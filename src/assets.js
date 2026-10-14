// Asset changes of the inner Safe call, never a claim that full execTransaction will pass.
import { B, cd, isAddr, keccakText, strip, u, ZERO } from './abi.js';
import { unpack } from './multisend.js';
import { revertData } from './review.js';
import { rpc } from './rpc.js';
import { S } from './sel.js';
import { catalog, clean, rememberTokens } from './tokens.js';
import { PROBE_CODE } from './probe-code.js';

export const PROBE = '0x' + strip(keccakText('safe.wei asset probe v1')).slice(-40);
const SELECTOR = strip(keccakText('preview(address,uint256,bytes,uint8,address[],address[],address[])')).slice(0, 8);
const LIMIT = 128;

/** Exact StorageAccessible revert envelope, then exact ABI uint256[] from our helper. */
export function decodePreview(data, count) {
  const n = 3 + count * 3, bytes = (n + 2) * 32;
  if (!/^0x[0-9a-f]*$/i.test(data || '') || data.length !== 2 + (64 + bytes) * 2 || u(data) !== 1n || u(data, 1) !== BigInt(bytes)) throw Error('Simulation result unavailable');
  const body = '0x' + strip(data).slice(128);
  if (u(body) !== 32n || u(body, 1) !== BigInt(n) || u(body, 2) > 1n) throw Error('Invalid simulation result');
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const at = 5 + i * 3, ok = u(body, at);
    if (ok > 1n) throw Error('Invalid balance result');
    tokens.push({ ok: ok === 1n, before: u(body, at + 1), after: u(body, at + 2) });
  }
  return { success: u(body, 2) === 1n, native: u(body, 4) - u(body, 3), tokens };
}

// Only candidate discovery, never interpret these words as decoded transaction arguments.
export function candidates(t, access, known) {
  const calls = unpack(t) || [t], explicit = calls.map((c) => c.to);
  const words = [];
  for (const c of calls) {
    const data = strip(c.data || '0x').slice(8);
    for (let i = 0; i + 64 <= data.length && words.length < LIMIT; i += 64)
      if (/^0{24}[0-9a-f]{40}$/i.test(data.slice(i, i + 64))) words.push('0x' + data.slice(i + 24, i + 64));
  }
  return [...new Set([...explicit, ...access, ...known.map((x) => x.address), ...words].filter(isAddr).map((a) => a.toLowerCase()))].filter((a) => a !== ZERO && a !== PROBE && a !== t.safe);
}

// Only canonical direct ERC-20 approval calls, including CALLs inside a decoded batch.
// These identify probe pairs; only allowance() before/after determines the displayed result.
export function approvalPairs(t) {
  const pairs = new Map();
  for (const c of unpack(t) || [t]) {
    const d = (c.data || '').toLowerCase();
    if (c.operation || !/^0x(095ea7b3|39509351|a457c2d7)0{24}[0-9a-f]{104}$/.test(d)) continue;
    const token = c.to.toLowerCase(), spender = '0x' + d.slice(34, 74);
    pairs.set(token + spender, { token, spender });
  }
  return [...pairs.values()];
}

async function tokenMeta(address, block) {
  const read = async (data) => rpc('eth_call', [{ to: address, data, gas: '0xea60' }, block]);
  const d = await read('0x' + S.decimals);
  if (!/^0x[0-9a-f]{64}$/i.test(d) || u(d) > 77n) return null;
  const s = await read('0x' + S.symbol).catch(() => '0x');
  let symbol = '?';
  const h = strip(s);
  let text = '';
  if (h.length === 64) text = h;
  else if (h.length >= 128 && u(s) === 32n && u(s, 1) <= 256n && h.length === 128 + Math.ceil(Number(u(s, 1)) / 32) * 64) {
    const end = 128 + Number(u(s, 1)) * 2;
    if (!/[^0]/.test(h.slice(end))) text = h.slice(128, end);
  }
  if (text && /^[0-9a-f]*$/i.test(text)) symbol = clean(new TextDecoder().decode(Uint8Array.from(text.match(/../g), (x) => parseInt(x, 16))));
  return { address, decimals: Number(u(d)), symbol, listed: false, discovered: true };
}

