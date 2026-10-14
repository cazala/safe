import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cd, encode, word } from '../../src/abi.js';
import { approvalPairs, candidates, decodePreview } from '../../src/assets.js';
import { discovered, forgetToken, mergeTokens, rememberTokens } from '../../src/tokens.js';
const A = '0x' + 'ab'.repeat(20), B = '0x' + 'cd'.repeat(20);
const envelope = (values) => { const b = encode([values]); return '0x' + word(1) + word(b.length / 2) + b; };
test('preview strictly decodes envelope, unknown balances, signed native/token changes', () => {
  const data = envelope([1, 10, 8, 1, 7, 11, 0, 0, 0]);
  const r = decodePreview(data, 2);
  assert.equal(r.native, -2n);
  assert.equal(r.tokens[0].after - r.tokens[0].before, 4n);
  assert.equal(r.tokens[1].ok, false);
  for (const bad of [data + '00', data.slice(0, -2), '0x', envelope([2, 10, 8]), envelope([1, 10, 8, 2, 0, 0])]) assert.throws(() => decodePreview(bad, 2));
  assert.equal(decodePreview(envelope([0, 10, 10]), 0).success, false);
});
test('candidate union normalizes and deduplicates without treating calldata as trusted metadata', () => {
  assert.deepEqual(candidates({ safe: B, to: A, operation: 0, data: '0x12345678' + word(B) }, [A.toUpperCase().replace('0X', '0x'), 'invalid'], [{ address: A }]), [A]);
});
test('discovery is chain/Safe scoped, contains no balances, and preserves registry/manual provenance', () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) };
  rememberTokens(1, A, [{ address: B, symbol: 'TEST', decimals: 18, balance: '123' }]);
  assert.equal(discovered(1, A).length, 1);
  assert.equal(discovered(1, B).length, 0);
  assert.equal(discovered(2, A).length, 0);
  assert.equal(discovered(1, A)[0].balance, undefined);
  const merged = mergeTokens(discovered(1, A), [{ address: B, added: true }], [{ address: B, symbol: 'LIST', decimals: 6, listed: true }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].symbol, 'LIST');
  assert.equal(merged[0].added, true);
  assert.equal(merged[0].listed, true);
  forgetToken(1, A, B);
  assert.deepEqual(discovered(1, A), []);
  delete globalThis.localStorage;
});

test('custom RPC receives discovery and state overrides, while signing stays with the wallet', async () => {
  const { reader } = await import('../../src/endpoints.js');
  const oldFetch = globalThis.fetch, requests = [], wallet = [];
  globalThis.localStorage = { getItem: (k) => k === 'safe.wei:rpcs' ? JSON.stringify({ 1: 'https://rpc.example.test' }) : null };
  globalThis.fetch = async (url, options) => { requests.push({ url, ...JSON.parse(options.body) }); return { json: async () => ({ result: '0x' }) }; };
  try {
    const p = reader({ request: async (x) => { wallet.push(x); return 'signed'; } }, () => 1);
    const params = [{ to: A }, '0x123', { [B]: { code: '0x00' } }];
    await p.request({ method: 'eth_createAccessList', params: [{ to: A }, '0x123'] });
    await p.request({ method: 'eth_call', params });
    await p.request({ method: 'eth_signTypedData_v4', params: [A, '{}'] });
    assert.deepEqual(requests.map((x) => x.method), ['eth_createAccessList', 'eth_call']);
    assert.deepEqual(requests[1].params, params);
    assert.equal(wallet[0].method, 'eth_signTypedData_v4');
  } finally { globalThis.fetch = oldFetch; delete globalThis.localStorage; }
});

test('allowance probes use exact direct approval encodings and deduplicate batch pairs', async () => {
  const { batch } = await import('../../src/multisend.js');
  const { SAFE } = await import('../../src/chains.js');
  const call = { to: A, data: cd('095ea7b3', B, 10n) };
  assert.deepEqual(approvalPairs(call), [{ token: A, spender: B }]);
  for (const selector of ['39509351', 'a457c2d7']) assert.deepEqual(approvalPairs({ to: A, data: cd(selector, B, 2n) }), [{ token: A, spender: B }]);
  assert.deepEqual(approvalPairs(batch(SAFE.multiSendCallOnly, [call, call])), [{ token: A, spender: B }]);
  for (const bad of [{ ...call, operation: 1 }, { ...call, data: call.data + '00' }, { ...call, data: '0x095ea7b3' + '1'.repeat(24) + B.slice(2) + word(10) }]) assert.deepEqual(approvalPairs(bad), []);
});
