// WalletConnect v2, wallet side (Sign protocol), minimal: pair from a wc: link, approve a session
// for the Safe, receive requests, answer them. Everything between the dapp and safe.wei is end-to-end
// encrypted (X25519 + HKDF-SHA256 keys, ChaCha20-Poly1305); the relay only moves ciphertext.
// Constants follow the WalletConnect specs and the official SDK (tags, TTLs, envelope types).
// Crypto: WebCrypto for SHA-256, HKDF, X25519 and Ed25519; ChaCha20-Poly1305 (RFC 8439) below.

const RELAY = 'wss://relay.walletconnect.org';
const MIN5 = 300, DAY = 86400;
export const TAGS = {
  proposeRes: 1101, proposeReject: 1120, settle: 1102, settleRes: 1103, update: 1104, extend: 1106,
  request: 1108, requestRes: 1109, event: 1110, del: 1112, delRes: 1113, ping: 1114, pingRes: 1115,
};

// ---- ChaCha20-Poly1305 (RFC 8439) ----
const rotl = (v, c) => ((v << c) | (v >>> (32 - c))) >>> 0;
const words = (b) => Array.from({ length: b.length / 4 }, (_, i) => (b[4 * i] | (b[4 * i + 1] << 8) | (b[4 * i + 2] << 16) | (b[4 * i + 3] << 24)) >>> 0);

function block(key, counter, nonce) {
  const s = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...words(key), counter >>> 0, ...words(nonce)], x = s.slice();
  const qr = (a, b, c, d) => {
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 16);
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 12);
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 8);
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const v = (x[i] + s[i]) >>> 0;
    out[4 * i] = v & 255; out[4 * i + 1] = (v >>> 8) & 255; out[4 * i + 2] = (v >>> 16) & 255; out[4 * i + 3] = v >>> 24;
  }
  return out;
}
export function chacha20(key, counter, nonce, data) {
  const out = new Uint8Array(data.length);
  for (let p = 0; p < data.length; p += 64, counter++) {
    const ks = block(key, counter, nonce);
    for (let i = 0; i < 64 && p + i < data.length; i++) out[p + i] = data[p + i] ^ ks[i];
  }
  return out;
}
const le = (b) => b.reduceRight((n, x) => (n << 8n) | BigInt(x), 0n);
export function poly1305(key, msg) {
  const r = le(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn, s = le(key.subarray(16, 32)), P = (1n << 130n) - 5n;
  let acc = 0n;
  for (let i = 0; i < msg.length; i += 16) {
    const chunk = msg.subarray(i, i + 16);
    acc = ((acc + le(chunk) + (1n << BigInt(8 * chunk.length))) * r) % P;
  }
  acc = (acc + s) & ((1n << 128n) - 1n);
  return Uint8Array.from({ length: 16 }, (_, i) => Number((acc >> BigInt(8 * i)) & 255n));
}
function mac(key, nonce, aad, ct) {
  const otk = block(key, 0, nonce).subarray(0, 32), pad = (n) => (16 - (n % 16)) % 16;
  const m = new Uint8Array(aad.length + pad(aad.length) + ct.length + pad(ct.length) + 16);
  m.set(aad, 0);
  m.set(ct, aad.length + pad(aad.length));
  const lens = new DataView(m.buffer, m.length - 16);
  lens.setBigUint64(0, BigInt(aad.length), true);
  lens.setBigUint64(8, BigInt(ct.length), true);
  return poly1305(otk, m);
}
export function seal(key, nonce, plaintext, aad = new Uint8Array(0)) {
  const ct = chacha20(key, 1, nonce, plaintext), out = new Uint8Array(ct.length + 16);
  out.set(ct);
  out.set(mac(key, nonce, aad, ct), ct.length);
  return out;
}
export function open(key, nonce, sealed, aad = new Uint8Array(0)) {
  if (sealed.length < 16) return null;
  const ct = sealed.subarray(0, sealed.length - 16), tag = sealed.subarray(sealed.length - 16), want = mac(key, nonce, aad, ct);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= want[i] ^ tag[i];
  return diff ? null : chacha20(key, 1, nonce, ct);
}

// ---- encodings ----
export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
const b64 = (b) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (b) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s) => new TextEncoder().encode(s);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(b) {
  let n = le([...b].reverse()), s = '';
  while (n > 0n) (s = B58[Number(n % 58n)] + s), (n /= 58n);
  for (const x of b) {
    if (x) break;
    s = '1' + s;
  }
  return s;
}
/** did:key of an Ed25519 public key (multicodec 0xed01, base58btc). */
export const didKey = (pub) => 'did:key:z' + base58(Uint8Array.from([0xed, 0x01, ...pub]));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const sha256 = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
export const topicOf = async (key) => hex(await sha256(key));

