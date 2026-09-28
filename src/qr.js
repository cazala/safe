// QR code encoder (ISO/IEC 18004), minimal: byte mode, error correction level M, versions 1–40,
// the mask with the lowest penalty. `qr(text)` returns the module grid (true = dark).
// Follows the structure of Project Nayuki's reference implementation.

// Per version (index 0 unused): ECC codewords per block, and number of blocks, at level M.
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const FORMAT_M = 0; // level M's two format bits

const rawModules = (v) => {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (v >= 7) n -= 36;
  }
  return n;
};
const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC[v] * BLOCKS[v];

// GF(256) with the QR polynomial 0x11D, and Reed–Solomon ECC.
function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = mul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = mul(root, 2);
  }
  return r;
}
function remainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((d, i) => (r[i] ^= mul(d, f)));
  }
  return r;
}

function codewords(bytes) {
  let v = 1;
  const need = (v) => 4 + (v <= 9 ? 8 : 16) + 8 * bytes.length;
  while (v <= 40 && need(v) > 8 * dataCodewords(v)) v++;
  if (v > 40) throw Error('Too long for a QR code.');
  const cap = dataCodewords(v), bits = [];
  const put = (x, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((x >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, v <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let p = 0xec; data.length < cap; p ^= 0xec ^ 0x11) data.push(p);
  // Split into blocks, add ECC to each, interleave.
  const nb = BLOCKS[v], el = ECC[v], raw = Math.floor(rawModules(v) / 8), short = nb - (raw % nb), shortLen = Math.floor(raw / nb), div = divisor(el), blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, (k += shortLen - el + (i < short ? 0 : 1)));
    const e = remainder(d, div);
    if (i < short) d.push(0);
    blocks.push(d.concat(e));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => (i !== shortLen - el || j >= short) && out.push(b[i]));
  return { v, out };
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function penalty(m) {
  const n = m.length, lines = [];
  for (let i = 0; i < n; i++) lines.push(m[i], m.map((r) => r[i]));
  let p = 0, dark = 0;
  for (const l of lines) {
    for (let i = 0, run = 1; i < n; i++, run++) {
      if (i + 1 < n && l[i + 1] === l[i]) continue;
      if (run >= 5) p += run - 2;
      run = 0;
    }
    const s = l.map(Number).join('');
    for (const pat of ['10111010000', '00001011101']) for (let i = s.indexOf(pat); i >= 0; i = s.indexOf(pat, i + 1)) p += 40;
  }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      dark += m[y][x];
      if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
  return p + (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
}

/** Encode `text` (UTF-8). Returns an array of rows of booleans (true = dark), without the quiet zone. */
export function qr(text) {
  const { v, out } = codewords(new TextEncoder().encode(text));
  const n = v * 4 + 17, m = [...Array(n)].map(() => Array(n).fill(false)), fn = [...Array(n)].map(() => Array(n).fill(false));
  const set = (x, y, d) => ((m[y][x] = d), (fn[y][x] = true));
  for (let i = 0; i < n; i++) set(6, i, i % 2 === 0), set(i, 6, i % 2 === 0);
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
      }
  if (v > 1) {
    const a = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (a * 2 - 2)) * 2, pos = [6];
    for (let p = n - 7; pos.length < a; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < a; i++)
      for (let j = 0; j < a; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === a - 1) || (i === a - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
  }
  const format = (mask) => {
    const d = (FORMAT_M << 3) | mask;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)), set(8, 8, bit(7)), set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true);
  };
  format(0); // reserve the format areas before placing data
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const d = ((b >>> i) & 1) === 1, a = n - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, d), set(c, a, d);
    }
  }
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (!fn[y][x] && i < out.length * 8) (m[y][x] = ((out[i >>> 3] >>> (7 - (i & 7))) & 1) === 1), i++;
      }
  }
  const masked = (k) => {
    const g = m.map((r) => r.slice());
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASKS[k](x, y)) g[y][x] = !g[y][x];
    return g;
  };
  let best = 0, score = Infinity;
  for (let k = 0; k < 8; k++) {
    format(k);
    const s = penalty(masked(k));
    if (s < score) (best = k), (score = s);
  }
  format(best);
  return masked(best);
}

/** SVG path data for the dark modules, offset by a 4-module quiet zone (viewBox 0 0 n+8 n+8). */
export const qrPath = (g) => g.flatMap((r, y) => r.map((d, x) => (d ? `M${x + 4} ${y + 4}h1v1h-1z` : ''))).join('');
