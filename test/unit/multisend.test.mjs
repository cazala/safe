import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodePacked, encodeFunctionData, parseAbi } from 'viem';
import { SAFE, SAFE141 } from '../../src/chains.js';
import { batch, pack, unpack } from '../../src/multisend.js';

const MS = SAFE.multiSendCallOnly;
const calls = [
  { to: '0x' + '11'.repeat(20), value: 5n, data: '0x' },
  { to: '0x' + '22'.repeat(20), value: 0n, data: '0xa9059cbb' + '00'.repeat(64) },
  { to: '0x' + '33'.repeat(20), value: 1n, data: '0x1234' },
];

test('pack matches the canonical encoding (encodePacked)', () => {
  const expect = '0x' + calls.map((c) => encodePacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [0, c.to, c.value, BigInt((c.data.length - 2) / 2), c.data]).slice(2)).join('');
  assert.equal(pack(calls), expect);
  const b = batch(MS, calls);
  assert.equal(b.data, encodeFunctionData({ abi: parseAbi(['function multiSend(bytes)']), functionName: 'multiSend', args: [expect] }));
  assert.equal(b.operation, 1);
  assert.equal(b.to, MS);
});

test('unpack round trip; strict about target, operation, inner delegatecall and length', () => {
  const b = { chainId: 1, ...batch(MS, calls) };
  assert.deepEqual(unpack(b), calls);
  assert.equal(unpack({ ...b, operation: 0 }), null);
  assert.equal(unpack({ ...b, to: '0x' + '44'.repeat(20) }), null);
  assert.equal(unpack({ ...b, data: b.data + '00' }), null);
  const dc = { chainId: 1, ...batch(MS, calls) };
  const i = 2 + 8 + 128; // first inner op byte
  dc.data = dc.data.slice(0, i) + '01' + dc.data.slice(i + 2);
  assert.equal(unpack(dc), null);
  assert.throws(() => batch(MS, calls.slice(0, 1)), /at least two/);
  assert.throws(() => batch('0x' + '44'.repeat(20), calls), /Not a canonical/);
  // both canonical MultiSendCallOnly versions are recognized
  assert.deepEqual(unpack({ chainId: 1, ...batch(SAFE141.multiSendCallOnly, calls) }), calls);
});
