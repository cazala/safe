import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZERO } from '../../src/abi.js';
import { safeTxHash } from '../../src/safe.js';
import { compact, fragment, fromFragment, importPayload, toJSON, uncompact } from '../../src/share.js';
import { randomTx } from './util.mjs';

const plain = () => ({ ...randomTx(), safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO });
const sig = () => '0x' + 'ab'.repeat(64) + '1b';

test('compact round trip (with and without gas fields / signatures)', () => {
  for (let i = 0; i < 100; i++) {
    const t = i % 2 ? randomTx() : plain();
    const sigs = i % 3 ? [] : [sig(), sig()];
    const back = uncompact(compact(t, sigs), t.chainId, t.safe);
    assert.deepEqual(back.tx, t);
    assert.deepEqual(back.sigs, sigs);
    assert.equal(safeTxHash(back.tx), safeTxHash(t));
  }
});

test('compact omits implied fields and stays small', () => {
  const t = { ...plain(), value: 10n ** 18n, data: '0x', nonce: 3n, operation: 0 };
  // magic 3 + flags 1 + to 20 + nonce 2 + value 9 + data len 3
  assert.equal((compact(t).length - 2) / 2, 38);
});

test('fragment and link round trip preserve chainId and Safe', () => {
  for (let i = 0; i < 50; i++) {
    const t = randomTx();
    const frag = fragment(t, [sig()]);
    assert.match(frag, /^tx=[A-Za-z0-9_-]+$/);
    assert.deepEqual(fromFragment(frag.slice(3)).tx, t);
    assert.deepEqual(importPayload('https://example.invalid/page#' + frag).tx, t);
    assert.deepEqual(importPayload(frag.slice(3)).tx, t);
  }
});

test('JSON round trip and tamper detection', () => {
  const t = randomTx();
  const json = toJSON(t, [sig()]);
  assert.deepEqual(importPayload(json), { tx: t, sigs: [sig()], abi: [] });
  const o = JSON.parse(json);
  o.to = '0x' + '1'.repeat(40);
  assert.throws(() => importPayload(JSON.stringify(o)), /safeTxHash does not match/);
  assert.throws(() => importPayload(JSON.stringify({ ...JSON.parse(json), operation: 2, safeTxHash: undefined })), /operation/);
  assert.throws(() => importPayload(JSON.stringify({ ...JSON.parse(json), value: '1.5', safeTxHash: undefined })), /decimal/);
});

test('call signatures round trip through links, onchain payloads and JSON', () => {
  const abi = ['assignRoles(address module, bytes32[] roleKeys, bool[] memberOf)', 'scopeFunction(bytes32 roleKey, address targetAddress, bytes4 selector, (uint8 parent, uint8 paramType, uint8 operator, bytes compValue)[] conditions, uint8 options)'];
  for (let i = 0; i < 20; i++) {
    const t = randomTx(), sigs = i % 2 ? [sig()] : [];
    assert.deepEqual(fromFragment(fragment(t, sigs, abi).slice(3)), { tx: t, sigs, abi });
    assert.deepEqual(uncompact(compact(t, [], abi), t.chainId, t.safe).abi, abi);
    assert.deepEqual(importPayload(toJSON(t, sigs, abi)).abi, abi);
  }
  assert.throws(() => importPayload(JSON.stringify({ ...JSON.parse(toJSON(randomTx())), abi: 'x' })), /abi must be a list/);
});

test('a tampered link decodes to a different transaction hash', () => {
  const t = plain();
  const frag = fragment(t).slice(3);
  const i = frag.length - 5;
  const bad = frag.slice(0, i) + (frag[i] === 'A' ? 'B' : 'A') + frag.slice(i + 1);
  let other;
  try {
    other = fromFragment(bad).tx;
  } catch {
    return; // a corrupted payload may also fail to parse at all, which is fine
  }
  assert.notEqual(safeTxHash(other), safeTxHash(t));
});

test('malformed payloads are rejected', () => {
  const t = plain();
  const c = compact(t);
  assert.throws(() => uncompact(c + '00', t.chainId, t.safe), /trailing/);
  assert.throws(() => uncompact(c.slice(0, -2), t.chainId, t.safe), /truncated/);
  assert.throws(() => uncompact('0x000000', t.chainId, t.safe), /Not a safe.wei/);
  assert.throws(() => uncompact('0x53570110' + c.slice(10), t.chainId, t.safe), /unknown flags/);
  assert.throws(() => importPayload('hello world'), /Paste a safe.wei link/);
});
