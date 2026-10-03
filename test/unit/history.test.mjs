// History: executions found onchain are decoded and kept only when they hash to the event's SafeTx hash.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] };
const { use } = await import('../../src/rpc.js');
const { newTx, execData, safeTxHash } = await import('../../src/safe.js');
const { findExecutions, readExecutions, record, saved, toTx } = await import('../../src/history.js');
const { strip } = await import('../../src/abi.js');

const safe = { address: '0x2a452599cb3a1cfd6769ff1b9b712a2956d6a8ce', chainId: 1, nonce: 5n };
const tx = (nonce, to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045') => newTx(safe, { to, value: 10n ** 17n, data: '0x', nonce });
const t2 = tx(2), t4 = tx(4, '0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
const sigs = '0x' + '11'.repeat(65);
// Block 30: t4 executed directly. Block 20: t2 executed through a relayer (execTransaction inside its calldata).
// Block 10: an event whose hash matches nothing in its transaction.
const bh = (n) => '0x' + String(n).padStart(64, '0');
const txs = {
  '0xa4': { to: safe.address, blockHash: bh(30), input: execData(t4, sigs) },
  '0xa2': { to: '0x00000000000000000000000000000000000000aa', blockHash: bh(20), input: '0x12345678' + '00'.repeat(32) + strip(execData(t2, sigs)) },
  '0xa0': { to: safe.address, blockHash: bh(10), input: execData(tx(0), sigs) },
};
const logs = [
  { blockNumber: '0x1e', blockHash: bh(30), logIndex: '0x0', transactionHash: '0xa4', topics: ['0x', safeTxHash(t4)], data: '0x' },
  { blockNumber: '0x14', blockHash: bh(20), logIndex: '0x0', transactionHash: '0xa2', topics: ['0x'], data: '0x' + strip(safeTxHash(t2)) + '00'.repeat(32) }, // 1.3.0: hash in data
  { blockNumber: '0x0a', blockHash: bh(10), logIndex: '0x0', transactionHash: '0xa0', topics: ['0x', '0x' + 'ab'.repeat(32)], data: '0x' },
];
use({ request: async ({ method, params }) => (method === 'eth_blockNumber' ? '0x28' : method === 'eth_getLogs' ? logs : txs[params[0]]) });

test('history: direct and relayed executions are decoded, with the nonce that matches the hash; others are dropped', async () => {
  const f = await findExecutions(safe, {});
  assert.equal(f.logs.length, 3);
  const r = await readExecutions(safe, f.logs, {});
  assert.deepEqual(r.entries.map((e) => [e.nonce, e.to, e.txHash]), [[4, t4.to, '0xa4'], [2, t2.to, '0xa2']]);
  assert.equal(safeTxHash(toTx(safe, r.entries[1])), safeTxHash(t2));
  assert.equal(r.rest.length, 0);
});

test('history: executions recorded here are kept with their hints and merged with what is found', async () => {
  record(safe, tx(1), '0xa1', ['transfer(address to, uint256 amount)']);
  const l = saved(safe);
  assert.deepEqual(l.map((e) => e.nonce), [4, 2, 1]);
  assert.deepEqual(l[2].hints, ['transfer(address to, uint256 amount)']);
});

test('history: an execution whose transaction is in another block is refused; reading stops at the limit', async () => {
  localStorage.removeItem('safe.wei:history');
  const f = await findExecutions(safe, {});
  const one = await readExecutions(safe, f.logs, { limit: 1 });
  assert.deepEqual([one.entries.length, one.rest.length], [1, 2]);
  await assert.rejects(readExecutions(safe, [{ ...logs[1], blockHash: bh(99), guess: 2 }], {}), /does not match the chain/);
});
