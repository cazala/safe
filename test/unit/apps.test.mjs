import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appURL, handle, READ, toSafeTx } from '../../src/apps.js';
import { CHAINS } from '../../src/chains.js';
import { unpack } from '../../src/multisend.js';

const safe = {
  address: '0x' + 'ab'.repeat(20), chainId: 1, version: '1.4.1', owners: ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20)],
  threshold: 2n, nonce: 7n, singleton: CHAINS[1].singleton, fallback: CHAINS[1].fallback, guard: null,
};
const ctx = (over = {}) => ({ safe, account: safe.owners[0], origin: 'http://localhost', rpc: async (m, p) => ({ m, p }), balances: async () => ({ items: [] }), txStatus: async (h) => ({ h }), propose: async (tx, h) => h, ...over });

test('getSafeInfo / getChainInfo shapes', async () => {
  const i = await handle('getSafeInfo', undefined, ctx());
  assert.equal(i.safeAddress, '0xABaBaBaBABabABabAbAbABAbABabababaBaBABaB');
  assert.equal(i.threshold, 2);
  assert.equal(i.nonce, 7);
  assert.equal(i.isReadOnly, false);
  assert.equal((await handle('getSafeInfo', undefined, ctx({ account: '0x' + '99'.repeat(20) }))).isReadOnly, true);
  assert.equal((await handle('getChainInfo', undefined, ctx())).chainId, '1');
});

test('rpcCall forwards only read methods', async () => {
  for (const m of READ) assert.deepEqual(await handle('rpcCall', { call: m, params: [1] }, ctx()), { m, p: [1] });
  for (const m of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'eth_accounts', 'anvil_setBalance'])
    await assert.rejects(handle('rpcCall', { call: m, params: [] }, ctx()), /not allowed/);
});

test('sendTransactions: one tx is a CALL, several become a MultiSendCallOnly batch', async () => {
  const one = toSafeTx(safe, { txs: [{ to: '0x' + '33'.repeat(20), value: '100', data: '0x' }] });
  assert.equal(one.operation, 0);
  assert.equal(one.value, 100n);
  assert.equal(one.nonce, 7n);
  const many = toSafeTx(safe, { txs: [{ to: '0x' + '33'.repeat(20), value: '0x10', data: '0x' }, { to: '0x' + '44'.repeat(20), data: '0x1234' }] });
  assert.equal(many.operation, 1);
  assert.deepEqual(unpack(many).map((c) => c.value), [16n, 0n]);
  const r = await handle('sendTransactions', { txs: [{ to: '0x' + '33'.repeat(20), value: '1' }] }, ctx());
  assert.match(r.safeTxHash, /^0x[0-9a-f]{64}$/);
  await assert.rejects(handle('sendTransactions', { txs: [] }, ctx()), /No transactions/);
  await assert.rejects(handle('sendTransactions', { txs: [{ to: 'nope' }] }, ctx()), /invalid "to"/);
  await assert.rejects(handle('sendTransactions', { txs: [{ to: '0x' + '33'.repeat(20), data: 'zz' }] }, ctx()), /invalid "data"/);
  await assert.rejects(handle('sendTransactions', { txs: [{ to: '0x' + '33'.repeat(20) }] }, ctx({ propose: async () => { throw Error('Transaction was rejected'); } })), /rejected/);
});

test('message signing and address book are refused', async () => {
  for (const m of ['signMessage', 'signTypedMessage', 'getOffChainSignature', 'requestAddressBook', 'wallet_requestPermissions'])
    await assert.rejects(handle(m, {}, ctx()), /not supported/);
});

test('app URLs: https only (http allowed on localhost)', () => {
  assert.equal(appURL('swap.cow.fi').origin, ['https:', '', 'swap.cow.fi'].join('/'));
  assert.equal(appURL('http://localhost:3000/x').origin, 'http://localhost:3000');
  assert.throws(() => appURL('http://example.com'), /https/);
  assert.throws(() => appURL('javascript:alert(1)'), /https/);
  assert.throws(() => appURL('data:text/html,hi'), /https/);
});
