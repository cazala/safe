import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SAFE } from '../../src/chains.js';
import { execute } from '../../src/flow.js';
import { use } from '../../src/rpc.js';
import { create, createCall, newTx, predict } from '../../src/safe.js';
import { ACCOUNTS, startFork, tx } from './anvil.mjs';

const c = SAFE; // mainnet: the non-L2 singleton
const [A, B, C] = ACCOUNTS;
let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());

test('predicted address matches the deployed Safe; owners, threshold, version, fallback correct', async () => {
  const k = createCall(c, [A, B, C], 2, 123456789n);
  const at = await predict(k, A);
  const s = await create(k, A);
  assert.equal(s.address, at);
  assert.deepEqual(s.owners, [A, B, C]);
  assert.equal(s.threshold, 2n);
  assert.equal(s.version, '1.4.1');
  assert.equal(s.singleton, c.singleton);
  assert.equal(s.fallback, c.fallback);
  assert.equal(s.nonce, 0n);
});

test('the prediction does not depend on the sender', async () => {
  const k = createCall(c, [A], 1, 42n);
  assert.equal(await predict(k, A), await predict(k, C));
});

test('re-using a salt is refused', async () => {
  const k = createCall(c, [B], 1, 777n);
  await create(k, A);
  await assert.rejects(create(k, A), /(already exists|reverted|Create2)/i);
});

test('a newly created Safe can transact', async () => {
  const s = await create(createCall(c, [A], 1, 99n), A);
  await tx(f.rpc, A, s.address, '0x', 100n);
  await execute(newTx({ ...s, balance: 100n }, { to: C, value: 1n }), A);
});

test('invalid owner sets and thresholds are rejected', () => {
  assert.throws(() => createCall(c, [], 1, 1n), /at least one owner/);
  assert.throws(() => createCall(c, [A, A], 1, 1n), /Duplicate/);
  assert.throws(() => createCall(c, [A, 'nope'], 1, 1n), /Invalid owner/);
  assert.throws(() => createCall(c, [A, '0x' + '0'.repeat(40)], 1, 1n), /Invalid owner/);
  assert.throws(() => createCall(c, [A, B], 3, 1n), /between 1 and 2/);
  assert.throws(() => createCall(c, [A, B], 0, 1n), /between 1 and 2/);
});
