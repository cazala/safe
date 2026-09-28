import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { hex, utf8 } from '../../src/abi.js';
import { chainMessageHash, checkMessage, combine, describe, isValid, onchainSignCall, safeMessageHash, signedOnchain, signMessage } from '../../src/message.js';
import { LIBS, line } from '../../src/chains.js';
import { execute, sign } from '../../src/flow.js';
import { review } from '../../src/review.js';
import { newTx, readSafe } from '../../src/safe.js';
import { use } from '../../src/rpc.js';
import { ACCOUNTS, deploySafe, startFork } from './anvil.mjs';

const [A, B, C, , X] = ACCOUNTS;
let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());

const PERMIT = JSON.stringify({
  types: {
    EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
    Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
  },
  primaryType: 'Permit',
  domain: { name: 'Token', chainId: 1, verifyingContract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  message: { owner: '0x' + '11'.repeat(20), spender: '0x' + '22'.repeat(20), value: '1000000', nonce: '0', deadline: '1790000000' },
});

for (const v of ['1.3.0', '1.4.1', '1.5.0']) {
  test(v + ': owners sign a message; the Safe accepts it through isValidSignature (EIP-1271)', async () => {
    const safe = await deploySafe(f.rpc, v, [A, B, C], 2);
    for (const [kind, content] of [[1, hex(utf8('Sign in to app.example'))], [2, PERMIT], [3, '0x' + 'ab'.repeat(32)]]) {
      const m = { chainId: 1, safe, kind, content };
      const { hash } = describe(m);
      // the Safe computes the same SafeMessage hash as safe.wei
      assert.equal(await chainMessageHash(safe, hash), safeMessageHash(1, safe, hash), v + ' kind ' + kind);
      const sigs = [await signMessage(m, C), await signMessage(m, A)];
      const c = await checkMessage(m, sigs);
      assert.equal(c.valid.length, 2);
      assert.equal(await isValid(safe, hash, combine(c.valid, 2)), true, v + ' kind ' + kind);
      // one signature is not enough, and signatures for another message do not count
      assert.equal(await isValid(safe, hash, combine(c.valid, 1)), false);
      assert.equal(await isValid(safe, '0x' + 'cd'.repeat(32), combine(c.valid, 2)), false);
    }
  });
}

test('a non-owner cannot sign, and a Safe without a fallback handler cannot validate messages', async () => {
  const safe = await deploySafe(f.rpc, '1.4.1', [A, B], 1);
  const m = { chainId: 1, safe, kind: 1, content: hex(utf8('hi')) };
  await assert.rejects(signMessage(m, X), /not an owner/);
  const bare = await deploySafe(f.rpc, '1.4.1', [A], 1, undefined, '0x0000000000000000000000000000000000000000');
  await assert.rejects(signMessage({ ...m, safe: bare }, A), /cannot validate message signatures/);
});

for (const v of ['1.3.0', '1.4.1', '1.5.0']) {
  test(v + ': the Safe signs a message onchain (SignMessageLib); an empty signature is then valid', async () => {
    const safe = await deploySafe(f.rpc, v, [A, B, C], 2);
    const s = await readSafe(safe), hash = describe({ kind: 1, content: hex(utf8('onchain ' + v)) }).hash;
    const t = newTx(s, onchainSignCall(LIBS[line(v)].signMessage[0], hash));
    const r = await review(t, s, 1);
    assert.equal(r.ok, true, r.errors.join(' '));
    assert.equal(r.signMessage, hash);
    assert.deepEqual(r.danger, [], 'the canonical SignMessageLib is not flagged as a dangerous DELEGATECALL');
    assert.equal(await isValid(safe, hash, '0x'), false);
    await execute(t, X, [await sign(t, A), await sign(t, C)]);
    assert.equal(await signedOnchain(safe, safeMessageHash(1, safe, hash)), true);
    assert.equal(await isValid(safe, hash, '0x'), true);
    assert.equal(await isValid(safe, '0x' + 'cd'.repeat(32), '0x'), false);
  });
}

test('only the canonical SignMessageLib with exact calldata is recognized', async () => {
  const s = await readSafe(await deploySafe(f.rpc, '1.4.1', [A], 1));
  const hash = '0x' + 'ab'.repeat(32), call = onchainSignCall(LIBS['1.4'].signMessage[0], hash);
  assert.equal((await review(newTx(s, call), s, 1)).signMessage, hash);
  const other = await review(newTx(s, { ...call, to: '0x' + '42'.repeat(20) }), s, 1);
  assert.equal(other.signMessage, null);
  assert.ok(other.danger.some((d) => /DELEGATECALL/.test(d)));
  assert.equal((await review(newTx(s, { ...call, data: call.data + '00' }), s, 1)).signMessage, null);
});
