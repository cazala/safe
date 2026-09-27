import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { encodeAbiParameters, getAddress, keccak256, toFunctionSelector, toEventSelector } from 'viem';
import { B, checksum, encode, fmt, fmtShort, keccakText, parse } from '../../src/abi.js';
import { keccak } from '../../src/keccak.js';
import { S, T } from '../../src/sel.js';

test('keccak matches @noble/hashes for lengths 0..600', () => {
  for (let n = 0; n <= 600; n++) {
    const m = randomBytes(n);
    assert.equal(Buffer.from(keccak(m)).toString('hex'), Buffer.from(keccak_256(m)).toString('hex'), 'len ' + n);
  }
});

const SIGS = {
  VERSION: 'VERSION()',
  getOwners: 'getOwners()',
  getThreshold: 'getThreshold()',
  nonce: 'nonce()',
  getTransactionHash: 'getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)',
  approveHash: 'approveHash(bytes32)',
  approvedHashes: 'approvedHashes(address,bytes32)',
  execTransaction: 'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)',
  setup: 'setup(address[],uint256,address,bytes,address,address,uint256,address)',
  createProxyWithNonce: 'createProxyWithNonce(address,bytes,uint256)',
  getStorageAt: 'getStorageAt(uint256,uint256)',
  transfer: 'transfer(address,uint256)',
  approve: 'approve(address,uint256)',
  transferFrom: 'transferFrom(address,address,uint256)',
  addOwnerWithThreshold: 'addOwnerWithThreshold(address,uint256)',
  removeOwner: 'removeOwner(address,address,uint256)',
  swapOwner: 'swapOwner(address,address,address)',
  changeThreshold: 'changeThreshold(uint256)',
  enableModule: 'enableModule(address)',
  disableModule: 'disableModule(address,address)',
  setGuard: 'setGuard(address)',
  setFallbackHandler: 'setFallbackHandler(address)',
  multiSend: 'multiSend(bytes)',
  balanceOf: 'balanceOf(address)',
  decimals: 'decimals()',
  symbol: 'symbol()',
  aggregate3: 'aggregate3((address,bool,bytes)[])',
  summariesPaged: 'summariesPaged(uint256,uint256)',
  resolver: 'resolver(bytes32)',
  addr: 'addr(bytes32)',
  resolve: 'resolve(bytes,bytes)',
  wnsResolve: 'resolve(uint256)',
  reverseResolve: 'reverseResolve(address)',
  name: 'name(bytes32)',
};

test('every hardcoded selector matches its signature', () => {
  assert.deepEqual(Object.keys(S).sort(), Object.keys(SIGS).sort());
  for (const [k, sig] of Object.entries(SIGS)) assert.equal('0x' + S[k], toFunctionSelector('function ' + sig), k);
});

test('event topics and typehashes', () => {
  assert.equal(T.ApproveHash, toEventSelector('event ApproveHash(bytes32 indexed approvedHash, address indexed owner)'));
  assert.equal(T.ExecutionSuccess, toEventSelector('event ExecutionSuccess(bytes32 txHash, uint256 payment)'));
  assert.equal(T.ExecutionFailure, toEventSelector('event ExecutionFailure(bytes32 txHash, uint256 payment)'));
  assert.equal(
    T.SafeTx,
    keccak256(
      Buffer.from(
        'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)',
      ),
    ),
  );
  assert.equal(T.Domain, keccakText('EIP712Domain(uint256 chainId,address verifyingContract)'));
  assert.equal('0x' + T.OffchainLookup, toFunctionSelector('function OffchainLookup(address,string[],bytes,bytes4,bytes)'));
});

test('encode matches viem for static, bytes and address[]', () => {
  const addrs = [getAddress('0x' + randomBytes(20).toString('hex')), getAddress('0x' + randomBytes(20).toString('hex'))];
  for (const len of [0, 1, 31, 32, 33, 100]) {
    const data = '0x' + randomBytes(len).toString('hex');
    const ours = encode([addrs, 7n, addrs[0], B(data), 2 ** 53, true, B('0x')]);
    const theirs = encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes' }, { type: 'uint256' }, { type: 'bool' }, { type: 'bytes' }],
      [addrs, 7n, addrs[0], data, 2n ** 53n, true, '0x'],
    );
    assert.equal('0x' + ours, theirs);
  }
});

test('checksum matches viem', () => {
  for (let i = 0; i < 50; i++) {
    const a = '0x' + randomBytes(20).toString('hex');
    assert.equal(checksum(a), getAddress(a));
  }
});

test('parse / fmt round trip without floating point', () => {
  assert.equal(parse('1', 18), 10n ** 18n);
  assert.equal(parse('0.000001', 6), 1n);
  assert.equal(parse('.5', 1), 5n);
  assert.equal(parse('123456789.123456789123456789', 18), 123456789123456789123456789n);
  assert.throws(() => parse('0.0000001', 6), /decimals/);
  for (const bad of ['', '.', '1e5', '-1', '1,5', '0x10', ' 1 2']) assert.throws(() => parse(bad, 18), bad);
  assert.equal(fmt(0n), '0');
  assert.equal(fmt(1n, 6), '0.000001');
  assert.equal(fmt(1500000n, 6), '1.5');
  assert.equal(fmt(10n ** 18n), '1');
  assert.equal(fmt(42n, 0), '42');
  for (const s of ['0', '1', '0.1', '99999999999999.000000000000000001']) assert.equal(fmt(parse(s)), s);
});

test('fmtShort: grouped, at most 2 decimals, truncated, tiny values marked', () => {
  assert.equal(fmtShort(parse('1110725.005685094551836322')), '1,110,725');
  assert.equal(fmtShort(parse('70271.262142', 6), 6), '70,271.26');
  assert.equal(fmtShort(parse('1944.999', 18)), '1,944.99'); // truncated, never rounded up
  assert.equal(fmtShort(parse('0.5')), '0.5');
  assert.equal(fmtShort(parse('0.001')), '< 0.01');
  assert.equal(fmtShort(0n), '0');
  assert.equal(fmtShort(16940n, 0), '16,940');
});
