import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revertData } from '../../src/review.js';

test('revert data is found wherever the wallet puts it', () => {
  const d = '0x' + '00'.repeat(31) + '01' + '00'.repeat(32);
  assert.equal(revertData({ code: 3, message: 'execution reverted', data: d }), d); // JSON-RPC error, as most RPCs
  assert.equal(revertData({ code: -32603, message: 'Internal JSON-RPC error.', data: { code: 3, data: d } }), d); // MetaMask-style nesting
  assert.equal(revertData({ error: { data: d } }), d);
  assert.equal(revertData({ message: 'x', data: 'not hex' }), null);
  assert.equal(revertData(null), null);
});
