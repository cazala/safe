// ABI support for the transaction builder: parse an ABI (JSON, or human-readable
// "function name(type arg, …)" lines), list its write methods, and ABI-encode calls with
// any parameter types (static, dynamic, arrays, fixed arrays, tuples).
import { bytes, keccakText, strip, utf8, hex, isAddr, isHex } from './abi.js';

// ---- types ----
// A param is { name, type, components? } as in JSON ABIs; `type` may carry array suffixes.
const arrayOf = (t) => /^(.*)\[(\d*)\]$/.exec(t); // [whole, inner, length|'']
const inner = (p, m) => ({ ...p, type: m[1] });

/** Canonical type string used in the selector: tuples become "(a,b)". */
export function canonical(p) {
  const m = arrayOf(p.type);
  if (m) return canonical(inner(p, m)) + '[' + m[2] + ']';
  if (p.type === 'tuple') return '(' + p.components.map(canonical).join(',') + ')';
  return p.type.replace(/^uint$/, 'uint256').replace(/^int$/, 'int256');
}

const dynamic = (p) => {
  const m = arrayOf(p.type);
  if (m) return m[2] === '' || dynamic(inner(p, m));
  if (p.type === 'tuple') return p.components.some(dynamic);
  return p.type === 'bytes' || p.type === 'string';
};

// ---- encoding (values are already parsed: bigint, boolean, hex string, string, arrays) ----
const pad = (h) => h.padEnd(Math.ceil(h.length / 64) * 64, '0');
const word = (n) => {
  if (n < 0n) n += 1n << 256n; // two's complement for intN
  return n.toString(16).padStart(64, '0');
};

function encodeOne(p, v) {
  const m = arrayOf(p.type);
  if (m) {
    const items = v.map((x) => ({ p: inner(p, m), v: x }));
    return (m[2] === '' ? word(BigInt(v.length)) : '') + encodeList(items);
  }
  if (p.type === 'tuple') return encodeList(p.components.map((c, i) => ({ p: c, v: v[i] })));
  if (p.type === 'bytes' || p.type === 'string') {
    const b = p.type === 'string' ? strip(hex(utf8(v))) : strip(v);
    return word(BigInt(b.length / 2)) + pad(b);
  }
  if (/^bytes\d+$/.test(p.type)) return strip(v).padEnd(64, '0');
  if (p.type === 'address') return strip(v).toLowerCase().padStart(64, '0');
  if (p.type === 'bool') return word(v ? 1n : 0n);
  return word(v); // (u)intN
}

function encodeList(items) {
  let head = '', tail = '';
  const size = items.reduce((n, x) => n + (dynamic(x.p) ? 32 : headSize(x.p)), 0);
  for (const x of items) {
    const e = encodeOne(x.p, x.v);
    if (dynamic(x.p)) (head += word(BigInt(size + tail.length / 2))), (tail += e);
    else head += e;
  }
  return head + tail;
}
// Static head size in bytes (fixed arrays and tuples of static types are inline).
function headSize(p) {
  const m = arrayOf(p.type);
  if (m) return Number(m[2]) * headSize(inner(p, m));
  if (p.type === 'tuple') return p.components.reduce((n, c) => n + headSize(c), 0);
  return 32;
}

// ---- functions ----
/** Normalize a function fragment and add its signature and selector. */
function fn(f) {
  const inputs = (f.inputs || []).map((p, i) => ({ ...p, name: p.name || 'arg' + i }));
  const sig = f.name + '(' + inputs.map(canonical).join(',') + ')';
  const mut = f.stateMutability || (f.constant ? 'view' : f.payable ? 'payable' : 'nonpayable');
  return { name: f.name, inputs, sig, selector: keccakText(sig).slice(2, 10), payable: mut === 'payable', write: mut !== 'view' && mut !== 'pure' };
}

/** Encode calldata for `f` with parsed `values`. */
export const encodeCall = (f, values) => '0x' + f.selector + encodeList(f.inputs.map((p, i) => ({ p, v: values[i] })));

