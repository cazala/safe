import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { base58, decrypt, didKey, encrypt, open, parseUri, seal, sharedKey, topicOf } from '../../src/wc.js';

test('ChaCha20-Poly1305 matches node:crypto (RFC 8439), with and without AAD, across block sizes', () => {
  for (const len of [0, 1, 15, 16, 17, 63, 64, 65, 200, 1000]) {
    const key = randomBytes(32), nonce = randomBytes(12), pt = randomBytes(len), aad = len % 2 ? randomBytes(12) : new Uint8Array(0);
    const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    if (aad.length) c.setAAD(aad, { plaintextLength: len });
    const want = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
    const got = seal(new Uint8Array(key), new Uint8Array(nonce), new Uint8Array(pt), new Uint8Array(aad));
    assert.equal(Buffer.from(got).toString('hex'), want.toString('hex'), 'len ' + len);
    assert.deepEqual(Buffer.from(open(new Uint8Array(key), new Uint8Array(nonce), got, new Uint8Array(aad))), pt);
    got[0] ^= 1;
    assert.equal(open(new Uint8Array(key), new Uint8Array(nonce), got, new Uint8Array(aad)), null, 'tampering is detected');
  }
});

test('base58 and did:key', () => {
  assert.equal(base58(new TextEncoder().encode('hello world')), 'StV1DL6CwTryKyV');
  assert.equal(base58(Uint8Array.from([0, 0, 1])), '112');
  assert.match(didKey(new Uint8Array(32).fill(7)), /^did:key:z6Mk/); // Ed25519 did:keys start with z6Mk
});

test('envelopes round trip and reject the wrong key', () => {
  const k = new Uint8Array(randomBytes(32)), msg = { id: 1, jsonrpc: '2.0', method: 'wc_sessionPing', params: {} };
  assert.deepEqual(decrypt(k, encrypt(k, msg)), msg);
  assert.equal(decrypt(new Uint8Array(randomBytes(32)), encrypt(k, msg)), null);
  assert.equal(decrypt(k, 'not base64 !!'), null);
});

test('wc: links are parsed strictly', () => {
  const topic = 'ab'.repeat(32), sym = 'cd'.repeat(32);
  assert.deepEqual(parseUri(`wc:${topic}@2?relay-protocol=irn&symKey=${sym}`), { topic, symKey: sym, expiry: 0 });
  assert.throws(() => parseUri('wc:' + topic + '@1?bridge=x&key=y'), /starts with wc:/);
  assert.throws(() => parseUri(`wc:${topic}@2?relay-protocol=irn&symKey=12`), /no valid key/);
  assert.throws(() => parseUri(`wc:${topic}@2?relay-protocol=irn&symKey=${sym}&expiryTimestamp=1`), /expired/);
});

test('session keys: both sides derive the same key and topic (X25519 + HKDF)', async () => {
  const a = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']), b = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const raw = async (k) => Buffer.from(await crypto.subtle.exportKey('raw', k.publicKey)).toString('hex');
  const ka = await sharedKey(a.privateKey, await raw(b)), kb = await sharedKey(b.privateKey, await raw(a));
  assert.deepEqual(ka, kb);
  assert.equal(await topicOf(ka), await topicOf(kb));
});
