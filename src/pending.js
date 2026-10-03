// Onchain pending transactions (spec §7.3 Layer 2): a proposer may append the compact
// payload to its approveHash calldata. Other owners find it from ApproveHash logs.
// Every payload is untrusted: it is accepted only if it hashes to the approved hash.
import { strip } from './abi.js';
import { explorerKey } from './endpoints.js';
import { rpc } from './rpc.js';
import { safeTxHash } from './safe.js';
import { S, T } from './sel.js';
import { uncompact } from './share.js';

const hx = (n) => '0x' + n.toString(16);

/** Extra calldata gas for appending `payload` (16 per non-zero byte, 4 per zero byte). */
export const payloadGas = (payload) => (strip(payload).match(/../g) || []).reduce((g, b) => g + (b === '00' ? 4 : 16), 0);

/** Decode one approveHash transaction's trailing payload, or null if it has none / is invalid. */
export function fromApproval(s, tx) {
  const input = strip(tx.input || tx.data || '').toLowerCase();
  if (!tx.to || tx.to.toLowerCase() !== s.address || !input.startsWith(S.approveHash) || input.length <= 72) return null;
  const hash = '0x' + input.slice(8, 72);
  try {
    const p = uncompact(input.slice(72), s.chainId, s.address);
    return safeTxHash(p.tx) === hash ? { ...p, hash, proposer: tx.from.toLowerCase() } : null;
  } catch {
    return null;
  }
}

/**
 * Scan ApproveHash logs backwards from `end` (default: latest) over `blocks` blocks, in
 * windows that shrink when the RPC refuses a range. Returns { found, next, error } where
 * `next` is the block to continue from (older), or -1 at genesis. If the RPC keeps
 * refusing, whatever was found so far is returned together with `error`. With an Etherscan
 * key the whole history is one request (`wide`). `progress(share 0–1)` follows the windows.
 */
export async function scan(s, { blocks = 50000, step = 5000, end, progress } = {}) {
  end = end ?? Number(await rpc('eth_blockNumber'));
  const head = end, wide = !!explorerKey();
  if (wide) blocks = step = end + 1;
  const stop = Math.max(0, end - blocks + 1), found = new Map();
  let win = step, error;
  while (end >= stop) {
    const start = Math.max(stop, end - win + 1);
    let logs;
    try {
      logs = await rpc('eth_getLogs', [{ address: s.address, topics: [T.ApproveHash], fromBlock: hx(start), toBlock: hx(end) }]);
    } catch (e) {
      if (win > 16 && !wide) {
        win = Math.floor(win / 2);
        continue;
      }
      error = e.message || String(e);
      break;
    }
    for (const l of logs) {
      if (found.has(l.topics[1])) continue;
      const tx = await rpc('eth_getTransactionByHash', [l.transactionHash]);
      const p = tx && fromApproval(s, tx);
      if (p && p.hash === l.topics[1] && p.tx.nonce >= s.nonce) found.set(p.hash, { ...p, block: Number(l.blockNumber) });
    }
    end = start - 1;
    progress && progress(Math.min(1, (head - end) / (head - stop + 1)));
  }
  return { head, wide, error, found: [...found.values()].sort((x, y) => (x.tx.nonce < y.tx.nonce ? -1 : x.tx.nonce > y.tx.nonce ? 1 : y.block - x.block)), next: end };
}
