// Minimal hex + ABI helpers. Hex strings are '0x'-prefixed, lowercase on output.
// Integers are bigint. Only the ABI shapes this app needs are supported.
import { keccak } from './keccak.js';

export const strip = (h) => (h.startsWith('0x') ? h.slice(2) : h);
export const bytes = (h) => Uint8Array.from(strip(h).match(/../g) || [], (b) => parseInt(b, 16));
export const hex = (b) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const utf8 = (s) => new TextEncoder().encode(s);
export const keccakHex = (h) => hex(keccak(bytes(h)));
export const keccakText = (s) => hex(keccak(utf8(s)));
export const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
export const isHex = (h) => /^0x([0-9a-fA-F]{2})*$/.test(h);
export const ZERO = '0x' + '0'.repeat(40);

/** 32-byte word (no 0x) from a bigint, number, boolean or hex string of ≤32 bytes. */
export const word = (v) => {
  const n = BigInt(v);
  if (n < 0n || n >> 256n) throw Error('word out of range');
  return n.toString(16).padStart(64, '0');
};

/** Marks a hex string as ABI `bytes` (dynamic). */
export const B = (h) => ({ b: strip(h) });

/**
 * ABI-encode a flat argument list (no 0x). Static args: anything `word` accepts.
 * Dynamic args: arrays of static values (address[] / uint256[]) or B(hex) for bytes.
 */
export function encode(args) {
  let head = '', tail = '';
  for (const a of args) {
    if (Array.isArray(a) || (a && a.b !== undefined)) {
      head += word(args.length * 32 + tail.length / 2);
      tail += Array.isArray(a)
        ? word(a.length) + a.map(word).join('')
        : word(a.b.length / 2) + a.b.padEnd(Math.ceil(a.b.length / 64) * 64, '0');
    } else head += word(a);
  }
  return head + tail;
}

/** Calldata for a 4-byte selector (hex, no 0x) and args. */
export const cd = (sel, ...args) => '0x' + sel + encode(args);

// ---- decoding (r = return data hex) ----
const w = (r, i) => strip(r).slice(i * 64, i * 64 + 64);
export const u = (r, i = 0) => BigInt('0x' + (w(r, i) || '0'));
export const a = (r, i = 0) => '0x' + w(r, i).slice(24);
/** Dynamic address[] or uint256[] whose offset is at word i. */
export const arr = (r, i = 0, f = a) => {
  const o = Number(u(r, i)) / 32, n = Number(u(r, o));
  return Array.from({ length: n }, (_, k) => f(r, o + 1 + k));
};
/** Dynamic bytes whose offset is at word i, as hex. */
export const dbytes = (r, i = 0) => {
  const o = Number(u(r, i)) / 32, n = Number(u(r, o));
  return '0x' + strip(r).slice((o + 1) * 64, (o + 1) * 64 + n * 2);
};
/** ABI string whose offset is at word i. */
export const str = (r, i = 0) => new TextDecoder().decode(bytes(dbytes(r, i)));

/** EIP-55 checksum address. */
export function checksum(addr) {
  const h = strip(addr).toLowerCase(), k = strip(keccakText(h));
  return '0x' + [...h].map((c, i) => (parseInt(k[i], 16) > 7 ? c.toUpperCase() : c)).join('');
}

/** Format a bigint amount with `dec` decimals, trimming trailing zeros. */
export function fmt(v, dec = 18) {
  const s = v.toString().padStart(dec + 1, '0');
  const i = s.slice(0, s.length - dec), f = dec ? s.slice(-dec).replace(/0+$/, '') : '';
  return f ? i + '.' + f : i;
}

/** Human-friendly amount for overviews: grouped thousands, at most `places` decimals (truncated,
 *  never rounded up), "< 0.01" for tiny non-zero values. Exact amounts use `fmt`. */
export function fmtShort(v, dec = 18, places = 2) {
  const base = 10n ** BigInt(dec), int = v / base, frac = ((v % base) * 10n ** BigInt(places)) / base;
  if (!int && !frac) return v ? '< 0.' + '0'.repeat(places - 1) + '1' : '0';
  const f = frac ? '.' + frac.toString().padStart(places, '0').replace(/0+$/, '') : '';
  return int.toLocaleString('en-US') + f;
}

/** Parse a decimal string into a bigint with `dec` decimals. Throws on bad input. */
export function parse(s, dec = 18) {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s.trim());
  if (!m || (!m[1] && !m[2])) throw Error('invalid amount');
  const f = m[2] || '';
  if (f.length > dec) throw Error('too many decimals (max ' + dec + ')');
  return BigInt((m[1] || '0') + f.padEnd(dec, '0'));
}
