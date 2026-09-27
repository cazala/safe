import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { review } from '../../src/review.js';
import { use } from '../../src/rpc.js';
import { chainTxHash, newTx, readSafe, safeTxHash } from '../../src/safe.js';
import { ACCOUNTS, deploySafe, startFork } from './anvil.mjs';

let f;
const safes = {};
before(async () => {
  f = await startFork();
  use(f.provider);
  for (const v of ['1.3.0', '1.4.1']) safes[v] = await readSafe(await deploySafe(f.rpc, v, ACCOUNTS.slice(0, 3), 2));
});
after(() => f.stop());

const rnd = (n) => '0x' + randomBytes(n).toString('hex');

for (const v of ['1.3.0', '1.4.1']) {
  test(v + ': local SafeTx hash equals getTransactionHash', async () => {
    for (let i = 0; i < 25; i++) {
      const t = { ...newTx(safes[v], { to: rnd(20), value: BigInt(rnd(8)), data: rnd(i * 13), operation: i % 2, nonce: BigInt(i) }) };
      if (i % 3 === 0) Object.assign(t, { safeTxGas: 5n, baseGas: 7n, gasPrice: 11n, gasToken: rnd(20), refundReceiver: rnd(20) });
      assert.equal(await chainTxHash(t), safeTxHash(t));
    }
  });
}

test('review passes for a well-formed transaction', async () => {
  const s = safes['1.4.1'];
  const r = await review(newTx(s, { to: ACCOUNTS[3], value: 1n }), s, 1);
  assert.equal(r.ok, true);
  assert.equal(r.local, r.chain);
  assert.deepEqual(r.errors, []);
});

test('hash mismatch blocks all actions', async () => {
  const s = safes['1.4.1'];
  // A tx claiming another chain: the local hash uses chainId 5, the Safe hashes with chainId 1.
  const r = await review({ ...newTx(s, { to: ACCOUNTS[3] }), chainId: 5 }, s, 1);
  assert.equal(r.ok, false);
  assert.notEqual(r.local, r.chain);
  assert.match(r.errors.join('\n'), /FATAL: SafeTx hash mismatch/);
});

test('review rejects wrong Safe, stale nonce, unsupported version; warns on delegatecall and queue', async () => {
  const s = safes['1.4.1'];
  const base = newTx(s, { to: ACCOUNTS[3] });
  assert.match((await review(base, { ...s, address: safes['1.3.0'].address }, 1)).errors.join(), /different Safe/);
  assert.match((await review(base, { ...s, nonce: 1n }, 1)).errors.join(), /already used/);
  assert.match((await review(base, { ...s, supported: false, version: '1.1.1' }, 1)).errors.join(), /Unsupported Safe version/);
  assert.match((await review(base, s, 10)).errors.join(), /wallet is on chain 10/);
  // DELEGATECALL into a contract: allowed with the danger banner. Into an address without code: blocked.
  const dc = await review(newTx(s, { to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', operation: 1 }), s, 1);
  assert.equal(dc.ok, true);
  assert.match(dc.danger.join(), /DANGEROUS: DELEGATECALL/);
  const empty = await review(newTx(s, { to: ACCOUNTS[3], operation: 1 }), s, 1);
  assert.equal(empty.ok, false);
  assert.match(empty.errors.join(), /no code on this chain/);
  assert.match((await review(newTx(s, { to: ACCOUNTS[3], nonce: 3n }), s, 1)).warnings.join(), /Queued/);
});

test('security warnings: delegatecall and unlimited approval appear in the review', async () => {
  const s = safes['1.4.1'];
  const dc = await review(newTx(s, { to: ACCOUNTS[3], operation: 1 }), s, 1);
  assert.match(dc.danger.join(), /DANGEROUS: DELEGATECALL/);
  const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const approve = '0x095ea7b3' + ACCOUNTS[3].slice(2).padStart(64, '0') + 'f'.repeat(64);
  const r = await review(newTx(s, { to: usdc, data: approve }), s, 1);
  assert.equal(r.decoded.label, 'ERC-20 approve');
  assert.match(r.danger.join(), /UNLIMITED APPROVAL/);
});
