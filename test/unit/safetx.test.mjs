import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashTypedData } from 'viem';
import { safeTxHash } from '../../src/safe.js';
import { randomTx } from './util.mjs';

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
