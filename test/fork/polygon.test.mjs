// Any EVM chain: the same flows on a Polygon fork (chain 137), where new Safes use SafeL2.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chainInfo, SAFE } from '../../src/chains.js';
import { execute } from '../../src/flow.js';
import { batch } from '../../src/multisend.js';
import { review } from '../../src/review.js';
import { use } from '../../src/rpc.js';
import { create, createCall, newTx, readSafe } from '../../src/safe.js';
import { balances, meta } from '../../src/tokens.js';
import { ACCOUNTS, startFork, tx } from './anvil.mjs';

const [A, B] = ACCOUNTS;
const USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'; // native USDC on Polygon
let f, c;
before(async () => {
  f = await startFork(undefined, { url: process.env.POLYGON_FORK_URL || 'https://polygon-bor-rpc.publicnode.com', block: 0 });
  use(f.provider);
  c = await chainInfo(137);
});
after(() => f && f.stop());

test('chain 137 is detected with every feature available', () => {
  assert.deepEqual([c.name, c.sym, c.singleton, c.canCreate, c.canBatch, c.canMulticall], ['Polygon', 'POL', SAFE.singletonL2, true, true, true]);
});

test('create a SafeL2 v1.5.0, execute a transfer and a batch, read token balances', async () => {
  const s0 = await create(createCall(c, [A], 1, 424242n), A);
  assert.equal(s0.chainId, 137);
  assert.equal(s0.singleton, SAFE.singletonL2);
  assert.equal(s0.version, '1.5.0');
  await tx(f.rpc, A, s0.address, '0x', 10n ** 18n);
  let s = await readSafe(s0.address);
  await execute(newTx(s, { to: B, value: 5n }), A);
  s = await readSafe(s0.address);
  const d = '0x' + 'cd'.repeat(20);
  const t = newTx(s, batch(c.multiSendCallOnly, [{ to: d, value: 1n }, { to: d, value: 2n }]));
  assert.equal((await review(t, s, 137)).ok, true);
  await execute(t, A);
  assert.equal(BigInt(await f.rpc('eth_getBalance', [d, 'latest'])), 3n);
  assert.deepEqual(await balances(s.address, [{ address: USDC }]), [0n]);
  assert.equal((await meta(USDC)).decimals, 6);
});

test('delegatecall into an address without code is blocked', async () => {
  const s = await readSafe((await create(createCall(c, [A], 1, 434343n), A)).address);
  const r = await review(newTx(s, { to: '0x' + '0e'.repeat(20), operation: 1 }), s, 137);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /no code on this chain/);
});
