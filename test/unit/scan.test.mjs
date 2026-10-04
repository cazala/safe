// History scans: progress block by block, and the whole history in one request from a block explorer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] };
// The block explorers as the config chunk sets them (config/explorers.json).
globalThis.EXPLORERS = JSON.parse((await import('node:fs')).readFileSync(new URL('../../config/explorers.json', import.meta.url), 'utf8'));
const { use } = await import('../../src/rpc.js');
const { scan } = await import('../../src/pending.js');
const { setExplorer, explorerFor, explorerSuggestion, explorerRefused, explorerChoice, explorerAbi, reader } = await import('../../src/endpoints.js');

const safe = { address: '0x2a452599cb3a1cfd6769ff1b9b712a2956d6a8ce', chainId: 1, nonce: 0 };
const calls = [];
use({ request: async ({ method, params }) => (calls.push([method, params]), method === 'eth_blockNumber' ? '0x' + (20000).toString(16) : []) });

test('scan: progress rises to 1, window by window, without a block explorer', async () => {
  setExplorer({ id: 'none' });
  calls.length = 0;
  const seen = [];
  const r = await scan(safe, { progress: (p) => seen.push(p) });
  assert.equal(r.wide, false);
  assert.equal(calls.filter(([m]) => m === 'eth_getLogs').length, 5); // 20,001 blocks in windows of 5,000
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  assert.equal(seen.at(-1), 1);
  assert.equal(r.next, -1);
});

test('scan: by default a block explorer covers Ethereum, and the whole history is one request from genesis', async () => {
  setExplorer({ id: 'default' });
  assert.equal(explorerFor(1).name, 'Blockscout');
  calls.length = 0;
  const r = await scan(safe, {});
  const logs = calls.filter(([m]) => m === 'eth_getLogs');
  assert.equal(r.wide, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1][0].fromBlock, '0x0');
  setExplorer({ id: 'none' });
});

test('scan: when the explorer refuses the chain, it scans block by block through the RPC', async () => {
  setExplorer({ id: 'default' });
  calls.length = 0;
  let first = true;
  use({ request: async ({ method, params }) => {
    calls.push([method, params]);
    if (method === 'eth_blockNumber') return '0x' + (20000).toString(16);
    if (first) throw ((first = false), Object.assign(Error('Blockscout does not cover this chain.'), { refused: true }));
    return [];
  } });
  const r = await scan(safe, {});
  assert.equal(r.wide, false);
  assert.equal(r.error, undefined);
  assert.equal(calls.filter(([m]) => m === 'eth_getLogs').length, 1 + 5);
  use({ request: async ({ method, params }) => (calls.push([method, params]), method === 'eth_blockNumber' ? '0x' + (20000).toString(16) : []) });
  setExplorer({ id: 'none' });
});

