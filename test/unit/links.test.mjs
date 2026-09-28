// Golden vectors for the link formats other apps and older links depend on (docs/links.md → Stability).
// If one of these fails, you changed a stable format: do not update the vector. Make the change
// backward compatible instead (a new optional section behind a new flag bit), and add a new vector.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZERO } from '../../src/abi.js';
import { safeTxHash } from '../../src/safe.js';
import { compact, fragment, fromFragment, fromMessageFragment, importMessage, importPayload, messageFragment, uncompact } from '../../src/share.js';
import { parse } from '../../src/backup.js';

const plain = {
  chainId: 1, safe: '0x96e2f6099860731cfdc0af700de862cf6eba4407', to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', value: 10n ** 16n, data: '0x',
  operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: 12n,
};
const full = {
  chainId: 137, safe: '0x3134dc9d36eac30aa69fe40b22b1311cabc12ec3', to: '0xa83c336b20401af773b6219ba5027174338d1836', value: 0n,
  data: '0x8d80ff0a00000000ab', operation: 1, safeTxGas: 50000n, baseGas: 21000n, gasPrice: 1n,
  gasToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', refundReceiver: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', nonce: 300n,
};
const sigs = ['0x' + '11'.repeat(32) + '22'.repeat(32) + '1b', '0x' + '33'.repeat(32) + '44'.repeat(32) + '1c'];

const PLAIN = 'tx=AQGW4vYJmGBzHP3Ar3AN6GLPbrpEB1NXAQDY2mvyaWSvnX7tngPlNBXTeqlgRQEMByOG8m_BAAAAAAA';
const FULL =
  'tx=AYkxNNydNurDCqaf5AsisTEcq8Euw1NXAQeoPDNrIEAa93O2IZulAnF0M40YNgIBLAAAAAmNgP8KAAAAAKsCw1ACUggBAaC4aZHGIYs2wdGdSi6esM42ButIcJl5cMUYEtw6AQx9AbUODRfcecgCEREREREREREREREREREREREREREREREREREREREREREiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIhszMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM0REREREREREREREREREREREREREREREREREREREREREHA';

test('#tx= links: encoding is frozen', () => {
  assert.equal(fragment(plain, []), PLAIN);
  assert.equal(fragment(full, sigs), FULL);
  assert.equal(safeTxHash(plain), '0x84bb0a538435af1d2649bc99e3295780ab341e781a6e51e30099350fa0787b70');
  assert.equal(safeTxHash(full), '0x8d625a4696554e01e80bc4f13d6b8d940a79a7b461754576a4f86deed7b23ce5');
});

test('#tx= links: old links keep decoding to the same transaction', () => {
  assert.deepEqual(fromFragment(PLAIN.slice(3)).tx, plain);
  assert.deepEqual(fromFragment(PLAIN.slice(3)).sigs, []);
  assert.deepEqual(fromFragment(FULL.slice(3)).tx, full);
  assert.deepEqual(fromFragment(FULL.slice(3)).sigs, sigs);
  for (const wrap of [(f) => 'https://safe.wei.limo/#' + f, (f) => 'https://0xabc.w3link.io/#' + f, (f) => f, (f) => f.slice(3)])
    assert.deepEqual(importPayload(wrap(FULL)).tx, full);
});

test('onchain approveHash payloads (compact) are frozen', () => {
  const c = '0x53570100d8da6bf26964af9d7eed9e03e53415d37aa96045010c072386f26fc10000000000';
  assert.equal(compact(plain), c);
  assert.deepEqual(uncompact(c, 1, plain.safe).tx, plain);
});

test('#import= links: plain (j) and deflated (z) backups keep parsing', async () => {
  const j = await parse(
    'https://safe.wei.limo/#import=jeyJhcHAiOiJzYWZlLndlaSIsInYiOjEsImF0IjoiMjAyNi0wOS0yOFQwMDowMDowMC4wMDBaIiwic2FmZXMiOlt7ImNoYWluSWQiOjEsImFkZHJlc3MiOiIweDMxMzRkYzlkMzZlYWMzMGFhNjlmZTQwYjIyYjEzMTFjYWJjMTJlYzMiLCJyZWYiOm51bGwsImxhYmVsIjoiT3BzIiwicGlubmVkIjpmYWxzZSwiYXQiOjE3OTAwMDAwMDAwMDB9XSwidHJlZSI6W10sImxhYmVscyI6e30sImFiaXMiOnt9LCJ0b2tlbnMiOnt9fQ',
  );
  assert.deepEqual(j.safes, [{ chainId: 1, address: '0x3134dc9d36eac30aa69fe40b22b1311cabc12ec3', ref: null, label: 'Ops', pinned: false, at: 1790000000000 }]);
  const z = await parse(
    'https://safe.wei.limo/#import=zlZFBb8IwDIX_yzsH5KZp2uTGcYfthHbYxMFNHK0CCmrLBkL971MLm7Yjlk-W3vP37Cv4eIRHz0mWX9JA4RM-U-ABHpq0XZBb6GpN5OdeEtEb1Czo4d-vCB_ctE_xpoqxk76HB52dFZ0sOVdZKvMspBiIU0kUpbI6JCs1G0MlFDpJ8Bg64f7UXe4cO65lB4_1fQyFY9O2EuGH7iQ3xKx09FvjRk0mMmNN_D0UtvDI_AM4k8u8u4e_gs6ximzrpK2zhpOLpUh0QrkUucmKmJfMzpIp4PHaDLxrthh_HFbDox7_Aylw3Uwco8Jw2Eo7M2VzwL-3plREnWrtUl3GPCQRYwxrIu2qZGzlqArBGT097rKvD9Ndn1cvKyhECc2ep7BZNW7G8Rs',
  );
  assert.equal(z.safes[0].label, 'Treasury');
  assert.equal(z.safes[0].ref, 'treasury.wei');
  assert.equal(z.labels['0xd8da6bf26964af9d7eed9e03e53415d37aa96045'], 'Vitalik');
  assert.equal(z.tokens['1'][0].symbol, 'MANA');
});

