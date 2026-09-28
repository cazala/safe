import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { hex, utf8 } from '../../src/abi.js';
import { chainMessageHash, checkMessage, combine, describe, isValid, safeMessageHash, signMessage } from '../../src/message.js';
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
