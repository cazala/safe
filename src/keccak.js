// Keccak-256 as used by Ethereum (original Keccak padding, not SHA3).
// The 1600-bit state is 25 lanes of 64 bits, each held as two 32-bit halves:
// lane i = (s[2i] low, s[2i+1] high). Constants are generated as in FIPS 202.

const PI = [], ROT = [], RCL = [], RCH = [];
for (let r = 0, x = 1, y = 0, R = 1; r < 24; r++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  PI.push(2 * (5 * y + x));
  ROT.push((((r + 1) * (r + 2)) / 2) % 64);
  let lo = 0, hi = 0;
  for (let j = 0; j < 7; j++) {
    R = ((R << 1) ^ ((R >> 7) * 0x71)) % 256;
    if (R & 2) {
      const b = (1 << j) - 1;
      if (b < 32) lo ^= 1 << b;
      else hi ^= 1 << (b - 32);
    }
  }
  RCL.push(lo);
  RCH.push(hi);
}

// 64-bit rotate-left of (lo, hi) by n, returned as [lo, hi].
const rot = (lo, hi, n) =>
  n < 32
    ? [(lo << n) | (hi >>> (32 - n)), (hi << n) | (lo >>> (32 - n))]
    : [(hi << (n - 32)) | (lo >>> (64 - n)), (lo << (n - 32)) | (hi >>> (64 - n))];

function permute(s) {
  const C = new Uint32Array(10);
  for (let r = 0; r < 24; r++) {
    // theta
    for (let x = 0; x < 10; x++) C[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const a = (x + 2) % 10, b = (x + 8) % 10;
      const lo = ((C[a] << 1) | (C[a + 1] >>> 31)) ^ C[b];
      const hi = ((C[a + 1] << 1) | (C[a] >>> 31)) ^ C[b + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= lo;
        s[x + y + 1] ^= hi;
      }
    }
    // rho + pi (ROT[t] is never 0, so rot() never shifts by 32)
    let lo = s[2], hi = s[3];
    for (let t = 0; t < 24; t++) {
      const p = PI[t], nl = s[p], nh = s[p + 1];
      [s[p], s[p + 1]] = rot(lo, hi, ROT[t]);
      lo = nl;
      hi = nh;
    }
    // chi
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++) C[x] = s[y + x];
      for (let x = 0; x < 10; x++) s[y + x] ^= ~C[(x + 2) % 10] & C[(x + 4) % 10];
    }
    // iota
    s[0] ^= RCL[r];
    s[1] ^= RCH[r];
  }
}

/** @param {Uint8Array} m @returns {Uint8Array} 32-byte digest */
export function keccak(m) {
  const s = new Uint32Array(50);
  const q = new Uint8Array(m.length + 136 - (m.length % 136));
  q.set(m);
  q[m.length] ^= 1;
  q[q.length - 1] ^= 0x80;
  for (let o = 0; o < q.length; o += 136) {
    for (let i = 0; i < 136; i++) s[i >> 2] ^= q[o + i] << (8 * (i & 3));
    permute(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = s[i >> 2] >>> (8 * (i & 3));
  return out;
}
