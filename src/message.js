// Safe messages (EIP-1271). A Safe "signs" a message when enough owners sign a SafeMessage over
// the message's hash; apps then verify it with the Safe's isValidSignature (through its fallback
// handler, e.g. CompatibilityFallbackHandler). As for transactions, nothing is signed unless the
// hash computed here equals the Safe's own getMessageHash, and the combined signature is checked
// with isValidSignature before it is handed out.
//
// A message is { chainId, safe, kind, content }:
//   kind 1: EIP-191 personal message, content = the message bytes (hex; text is UTF-8)
//   kind 2: EIP-712 typed data, content = its JSON text
//   kind 3: a raw 32-byte hash, as an app would pass to isValidSignature(bytes32, bytes)
// The Safe signs SafeMessage(bytes message) with message = that 32-byte hash (as Safe Wallet does).
import { B, cd, encode, hex, isAddr, isHex, keccakHex, keccakText, strip, u, utf8, word } from './abi.js';
import { checkSigs, normSig, recover } from './flow.js';
import { call, rpc } from './rpc.js';
import { readSafe } from './safe.js';
import { HANDLERS } from './chains.js';
import { S, T } from './sel.js';

export const KINDS = { 1: 'Message', 2: 'Typed data (EIP-712)', 3: 'Message hash' };

/** EIP-191 personal_sign hash of raw bytes (hex). */
export const hashMessage = (h) => {
  const b = strip(h);
  return keccakHex('0x' + strip(hex(utf8('\x19Ethereum Signed Message:\n' + b.length / 2))) + b);
};

// ---- EIP-712 ----
const DOMAIN = [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32']];
const base = (t) => t.replace(/(\[\d*\])+$/, '');

function typesOf(td) {
  const t = { ...td.types };
  if (!t.EIP712Domain) t.EIP712Domain = DOMAIN.filter(([n]) => td.domain[n] !== undefined).map(([name, type]) => ({ name, type }));
  for (const k in t) if (!Array.isArray(t[k]) || t[k].some((f) => !f || typeof f.name !== 'string' || typeof f.type !== 'string')) throw Error('Typed data: type ' + k + ' is malformed.');
  return t;
}
function deps(type, types, out = new Set()) {
  type = base(type);
  if (!types[type] || out.has(type)) return out;
  out.add(type);
  for (const f of types[type]) deps(f.type, types, out);
  return out;
}
/** "Mail(Person from,Person to,string contents)Person(string name,address wallet)" */
export function encodeType(type, types) {
  const [primary, ...rest] = [...deps(type, types)];
  return [primary, ...rest.sort()].map((t) => t + '(' + types[t].map((f) => f.type + ' ' + f.name).join(',') + ')').join('');
}
function encodeValue(type, v, types, path) {
  if (types[type]) return strip(hashStruct(type, v, types, path));
  const m = /^(.*)\[(\d*)\]$/.exec(type);
  if (m) {
    if (!Array.isArray(v)) throw Error(path + ': expected an array.');
    if (m[2] !== '' && v.length !== Number(m[2])) throw Error(path + ': expected ' + m[2] + ' items.');
    return strip(keccakHex('0x' + v.map((x, i) => encodeValue(m[1], x, types, path + '[' + i + ']')).join('')));
  }
  if (type === 'string') {
    if (typeof v !== 'string') throw Error(path + ': expected a string.');
    return strip(keccakText(v));
  }
  if (type === 'bytes') {
    if (typeof v !== 'string' || !isHex(v)) throw Error(path + ': expected 0x hex bytes.');
    return strip(keccakHex(v));
  }
  if (type === 'bool') {
    if (v !== true && v !== false) throw Error(path + ': expected true or false.');
    return word(v ? 1 : 0);
  }
  if (type === 'address') {
    if (typeof v !== 'string' || !isAddr(v)) throw Error(path + ': expected an address.');
    return word(v);
  }
  const b = /^bytes(\d+)$/.exec(type);
  if (b) {
    const n = Number(b[1]);
    if (typeof v !== 'string' || !isHex(v) || strip(v).length !== n * 2 || n < 1 || n > 32) throw Error(path + ': expected exactly ' + n + ' bytes.');
    return strip(v).toLowerCase().padEnd(64, '0');
  }
  const i = /^(u?)int(\d*)$/.exec(type);
  if (i) {
    const bits = BigInt(i[2] || 256);
    let n;
    try {
      n = BigInt(v);
    } catch {
      throw Error(path + ': expected an integer.');
    }
    const [lo, hi] = i[1] ? [0n, (1n << bits) - 1n] : [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n];
    if (n < lo || n > hi) throw Error(path + ': out of range for ' + type + '.');
    return (n < 0n ? n + (1n << 256n) : n).toString(16).padStart(64, '0');
  }
  throw Error(path + ': unsupported type ' + type + '.');
}
export function hashStruct(type, data, types, path = type) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(path + ': expected an object.');
  return keccakHex('0x' + strip(keccakText(encodeType(type, types))) + types[type].map((f) => encodeValue(f.type, data[f.name], types, path + '.' + f.name)).join(''));
}
/** The EIP-712 hash an app verifies (what eth_signTypedData_v4 signs). */
export function hashTypedData(td) {
  if (!td || typeof td !== 'object' || !td.types || !td.primaryType || !td.domain) throw Error('Typed data needs types, primaryType, domain and message.');
  const types = typesOf(td);
  if (!types[td.primaryType]) throw Error('Typed data: primaryType ' + td.primaryType + ' is not defined in types.');
  const domain = strip(hashStruct('EIP712Domain', td.domain, types, 'domain'));
  return keccakHex('0x1901' + domain + (td.primaryType === 'EIP712Domain' ? '' : strip(hashStruct(td.primaryType, td.message, types, 'message'))));
}