// ---- parsing ABIs ----
/** Split "a, (b c, d) e, f" at top-level commas. */
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && !depth) (out.push(cur.trim()), (cur = ''));
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Parse one human-readable parameter: "uint256 amount", "(address a, uint b)[] items", "tuple(address,uint) t". */
function param(s) {
  s = s.trim().replace(/^tuple(?=\()/, '');
  if (s.startsWith('(')) {
    let depth = 0, i = 0;
    for (; i < s.length; i++) {
      if (s[i] === '(') depth++;
      if (s[i] === ')' && !--depth) break;
    }
    const [suffix, name = ''] = s.slice(i + 1).trim().split(/\s+/);
    const arr = /^(\[\d*\])*/.exec(suffix || '')[0];
    return { type: 'tuple' + arr, name: (arr ? name : suffix) || '', components: splitTop(s.slice(1, i)).map(param) };
  }
  const [type, ...rest] = s.split(/\s+/).filter((w) => !/^(memory|calldata|storage|indexed)$/.test(w));
  return { type, name: rest.pop() || '' };
}

/**
 * Parse a pasted or uploaded ABI: a JSON ABI array (or an object with an `abi` field),
 * or human-readable lines such as "function transfer(address to, uint256 amount)".
 * Returns every function, write methods first.
 */
export function parseAbi(text) {
  text = text.trim();
  let frags;
  if (text.startsWith('[') || text.startsWith('{')) {
    let j = JSON.parse(text);
    if (!Array.isArray(j)) j = j.abi || (j.output && j.output.abi) || [];
    frags = j.filter((f) => f.type === 'function' || (!f.type && f.name));
  } else {
    frags = text
      .split(/\n|;/)
      .map((l) => l.trim())
      .filter((l) => /^(function\s+)?[A-Za-z_$][\w$]*\s*\(/.test(l))
      .map((l) => {
        const m = /^(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*([^()]*)$/.exec(l.replace(/\s+returns\s*\([\s\S]*\)\s*$/, ''));
        if (!m) throw Error('Cannot parse: ' + l);
        const mods = m[3].split(/\s+/);
        return { name: m[1], inputs: splitTop(m[2]).map(param), stateMutability: ['view', 'pure', 'payable'].find((x) => mods.includes(x)) || 'nonpayable' };
      });
  }
  const fns = frags.map(fn);
  if (!fns.length) throw Error('No functions found in that ABI.');
  return fns.sort((a, b) => b.write - a.write || a.name.localeCompare(b.name));
}

// ---- parsing user input ----
const MAX = (1n << 256n) - 1n;
const intRange = (type) => {
  const bits = BigInt(/\d+/.exec(type) ? /\d+/.exec(type)[0] : 256);
  return type.startsWith('u') ? [0n, (1n << bits) - 1n] : [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n];
};

/** Parse a value typed by the user (strings for scalars; JSON arrays for arrays/tuples). */
export function parseValue(p, v) {
  const m = arrayOf(p.type);
  if (m || p.type === 'tuple') {
    let a = v;
    if (typeof a === 'string') {
      try {
        a = JSON.parse(a);
      } catch {
        throw Error(p.name + ': enter a JSON array, e.g. ["0x…", "1"]');
      }
    }
    if (!Array.isArray(a)) throw Error(p.name + ': expected an array.');
    if (m) {
      if (m[2] !== '' && a.length !== Number(m[2])) throw Error(p.name + ': expected exactly ' + m[2] + ' items.');
      return a.map((x, i) => parseValue({ ...inner(p, m), name: p.name + '[' + i + ']' }, x));
    }
    if (a.length !== p.components.length) throw Error(p.name + ': expected ' + p.components.length + ' fields.');
    return p.components.map((c, i) => parseValue({ ...c, name: p.name + '.' + (c.name || i) }, a[i]));
  }
  const s = String(v).trim();
  if (p.type === 'address') {
    if (!isAddr(s)) throw Error(p.name + ': not an address.');
    return s.toLowerCase();
  }
  if (p.type === 'bool') {
    if (!/^(true|false)$/.test(s)) throw Error(p.name + ': true or false.');
    return s === 'true';
  }
  if (p.type === 'string') return String(v);
  if (p.type === 'bytes' || /^bytes\d+$/.test(p.type)) {
    if (!isHex(s)) throw Error(p.name + ': 0x-prefixed hex with an even number of digits.');
    const n = /\d+/.exec(p.type);
    if (n && strip(s).length / 2 !== Number(n[0])) throw Error(p.name + ': exactly ' + n[0] + ' bytes.');
    return s.toLowerCase();
  }
  if (/^u?int\d*$/.test(p.type)) {
    if (!/^-?\d+$/.test(s) && !/^0x[0-9a-fA-F]+$/.test(s)) throw Error(p.name + ': a whole number (use the unit helper for decimals).');
    const n = BigInt(s), [lo, hi] = intRange(p.type);
    if (n < lo || n > hi) throw Error(p.name + ': out of range for ' + p.type + '.');
    return n;
  }
  throw Error(p.name + ': unsupported type ' + p.type + '.');
}

export { MAX };

// ---- decoding with a signature that came with a transaction (docs/links.md → call signatures) ----
// The signature is untrusted: it only supplies names. A decode counts only if encoding the decoded
// values again reproduces the calldata byte for byte, so the values are exactly what will execute.

const rd = (h, pos, n = 64) => {
  if (pos < 0 || pos + n > h.length) throw Error('out of bounds');
  return h.slice(pos, pos + n);
};
/** A length or offset word, bounded by the data itself (no allocation from attacker-sized numbers). */
const small = (h, pos) => {
  const v = BigInt('0x' + rd(h, pos));
  if (v > BigInt(h.length)) throw Error('length or offset out of range');
  return Number(v);
};

function decodeList(ps, h, start) {
  let head = start;
  return ps.map((p) => {
    let v;
    if (dynamic(p)) (v = decodeAt(p, h, start + small(h, head) * 2)), (head += 64);
    else (v = decodeAt(p, h, head)), (head += headSize(p) * 2);
    return v;
  });
}

function decodeAt(p, h, pos) {
  const m = arrayOf(p.type);
  if (m) {
    const it = inner(p, m), n = m[2] === '' ? small(h, pos) : Number(m[2]);
    if (n * 64 > h.length) throw Error('array longer than the data');
    return decodeList(Array(n).fill(it), h, m[2] === '' ? pos + 64 : pos);
  }
  if (p.type === 'tuple') return decodeList(p.components, h, pos);
  if (p.type === 'bytes' || p.type === 'string') {
    const n = small(h, pos), b = rd(h, pos + 64, n * 2);
    return p.type === 'bytes' ? '0x' + b : new TextDecoder('utf-8', { fatal: true }).decode(bytes('0x' + b));
  }
  const w = rd(h, pos);
  if (p.type === 'address') return '0x' + w.slice(24);
  if (p.type === 'bool') return w.endsWith('1'); // any other word re-encodes differently and is rejected
  const b = /^bytes(\d+)$/.exec(p.type);
  if (b) return '0x' + w.slice(0, Number(b[1]) * 2);
  const i = /^(u?)int(\d*)$/.exec(p.type);
  if (!i) throw Error('unsupported type ' + p.type);
  let v = BigInt('0x' + w);
  if (!i[1] && v >> 255n) v -= 1n << 256n;
  const [lo, hi] = intRange(p.type);
  if (v < lo || v > hi) throw Error('out of range for ' + p.type); // the encoder would not catch this
  return v;
}

/**
 * Decode `data` with the first of `signatures` (human-readable lines) whose selector matches and
 * whose decoded values re-encode to exactly `data`. Returns { f, values, signature } or null.
 */
export function matchCall(signatures, data) {
  const h = strip(data || '0x').toLowerCase();
  if (h.length < 8) return null;
  for (const line of signatures || []) {
    let f;
    try {
      [f] = parseAbi(line);
    } catch {
      continue;
    }
    if (!f || f.selector !== h.slice(0, 8)) continue;
    try {
      const values = decodeList(f.inputs, h.slice(8), 0);
      if (strip(encodeCall(f, values)) === h) return { f, values, signature: line };
    } catch {}
  }
  return null;
}

/** The human-readable signature of a parsed function, with parameter names: "transfer(address to, uint256 amount)". */
export function humanSig(f) {
  const t = (p) => {
    const m = arrayOf(p.type);
    if (m) return t(inner(p, m)) + '[' + m[2] + ']';
    return p.type === 'tuple' ? '(' + p.components.map((c) => t(c) + (c.name ? ' ' + c.name : '')).join(', ') + ')' : canonical(p);
  };
  return f.name + '(' + f.inputs.map((p) => t(p) + (p.name && !/^arg\d+$/.test(p.name) ? ' ' + p.name : '')).join(', ') + ')';
}