/** Envelope: type 0 = 0x00 ‖ iv(12) ‖ sealed; type 1 = 0x01 ‖ senderPublicKey(32) ‖ iv ‖ sealed. Base64. */
export function encrypt(key, payload) {
  const iv = random(12), sealed = seal(key, iv, utf8(JSON.stringify(payload))), out = new Uint8Array(13 + sealed.length);
  out.set(iv, 1);
  out.set(sealed, 13);
  return b64(out);
}
export function decrypt(key, message) {
  let b;
  try {
    b = unb64(message);
  } catch {
    return null;
  }
  const head = b[0] === 0 ? 1 : b[0] === 1 ? 33 : -1;
  if (head < 0 || b.length < head + 28) return null;
  const pt = open(key, b.subarray(head, head + 12), b.subarray(head + 12));
  if (!pt) return null;
  try {
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

const cryptoMissing = () => Error('This browser cannot do the cryptography WalletConnect needs (Ed25519 / X25519). Update it, or use another browser.');

/**
 * The relay client identity: an Ed25519 key kept across reloads. The relay ties a topic to the client
 * that joined it, so a fresh key after a reload could listen to a session but not publish to it.
 * Returns { pkcs8, pub } (hex); it only authenticates to the relay and controls no funds.
 */
async function newClientKey() {
  try {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign']);
    return { pkcs8: hex(new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))), pub: hex(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))) };
  } catch {
    throw cryptoMissing();
  }
}
/** Relay auth: a JWT signed by the client key (iss = its did:key, aud = the relay). */
async function relayAuth(client) {
  const key = await crypto.subtle.importKey('pkcs8', unhex(client.pkcs8), { name: 'Ed25519' }, false, ['sign']), iat = Math.floor(Date.now() / 1000);
  const part = (o) => b64u(utf8(JSON.stringify(o)));
  const body = part({ alg: 'EdDSA', typ: 'JWT' }) + '.' + part({ iss: didKey(unhex(client.pub)), sub: hex(random(32)), aud: RELAY, iat, exp: iat + DAY, act: 'client_auth' });
  return body + '.' + b64u(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, utf8(body))));
}

/** X25519 key pair (raw public key) and the shared session key with a peer: HKDF-SHA256(X25519). */
async function keyPair() {
  try {
    const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    return { privateKey: kp.privateKey, pub: new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)) };
  } catch {
    throw cryptoMissing();
  }
}
export async function sharedKey(privateKey, peerHex) {
  const peer = await crypto.subtle.importKey('raw', unhex(peerHex), { name: 'X25519' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, privateKey, 256);
  const ikm = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new Uint8Array(0) }, ikm, 256));
}

/** "wc:<topic>@2?relay-protocol=irn&symKey=<hex>&expiryTimestamp=…" → { topic, symKey, expiry }. */
export function parseUri(uri) {
  const m = /^wc:([0-9a-f]{64})@2\?(.+)$/i.exec((uri || '').trim());
  if (!m) throw Error('Paste the WalletConnect link from the dapp: it starts with wc: and contains @2.');
  const q = new URLSearchParams(m[2]), symKey = (q.get('symKey') || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(symKey)) throw Error('This WalletConnect link has no valid key.');
  if ((q.get('relay-protocol') || 'irn') !== 'irn') throw Error('This WalletConnect link uses an unknown relay.');
  const expiry = Number(q.get('expiryTimestamp') || 0);
  if (expiry && expiry * 1000 < Date.now()) throw Error('This WalletConnect link has expired. Ask the dapp for a new one.');
  return { topic: m[1].toLowerCase(), symKey, expiry };
}

// ---- the wallet ----

/**
 * create({ projectId, load, save, onEvent }): a WalletConnect wallet client. `load()`/`save(state)`
 * persist { sessions, pending, client }; `onEvent(e)` gets { type: 'proposal' | 'request' | 'sessions' | 'closed' | 'error' }.
 */
