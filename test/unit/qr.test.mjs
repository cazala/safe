import assert from 'node:assert/strict';
import { test } from 'node:test';
import jsQR from 'jsqr';
import { qr } from '../../src/qr.js';

// Render with a 4-module quiet zone at 4 px per module and decode with an independent reader.
function decode(g) {
  const s = 4, n = g.length + 8, w = n * s, px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g.length; x++)
      if (g[y][x])
        for (let dy = 0; dy < s; dy++)
          for (let dx = 0; dx < s; dx++) {
            const o = (((y + 4) * s + dy) * w + (x + 4) * s + dx) * 4;
            px[o] = px[o + 1] = px[o + 2] = 0;
          }
  const r = jsQR(px, w, w);
  return r && r.data;
}

test('QR codes decode back to their text, across versions (1 to ~20)', () => {
  const uri = 'wc:' + 'ab'.repeat(32) + '@2?relay-protocol=irn&symKey=' + 'cd'.repeat(32) + '&expiryTimestamp=1790577734';
  for (const t of ['a', 'hello', uri, ...[10, 14, 20, 30, 42, 60, 84, 100, 122, 154, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666].map((n) => 'x'.repeat(n - 7) + '1234567')]) {
    const g = qr(t);
    assert.equal(decode(g), t, 'length ' + t.length + ', version ' + (g.length - 17) / 4);
  }
  assert.equal((qr(uri).length - 17) / 4, 10, 'a WalletConnect link (187 bytes) is version 10: 57×57 modules');
});
