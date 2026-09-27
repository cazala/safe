// ERC-20 balances (spec §24). The list comes from the zOrg TokenList registry on
// mainnet; balances are read in one Multicall3 aggregate3. Symbols are not unique:
// the UI always shows the token address next to them.
import { bytes, cd, strip, word } from './abi.js';
import { MAINNET, SAFE } from './chains.js';
import { call, rpc } from './rpc.js';
import { S } from './sel.js';

const W = (h, i) => BigInt('0x' + (h.slice(i * 64, i * 64 + 64) || '0'));
const txt = (h, at) => new TextDecoder().decode(bytes(h.slice((at + 1) * 64, (at + 1) * 64 + Number(W(h, at)) * 2)));
/** Printable ASCII only, trimmed: token-supplied text is untrusted. */
export const clean = (s, n = 24) => s.replace(/[^\x20-\x7e]/g, '').trim().slice(0, n) || '?';

/** Listed, deployed ERC-20s for `chainId`. The registry lives on mainnet only. */
export async function listed(chainId) {
  if (chainId !== 1) return [];
  const h = strip(await call(MAINNET.tokenList, cd(S.summariesPaged, 0, 256)));
  const base = Number(W(h, 0)) / 32, n = Number(W(h, base)), out = [];
  for (let i = 0; i < n; i++) {
    const t = base + 1 + Number(W(h, base + 1 + i)) / 32, g = (k) => W(h, t + k);
    // Summary: id, account, chainId, decimals, kind, standard, deployed, onchainSvg, synced, color, rank, frozen, name, symbol
    const acct = h.slice((t + 1) * 64, (t + 2) * 64);
    if (Number(g(2)) !== chainId || g(4) !== 0n || g(5) !== 2n || !g(6) || !acct.startsWith('0'.repeat(24))) continue;
    out.push({
      address: '0x' + acct.slice(24),
      decimals: Number(g(3)),
      name: clean(txt(h, t + Number(g(12)) / 32), 40),
      symbol: clean(txt(h, t + Number(g(13)) / 32)),
      listed: true,
    });
  }
  return out;
}

/** Multicall3 aggregate3 with allowFailure = true. Returns [{ok, data}] in order.
 *  Where Multicall3 is not deployed, falls back to one eth_call per entry. */
export async function multicall(calls) {
  if ((await rpc('eth_getCode', [SAFE.multicall3, 'latest'])) === '0x')
    return Promise.all(calls.map(({ to, data }) => call(to, data).then((d) => ({ ok: true, data: d }), () => ({ ok: false, data: '0x' }))));
  const enc = calls.map(({ to, data }) => {
    const d = strip(data);
    return word(to) + word(1) + word(0x60) + word(d.length / 2) + d.padEnd(Math.ceil(d.length / 64) * 64, '0');
  });
  let head = '', off = calls.length * 32;
  for (const e of enc) (head += word(off)), (off += e.length / 2);
  const h = strip(await call(SAFE.multicall3, '0x' + S.aggregate3 + word(0x20) + word(calls.length) + head + enc.join('')));
  const base = Number(W(h, 0)) / 32;
  return calls.map((_, i) => {
    const t = base + 1 + Number(W(h, base + 1 + i)) / 32, at = t + Number(W(h, t + 1)) / 32;
    return { ok: W(h, t) === 1n, data: '0x' + h.slice((at + 1) * 64, (at + 1) * 64 + Number(W(h, at)) * 2) };
  });
}

/** balanceOf(holder) for each token; failed or malformed reads give null. */
export const balances = async (holder, tokens) =>
  tokens.length
    ? (await multicall(tokens.map((t) => ({ to: t.address, data: cd(S.balanceOf, holder) })))).map((r) =>
        r.ok && strip(r.data).length === 64 ? BigInt(r.data) : null,
      )
    : [];

/** Read decimals and symbol from an unlisted token (string or bytes32 symbol). */
export async function meta(address, chainName = 'this chain') {
  address = address.toLowerCase();
  if ((await rpc('eth_getCode', [address, 'latest'])) === '0x')
    throw Error('There is no contract at ' + address + ' on ' + chainName + '. Tokens often have a different address on each chain.');
  const [d, s] = await multicall([
    { to: address, data: '0x' + S.decimals },
    { to: address, data: '0x' + S.symbol },
  ]);
  if (!d.ok || strip(d.data).length !== 64 || W(strip(d.data), 0) > 77n) throw Error('This contract does not look like an ERC-20 token: decimals() is missing or invalid.');
  const sh = strip(s.data);
  const symbol = !s.ok ? '?' : sh.length === 64 ? clean(new TextDecoder().decode(bytes(sh)).replace(/\0/g, '')) : clean(txt(sh, Number(W(sh, 0)) / 32));
  return { address: address.toLowerCase(), decimals: Number(W(strip(d.data), 0)), symbol, listed: false };
}

// Unlisted tokens the viewer added: a per-browser convenience, never required.
const KEY = (chainId) => 'safe.wei:tokens:' + chainId;
export const saved = (chainId) => {
  try {
    return JSON.parse(localStorage.getItem(KEY(chainId)) || '[]');
  } catch {
    return [];
  }
};
export const save = (chainId, list) => {
  try {
    localStorage.setItem(KEY(chainId), JSON.stringify(list));
  } catch {}
};