// ---- the Safe's side ----

/** The hash the app will ask the Safe about (EIP-1271 `hash`), and the typed data when there is any. */
export function describe(m) {
  if (m.kind === 1) {
    let text = null;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(strip(m.content).match(/../g) || [], (x) => parseInt(x, 16)));
    } catch {}
    return { hash: hashMessage(m.content), text };
  }
  if (m.kind === 2) {
    const typed = JSON.parse(m.content);
    return { hash: hashTypedData(typed), typed };
  }
  if (m.kind === 3) {
    if (!/^0x[0-9a-f]{64}$/.test(m.content)) throw Error('A message hash must be 32 bytes of hex.');
    return { hash: m.content };
  }
  throw Error('Unknown message kind.');
}

/** The EIP-712 parts of a SafeMessage over message = the 32-byte hash: domain hash, message hash, and their hash. */
export function safeMessageParts(chainId, safe, hash) {
  const domain = keccakHex('0x' + encode([T.Domain, chainId, safe])), message = keccakHex('0x' + encode([T.SafeMessage, keccakHex(hash)]));
  return { domain, message, hash: keccakHex('0x1901' + strip(domain) + strip(message)) };
}
/** SafeMessage hash for this Safe (what owners sign). */
export const safeMessageHash = (chainId, safe, hash) => safeMessageParts(chainId, safe, hash).hash;

/** Typed data for eth_signTypedData_v4 (an owner signing the Safe's message). */
export const safeMessageTypedData = (chainId, safe, hash) => ({
  types: {
    EIP712Domain: [
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    SafeMessage: [{ name: 'message', type: 'bytes' }],
  },
  domain: { chainId, verifyingContract: safe },
  primaryType: 'SafeMessage',
  message: { message: hash },
});

/** The Safe's own getMessageHash (through its fallback handler); null if the Safe cannot answer. */
export const chainMessageHash = (safe, hash) =>
  call(safe, cd(S.getMessageHash, B(hash))).then(
    (r) => (strip(r).length >= 64 ? '0x' + strip(r).slice(0, 64) : null),
    () => null,
  );

/** Does the Safe accept `sig` for `hash` (EIP-1271)? */
export const isValid = (safe, hash, sig) => call(safe, cd(S.isValidSignature, hash, B(sig))).then((r) => strip(r).slice(0, 8) === S.isValidSignature, () => false);

/** Has the Safe signed this SafeMessage hash onchain (SignMessageLib)? Then an empty signature is valid. */
export const signedOnchain = (safe, local) => call(safe, cd(S.signedMessages, local)).then((r) => u(r) !== 0n, () => false);

/** The Safe transaction that signs a message onchain: DELEGATECALL into Safe's SignMessageLib. */
export const onchainSignCall = (lib, hash) => ({ to: lib, value: 0n, data: cd(S.signMessage, B(hash)), operation: 1 });

/** Owners' signatures sorted by signer, `threshold` of them, concatenated: what the app receives. */
export const combine = (valid, threshold) =>
  '0x' + [...valid].sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1)).slice(0, Number(threshold)).map((x) => strip(x.sig)).join('');

/** The Safe's EIP-712 domain separator, from the Safe itself. */
const chainDomain = (safe) => call(safe, '0x' + S.domainSeparator).then((r) => '0x' + strip(r).slice(0, 64), () => null);

/**
 * The Safe's own SafeMessage hash. Handlers with getMessageHash (Compatibility) are asked directly;
 * a known handler without it (Extensible) builds the same SafeMessage hash from the Safe's domain
 * separator, so that is what is checked against the one computed here.
 */
async function safeSideHash(s, hash, local) {
  const own = await chainMessageHash(s.address, hash);
  if (own) return { onchain: own, via: 'getMessageHash' };
  const known = s.fallback && HANDLERS[s.fallback];
  if (!known || known.messageHash) return { onchain: null };
  const domain = keccakHex('0x' + encode([T.Domain, s.chainId, s.address]));
  return (await chainDomain(s.address)) === domain ? { onchain: local, via: 'domainSeparator' } : { onchain: null };
}

/** Check a message against the Safe: its hashes, and which of `sigs` are valid owner signatures. */
export async function checkMessage(m, sigs = []) {
  const s = await readSafe(m.safe), d = describe(m), local = safeMessageHash(m.chainId, m.safe, d.hash);
  const [{ onchain, via }, signed] = await Promise.all([safeSideHash(s, d.hash, local), signedOnchain(m.safe, local)]);
  const { valid, rejected } = await checkSigs(s, local, sigs);
  return { s, ...d, local, onchain, via, signed, valid, rejected };
}

/** An owner signs the Safe's message; refuses unless the Safe computes the same hash. */
export async function signMessage(m, from) {
  from = from.toLowerCase();
  const c = await checkMessage(m);
  if (!c.s.owners.includes(from)) throw Error('The connected wallet is not an owner of this Safe.');
  if (c.onchain !== c.local) throw Error(c.onchain ? 'The Safe computes a different message hash. Do not sign.' : 'This Safe cannot validate message signatures (no compatible fallback handler).');
  const sig = normSig(await rpc('eth_signTypedData_v4', [from, JSON.stringify(safeMessageTypedData(m.chainId, m.safe, c.hash))]));
  if ((await recover(c.local, sig)) !== from) throw Error('The wallet returned a signature that does not match this message. Discarding it.');
  return sig;
}
