// A safe.wei #tx= link (docs/links.md → Shared transactions) for one call or a batch, built and checked the way
// safe.wei does it: the Safe's nonce is read over the RPC, and the locally computed SafeTx hash must equal the Safe's
// own getTransactionHash before a link is printed. Only that RPC is contacted; nothing is signed or sent.
//   node scripts/tx-link.mjs plan.json --rpc https://… [--gateway https://safe.wei.limo/]
//   plan.json: { "safe": "0x…", "calls": [{ "to": "0x…", "value": "0", "data": "0x…", "signature": "transfer(address,uint256)" }], "nonce": "12" }
// "value" is in wei (a decimal string); "signature" (optional, recommended) lets the owners read the call; "nonce"
// (optional) queues the transaction at a later nonce. Two or more calls become one MultiSendCallOnly batch.
import { readFileSync } from 'node:fs';
import { use } from '../src/rpc.js';
import { readSafe, newTx, safeTxHash, chainTxHash } from '../src/safe.js';
import { batch } from '../src/multisend.js';
import { fragment } from '../src/share.js';
import { SAFE } from '../src/chains.js';
import { parseAbi, humanSig } from '../src/abicoder.js';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const rpcUrl = opt('rpc'), gateway = opt('gateway', 'https://safe.wei.limo/');
if (!file || !/^https?:\/\//.test(rpcUrl || '') || !/^(https:\/\/[^\s#?]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\/$/.test(gateway)) {
  console.error('Usage: node scripts/tx-link.mjs <plan.json | -> --rpc <url> [--gateway https://safe.wei.limo/]');
  process.exit(2);
}
let id = 1;
use({ request: async ({ method, params = [] }) => {
  const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) }).then((x) => x.json());
  if (r.error) throw Error(r.error.message);
  return r.result;
} });
try {
  const plan = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
  const addr = (v, what) => { if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw Error(what + ' must be a 0x address.'); return v.toLowerCase(); };
  if (!Array.isArray(plan.calls) || !plan.calls.length) throw Error('calls must list at least one call.');
  const calls = plan.calls.map((c, i) => {
    if (c.value != null && !/^\d+$/.test(String(c.value))) throw Error('Call ' + (i + 1) + ': value must be wei, a decimal string.');
    if (c.data != null && !/^0x([0-9a-fA-F]{2})*$/.test(c.data)) throw Error('Call ' + (i + 1) + ': data must be 0x hex.');
    if (c.signature != null) { const [f] = parseAbi(c.signature); if (c.data && c.data.slice(0, 10).toLowerCase() !== '0x' + f.selector) throw Error('Call ' + (i + 1) + ': the signature does not match the calldata selector.'); }
    return { to: addr(c.to, 'Call ' + (i + 1) + ': to'), value: BigInt(c.value || 0), data: (c.data || '0x').toLowerCase(), signature: c.signature };
  });
  const s = await readSafe(addr(plan.safe, 'safe'));
  const nonce = plan.nonce != null ? BigInt(plan.nonce) : s.nonce;
  if (nonce < s.nonce) throw Error('nonce ' + nonce + ' is already used (the Safe is at ' + s.nonce + ').');
  const t = newTx(s, { ...(calls.length === 1 ? calls[0] : batch(SAFE.multiSendCallOnly, calls)), nonce });
  const local = safeTxHash(t), onchain = await chainTxHash(t);
  if (local !== onchain) throw Error('SafeTx hash mismatch: local ' + local + ', the Safe says ' + onchain + '.');
  const abi = [...new Set(calls.filter((c) => c.signature).map((c) => humanSig(parseAbi(c.signature)[0])))];
  console.error('Safe ' + s.address + ' on chain ' + s.chainId + ' · nonce ' + nonce + ' · ' + calls.length + ' call' + (calls.length === 1 ? '' : 's') + ' · SafeTx ' + local);
  console.log(gateway + '#' + fragment(t, [], abi));
} catch (e) {
  console.error('Could not build the link: ' + e.message);
  process.exit(1);
}
