import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashMessage as vHashMessage, hashTypedData as vHashTypedData, toHex } from 'viem';
import { combine, describe, encodeType, hashMessage, hashTypedData, safeMessageHash, safeMessageTypedData } from '../../src/message.js';

const SAFE = '0x3134dc9d36eac30aa69fe40b22b1311cabc12ec3';
const A = '0x' + '11'.repeat(20), B = '0x' + '22'.repeat(20);

test('EIP-191 message hash matches viem (text and raw bytes)', () => {
  for (const text of ['hello', '', 'Sign in to app.example\nNonce: 42', 'ünïcödé ✓']) assert.equal(hashMessage(toHex(text)), vHashMessage(text), text);
  assert.equal(hashMessage('0xdeadbeef'), vHashMessage({ raw: '0xdeadbeef' }));
});

const MAIL = {
  types: {
    EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
    Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
    Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }],
  },
  primaryType: 'Mail',
  domain: { name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: '0xcccccccccccccccccccccccccccccccccccccccc' },
  message: { from: { name: 'Cow', wallet: '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826' }, to: { name: 'Bob', wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, contents: 'Hello, Bob!' },
};
const PERMIT2 = {
  types: {
    PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
    PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
  },
  primaryType: 'PermitSingle',
  domain: { name: 'Permit2', chainId: 1, verifyingContract: '0x000000000022d473030f116ddee9f6b43ac78ba3' },
  message: { details: { token: A, amount: '1461501637330902918203684832716283019655932542975', expiration: '1790000000', nonce: '0' }, spender: B, sigDeadline: '0x6a000000' },
};
const EVERYTHING = {
  types: {
    Item: [{ name: 'id', type: 'uint8' }, { name: 'tags', type: 'bytes32[]' }],
    Order: [{ name: 'items', type: 'Item[]' }, { name: 'delta', type: 'int256' }, { name: 'ok', type: 'bool' }, { name: 'blob', type: 'bytes' }, { name: 'code', type: 'bytes4' }, { name: 'names', type: 'string[2]' }],
  },
  primaryType: 'Order',
  domain: { name: 'X', salt: '0x' + 'ab'.repeat(32) },
  message: { items: [{ id: 7, tags: ['0x' + '01'.repeat(32)] }, { id: 255, tags: [] }], delta: '-5', ok: true, blob: '0x0102', code: '0xdeadbeef', names: ['a', 'b'] },
};

test('EIP-712 hash matches viem (nested structs, arrays, all atomic types, derived domain)', () => {
  for (const td of [MAIL, PERMIT2, EVERYTHING]) {
    const { EIP712Domain, ...types } = td.types;
    assert.equal(hashTypedData(td), vHashTypedData({ ...td, types }), td.primaryType);
  }
  assert.equal(encodeType('Mail', MAIL.types), 'Mail(Person from,Person to,string contents)Person(string name,address wallet)');
});

test('EIP-712 input is validated, not guessed', () => {
  const bad = (msg) => ({ ...MAIL, message: { ...MAIL.message, ...msg } });
  assert.throws(() => hashTypedData(bad({ contents: 5 })), /expected a string/);
  assert.throws(() => hashTypedData(bad({ from: { name: 'x', wallet: '0x12' } })), /expected an address/);
  assert.throws(() => hashTypedData({ ...PERMIT2, message: { ...PERMIT2.message, sigDeadline: '1.5' } }), /integer/);
  assert.throws(() => hashTypedData({ ...EVERYTHING, message: { ...EVERYTHING.message, items: [{ id: 256, tags: [] }] } }), /out of range/);
  assert.throws(() => hashTypedData({ ...MAIL, primaryType: 'Nope' }), /not defined/);
});

test('SafeMessage hash equals the EIP-712 hash of the typed data the owners sign', () => {
  for (const hash of [hashMessage(toHex('hi')), hashTypedData(MAIL), '0x' + 'ee'.repeat(32)]) {
    const td = safeMessageTypedData(137, SAFE, hash);
    const { EIP712Domain, ...types } = td.types;
    assert.equal(safeMessageHash(137, SAFE, hash), vHashTypedData({ ...td, types }));
  }
});

test('describe gives the hash apps verify, per kind', () => {
  assert.equal(describe({ kind: 1, content: toHex('hi') }).hash, vHashMessage('hi'));
  assert.equal(describe({ kind: 1, content: toHex('hi') }).text, 'hi');
  assert.equal(describe({ kind: 1, content: '0xff00' }).text, null); // not UTF-8: shown as bytes
  assert.equal(describe({ kind: 2, content: JSON.stringify(MAIL) }).hash, hashTypedData(MAIL));
  assert.equal(describe({ kind: 3, content: '0x' + 'ab'.repeat(32) }).hash, '0x' + 'ab'.repeat(32));
  assert.throws(() => describe({ kind: 3, content: '0x12' }), /32 bytes/);
});

test('combine sorts by signer and keeps threshold signatures', () => {
  const s = (signer, b) => ({ signer, sig: '0x' + b.repeat(65) });
  assert.equal(combine([s('0x' + 'bb'.repeat(20), 'bb'), s('0x' + 'aa'.repeat(20), 'aa'), s('0x' + 'cc'.repeat(20), 'cc')], 2), '0x' + 'aa'.repeat(65) + 'bb'.repeat(65));
});
