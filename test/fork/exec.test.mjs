import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cd } from '../../src/abi.js';
import { approve, collect, execute } from '../../src/flow.js';
import { review } from '../../src/review.js';
import { use } from '../../src/rpc.js';
import { newTx, readSafe } from '../../src/safe.js';
import { S } from '../../src/sel.js';
import { ACCOUNTS, deploySafe, startFork, tx } from './anvil.mjs';

const [A, B, C, , X] = ACCOUNTS; // X is never an owner
let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());

const bal = async (a) => BigInt(await f.rpc('eth_getBalance', [a, 'latest']));
async function funded(version, owners, threshold) {
  const safe = await deploySafe(f.rpc, version, owners, threshold);
  await tx(f.rpc, A, safe, '0x', 10n ** 18n);
  return readSafe(safe);
}
const dest = () => '0x' + Math.floor(Math.random() * 2 ** 48).toString(16).padStart(40, 'd');

for (const v of ['1.3.0', '1.4.1']) {
  test(v + ': 1-of-1 executes in a single transaction (executor pre-validated, no approveHash)', async () => {
    const s = await funded(v, [A], 1);
    const to = dest();
    await execute(newTx(s, { to, value: 1000n }), A);
    assert.equal(await bal(to), 1000n);
    assert.equal((await readSafe(s.address)).nonce, 1n);
  });

  test(v + ': 2-of-3 with one approveHash, final owner approves and executes', async () => {
    const s = await funded(v, [A, B, C], 2);
    const t = newTx(s, { to: dest(), value: 7n });
    await approve(t, B);
    const r = await review(t, s, 1);
    const c = await collect(s, r.local, C);
    assert.deepEqual(c.approved, [B]);
    assert.deepEqual(c.sigs.map((x) => x.kind).sort(), ['executor', 'onchain']);
    await execute(t, C);
    assert.equal(await bal(t.to), 7n);
  });

  test(v + ': non-owner executes once threshold approvals exist onchain', async () => {
    const s = await funded(v, [A, B, C], 2);
    const t = newTx(s, { to: dest(), value: 9n });
    await approve(t, C);
    await assert.rejects(execute(t, X), /Not enough approvals: 1 of 2/);
    await approve(t, A);
    await execute(t, X);
    assert.equal(await bal(t.to), 9n);
  });
}

test('non-owner cannot approve', async () => {
  const s = await funded('1.4.1', [A, B, C], 2);
  await assert.rejects(approve(newTx(s, { to: dest() }), X), /not an owner/);
});

test('nonce mismatch is rejected after another transaction executes first', async () => {
  const s = await funded('1.4.1', [A], 1);
  const stale = newTx(s, { to: dest(), value: 1n });
  await execute(newTx(s, { to: dest(), value: 2n }), A);
  await assert.rejects(execute(stale, A), /another Safe transaction executed first/);
  const queued = newTx(s, { to: dest(), value: 3n, nonce: 5n });
  await assert.rejects(execute(queued, A), /queued/);
});

test('reverting inner call is flagged by simulation and cannot execute', async () => {
  const s = await funded('1.4.1', [A], 1);
  const t = newTx(s, { to: dest(), value: 10n ** 20n }); // more than the Safe holds
  const r = await review(t, s, 1);
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(), /REVERTS/);
  await assert.rejects(execute(t, A));
});

test('token returning false is flagged', async () => {
  const s = await funded('1.4.1', [A], 1);
  const token = '0x' + 'fa15e'.padStart(40, '0');
  await f.rpc('anvil_setCode', [token, '0x60206000f3']); // returns 32 zero bytes to any call
  const r = await review(newTx(s, { to: token, data: cd(S.transfer, B, 1) }), s, 1);
  assert.match(r.warnings.join(), /returned FALSE/);
});

test('calldata to an address without code is flagged', async () => {
  const s = await funded('1.4.1', [A], 1);
  const r = await review(newTx(s, { to: dest(), data: '0x12345678' }), s, 1);
  assert.match(r.warnings.join(), /no contract code/);
});
