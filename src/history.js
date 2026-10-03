// Executed transactions (history). Kept in this browser as safe.wei executes them, and found onchain from the
// Safe's ExecutionSuccess events: the transaction that emitted one is read and the execTransaction call in it
// decoded (also inside a relayer's or multicall's calldata). An entry is kept only if its fields hash to the
// event's SafeTx hash, the nonce being the one that makes it match: nothing is guessed. docs/spec.md §27g.
import { a, dbytes, strip, u } from './abi.js';
import { explorerKey } from './endpoints.js';
import { rpc } from './rpc.js';
import { safeTxHash } from './safe.js';
import { S, T } from './sel.js';
import { load, store } from './store.js';

const hx = (n) => '0x' + n.toString(16);
const key = (s) => s.chainId + ':' + s.address;
const NUMS = ['value', 'safeTxGas', 'baseGas', 'gasPrice'];

/** This Safe's history in this browser, newest first: { hash, nonce, to, value, data, operation, …, txHash, hints }. */
export const saved = (s) => load('history', {})[key(s)] || [];
function keep(s, entries) {
  const m = load('history', {}), by = new Map(saved(s).map((e) => [e.hash, e]));
  for (const e of entries) by.set(e.hash, { ...by.get(e.hash), ...e });
  m[key(s)] = [...by.values()].sort((x, y) => y.nonce - x.nonce);
  store('history', m);
  return m[key(s)];
}
const plain = (t) => ({ ...Object.fromEntries(NUMS.map((k) => [k, String(t[k])])), to: t.to, data: t.data, operation: t.operation, gasToken: t.gasToken, refundReceiver: t.refundReceiver, nonce: Number(t.nonce) });
/** A stored entry as a SafeTx again. */
export const toTx = (s, e) => ({ chainId: s.chainId, safe: s.address, ...e, ...Object.fromEntries(NUMS.map((k) => [k, BigInt(e[k])])), nonce: BigInt(e.nonce) });

/** Record a transaction executed here (with the call signatures that name its calls). */
export const record = (s, t, txHash, hints = []) => keep(s, [{ ...plain(t), hash: safeTxHash(t), txHash, hints }]);

/** The SafeTx in an execTransaction call starting at `d` (hex, no 0x, selector first) that hashes to `hash`, or null. */
function fromExec(s, d, hash, guess) {
  try {
    const r = d.slice(8);
    const t = { chainId: s.chainId, safe: s.address, to: a(r, 0), value: u(r, 1), data: dbytes(r, 2), operation: Number(u(r, 3)), safeTxGas: u(r, 4), baseGas: u(r, 5), gasPrice: u(r, 6), gasToken: a(r, 7), refundReceiver: a(r, 8) };
    // The nonce is not in the call: try the expected one, then outward from it (failed executions shift it).
    const n = Number(s.nonce);
    for (let d = 0; d < n; d++)
      for (const k of d ? [guess - d, guess + d] : [guess]) if (k >= 0 && k < n && safeTxHash({ ...t, nonce: BigInt(k) }) === hash) return { ...t, nonce: BigInt(k) };
  } catch {}
  return null;
}

/**
 * Scan ExecutionSuccess logs backwards from `end` (default: latest) over `blocks` blocks (all of them with an
 * Etherscan key), decode each execution and add it to the history. Returns { entries, head, next, wide, error, skipped }.
 * `progress(share)` follows the block windows; `progress(null, { read, of })` the executions being read.
 */
export async function scanHistory(s, { blocks = 50000, step = 5000, end, progress } = {}) {
  end = end ?? Number(await rpc('eth_blockNumber'));
  const head = end, wide = !!explorerKey(), have = new Set(saved(s).map((e) => e.hash)), found = [];
  if (wide) blocks = step = end + 1;
  const stop = Math.max(0, end - blocks + 1);
  let win = step, error, rank = 0, skipped = 0;
  while (end >= stop) {
    const start = Math.max(stop, end - win + 1);
    let logs;
    try {
      logs = await rpc('eth_getLogs', [{ address: s.address, topics: [T.ExecutionSuccess], fromBlock: hx(start), toBlock: hx(end) }]);
    } catch (e) {
      if (win > 16 && !wide) {
        win = Math.floor(win / 2);
        continue;
      }
      error = e.message || String(e);
      break;
    }
    // Newest first: the expected nonce counts down from the Safe's current one. Each one read is reported.
    let k = 0;
    for (const l of logs.sort((x, y) => Number(y.blockNumber) - Number(x.blockNumber) || Number(y.logIndex) - Number(x.logIndex))) {
      progress && progress(null, { read: ++k, of: logs.length });
      const hash = l.topics[1] || '0x' + strip(l.data).slice(0, 64), guess = Number(s.nonce) - 1 - rank++;
      if (have.has(hash)) continue;
      // An execution whose transaction no RPC serves any more is skipped and counted, not a reason to stop.
      const tx = await rpc('eth_getTransactionByHash', [l.transactionHash]).catch(() => null);
      if (!tx) {
        skipped++;
        continue;
      }
      const d = strip(tx.input || '').toLowerCase();
      let t = null;
      for (let i = d.indexOf(S.execTransaction); i >= 0 && !t; i = d.indexOf(S.execTransaction, i + 1)) if (i % 2 === 0) t = fromExec(s, d.slice(i), hash, guess);
      if (t) have.add(hash), found.push({ ...plain(t), hash, txHash: l.transactionHash });
    }
    end = start - 1;
    progress && progress(Math.min(1, (head - end) / (head - stop + 1)));
  }
  return { entries: found.length ? keep(s, found) : saved(s), head, next: end, wide, error, skipped };
}
