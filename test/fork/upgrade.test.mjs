// Upgrading a Safe one version at a time through Safe's official SafeMigration contracts (a DELEGATECALL from the
// Safe itself), with safe.wei's own approve / execute flow: 1.3.0 → 1.4.1 → 1.5.0, for an L1 and an L2 Safe, keeping
// owners, threshold, modules and guard; the guard keeps being called and a module keeps executing after each step.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { B as bytes, cd, keccakText } from '../../src/abi.js';
import { approve, execute } from '../../src/flow.js';
import { use } from '../../src/rpc.js';
import { newTx, readSafe } from '../../src/safe.js';
import { S } from '../../src/sel.js';
import { ACCOUNTS, V, startFork, tx } from './anvil.mjs';

const [A, B, C, M, X] = ACCOUNTS; // M is enabled as a module; X never an owner
const MIGRATION = { '1.4.1': '0x526643f69b81b008f46d95cd5ced5ec0edffdac6', '1.5.0': '0x6439e7abd8bb915a5263094784c5cf561c4172ac' };
const L2 = { '1.3.0': '0x3e5c63644e683549055b9be8653de26e0b4cd36e', '1.4.1': '0x29fcb43b46531bca003ddc8fcb67ffe91900c762', '1.5.0': '0xedd160febbd92e350d4d398fb636302fccd67c7e' };
const GUARD = '0x' + '6a'.repeat(20); // counts every call it gets in storage slot 0
const sel = (f) => '0x' + keccakText(f).slice(2, 10);
let f;
before(async () => {
  f = await startFork();
  use(f.provider);
  await f.rpc('anvil_setCode', [GUARD, '0x60005460010160005500']);
});
after(() => f.stop());

const calls = async () => BigInt(await f.rpc('eth_getStorageAt', [GUARD, '0x0', 'latest']));
const bal = async (a) => BigInt(await f.rpc('eth_getBalance', [a, 'latest']));
async function modulesOf(safe) {
  const r = await f.rpc('eth_call', [{ to: safe, data: cd(S.getModulesPaginated || 'cc2f8452', '0x0000000000000000000000000000000000000001', 10) }, 'latest']);
  const n = Number(BigInt('0x' + r.slice(2 + 128, 2 + 192)));
  return Array.from({ length: n }, (_, i) => '0x' + r.slice(2 + 192 + i * 64 + 24, 2 + 192 + (i + 1) * 64));
}
// A 2-of-3 Safe on 1.3.0 (L1 or L2 singleton), funded, with a module and a guard, set through its own transactions.
async function oldSafe(l2) {
  const singleton = l2 ? L2['1.3.0'] : V['1.3.0'].singleton, v = V['1.3.0'];
  const init = cd(S.setup, [A, B, C], 2, '0x0000000000000000000000000000000000000000', bytes('0x'), v.fallback, '0x0000000000000000000000000000000000000000', 0, '0x0000000000000000000000000000000000000000');
  const data = cd(S.createProxyWithNonce, singleton, bytes(init), BigInt(Date.now()));
  const r = await f.rpc('eth_call', [{ from: A, to: v.factory, data }, 'latest']);
  const safe = '0x' + r.slice(26);
  await tx(f.rpc, A, v.factory, data);
  await tx(f.rpc, A, safe, '0x', 10n ** 18n);
  await run(safe, { to: safe, data: cd(S.enableModule, M) });
  await run(safe, { to: safe, data: cd(S.setGuard, GUARD) });
  return safe;
}
// One Safe transaction the way safe.wei does it: B approves onchain, A executes (its own signature pre-validated).
async function run(safe, call) {
  const t = newTx(await readSafe(safe), { value: 0n, operation: 0, ...call });
  await approve(t, B);
  await execute(t, A);
}
async function step(safe, to, l2) {
  const before = await readSafe(safe), g0 = await calls();
  await run(safe, { to: MIGRATION[to], data: sel(l2 ? 'migrateL2WithFallbackHandler()' : 'migrateWithFallbackHandler()'), operation: 1 });
  const s = await readSafe(safe);
  assert.equal(s.version, to);
  assert.equal(s.singleton, l2 ? L2[to] : V[to].singleton);
  assert.equal(s.fallback, V[to].fallback);
  assert.deepEqual(s.owners, before.owners);
  assert.equal(s.threshold, before.threshold);
  assert.equal(s.nonce, before.nonce + 1n);
  assert.equal(s.guard, GUARD);
  assert.deepEqual(await modulesOf(safe), [M.toLowerCase()]);
  assert.equal(await calls(), g0 + 2n, 'the guard checked the migration before and after');
  // Still works: an owner transaction (hash checked against the Safe's own) and a module transaction.
  const to1 = '0x' + Math.floor(Math.random() * 2 ** 40).toString(16).padStart(40, 'e');
  await run(safe, { to: to1, value: 5n });
  assert.equal(await bal(to1), 5n);
  assert.equal(await calls(), g0 + 4n, 'the guard still runs');
  await tx(f.rpc, M, safe, cd(S.execTransactionFromModule || '468721a7', to1, 3n, bytes('0x'), 0));
  assert.equal(await bal(to1), 8n);
}

for (const l2 of [false, true]) {
  test((l2 ? 'L2 ' : '') + 'Safe 1.3.0 → 1.4.1 → 1.5.0 with a module and a guard', async () => {
    const safe = await oldSafe(l2);
    assert.equal((await readSafe(safe)).version, '1.3.0');
    await step(safe, '1.4.1', l2);
    await step(safe, '1.5.0', l2);
  });
}

test('a migration called directly (not delegatecalled) reverts', async () => {
  await assert.rejects(tx(f.rpc, X, MIGRATION['1.4.1'], sel('migrateSingleton()')), /reverted/);
});

// A Safe with its own fallback handler (here CoW's ExtensibleFallbackHandler, for TWAP orders) keeps it: the upgrade
// uses migrateSingleton, which replaces only the singleton. migrateWithFallbackHandler would have replaced it.
test('a custom fallback handler is kept with migrateSingleton', async () => {
  const EFH = '0x2f55e8b20d0b9fefa187aa7d00b6cbe563605bf5';
  const safe = await oldSafe(false);
  await run(safe, { to: safe, data: cd(S.setFallbackHandler, EFH) });
  await run(safe, { to: MIGRATION['1.4.1'], data: sel('migrateSingleton()'), operation: 1 });
  const s = await readSafe(safe);
  assert.equal(s.version, '1.4.1');
  assert.equal(s.fallback, EFH);
});
