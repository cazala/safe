// Upgrading a Safe one version at a time (spec §27h), through Safe's official SafeMigration contracts: a DELEGATECALL
// from the Safe that rewrites its singleton and, when it uses Safe's standard handler, its fallback handler. The
// migration checks nothing about the version it starts from, so everything is checked here: the Safe's singleton
// must be a known one of its version, the step is to the next tested version only, and the migration contract must
// still point to the expected singletons and handler (read from it before signing).
import { cd, keccakText, strip } from './abi.js';
import { rpc } from './rpc.js';
import { FALLBACK_SLOT, GUARD_SLOT } from './safe.js';
import { S } from './sel.js';

// The next version, for the versions safe.wei can upgrade from. Only to versions it tests end to end (TESTED).
const NEXT = { '1.3.0': '1.4.1', '1.4.1': '1.5.0' };
// Safe's SafeMigration contracts (safe-deployments), the same address on every chain safe.wei supports.
export const MIGRATIONS = { '1.4.1': '0x526643f69b81b008f46d95cd5ced5ec0edffdac6', '1.5.0': '0x6439e7abd8bb915a5263094784c5cf561c4172ac' };
// Singletons by version: regular and L2, canonical and (1.3.0) eip155 deployments.
const SINGLETONS = {
  '1.3.0': { l1: ['0xd9db270c1b5e3bd161e8c8503c55ceabee709552', '0x69f4d1788e39c87893c980c06edf4b7f686e2938'], l2: ['0x3e5c63644e683549055b9be8653de26e0b4cd36e', '0xfb1bffc9d739b8d520daf37df666da4c687191ea'] },
  '1.4.1': { l1: ['0x41675c099f32341bf84bfc5382af534df5c7461a'], l2: ['0x29fcb43b46531bca003ddc8fcb67ffe91900c762'] },
  '1.5.0': { l1: ['0xff51a5898e281db6dfc7855790607438df2ca44b'], l2: ['0xedd160febbd92e350d4d398fb636302fccd67c7e'] },
};
// Safe's standard CompatibilityFallbackHandler, by version. Any other handler (a custom one) is kept as it is.
const HANDLERS = {
  '1.3.0': ['0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4', '0x017062a1de2fe6b99be3d9d37841fed19f573804'],
  '1.4.1': ['0xfd0732dc9e303f09fcef3a7388ad10a83459ec99'],
  '1.5.0': ['0x3efcbb83a4a7afcb4f68d501e2c2203a38be77f4'],
};
const FNS = ['migrateSingleton()', 'migrateWithFallbackHandler()', 'migrateL2Singleton()', 'migrateL2WithFallbackHandler()'];
const sel = (f) => keccakText(f).slice(2, 10);

/**
 * The next upgrade for this Safe, or null: { from, to, l2, handler (true: the standard handler is replaced with the
 * new version's; false: kept), migration, data, singleton (after), fallback (after) }.
 */
export function upgradeOf(s) {
  const to = NEXT[s.version], known = SINGLETONS[s.version];
  if (!to || !known || !s.singleton) return null;
  const l2 = known.l2.includes(s.singleton), l1 = known.l1.includes(s.singleton);
  if (!l1 && !l2) return null; // a singleton safe.wei does not know (another deployment, or modified): no offer
  const handler = HANDLERS[s.version].includes(s.fallback || '');
  const fn = 'migrate' + (l2 ? 'L2' : '') + (handler ? 'WithFallbackHandler' : 'Singleton') + '()';
  return { from: s.version, to, l2, handler, migration: MIGRATIONS[to], data: '0x' + sel(fn), singleton: SINGLETONS[to][l2 ? 'l2' : 'l1'][0], fallback: handler ? HANDLERS[to][0] : s.fallback };
}

