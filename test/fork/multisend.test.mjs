import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cd } from '../../src/abi.js';
import { execute } from '../../src/flow.js';
import { batch } from '../../src/multisend.js';
import { SAFE } from '../../src/chains.js';
import { review } from '../../src/review.js';
import { use } from '../../src/rpc.js';
import { newTx, readSafe, SENTINEL } from '../../src/safe.js';
import { S } from '../../src/sel.js';
import { balances } from '../../src/tokens.js';
import { ACCOUNTS, deploySafe, startFork, tx } from './anvil.mjs';

const [A, B, C] = ACCOUNTS;
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());
const bal = async (a) => BigInt(await f.rpc('eth_getBalance', [a, 'latest']));
const dest = () => '0x' + Math.floor(Math.random() * 2 ** 48).toString(16).padStart(40, 'b');

for (const v of ['1.3.0', '1.4.1', '1.5.0']) {
  test(v + ': batch of ETH + WETH transfers + a self-call executes atomically', async () => {
    const safe = await deploySafe(f.rpc, v, [A], 1);
    await tx(f.rpc, A, safe, '0x', 10n ** 18n);
    await tx(f.rpc, A, WETH, '0xd0e30db0', 10n ** 17n);
    await tx(f.rpc, A, WETH, cd(S.transfer, safe, 10n ** 17n));
    const s = await readSafe(safe);
    const [d1, d2] = [dest(), dest()];
    const t = newTx(s, batch(SAFE.multiSendCallOnly, [
      { to: d1, value: 11n },
      { to: WETH, data: cd(S.transfer, d2, 12n) },
      { to: safe, data: cd(S.addOwnerWithThreshold, B, 1) },
    ]));
    const r = await review(t, s, 1);
    assert.equal(r.ok, true);
    assert.equal(r.inner.length, 3);
    assert.ok(!r.danger.some((d) => /DELEGATECALL/.test(d)));
    assert.equal(r.inner[1].decoded.label, 'ERC-20 transfer');
    assert.match(r.warnings.join(), /Call 3: Changes who controls/);
    await execute(t, A);
    assert.equal(await bal(d1), 11n);
    assert.equal((await balances(d2, [{ address: WETH }]))[0], 12n);
    assert.deepEqual((await readSafe(safe)).owners.sort(), [A, B].sort());
  });
}

test('a failing inner call is flagged and reverts the whole batch', async () => {
  const safe = await deploySafe(f.rpc, '1.4.1', [A], 1);
  await tx(f.rpc, A, safe, '0x', 100n);
  const s = await readSafe(safe);
  const d = dest();
  const t = newTx(s, batch(SAFE.multiSendCallOnly, [{ to: d, value: 50n }, { to: dest(), value: 10n ** 20n }]));
  const r = await review(t, s, 1);
  assert.match(r.warnings.join(), /this batch REVERTS/);
  assert.match(r.warnings.join(), /Call 2 \(simulated on its own\).*REVERTS/);
  await assert.rejects(execute(t, A));
  assert.equal(await bal(d), 0n);
});

for (const v of ['1.3.0', '1.4.1', '1.5.0']) {
  test(v + ': a batch whose calls depend on each other is simulated as a whole, inside the Safe', async () => {
    // Call 2 alone reverts (the module is not enabled yet); in order, inside the Safe, it succeeds.
    const safe = await deploySafe(f.rpc, v, [A], 1);
    const s = await readSafe(safe), m = dest();
    const t = newTx(s, batch(SAFE.multiSendCallOnly, [{ to: safe, data: cd(S.enableModule, m) }, { to: safe, data: cd(S.disableModule, SENTINEL, m) }]));
    const r = await review(t, s, 1);
    assert.equal(r.ok, true);
    assert.ok(!r.warnings.some((w) => /REVERTS/.test(w)), r.warnings.join('\n'));
    await execute(t, A);
  });
}

test('batches through MultiSendCallOnly 1.3.0 (older Safes, e.g. existing Roles setups) are read as batches', async () => {
  const safe = await deploySafe(f.rpc, '1.3.0', [A], 1);
  await tx(f.rpc, A, safe, '0x', 100n);
  const s = await readSafe(safe), [d1, d2] = [dest(), dest()];
  const t = newTx(s, batch('0x40a2accbd92bca938b02010e17a5b8929b49130d', [{ to: d1, value: 1n }, { to: d2, value: 2n }]));
  const r = await review(t, s, 1);
  assert.equal(r.ok, true);
  assert.equal(r.inner.length, 2);
  assert.ok(!r.danger.some((d) => /DELEGATECALL/.test(d)));
  await execute(t, A);
  assert.equal(await bal(d2), 2n);
});

test('a DELEGATECALL outside a batch is simulated inside the Safe too', async () => {
  const s = await readSafe(await deploySafe(f.rpc, '1.4.1', [A], 1));
  // WETH's transfer, run as the Safe's own code: the Safe's storage has no WETH balance, so it reverts.
  const r = await review(newTx(s, { to: WETH, operation: 1, data: cd(S.transfer, B, 1n) }), s, 1);
  assert.match(r.warnings.join(), /this DELEGATECALL REVERTS/);
  const ok = await review(newTx(s, { to: WETH, operation: 1, data: cd(S.balanceOf, B) }), s, 1);
  assert.ok(!ok.warnings.some((w) => /REVERTS|not simulated/.test(w)), ok.warnings.join('\n'));
});

test('delegatecall to anything other than MultiSendCallOnly keeps the danger banner', async () => {
  const s = await readSafe(await deploySafe(f.rpc, '1.4.1', [A], 1));
  const r = await review(newTx(s, { to: C, operation: 1 }), s, 1);
  assert.match(r.danger.join(), /DANGEROUS: DELEGATECALL/);
});
