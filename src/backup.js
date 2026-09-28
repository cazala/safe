// Backup & sync: everything this browser keeps for safe.wei (Safes and their layout,
// labels, ABIs, added tokens), as JSON or a link to open on another device.
import { utf8 } from './abi.js';

const P = 'safe.wei:';
const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(P + k)) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(P + k, JSON.stringify(v));
  } catch {}
};
const tokenChains = () => {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(P + 'tokens:')) out.push(k.slice((P + 'tokens:').length));
    }
  } catch {}
  return out;
};

export function collect() {
  const tokens = {};
  for (const c of tokenChains()) tokens[c] = read('tokens:' + c, []);
  return { app: 'safe.wei', v: 1, at: new Date().toISOString(), safes: read('safes', []), tree: read('tree', []), labels: read('labels', {}), labelsAt: read('labelsAt', {}), abis: read('abis', {}), tokens };
}

export const counts = (d) => ({
  safes: (d.safes || []).length,
  labels: Object.keys(d.labels || {}).length,
  abis: Object.keys(d.abis || {}).length,
  tokens: Object.values(d.tokens || {}).reduce((n, l) => n + l.length, 0),
});

// ---- links: #import=<z|j><base64url>, deflated when the browser can ----
const b64 = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipe = async (data, T) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new T('deflate-raw'))).arrayBuffer());

export async function link(d) {
  const raw = utf8(JSON.stringify(d));
  const z = typeof CompressionStream === 'function' ? await pipe(raw, CompressionStream).catch(() => null) : null;
  return location.href.split('#')[0] + '#import=' + (z ? 'z' + b64(z) : 'j' + b64(raw));
}

/** Parse pasted text: an import link, the fragment alone, or backup JSON. Throws on anything else. */
export async function parse(text) {
  text = text.trim();
  let d;
  const m = /(?:^|[#&])import=([zj])([A-Za-z0-9_-]+)/.exec(text);
  if (m) {
    const b = unb64(m[2]);
    const raw = m[1] === 'z' ? await pipe(b, DecompressionStream) : b;
    d = JSON.parse(new TextDecoder().decode(raw));
  } else d = JSON.parse(text);
  if (!d || d.app !== 'safe.wei' || !Array.isArray(d.safes)) throw Error('This is not a safe.wei backup.');
  // Keep only well-formed entries: this may come from someone else's link.
  const addr = (a) => typeof a === 'string' && /^0x[0-9a-f]{40}$/.test(a);
  d.safes = d.safes.filter((e) => e && addr(e.address) && Number.isInteger(e.chainId)).map((e) => ({ chainId: e.chainId, address: e.address, ref: typeof e.ref === 'string' ? e.ref.slice(0, 80) : null, label: typeof e.label === 'string' ? e.label.slice(0, 40) : '', pinned: !!e.pinned, at: Number(e.at) || Date.now() }));
  d.labels = Object.fromEntries(Object.entries(d.labels || {}).filter(([a, l]) => addr(a) && typeof l === 'string' && l.trim()).map(([a, l]) => [a, l.trim().slice(0, 40)]));
  d.labelsAt = Object.fromEntries(Object.entries(d.labelsAt || {}).filter(([a, t]) => d.labels[a] && Number.isFinite(t)));
  d.abis = Object.fromEntries(Object.entries(d.abis || {}).filter(([k, v]) => /^\d+:0x[0-9a-f]{40}$/.test(k) && typeof v === 'string'));
  d.tokens = Object.fromEntries(Object.entries(d.tokens || {}).filter(([c, l]) => /^\d+$/.test(c) && Array.isArray(l)).map(([c, l]) => [c, l.filter((t) => t && addr(t.address) && Number.isInteger(t.decimals))]));
  d.tree = Array.isArray(d.tree) ? d.tree : [];
  return d;
}

/**
 * Apply a backup. 'merge' adds what is missing and never overwrites anything already here
 * (so an imported label cannot rename an address you already labeled); 'replace' swaps it all.
 */
export function apply(d, mode) {
  if (mode === 'replace') {
    for (const c of tokenChains()) write('tokens:' + c, []);
    write('safes', d.safes);
    write('tree', d.tree);
    write('labels', d.labels);
    write('labelsAt', d.labelsAt);
    write('abis', d.abis);
    for (const [c, l] of Object.entries(d.tokens)) write('tokens:' + c, l);
    return;
  }
  const safes = read('safes', []), key = (e) => e.chainId + ':' + e.address, have = new Set(safes.map(key));
  write('safes', [...safes, ...d.safes.filter((e) => !have.has(key(e)))]);
  // Imported folders go after the current layout; Safes already placed here keep their place.
  write('tree', [...read('tree', []), ...d.tree]);
  const mine = read('labels', {});
  write('labels', { ...d.labels, ...mine });
  // Dates follow the label that is kept: imported ones only for labels that were new here.
  write('labelsAt', { ...Object.fromEntries(Object.entries(d.labelsAt).filter(([a]) => !mine[a])), ...read('labelsAt', {}) });
  write('abis', { ...d.abis, ...read('abis', {}) });
  for (const [c, l] of Object.entries(d.tokens)) {
    const cur = read('tokens:' + c, []), seen = new Set(cur.map((t) => t.address));
    write('tokens:' + c, [...cur, ...l.filter((t) => !seen.has(t.address))]);
  }
}

