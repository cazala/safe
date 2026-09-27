import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFunctionData, parseAbi } from 'viem';
import { decode } from '../../src/decode.js';

const abi = parseAbi([
  'function transfer(address,uint256)',
  'function approve(address,uint256)',
  'function transferFrom(address,address,uint256)',
  'function addOwnerWithThreshold(address,uint256)',
  'function removeOwner(address,address,uint256)',
  'function swapOwner(address,address,address)',
  'function changeThreshold(uint256)',
  'function enableModule(address)',
  'function disableModule(address,address)',
  'function setGuard(address)',
  'function setFallbackHandler(address)',
]);
const SAFE = '0x' + '5a'.repeat(20), TOKEN = '0x' + '70'.repeat(20), X = '0x' + '11'.repeat(20), Y = '0x' + '22'.repeat(20);
const MAX = (1n << 256n) - 1n;
const tx = (to, functionName, args) => ({ safe: SAFE, to, data: encodeFunctionData({ abi, functionName, args }) });

test('decodes ERC-20 calls', () => {
  const d = decode(tx(TOKEN, 'transfer', [X, 5n]));
  assert.equal(d.label, 'ERC-20 transfer');
  assert.deepEqual(d.args.map((a) => a.value), [X, 5n]);
  assert.deepEqual(decode(tx(TOKEN, 'transferFrom', [X, Y, 7n])).args.map((a) => a.value), [X, Y, 7n]);
  assert.deepEqual(decode(tx(TOKEN, 'approve', [X, 1n])).danger, []);
});

test('unlimited approval is flagged', () => {
  assert.match(decode(tx(TOKEN, 'approve', [X, MAX])).danger.join(), /UNLIMITED APPROVAL/);
});

test('Safe config calls: warnings on self-calls, danger for module/guard/fallback', () => {
  assert.match(decode(tx(SAFE, 'addOwnerWithThreshold', [X, 2n])).warnings.join(), /who controls/);
  assert.match(decode(tx(SAFE, 'changeThreshold', [1n])).warnings.join(), /who controls/);
  assert.match(decode(tx(SAFE, 'enableModule', [X])).danger.join(), /ENABLE MODULE/);
  assert.match(decode(tx(SAFE, 'setGuard', [X])).danger.join(), /SET GUARD/);
  assert.match(decode(tx(SAFE, 'setFallbackHandler', [X])).danger.join(), /FALLBACK/);
  assert.equal(decode(tx(SAFE, 'swapOwner', [X, Y, SAFE])).label, 'Replace owner');
  assert.equal(decode(tx(SAFE, 'removeOwner', [X, Y, 1n])).args.length, 3);
  assert.equal(decode(tx(SAFE, 'disableModule', [X, Y])).label, 'Disable module');
  assert.match(decode(tx(TOKEN, 'enableModule', [X])).warnings.join(), /targets another contract/);
});

test('unknown or non-canonical calldata is never decoded', () => {
  const ok = tx(TOKEN, 'transfer', [X, 5n]).data;
  assert.equal(decode({ safe: SAFE, to: TOKEN, data: '0x' }), null);
  assert.equal(decode({ safe: SAFE, to: TOKEN, data: '0x12345678' + '00'.repeat(64) }), null);
  assert.equal(decode({ safe: SAFE, to: TOKEN, data: ok + '00' }), null); // extra bytes
  assert.equal(decode({ safe: SAFE, to: TOKEN, data: ok.slice(0, -2) }), null); // short
  assert.equal(decode({ safe: SAFE, to: TOKEN, data: '0xa9059cbb' + 'ff'.repeat(12) + '11'.repeat(20) + '00'.repeat(32) }), null); // dirty address
});