test('#tx= links with call signatures (flag bit 3) are frozen', () => {
  const t = { ...plain, to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', value: 0n, nonce: 5n,
    data: '0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000000001' };
  const abi = ['transferTo(address recipient, uint256 amount)', 'transfer(address to, uint256 amount)'];
  const F = 'tx=AQGW4vYJmGBzHP3Ar3AN6GLPbrpEB1NXAQiguGmRxiGLNsHRnUounrDONgbrSAEFAAAARKkFnLsAAAAAAAAAAAAAAADY2mvyaWSvnX7tngPlNBXTeqlgRQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAFJ0cmFuc2ZlclRvKGFkZHJlc3MgcmVjaXBpZW50LCB1aW50MjU2IGFtb3VudCkKdHJhbnNmZXIoYWRkcmVzcyB0bywgdWludDI1NiBhbW91bnQp';
  assert.equal(fragment(t, [], abi), F);
  assert.deepEqual(fromFragment(F.slice(3)), { tx: t, sigs: [], abi });
  // the signatures never change the transaction or its hash
  assert.equal(safeTxHash(fromFragment(F.slice(3)).tx), safeTxHash(t));
  assert.equal(fragment(t, []), fragment(t, [], []));
});

test('#msg= links are frozen (text with a signature, typed data, hash)', () => {
  const SAFE = '0x3134dc9d36eac30aa69fe40b22b1311cabc12ec3';
  const cases = [
    [{ chainId: 1, safe: SAFE, kind: 1, content: '0x5369676e20696e20746f206170702e6578616d706c65' }, ['0x' + '11'.repeat(64) + '1b'],
      'msg=AQExNNydNurDCqaf5AsisTEcq8Euw1NNAQEBAAAWU2lnbiBpbiB0byBhcHAuZXhhbXBsZQERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERGw'],
    [{ chainId: 137, safe: '0x96e2f6099860731cfdc0af700de862cf6eba4407', kind: 2, content: '{"types":{"Hi":[{"name":"x","type":"uint256"}]},"primaryType":"Hi","domain":{"name":"A","chainId":137},"message":{"x":"1"}}' }, [],
      'msg=AYmW4vYJmGBzHP3Ar3AN6GLPbrpEB1NNAQACAAB7eyJ0eXBlcyI6eyJIaSI6W3sibmFtZSI6IngiLCJ0eXBlIjoidWludDI1NiJ9XX0sInByaW1hcnlUeXBlIjoiSGkiLCJkb21haW4iOnsibmFtZSI6IkEiLCJjaGFpbklkIjoxMzd9LCJtZXNzYWdlIjp7IngiOiIxIn19'],
    [{ chainId: 1, safe: SAFE, kind: 3, content: '0x' + 'ab'.repeat(32) }, [], 'msg=AQExNNydNurDCqaf5AsisTEcq8Euw1NNAQADAAAgq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s'],
  ];
  for (const [msg, sigs, F] of cases) {
    assert.equal(messageFragment(msg, sigs), F);
    assert.deepEqual(fromMessageFragment(F.slice(4)), { msg, sigs });
    assert.deepEqual(importMessage('https://safe.wei.limo/#' + F), { msg, sigs });
  }
  assert.equal(importMessage('https://safe.wei.limo/#' + FULL), null);
});

test('readers reject what they do not understand (so extensions need new flag bits)', () => {
  const c = compact(plain);
  assert.throws(() => uncompact('0x53570110' + c.slice(10), 1, plain.safe), /unknown flags/);
  assert.throws(() => uncompact(c + '00', 1, plain.safe), /trailing/);
});
