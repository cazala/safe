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
// An Etherscan API key (optional, kept in this browser): history scans read event logs from Etherscan's index in a
// few requests instead of block by block. Etherscan is trusted to return every log; each block a log comes from is
// checked against the chain's own header, and every log is still decoded and checked as before. docs/spec.md §27f.
export const explorerKey = () => String(load('explorerkey', '') || '');
export function setExplorerKey(k) {
  k = String(k || '').trim();
  if (k && !/^[A-Za-z0-9]{20,64}$/.test(k)) throw Error('That does not look like an Etherscan API key.');
  store('explorerkey', k);
  return k;
}
// The free plan allows a few requests a second: one at a time, spaced, retried on its rate limit.
let lane = Promise.resolve();
function etherscan(q) {
  const run = async () => {
    for (let i = 0; ; i++) {
      const r = await fetch('https://api.etherscan.io/v2/api?' + q).then((x) => x.json(), (e) => Promise.reject(Error('Etherscan could not be reached (' + e.message + ').')));
      if (i < 2 && r.status === '0' && /rate limit/i.test(r.result + ' ' + r.message)) { await new Promise((ok) => setTimeout(ok, 1100)); continue; }
      return r;
    }
  };
  const next = lane.then(run);
  lane = next.catch(() => {}).then(() => new Promise((ok) => setTimeout(ok, 250)));
  return next;
}
const hx = (v) => '0x' + BigInt(!v || v === '0x' ? 0 : v).toString(16); // Etherscan writes zero as "0x"; RPCs refuse leading zeros
/** eth_getLogs from Etherscan's index: the whole range, in pages of 1,000, as RPC logs. */
async function explorerLogs(key, chain, { address, topics, fromBlock, toBlock }) {
  const out = [], seen = new Set(), to = toBlock === 'latest' ? toBlock : Number(toBlock);
  let from = Number(fromBlock), page = 1;
  for (;;) {
    const q = new URLSearchParams({ chainid: chain, module: 'logs', action: 'getLogs', address, fromBlock: from, toBlock: to, page, offset: 1000, apikey: key });
    if (topics && topics[0]) q.set('topic0', topics[0]);
    const r = await etherscan(q);
    if (r.status !== '1' && !/no records/i.test(r.message || '')) throw Error('Etherscan: ' + (typeof r.result === 'string' ? r.result : r.message || 'request failed') + '. Check the key in ▾ → Settings.');
    const list = Array.isArray(r.result) ? r.result : [];
    for (const l of list) {
      const log = { address: l.address.toLowerCase(), topics: l.topics.filter(Boolean), data: l.data, blockNumber: hx(l.blockNumber), blockHash: l.blockHash, transactionHash: l.transactionHash, logIndex: hx(l.logIndex) };
      const k = log.transactionHash + ':' + Number(log.logIndex);
      if (!seen.has(k)) seen.add(k), out.push(log);
    }
    if (list.length < 1000) break;
    // Pages stop at 10,000 results: continue from the last block seen (duplicates are dropped).
    if (page < 10) page++;
    else (from = Number(list[list.length - 1].blockNumber)), (page = 1);
  }
  return out;
}

/**
 * A contract's verified ABI from Etherscan, merged with its implementation's for a proxy (JSON text), or null when
 * it is not verified. Only used to build calls: a function's selector comes from its name and types, so an ABI
 * cannot make one call look like another.
 */
export async function explorerAbi(chain, address) {
  const get = async (a) => {
    const r = await etherscan(new URLSearchParams({ chainid: chain, module: 'contract', action: 'getsourcecode', address: a, apikey: explorerKey() }));
    if (r.status !== '1' || !Array.isArray(r.result) || !r.result[0]) throw Error('Etherscan: ' + (typeof r.result === 'string' ? r.result : r.message || 'request failed'));
    return r.result[0];
  };
  const c = await get(address), all = [];
  if (String(c.ABI).startsWith('[')) all.push(...JSON.parse(c.ABI));
  if (c.Proxy === '1' && /^0x[0-9a-fA-F]{40}$/.test(c.Implementation || '')) {
    const i = await get(c.Implementation.toLowerCase());
    if (String(i.ABI).startsWith('[')) all.push(...JSON.parse(i.ABI));
  }
  const seen = new Set(), abi = all.filter((f) => {
    const k = f.type + ' ' + f.name + '(' + (f.inputs || []).map((x) => x.type).join(',') + ')';
    return !seen.has(k) && seen.add(k);
  });
  return abi.length ? JSON.stringify(abi) : null;
}

// Many RPCs no longer keep old history (geth indexes about a year of transactions; nodes drop pre-Merge blocks).
// Those reads go to WalletConnect's RPC instead, as for a WalletConnect wallet (docs/spec.md §27d).
const HISTORY = new Set(['eth_getLogs', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getCode']);
const pruned = (e) => /pruned|historical|history (is )?unavailable|missing trie|archive|not available|index(ing)? (is )?(in progress|not)/i.test((e && e.message) || '');

/**
 * The wallet's provider, with reads sent to your endpoint for `chain()` when there is one, logs to Etherscan with a
 * key, and old history the RPC no longer keeps to WalletConnect's RPC (`project()`: its project ID).
 */
export function reader(provider, chain, project = () => '') {
  if (!provider) return provider;
  const checked = new Map(); // block → hash, already checked against the chain
  const r = {
    request: async (a) => {
      // `checked: false`: the caller checks each log it uses against the chain itself (History reads each one's transaction).
      const { checked, ...filter } = (a.method === 'eth_getLogs' && a.params[0]) || {};
      if (a.method === 'eth_getLogs') a = { ...a, params: [filter] };
      if (a.method === 'eth_getLogs' && explorerKey()) {
        const logs = await explorerLogs(explorerKey(), chain(), filter), blocks = checked === false ? [] : [...new Set(logs.map((l) => l.blockNumber))];
        // Four header checks at a time (a long history is thousands of blocks), retried when the RPC throttles,
        // and each block checked once per session.
        const check = async (b) => {
          const want = logs.find((l) => l.blockNumber === b).blockHash;
          if (checked.get(b) === want) return;
          for (let i = 0; ; i++) {
            try {
              const head = await r.request({ method: 'eth_getBlockByNumber', params: [b, false] });
              if (!head || head.hash !== want) throw Object.assign(Error('Etherscan returned a log in block ' + Number(b) + ' that does not match the chain. Remove the Etherscan key in ▾ → Settings and try again.'), { final: true });
              return checked.set(b, want);
            } catch (e) {
              if (e.final || i > 4 || !/rate|limit|capacity|too many|429|busy|timeout/i.test(e.message)) throw e;
              await new Promise((ok) => setTimeout(ok, 500 * 2 ** i));
            }
          }
        };
        for (let i = 0; i < blocks.length; i += 4) await Promise.all(blocks.slice(i, i + 4).map(check));
        return logs;
      }
      const u = READS.has(a.method) && rpcs()[chain()];
      try {
        const v = await (u ? post(u, a.method, a.params) : provider.request(a));
        // A transaction this RPC no longer indexes comes back as null: ask WalletConnect's RPC too.
        if (v == null && a.method === 'eth_getTransactionByHash' && project()) throw Error('pruned: transaction not indexed');
        return v;
      } catch (e) {
        if (!HISTORY.has(a.method) || !pruned(e) || !project()) throw e;
        return post('https://rpc.walletconnect.org/v1/?chainId=eip155:' + chain() + '&projectId=' + project(), a.method, a.params);
      }
    },
  };
  return r;
}
