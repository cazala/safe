// Transaction sharing (spec §7.3). A payload is untrusted input: whoever imports it
// recomputes the hash and reviews it; this module only (de)serializes.
//
// FROZEN FORMAT: links already shared and payloads published onchain depend on it. See
// docs/links.md → Stability and the golden vectors in test/unit/links.test.mjs before touching it.
//
// Compact binary (also the onchain format appended to approveHash):
//   'SW' 0x01 flags to nonce value data [gas fields] [signatures] [call signatures]
//   flags: bit0 DELEGATECALL, bit1 gas fields present, bit2 signatures present,
//          bit3 call signatures present
//   uint = 1-byte length + big-endian bytes; data = 3-byte length + bytes
//   signatures = 1-byte count + 65-byte ECDSA signatures (signers are recovered)
//   call signatures = 2-byte length + UTF-8 text, one human-readable function signature per line
//     (names for decoding the calls; untrusted: a decode counts only if it re-encodes exactly)
// A link carries uint(chainId) ‖ safe ‖ compact, base64url, in the URL fragment.
import { bytes, hex, isAddr, isHex, strip, utf8, ZERO } from './abi.js';
import { safeTxHash } from './safe.js';

const MAGIC = '535701';
const b1 = (n) => n.toString(16).padStart(2, '0');
const uint = (v) => {
  let h = v ? v.toString(16) : '';
  if (h.length % 2) h = '0' + h;
  return b1(h.length / 2) + h;
};
const hasGas = (t) => !!(t.safeTxGas || t.baseGas || t.gasPrice || t.gasToken !== ZERO || t.refundReceiver !== ZERO);

/** Call signatures as the UTF-8 text of the payload section (one per line, no empty lines). */
const abiText = (abi) => strip(hex(utf8(abi.map((l) => l.trim()).filter(Boolean).join('\n'))));

/** Compact encoding of a SafeTx (chainId and Safe address are implied by context). */
export function compact(t, sigs = [], abi = []) {
  const d = strip(t.data), g = hasGas(t), a = abi.length ? abiText(abi) : '';
  if (d.length / 2 >= 1 << 24) throw Error('calldata too large to share');
  if (a.length / 2 >= 1 << 16) throw Error('call signatures too large to share');
  let o = MAGIC + b1(t.operation | (g ? 2 : 0) | (sigs.length ? 4 : 0) | (a ? 8 : 0)) + strip(t.to) + uint(t.nonce) + uint(t.value) + (d.length / 2).toString(16).padStart(6, '0') + d;
  if (g) o += uint(t.safeTxGas) + uint(t.baseGas) + uint(t.gasPrice) + strip(t.gasToken) + strip(t.refundReceiver);
  if (sigs.length) o += b1(sigs.length) + sigs.map((s) => strip(s)).join('');
  if (a) o += (a.length / 2).toString(16).padStart(4, '0') + a;
  return '0x' + o.toLowerCase();
}

function reader(h) {
  h = strip(h).toLowerCase();
  let i = 0;
  const take = (n) => {
    if (i + n * 2 > h.length) throw Error('Payload is truncated.');
    return h.slice(i, (i += n * 2));
  };
  const num = () => {
    const n = parseInt(take(1), 16);
    if (n > 32) throw Error('Payload has an oversized number.');
    return n ? BigInt('0x' + take(n)) : 0n;
  };
  return { take, num, end: () => i === h.length };
}

function decode(r, chainId, safe) {
  if (r.take(3) !== MAGIC) throw Error('Not a safe.wei transaction payload.');
  const f = parseInt(r.take(1), 16);
  if (f & ~15) throw Error('Payload uses unknown flags.');
  const t = { chainId, safe, to: '0x' + r.take(20), nonce: r.num(), value: r.num(), operation: f & 1 };
  t.data = '0x' + r.take(parseInt(r.take(3), 16));
  Object.assign(
    t,
    f & 2
      ? { safeTxGas: r.num(), baseGas: r.num(), gasPrice: r.num(), gasToken: '0x' + r.take(20), refundReceiver: '0x' + r.take(20) }
      : { safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO },
  );
  const sigs = [];
  if (f & 4) for (let n = parseInt(r.take(1), 16); n--; ) sigs.push('0x' + r.take(65));
  let abi = [];
  if (f & 8) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes('0x' + r.take(parseInt(r.take(2), 16))));
    abi = text.split('\n').filter(Boolean);
  }
  if (!r.end()) throw Error('Payload has trailing bytes.');
  return { tx: t, sigs, abi };
}

/** Decode a compact payload for a known chain and Safe (the onchain case). */
export const uncompact = (h, chainId, safe) => decode(reader(h), chainId, safe.toLowerCase());

