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
// A block explorer's index (docs/spec.md §27f): history scans read event logs in a few requests instead of block by
// block, and Custom loads verified ABIs. The providers, the chains each covers and the default order come from the
// config chunk (config/explorers.json, so they can change without touching the code); your choice in ▾ → Settings
// overrides the default. Any Etherscan-compatible API works (module=logs&action=getLogs, module=contract&action=
// getsourcecode). The explorer is trusted to return every log; each block a log comes from is checked against the
// chain's own header, and every log is still decoded and checked as before.
const config = () => {
  const c = globalThis.EXPLORERS;
  return c && typeof c === 'object' && c.providers ? c : { default: [], providers: {} };
};
export const explorerProviders = () => Object.entries(config().providers).map(([id, p]) => ({ id, ...p }));
export const explorerDefaults = () => (config().default || []).filter((id) => config().providers[id]);
/** Your choice: { id: 'default' | 'none' | 'custom' | a provider, url (custom), keys: { [id]: key } }. */
export function explorerChoice() {
  const c = load('explorer', null);
  if (c && typeof c === 'object' && typeof c.id === 'string') return { id: c.id, url: String(c.url || ''), keys: c.keys && typeof c.keys === 'object' ? c.keys : {} };
  // Before the choice existed there was only an Etherscan key: keep using it.
  const k = String(load('explorerkey', '') || '');
  return k ? { id: 'etherscan', url: '', keys: { etherscan: k } } : { id: 'default', url: '', keys: {} };
}
const keyed = (k) => /^[A-Za-z0-9_-]{8,128}$/.test(k);
export function setExplorer({ id, url = '', key = '' }) {
  const c = explorerChoice(), p = config().providers[id];
  if (!['default', 'none', 'custom'].includes(id) && !p) throw Error('Unknown block explorer.');
  url = String(url || '').trim();
  key = String(key || '').trim();
  if (id === 'custom' && !/^https:\/\/[^\s{}]+(\{chain\}[^\s{}]*)?$/.test(url)) throw Error('Enter the explorer API’s https URL; {chain} stands for the chain ID.');
  if (key && !keyed(key)) throw Error('That does not look like an API key.');
  if (p && p.key === 'required' && !key) throw Error(p.name + ' needs an API key.');
  const keys = { ...c.keys };
  if (id !== 'default' && id !== 'none') key ? (keys[id] = key) : delete keys[id];
  store('explorer', { id, url: id === 'custom' ? url : c.url, keys });
  store('explorerkey', '');
  refused.clear();
}
// Chains an explorer refused (not covered, or not on your plan: for the session; rate-limited: for a minute):
// their reads go to the RPC. key → { name, busy, until }.
const refused = new Map();
const isRefused = (k) => { const x = refused.get(k); return !!x && (!x.until || x.until > Date.now() || !refused.delete(k)); };
const covers = (p, chain) => (p.urls && p.urls[chain]) || (p.api && (p.chains || []).includes(Number(chain)) ? p.api.split('{chain}').join(chain) : '');
function resolve(id, chain, c = explorerChoice()) {
  if (id === 'custom') return c.url && { id, name: hostOf(c.url), url: c.url.split('{chain}').join(chain), key: c.keys.custom || '' };
  const p = config().providers[id], url = p && covers(p, chain), key = c.keys[id] || '';
  return url && !(p.key === 'required' && !key) && { id, name: p.name, url, key };
}
const hostOf = (u) => { try { return new URL(u.split('{chain}').join('1')).hostname; } catch { return 'your block explorer'; } };
/** The explorer that serves `chain` now ({ id, name, url, key }), or null: reads go through the RPC. */
export function explorerFor(chain) {
  const c = explorerChoice();
  if (c.id === 'none') return null;
  const ok = (e) => e && !isRefused(e.id + ':' + chain);
  return (c.id === 'default' ? explorerDefaults().map((id) => resolve(id, chain, c)).find(ok) : [resolve(c.id, chain, c)].find(ok)) || null;
}
/** The explorer an index could come from on `chain` when none serves it (for "Use X's index"): a name or ''. */
export function explorerSuggestion(chain) {
  const c = explorerChoice(), named = (id) => config().providers[id] && covers(config().providers[id], chain) && config().providers[id].name;
  if (c.id === 'custom') return hostOf(c.url);
  if (c.id !== 'default' && c.id !== 'none' && named(c.id)) return named(c.id);
  return explorerDefaults().map(named).find(Boolean) || '';
}
/** The explorer that refused `chain` (its reads went to the RPC instead): { name, busy } or null. */
export const explorerRefused = (chain) => [...refused].find(([k]) => k.endsWith(':' + chain) && isRefused(k))?.[1] || null;
// Free plans allow a few requests a second: one at a time, spaced, retried on a rate limit.
let lane = Promise.resolve();
function explorer(e, chain, q) {
  if (e.key) q.set('apikey', e.key);
  const run = async () => {
    for (let i = 0; ; i++) {
      const r = await fetch(e.url + (e.url.includes('?') ? '&' : '?') + q).then((x) => x.json(), (x) => Promise.reject(Error(e.name + ' could not be reached (' + x.message + ').')));
      if (r.status === '0' && /rate limit|too many requests/i.test(r.result + ' ' + r.message)) {
        if (i < 3) { await new Promise((ok) => setTimeout(ok, 1100 * 2 ** i)); continue; }
        // Still limited (Blockscout allows 10 requests a minute without a key): the RPC for a minute.
        refused.set(e.id + ':' + chain, { name: e.name, busy: true, until: Date.now() + 60000 });
        throw Object.assign(Error(e.name + ' is busy (too many requests).'), { refused: true });
      }
      // The chain is not covered (or not on this plan): remember it, and let the caller read through the RPC.
      if (r.status === '0' && /not supported|unsupported|upgrade your api plan|chain not/i.test(r.result + ' ' + r.message)) {
        refused.set(e.id + ':' + chain, { name: e.name });
        throw Object.assign(Error(e.name + ' does not cover this chain' + (e.key ? ' on your plan' : '') + '.'), { refused: true });
      }
      return r;
    }
  };
  const next = lane.then(run);
  lane = next.catch(() => {}).then(() => new Promise((ok) => setTimeout(ok, 250)));
  return next;
}
const hx = (v) => '0x' + BigInt(!v || v === '0x' ? 0 : v).toString(16); // Etherscan writes zero as "0x"; RPCs refuse leading zeros
/** eth_getLogs from an explorer's index: the whole range, in pages of 1,000, as RPC logs. */
async function explorerLogs(e, chain, { address, topics, fromBlock, toBlock }) {
  const out = [], seen = new Set(), to = toBlock === 'latest' ? toBlock : Number(toBlock);
  let from = Number(fromBlock), page = 1;
  for (;;) {
    const q = new URLSearchParams({ module: 'logs', action: 'getLogs', address, fromBlock: from, toBlock: to, page, offset: 1000 });
    if (topics && topics[0]) q.set('topic0', topics[0]);
    const r = await explorer(e, chain, q);
    if (r.status !== '1' && !/no (records|logs)/i.test(r.message || '')) throw Error(e.name + ': ' + (typeof r.result === 'string' ? r.result : r.message || 'request failed') + '. Check the block explorer in ▾ → Settings.');
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
 * A contract's verified ABI from the block explorer (`e`, from explorerFor), merged with its implementation's for a
 * proxy (JSON text), or null when it is not verified. Only used to build calls: a function's selector comes from its
 * name and types, so an ABI cannot make one call look like another.
 */
export async function explorerAbi(e, chain, address) {
  const get = async (a) => {
    const r = await explorer(e, chain, new URLSearchParams({ module: 'contract', action: 'getsourcecode', address: a }));
    if (r.status !== '1' || !Array.isArray(r.result) || !r.result[0]) throw Error(e.name + ': ' + (typeof r.result === 'string' ? r.result : r.message || 'request failed'));
    return r.result[0];
  };
  const c = await get(address), all = [];
  if (String(c.ABI).startsWith('[')) all.push(...JSON.parse(c.ABI));
  // A proxy: Etherscan says Proxy "1" and Implementation, Blockscout IsProxy "true" and ImplementationAddress.
  const impl = (c.Proxy === '1' && c.Implementation) || (c.IsProxy === 'true' && c.ImplementationAddress) || '';
  if (/^0x[0-9a-fA-F]{40}$/.test(impl) && impl.toLowerCase() !== address.toLowerCase()) {
    const i = await get(impl.toLowerCase());
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
 * The wallet's provider, with reads sent to your endpoint for `chain()` when there is one, logs to the block
 * explorer when one serves the chain, and old history the RPC no longer keeps to WalletConnect's RPC (`project()`: its project ID).
 */
export function reader(provider, chain, project = () => '') {
  if (!provider) return provider;
  const checked = new Map(); // block → hash, already checked against the chain
  const r = {
    request: async (a) => {
      // `checked: false`: the caller checks each log it uses against the chain itself (History reads each one's transaction).
      const { checked: trusted, ...filter } = (a.method === 'eth_getLogs' && a.params[0]) || {};
      if (a.method === 'eth_getLogs') a = { ...a, params: [filter] };
      const e = a.method === 'eth_getLogs' && explorerFor(chain());
      if (e) {
        const logs = await explorerLogs(e, chain(), filter), mismatch = (n) => Object.assign(Error(e.name + ' returned a log in block ' + Number(n) + ' that does not match the chain. Pick another block explorer (or None) in ▾ → Settings and try again.'), { final: true });
        // Retried when the RPC throttles.
        const retry = async (f) => {
          for (let i = 0; ; i++) {
            try {
              return await f();
            } catch (x) {
              if (x.final || i > 4 || !/rate|limit|capacity|too many|429|busy|timeout/i.test(x.message)) throw x;
              await new Promise((ok) => setTimeout(ok, 500 * 2 ** i));
            }
          }
        };
        const four = async (list, f) => { for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(f)); };
        if (trusted === false) return logs;
        // An explorer that gives no block hash (Blockscout): each such log must be in its transaction's receipt, from
        // the chain, which also gives the block hash. A receipt no RPC serves leaves the log unverified: it is dropped,
        // as the scans skip a transaction no RPC serves.
        const unread = new Set();
        const same = (x, l) => Number(x.logIndex) === Number(l.logIndex) && x.address.toLowerCase() === l.address && String(x.data).toLowerCase() === String(l.data).toLowerCase() && x.topics.join().toLowerCase() === l.topics.join().toLowerCase();
        await four([...new Set(logs.filter((l) => !l.blockHash).map((l) => l.transactionHash))], (t) => retry(async () => {
          const rc = await r.request({ method: 'eth_getTransactionReceipt', params: [t] });
          if (!rc) return unread.add(t);
          for (const l of logs.filter((x) => x.transactionHash === t)) {
            if (Number(rc.blockNumber) !== Number(l.blockNumber) || !(rc.logs || []).some((x) => same(x, l))) throw mismatch(l.blockNumber);
            l.blockHash = rc.blockHash;
            checked.set(l.blockNumber, rc.blockHash);
          }
        }));
        if (unread.size) logs.splice(0, logs.length, ...logs.filter((l) => !unread.has(l.transactionHash)));
        // The rest: each block's header must have the hash the explorer gave. Four at a time (a long history is
        // thousands of blocks), and each block checked once per session.
        await four([...new Set(logs.map((l) => l.blockNumber))], (b) => retry(async () => {
          const want = logs.find((l) => l.blockNumber === b).blockHash;
          if (checked.get(b) === want) return;
          const head = await r.request({ method: 'eth_getBlockByNumber', params: [b, false] });
          if (!head || head.hash !== want) throw mismatch(b);
          checked.set(b, want);
        }));
        return logs;
      }
      const u = READS.has(a.method) && rpcs()[chain()];
      try {
        const v = await (u ? post(u, a.method, a.params) : provider.request(a));
        // A transaction this RPC no longer indexes comes back as null: ask WalletConnect's RPC too.
        if (v == null && (a.method === 'eth_getTransactionByHash' || a.method === 'eth_getTransactionReceipt') && project()) throw Error('pruned: transaction not indexed');
        return v;
      } catch (e) {
        if (!HISTORY.has(a.method) || !pruned(e) || !project()) throw e;
        return post('https://rpc.walletconnect.org/v1/?chainId=eip155:' + chain() + '&projectId=' + project(), a.method, a.params);
      }
    },
  };
  return r;
}
