import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { approve, checkSigs, collect, execute, normSig, recover, sign, typedData } from '../../src/flow.js';
import { use } from '../../src/rpc.js';
import { newTx, readSafe, safeTxHash } from '../../src/safe.js';
import { importPayload, fragment } from '../../src/share.js';
import { ACCOUNTS, deploySafe, KEYS, startFork, tx } from './anvil.mjs';

const [A, B, C, D, X] = ACCOUNTS;
let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());

async function funded(version, owners, threshold) {
  const safe = await deploySafe(f.rpc, version, owners, threshold);
  await tx(f.rpc, A, safe, '0x', 10n ** 18n);
  return readSafe(safe);
}
const dest = () => '0x' + Math.floor(Math.random() * 2 ** 48).toString(16).padStart(40, 'e');
const bal = async (a) => BigInt(await f.rpc('eth_getBalance', [a, 'latest']));

for (const v of ['1.3.0', '1.4.1', '1.5.0']) {
  test(v + ': 2-of-3 with two EIP-712 signatures, executed by a non-owner', async () => {
    const s = await funded(v, [A, B, C], 2);
    const t = newTx(s, { to: dest(), value: 5n });
    const sigs = [await sign(t, C), await sign(t, A)];
    // shared through a link, then executed by someone else
    const p = importPayload(fragment(t, sigs));
    await execute(p.tx, X, p.sigs);
    assert.equal(await bal(t.to), 5n);
  });

  test(v + ': mixed onchain approval + EIP-712 signature + executor', async () => {
    const s = await funded(v, [A, B, C, D], 3);
    const t = newTx(s, { to: dest(), value: 6n });
    await approve(t, D);
    const sig = await sign(t, B);
    const { sigs } = await collect(s, safeTxHash(t), A, (await checkSigs(s, safeTxHash(t), [sig])).valid);
    assert.deepEqual(sigs.map((x) => x.kind).sort(), ['executor', 'offchain', 'onchain']);
    await execute(t, A, [sig]);
    assert.equal(await bal(t.to), 6n);
  });
}

test('typed data sent to the wallet hashes to the SafeTx hash (viem)', async () => {
  const s = await funded('1.4.1', [A], 1);
  const t = newTx(s, { to: dest(), value: 1n, data: '0xdeadbeef' });
  const acct = privateKeyToAccount(KEYS[0]);
  const d = typedData(t);
  const sig = await acct.signTypedData({ ...d, types: { SafeTx: d.types.SafeTx } });
  assert.equal(await recover(safeTxHash(t), sig), A);
});

test('non-owner, duplicate, malformed and wrong-hash signatures are rejected', async () => {
  const s = await funded('1.4.1', [A, B, C], 2);
  const t = newTx(s, { to: dest(), value: 1n });
  const h = safeTxHash(t);
  const okA = await sign(t, A);
  const xAcct = privateKeyToAccount(KEYS[4]);
  const d = typedData(t);
  const byX = await xAcct.signTypedData({ ...d, types: { SafeTx: d.types.SafeTx } });
  const other = await sign(newTx(s, { to: dest(), value: 2n }), B); // signs a different tx
  const { valid, rejected } = await checkSigs(s, h, [okA, okA, byX, other, '0x' + '00'.repeat(65), '0x1234']);
  assert.deepEqual(valid.map((x) => x.signer), [A]);
  const reasons = rejected.map((x) => x.reason).join('\n');
  assert.match(reasons, /duplicate/);
  assert.match(reasons, /not an owner/); // X, and B's signature over another hash recovers to a random address
  assert.match(reasons, /65 bytes/);
  assert.equal(rejected.length, 5);
});

test('insufficient signatures cannot execute', async () => {
  const s = await funded('1.4.1', [A, B, C], 3);
  const t = newTx(s, { to: dest(), value: 1n });
  await assert.rejects(execute(t, X, [await sign(t, A), await sign(t, B)]), /Not enough approvals: 2 of 3/);
});

test('non-owner cannot sign', async () => {
  const s = await funded('1.4.1', [A], 1);
  await assert.rejects(sign(newTx(s, { to: dest() }), X), /not an owner/);
});

test('v = 0/1 signatures are normalized', () => {
  const r = 'ab'.repeat(64);
  assert.equal(normSig('0x' + r + '00'), '0x' + r + '1b');
  assert.equal(normSig('0x' + r + '01'), '0x' + r + '1c');
  assert.throws(() => normSig('0x' + r + '1f'), /Unsupported signature type/);
});