test('explorers: the choice picks the provider per chain; None and uncovered chains read through the RPC', () => {
  setExplorer({ id: 'default' });
  assert.equal(explorerFor(43114).name, 'Routescan'); // Blockscout does not cover Avalanche: the next default does
  assert.equal(explorerFor(100), null); // no default covers Gnosis
  assert.equal(explorerSuggestion(100), '');
  setExplorer({ id: 'none' });
  assert.equal(explorerFor(1), null);
  assert.equal(explorerSuggestion(1), 'Blockscout');
  assert.throws(() => setExplorer({ id: 'etherscan' }), /needs an API key/);
  assert.throws(() => setExplorer({ id: 'etherscan', key: 'not a key!' }), /API key/);
  setExplorer({ id: 'etherscan', key: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' });
  assert.equal(explorerFor(8453).url, 'https://api.etherscan.io/v2/api?chainid=8453');
  assert.equal(explorerFor(534352), null);
  assert.equal(explorerSuggestion(100), 'Etherscan');
  assert.throws(() => setExplorer({ id: 'custom', url: 'http://x.example/api' }), /https URL/);
  setExplorer({ id: 'custom', url: 'https://x.example/{chain}/api' });
  assert.equal(explorerFor(5).url, 'https://x.example/5/api');
  assert.equal(explorerFor(5).name, 'x.example');
  assert.equal(explorerChoice().keys.etherscan, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'); // kept when switching away
  setExplorer({ id: 'none' });
});

test('explorers: an Etherscan key saved before the choice existed keeps working', () => {
  delete mem['safe.wei:explorer'];
  mem['safe.wei:explorerkey'] = JSON.stringify('ABCDEFGHIJKLMNOPQRSTUVWXYZ123456');
  assert.equal(explorerFor(1).name, 'Etherscan');
  assert.equal(explorerFor(1).key, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456');
  setExplorer({ id: 'none' });
  assert.equal(JSON.parse(mem['safe.wei:explorerkey']), '');
});

test('explorers: a chain the plan refuses falls back to the RPC for the session, and says which explorer refused', async () => {
  setExplorer({ id: 'etherscan', key: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' });
  const real = globalThis.fetch, asked = [];
  globalThis.fetch = async (u) => (asked.push(String(u)), { json: async () => ({ status: '0', message: 'NOTOK', result: 'Free API access is not supported for this chain.' }) });
  const r = reader({ request: async () => [] }, () => 8453);
  await assert.rejects(r.request({ method: 'eth_getLogs', params: [{ address: safe.address, fromBlock: '0x0', toBlock: '0x10' }] }), (e) => e.refused);
  assert.match(asked[0], /^https:\/\/api\.etherscan\.io\/v2\/api\?chainid=8453&module=logs&action=getLogs/);
  assert.equal(explorerFor(8453), null);
  assert.deepEqual(explorerRefused(8453), { name: 'Etherscan' });
  assert.deepEqual(await r.request({ method: 'eth_getLogs', params: [{ address: safe.address, fromBlock: '0x0', toBlock: '0x10' }] }), []); // now the RPC
  globalThis.fetch = real;
  setExplorer({ id: 'none' });
});

test('explorers: a Blockscout proxy gets its implementation’s ABI too', async () => {
  setExplorer({ id: 'blockscout' });
  const impl = '0x2ce6311ddae708829bc0784c967b7d77d19fd779', real = globalThis.fetch;
  const f = (name) => JSON.stringify([{ type: 'function', name, inputs: [], outputs: [], stateMutability: 'view' }]);
  globalThis.fetch = async (u) => ({ json: async () => ({ status: '1', message: 'OK', result: [String(u).includes(impl) ? { ABI: f('balanceOf') } : { ABI: f('admin'), IsProxy: 'true', ImplementationAddress: impl }] }) });
  const abi = JSON.parse(await explorerAbi(explorerFor(8453), 8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'));
  assert.deepEqual(abi.map((x) => x.name), ['admin', 'balanceOf']);
  globalThis.fetch = real;
  setExplorer({ id: 'none' });
});

test('explorers: each block a log comes from is checked against the chain’s own header', async () => {
  setExplorer({ id: 'blockscout' });
  const real = globalThis.fetch, hash = '0x' + 'ab'.repeat(32);
  const log = { address: safe.address, topics: ['0x' + '11'.repeat(32)], data: '0x', blockNumber: '0x10', blockHash: hash, transactionHash: '0x' + '22'.repeat(32), logIndex: '0x0' };
  globalThis.fetch = async () => ({ json: async () => ({ status: '1', message: 'OK', result: [log] }) });
  const q = { method: 'eth_getLogs', params: [{ address: safe.address, fromBlock: '0x0', toBlock: '0x20' }] };
  const good = reader({ request: async ({ method }) => (method === 'eth_getBlockByNumber' ? { hash } : null) }, () => 1);
  assert.equal((await good.request(q)).length, 1);
  const bad = reader({ request: async ({ method }) => (method === 'eth_getBlockByNumber' ? { hash: '0x' + 'cd'.repeat(32) } : null) }, () => 1);
  await assert.rejects(bad.request(q), /Blockscout returned a log in block 16 that does not match the chain/);
  globalThis.fetch = real;
  setExplorer({ id: 'none' });
});

test('explorers: a log without a block hash (Blockscout) must be in its transaction’s receipt', async () => {
  setExplorer({ id: 'blockscout' });
  const real = globalThis.fetch, hash = '0x' + 'ab'.repeat(32);
  const log = { address: safe.address, topics: ['0x' + '11'.repeat(32)], data: '0x', blockNumber: '0x10', transactionHash: '0x' + '22'.repeat(32), logIndex: '0x3' };
  globalThis.fetch = async () => ({ json: async () => ({ status: '1', message: 'OK', result: [{ ...log }] }) });
  const q = { method: 'eth_getLogs', params: [{ address: safe.address, fromBlock: '0x0', toBlock: '0x20' }] };
  const chainWith = (logs) => reader({ request: async ({ method }) => (method === 'eth_getTransactionReceipt' ? { blockNumber: '0x10', blockHash: hash, logs } : method === 'eth_getBlockByNumber' ? { hash } : null) }, () => 1);
  const got = await chainWith([{ ...log, blockHash: hash }]).request(q);
  assert.equal(got[0].blockHash, hash);
  await assert.rejects(chainWith([{ ...log, data: '0x01' }]).request(q), /does not match the chain/);
  await assert.rejects(chainWith([]).request(q), /does not match the chain/);
  const unserved = reader({ request: async () => null }, () => 1);
  assert.deepEqual(await unserved.request(q), []); // no RPC serves the receipt: unverified, so dropped
  globalThis.fetch = real;
  setExplorer({ id: 'none' });
});

test('explorers: still rate-limited after retries, reads go to the RPC for a minute', async () => {
  setExplorer({ id: 'blockscout' });
  const real = globalThis.fetch, realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (f) => realTimeout(f, 0);
  globalThis.fetch = async () => ({ json: async () => ({ status: '0', message: 'Too many requests. Increase limits now at https://dev.blockscout.com', result: null }) });
  const r = reader({ request: async () => [] }, () => 1);
  await assert.rejects(r.request({ method: 'eth_getLogs', params: [{ address: safe.address, fromBlock: '0x0', toBlock: '0x10' }] }), (e) => e.refused && /busy/.test(e.message));
  assert.equal(explorerFor(1), null);
  assert.equal(explorerRefused(1).busy, true);
  globalThis.fetch = real;
  globalThis.setTimeout = realTimeout;
  setExplorer({ id: 'none' });
});

test('explorers: empty log data (Routescan writes "") comes back as 0x', async () => {
  setExplorer({ id: 'routescan' });
  const real = globalThis.fetch, hash = '0x' + 'ab'.repeat(32);
  globalThis.fetch = async () => ({ json: async () => ({ status: '1', message: 'OK', result: [{ address: safe.address, topics: ['0x' + '11'.repeat(32)], data: '', blockNumber: '0x10', blockHash: hash, transactionHash: '0x' + '22'.repeat(32), logIndex: '0x0' }] }) });
  const r = reader({ request: async () => ({ hash }) }, () => 1);
  assert.equal((await r.request({ method: 'eth_getLogs', params: [{ address: safe.address, fromBlock: '0x0', toBlock: '0x20' }] }))[0].data, '0x');
  globalThis.fetch = real;
  setExplorer({ id: 'none' });
});