const b64 = (h) => btoa(String.fromCharCode(...bytes(h))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => hex(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

/** The fragment part of a share link: tx=<base64url>. */
export const fragment = (t, sigs, abi) => 'tx=' + b64(uint(BigInt(t.chainId)) + strip(t.safe) + strip(compact(t, sigs, abi)));

export function fromFragment(s) {
  const r = reader(unb64(s));
  const chainId = Number(r.num());
  return decode(r, chainId, '0x' + r.take(20));
}

/** Human-readable JSON payload. Includes safeTxHash so humans can cross-check. */
export function toJSON(t, sigs = [], abi = []) {
  const o = { safeTxHash: safeTxHash(t) };
  for (const k in t) o[k] = typeof t[k] === 'bigint' ? t[k].toString() : t[k];
  if (sigs.length) o.signatures = sigs;
  if (abi.length) o.abi = abi;
  return JSON.stringify(o, null, 2);
}

/** Parse anything a user may paste: a link, a bare fragment, or JSON. */
export function importPayload(text) {
  text = text.trim();
  if (text.startsWith('{')) {
    const o = JSON.parse(text);
    const U = (k) => {
      if (!/^\d+$/.test(String(o[k] ?? '0'))) throw Error('JSON: ' + k + ' must be a decimal integer.');
      return BigInt(o[k] ?? 0);
    };
    const A = (k, d) => {
      const v = String(o[k] ?? d).toLowerCase();
      if (!isAddr(v)) throw Error('JSON: ' + k + ' must be an address.');
      return v;
    };
    const t = {
      chainId: Number(U('chainId')),
      safe: A('safe'),
      to: A('to'),
      value: U('value'),
      data: String(o.data ?? '0x').toLowerCase(),
      operation: Number(U('operation')),
      safeTxGas: U('safeTxGas'),
      baseGas: U('baseGas'),
      gasPrice: U('gasPrice'),
      gasToken: A('gasToken', ZERO),
      refundReceiver: A('refundReceiver', ZERO),
      nonce: U('nonce'),
    };
    if (!isHex(t.data)) throw Error('JSON: data must be hex.');
    if (t.operation > 1) throw Error('JSON: operation must be 0 or 1.');
    if (o.safeTxHash && o.safeTxHash.toLowerCase() !== safeTxHash(t)) throw Error('JSON: safeTxHash does not match the transaction fields. Refusing to import.');
    const sigs = (o.signatures || []).map((s) => {
      if (!/^0x[0-9a-fA-F]{130}$/.test(s)) throw Error('JSON: each signature must be 65 bytes of hex.');
      return s.toLowerCase();
    });
    if (o.abi !== undefined && (!Array.isArray(o.abi) || o.abi.some((l) => typeof l !== 'string'))) throw Error('JSON: abi must be a list of function signatures.');
    return { tx: t, sigs, abi: (o.abi || []).map((l) => l.trim()).filter(Boolean) };
  }
  const m = /(?:^|[#&?])tx=([A-Za-z0-9_-]+)/.exec(text) || /^([A-Za-z0-9_-]+)$/.exec(text);
  if (!m) throw Error('Paste a safe.wei link, a tx= fragment, or transaction JSON.');
  return fromFragment(m[1]);
}

// ---- messages (FROZEN FORMAT as well): #msg=<base64url> ----
//   uint(chainId) ‖ safe ‖ 'SM' 0x01 flags kind content [signatures]
//   flags: bit0 signatures present (every other bit must be 0)
//   kind: 1 = EIP-191 message bytes, 2 = EIP-712 typed data as UTF-8 JSON, 3 = 32-byte hash
//   content = 3-byte length + bytes; signatures = 1-byte count + 65-byte SafeMessage signatures
const MSG = '534d01';

/** The fragment part of a message link: msg=<base64url>. */
export function messageFragment(m, sigs = []) {
  const c = m.kind === 2 ? strip(hex(utf8(m.content))) : strip(m.content);
  if (c.length / 2 >= 1 << 24) throw Error('message too large to share');
  let o = uint(BigInt(m.chainId)) + strip(m.safe) + MSG + b1(sigs.length ? 1 : 0) + b1(m.kind) + (c.length / 2).toString(16).padStart(6, '0') + c;
  if (sigs.length) o += b1(sigs.length) + sigs.map((x) => strip(x)).join('');
  return 'msg=' + b64(o.toLowerCase());
}

export function fromMessageFragment(s) {
  const r = reader(unb64(s));
  const chainId = Number(r.num()), safe = '0x' + r.take(20);
  if (r.take(3) !== MSG) throw Error('Not a safe.wei message payload.');
  const f = parseInt(r.take(1), 16);
  if (f & ~1) throw Error('Payload uses unknown flags.');
  const kind = parseInt(r.take(1), 16);
  if (![1, 2, 3].includes(kind)) throw Error('Unknown message kind.');
  const raw = r.take(parseInt(r.take(3), 16));
  if (kind === 3 && raw.length !== 64) throw Error('A message hash must be 32 bytes.');
  const content = kind === 2 ? new TextDecoder('utf-8', { fatal: true }).decode(bytes('0x' + raw)) : '0x' + raw;
  const sigs = [];
  if (f & 1) for (let n = parseInt(r.take(1), 16); n--; ) sigs.push('0x' + r.take(65));
  if (!r.end()) throw Error('Payload has trailing bytes.');
  return { msg: { chainId, safe, kind, content }, sigs };
}

/** A pasted message link or msg= fragment, or null if the text is not one. */
export function importMessage(text) {
  const m = /(?:^|[#&?])msg=([A-Za-z0-9_-]+)/.exec(text.trim());
  return m ? fromMessageFragment(m[1]) : null;
}