export async function assetChanges(t) {
  const result = { status: 'unavailable', changes: [], allowances: [], notes: [], block: null };
  try {
    const block = result.block = await rpc('eth_blockNumber');
    if (t.safe === PROBE || t.to === PROBE || await rpc('eth_getCode', [PROBE, block]) !== '0x') throw Error('Simulation helper address is occupied');
    const known = await catalog(t.chainId, t.safe);
    let access = [];
    try {
      const call = t.operation
        ? { to: t.safe, data: cd(S.simulateAndRevert, t.to, B(t.data)) }
        : { to: t.to, data: t.data, value: '0x' + t.value.toString(16) };
      const a = await rpc('eth_createAccessList', [{ ...call, from: t.safe }, block]);
      if (!Array.isArray(a.accessList)) throw Error('No access list');
      access = a.accessList.map((x) => x.address);
      // simulateAndRevert intentionally reverts; its access list remains useful.
      if (a.error && !t.operation) result.notes.push('Discovery stopped at a reverting call.');
    } catch { result.notes.push('Token discovery unavailable; checking known tokens.'); }
    const all = candidates(t, access, known), addresses = all.slice(0, LIMIT);
    if (all.length > LIMIT) result.notes.push('Token candidate limit reached (128).');
    const approvals = approvalPairs(t);
    if (approvals.length > LIMIT) result.notes.push('Allowance candidate limit reached (128).');
    const pairs = approvals.slice(0, LIMIT);
    const data = cd(S.simulateAndRevert, PROBE, B(cd(SELECTOR, t.to, t.value, B(t.data), t.operation, addresses, pairs.map((p) => p.token), pairs.map((p) => p.spender))));
    const error = await rpc('eth_call', [{ from: t.safe, to: t.safe, data, gas: '0x1c9c380' }, block, { [PROBE]: { code: PROBE_CODE } }]).then(() => null, (e) => e);
    const decoded = decodePreview(revertData(error), addresses.length + pairs.length);
    result.status = decoded.success ? 'success' : 'failed';
    if (!decoded.success) return result;
    if (decoded.native) result.changes.push({ address: ZERO, delta: decoded.native });
    const found = [];
    // Bound metadata requests; a valid balanceOf alone does not identify an ERC-20 (NFTs have it too).
    for (let i = 0; i < addresses.length; i++) {
      const b = decoded.tokens[i], address = addresses[i], existing = known.find((x) => x.address === address);
      if (!b.ok) {
        if (existing) result.notes.push('Balance unreadable: ' + address);
        continue;
      }
      if (!b.before && !b.after && !existing) continue;
      const token = existing || await tokenMeta(address, block).catch(() => null);
      if (!token) {
        if (b.before !== b.after) result.notes.push('Unclassified asset changed: ' + address);
        continue;
      }
      if (!token.listed && (b.before || b.after)) found.push(token);
      if (b.after !== b.before) result.changes.push({ ...token, delta: b.after - b.before });
    }
    for (let i = 0; i < pairs.length; i++) {
      const { token: address, spender } = pairs[i], b = decoded.tokens[addresses.length + i];
      if (!b.ok) { result.notes.push('Allowance unreadable: ' + address); continue; }
      if (b.before === b.after) continue;
      const token = known.find((x) => x.address === address) || await tokenMeta(address, block).catch(() => null);
      if (!token) { result.notes.push('Unclassified allowance changed: ' + address); continue; }
      result.allowances.push({ ...token, spender, before: b.before, after: b.after });
    }
    rememberTokens(t.chainId, t.safe, found);
    return result;
  } catch (e) {
    result.notes.push('Asset preview unavailable: ' + e.message);
    return result;
  }
}
