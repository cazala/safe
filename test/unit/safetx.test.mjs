import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { hashTypedData } from 'viem';
import { safeTxHash } from '../../src/safe.js';

const rnd = (n) => '0x' + randomBytes(n).toString('hex');
export const randomTx = () => ({
  chainId: 1 + Math.floor(Math.random() * 1e6),
  safe: rnd(20),
  to: rnd(20),
  value: BigInt(rnd(12)),
  data: rnd(Math.floor(Math.random() * 300)),
  operation: Math.round(Math.random()),
  safeTxGas: BigInt(rnd(3)),
  baseGas: BigInt(rnd(3)),
  gasPrice: BigInt(rnd(4)),
  gasToken: rnd(20),
  refundReceiver: rnd(20),
  nonce: BigInt(rnd(2)),
});

const TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
};

test('safeTxHash matches viem EIP-712 hashTypedData', () => {
  for (let i = 0; i < 200; i++) {
    const t = randomTx();
    const { chainId, safe, ...message } = t;
    const expect = hashTypedData({ domain: { chainId, verifyingContract: safe }, types: TYPES, primaryType: 'SafeTx', message });
    assert.equal(safeTxHash(t), expect);
  }
});