/** A transaction that is exactly one migration call (a DELEGATECALL, no value): { to, fn } or null. */
export function migrationOf(t) {
  if (t.operation !== 1 || t.value) return null;
  const to = Object.keys(MIGRATIONS).find((v) => MIGRATIONS[v] === t.to), d = strip(t.data).toLowerCase();
  const fn = to && d.length === 8 && FNS.find((f) => sel(f) === d);
  return fn ? { to, fn } : null;
}

/**
 * Check a migration call against this Safe before anything is signed: it must be exactly the upgrade upgradeOf
 * offers, and the migration contract must still point to the expected singletons and handler. Returns error strings.
 */
export async function checkMigration(t, s) {
  const m = migrationOf(t), u = upgradeOf(s);
  if (!m) return [];
  if (!u) return ['This Safe (version ' + s.version + ', singleton ' + s.singleton + ') has no upgrade safe.wei can check. Do not sign.'];
  if (m.to !== u.to) return ['This migration goes to ' + m.to + ', but this Safe (' + s.version + ') can only move to ' + u.to + ', one version at a time. Do not sign.'];
  if (t.data.toLowerCase() !== u.data) return ['This migration call (' + m.fn + ') does not fit this Safe: it should be ' + FNS.find((f) => '0x' + sel(f) === u.data) + '. Do not sign.'];
  const read = (f) => rpc('eth_call', [{ to: t.to, data: '0x' + sel(f) }, 'latest']).then((r) => '0x' + strip(r).slice(24).toLowerCase(), () => null);
  const [one, two, fb] = await Promise.all(['SAFE_SINGLETON()', 'SAFE_L2_SINGLETON()', 'SAFE_FALLBACK_HANDLER()'].map(read));
  if (one !== SINGLETONS[u.to].l1[0] || two !== SINGLETONS[u.to].l2[0] || fb !== HANDLERS[u.to][0]) return ['The migration contract at ' + t.to + ' does not point to Safe ' + u.to + '’s singletons and handler. Do not sign.'];
  return [];
}

/**
 * The Safe as it would be after the upgrade: read through the new singleton (eth_call with the singleton slot, and the
 * handler slot, overridden as the migration writes them). { version, owners, threshold, modules, guard } or null
 * when the RPC does not support state overrides.
 */
export async function afterUpgrade(s, u) {
  const word = (a) => '0x' + strip(a).padStart(64, '0');
  const over = { [s.address]: { stateDiff: { ['0x' + '0'.repeat(64)]: word(u.singleton), [FALLBACK_SLOT]: word(u.fallback || '0x0') } } };
  const call = (data) => rpc('eth_call', [{ to: s.address, data }, 'latest', over]);
  try {
    const [v, o, th, m, g] = await Promise.all([call('0x' + S.VERSION), call('0x' + S.getOwners), call('0x' + S.getThreshold), call(cd(S.getModulesPaginated, '0x0000000000000000000000000000000000000001', 50)),
      rpc('eth_getStorageAt', [s.address, GUARD_SLOT, 'latest'])]);
    const d = strip(v), len = Number(BigInt('0x' + d.slice(64, 128)));
    const version = new TextDecoder().decode(Uint8Array.from(d.slice(128, 128 + len * 2).match(/../g) || [], (x) => parseInt(x, 16)));
    const list = (r) => { const h = strip(r), n = Number(BigInt('0x' + h.slice(64, 128))); return Array.from({ length: n }, (_, i) => '0x' + h.slice(128 + i * 64 + 24, 128 + (i + 1) * 64)); };
    const mh = strip(m), mn = Number(BigInt('0x' + mh.slice(128, 192)));
    const modules = Array.from({ length: mn }, (_, i) => '0x' + mh.slice(192 + i * 64 + 24, 192 + (i + 1) * 64));
    const guard = '0x' + strip(g).slice(24);
    return { version, owners: list(o), threshold: BigInt(th), modules, guard: /^0x0{40}$/.test(guard) ? null : guard };
  } catch {
    return null;
  }
}
