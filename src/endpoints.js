// Your own RPC endpoints (optional, kept in this browser): reads on an endpoint's chain go there instead of the
// wallet's RPC (faster, or where the wallet's RPC is unreliable). The wallet still signs, switches chains and
// owns the account; nothing else is sent. docs/spec.md §27e.
import { load, store } from './store.js';

export const rpcs = () => { const m = load('rpcs', {}); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; };
let id = 1;
async function post(url, method, params = []) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
  } catch (e) {
    throw Error('Your RPC endpoint could not be reached (' + e.message + '). Check it in ▾ → Settings.');
  }
  const j = await res.json().catch(() => null);
  if (!j) throw Error('Your RPC endpoint answered ' + res.status + '.');
  if (j.error) throw Object.assign(Error(j.error.message || 'RPC error'), { code: j.error.code, data: j.error.data });
  return j.result;
}
/** Add an endpoint: its chain is asked from the endpoint itself. Returns the chain id. */
export async function addRpc(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw Error('Enter the endpoint’s full https URL.');
  const chain = Number(await post(url, 'eth_chainId'));
  if (!Number.isSafeInteger(chain) || chain < 1) throw Error('That endpoint did not answer eth_chainId.');
  store('rpcs', { ...rpcs(), [chain]: url });
  return chain;
}
export const removeRpc = (chain) => { const m = rpcs(); delete m[chain]; store('rpcs', m); };

// Reads only: everything that signs, sends, or concerns the account or the chain stays with the wallet.
const READS = new Set(['eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getLogs', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_feeHistory', 'eth_maxPriorityFeePerGas']);
/** The wallet's provider, with reads sent to your endpoint for `chain()` when there is one. */
export function reader(provider, chain) {
  if (!provider) return provider;
  return { request: (a) => { const u = READS.has(a.method) && rpcs()[chain()]; return u ? post(u, a.method, a.params) : provider.request(a); } };
}
