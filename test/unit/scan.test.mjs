// History scans: progress block by block, and the whole history in one request with an Etherscan key.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] };
const { use } = await import('../../src/rpc.js');
const { scan } = await import('../../src/pending.js');
const { setExplorerKey } = await import('../../src/endpoints.js');

const safe = { address: '0x2a452599cb3a1cfd6769ff1b9b712a2956d6a8ce', chainId: 1, nonce: 0 };
const calls = [];
use({ request: async ({ method, params }) => (calls.push([method, params]), method === 'eth_blockNumber' ? '0x' + (20000).toString(16) : []) });

test('scan: progress rises to 1, window by window, without a key', async () => {
  calls.length = 0;
  const seen = [];
  const r = await scan(safe, { progress: (p) => seen.push(p) });
  assert.equal(r.wide, false);
  assert.equal(calls.filter(([m]) => m === 'eth_getLogs').length, 5); // 20,001 blocks in windows of 5,000
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  assert.equal(seen.at(-1), 1);
  assert.equal(r.next, -1);
});

test('scan: with an Etherscan key, the whole history is one request from genesis', async () => {
  setExplorerKey('ABCDEFGHIJKLMNOPQRSTUVWXYZ123456');
  calls.length = 0;
  const r = await scan(safe, {});
  const logs = calls.filter(([m]) => m === 'eth_getLogs');
  assert.equal(r.wide, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1][0].fromBlock, '0x0');
  setExplorerKey('');
});

test('setExplorerKey rejects what is not a key', () => {
  assert.throws(() => setExplorerKey('not a key!'), /Etherscan API key/);
});