export function create({ projectId, load, save, onEvent }) {
  let sock = null, opening = null, nextId = 1, retry = 0;
  const waiting = new Map(), subs = new Map(); // relay request id → {res, rej}; topic → handler
  const state = () => ({ sessions: [], pending: [], ...(load() || {}) });
  async function client() {
    const st = state();
    if (!st.client) (st.client = await newClientKey()), save(st);
    return st.client;
  }
  const emit = (e) => {
    try {
      onEvent(e);
    } catch {}
  };
  const id = () => Date.now() * 1000 + (nextId++ % 1000);

  function onMessage(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.method === 'irn_subscription') {
      send({ id: m.id, jsonrpc: '2.0', result: true });
      const d = m.params && m.params.data, f = d && subs.get(d.topic);
      if (f) Promise.resolve(f(d.message)).catch((e) => emit({ type: 'error', message: e.message }));
      return;
    }
    const w = waiting.get(m.id);
    if (w) waiting.delete(m.id), m.error ? w.rej(Error(m.error.message || 'Relay error')) : w.res(m.result);
  }
  const send = (o) => !!(sock && sock.readyState === 1 && (sock.send(JSON.stringify(o)), true));

  async function connect() {
    if (sock && sock.readyState === 1) return;
    if (opening) return opening;
    opening = (async () => {
      const ws = new WebSocket(RELAY + '/?auth=' + (await relayAuth(await client())) + '&projectId=' + projectId() + '&ua=' + encodeURIComponent('wc-2/js/safe.wei'));
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(Error('The WalletConnect relay did not answer.')), 15000);
        ws.onopen = () => (clearTimeout(t), res());
        ws.onerror = () => (clearTimeout(t), rej(Error('The WalletConnect relay could not be reached.')));
        ws.onclose = (e) => (clearTimeout(t), rej(Error('The WalletConnect relay refused the connection' + (e.code === 3000 || e.code === 4010 ? ': the project ID was not accepted.' : e.code ? ' (' + e.code + (e.reason ? ': ' + e.reason : '') + ').' : '.'))));
      });
      sock = ws;
      retry = 0;
      ws.onmessage = (e) => typeof e.data === 'string' && onMessage(e.data);
      ws.onclose = () => {
        sock = null;
        for (const w of waiting.values()) w.rej(Error('The WalletConnect relay connection dropped.'));
        waiting.clear();
        // Reconnect while sessions exist, backing off.
        if (state().sessions.length) setTimeout(() => restore().catch(() => {}), Math.min(30000, 1000 * 2 ** retry++));
        else emit({ type: 'closed' });
      };
      // Topics survive reconnects.
      await Promise.all([...subs.keys()].map((topic) => call('irn_subscribe', { topic })));
    })().finally(() => (opening = null));
    return opening;
  }
  function call(method, params) {
    const rid = id();
    return new Promise((res, rej) => {
      waiting.set(rid, { res, rej });
      if (!send({ id: rid, jsonrpc: '2.0', method, params })) waiting.delete(rid), rej(Error('Not connected to the WalletConnect relay.'));
      setTimeout(() => waiting.has(rid) && (waiting.delete(rid), rej(Error('The WalletConnect relay timed out.'))), 15000);
    });
  }
  const subscribe = async (topic, fn) => (subs.set(topic, fn), await connect(), call('irn_subscribe', { topic }));
  const publish = (topic, key, payload, tag, ttl = MIN5, prompt = false) => call('irn_publish', { topic, message: encrypt(key, payload), ttl, tag, prompt });

  // ---- sessions ----
  const sessionHandler = (s) => async (message) => {
    const key = unhex(s.key), m = decrypt(key, message);
    if (!m) return;
    if (m.method === 'wc_sessionRequest') {
      const r = { topic: s.topic, id: m.id, method: m.params.request.method, params: m.params.request.params, chainId: m.params.chainId, at: Date.now() };
      const st = state();
      if (!st.pending.some((p) => p.topic === r.topic && p.id === r.id)) (st.pending = [...st.pending, r]), save(st);
      return emit({ type: 'request', request: r, session: s });
    }
    if (m.method === 'wc_sessionPing') return publish(s.topic, key, { id: m.id, jsonrpc: '2.0', result: true }, TAGS.pingRes, DAY);
    if (m.method === 'wc_sessionDelete') {
      await publish(s.topic, key, { id: m.id, jsonrpc: '2.0', result: true }, TAGS.delRes, DAY).catch(() => {});
      return forget(s.topic);
    }
    if (m.method === 'wc_sessionExtend' || m.method === 'wc_sessionUpdate' || m.method === 'wc_sessionEvent')
      return publish(s.topic, key, { id: m.id, jsonrpc: '2.0', result: true }, (m.method === 'wc_sessionEvent' ? TAGS.event : m.method === 'wc_sessionExtend' ? TAGS.extend : TAGS.update) + 1, DAY);
  };
  function forget(topic) {
    const st = state();
    st.sessions = st.sessions.filter((x) => x.topic !== topic);
    st.pending = st.pending.filter((x) => x.topic !== topic);
    save(st);
    subs.delete(topic);
    call('irn_unsubscribe', { topic, id: '' }).catch(() => {});
    emit({ type: 'sessions' });
    if (!st.sessions.length && sock) sock.close();
  }

  /** Re-open the relay and listen to every saved session (after a reload). */
  async function restore() {
    const st = state(), now = Date.now() / 1000;
    const live = st.sessions.filter((s) => s.expiry > now);
    if (live.length !== st.sessions.length) (st.sessions = live), save(st);
    if (!live.length) return;
    for (const s of live) subs.set(s.topic, sessionHandler(s));
    await connect();
  }

  /** Pair with a dapp's wc: link. Resolves with its session proposal (to approve or reject). */
  async function pair(uri) {
    const p = parseUri(uri), key = unhex(p.symKey);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(Error('The dapp did not send a connection request. Make sure its WalletConnect window is still open, then try again with a fresh link.')), 30000);
      subscribe(p.topic, (message) => {
        const m = decrypt(key, message);
        if (!m || m.method !== 'wc_sessionPropose') return;
        clearTimeout(t);
        res({ ...m.params, id: m.id, pairingTopic: p.topic, pairingKey: p.symKey });
      }).catch((e) => (clearTimeout(t), rej(e)));
    });
  }

  /** Approve a proposal for `account` on `chainId`: key agreement, then settle the session. */
  async function approve(proposal, { chainId, account, metadata, methods, events }) {
    const kp = await keyPair(), key = await sharedKey(kp.privateKey, proposal.proposer.publicKey), topic = await topicOf(key);
    const req = (proposal.requiredNamespaces && proposal.requiredNamespaces.eip155) || {};
    const namespaces = {
      eip155: {
        chains: ['eip155:' + chainId],
        accounts: ['eip155:' + chainId + ':' + account],
        methods: [...new Set([...methods, ...(req.methods || [])])],
        events: [...new Set([...events, ...(req.events || [])])],
      },
    };
    const s = { topic, key: hex(key), peer: proposal.proposer.metadata || {}, account, chainId, expiry: Math.floor(Date.now() / 1000) + 7 * DAY, at: Date.now() };
    await subscribe(topic, sessionHandler(s));
    await publish(proposal.pairingTopic, unhex(proposal.pairingKey), { id: proposal.id, jsonrpc: '2.0', result: { relay: { protocol: 'irn' }, responderPublicKey: hex(kp.pub) } }, TAGS.proposeRes);
    await publish(topic, key, { id: id(), jsonrpc: '2.0', method: 'wc_sessionSettle', params: { relay: { protocol: 'irn' }, namespaces, controller: { publicKey: hex(kp.pub), metadata }, expiry: s.expiry } }, TAGS.settle);
    const st = state();
    st.sessions = [...st.sessions.filter((x) => x.topic !== topic), s];
    save(st);
    subs.delete(proposal.pairingTopic);
    call('irn_unsubscribe', { topic: proposal.pairingTopic, id: '' }).catch(() => {});
    emit({ type: 'sessions' });
    return s;
  }
  async function reject(proposal) {
    await publish(proposal.pairingTopic, unhex(proposal.pairingKey), { id: proposal.id, jsonrpc: '2.0', error: { code: 5000, message: 'User rejected.' } }, TAGS.proposeReject).catch(() => {});
    subs.delete(proposal.pairingTopic);
  }

  /** Answer a request: `result`, or `error` ({ code, message }). */
  async function respond(topic, rid, result, error) {
    const st = state(), s = st.sessions.find((x) => x.topic === topic);
    st.pending = st.pending.filter((p) => !(p.topic === topic && p.id === rid));
    save(st);
    if (!s) return;
    await connect();
    await publish(topic, unhex(s.key), error ? { id: rid, jsonrpc: '2.0', error } : { id: rid, jsonrpc: '2.0', result }, TAGS.requestRes, MIN5 * 3);
  }

  async function disconnect(topic) {
    const s = state().sessions.find((x) => x.topic === topic);
    if (s) await connect().then(() => publish(topic, unhex(s.key), { id: id(), jsonrpc: '2.0', method: 'wc_sessionDelete', params: { code: 6000, message: 'User disconnected.' } }, TAGS.del, DAY)).catch(() => {});
    forget(topic);
  }

  return { pair, approve, reject, respond, disconnect, restore, sessions: () => state().sessions, pending: () => state().pending };
}
