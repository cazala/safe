// Safes opened in this browser: a per-viewer convenience in localStorage, never required.
// Entry: { chainId, address, ref (name it was opened by, if any), label (nickname), pinned, at (ms) }.
import { load, store } from './store.js';

const same = (e, chainId, address) => e.chainId === chainId && e.address === address;

export function safes() {
  const l = load('safes', []);
  return Array.isArray(l) ? l.filter((e) => e && typeof e.address === 'string') : [];
}
const write = (l) => store('safes', l);

/** Pinned first, then most recently opened. */
export const sorted = () => safes().sort((a, b) => (b.pinned | 0) - (a.pinned | 0) || b.at - a.at);

export const find = (chainId, address) => safes().find((e) => same(e, chainId, address));

/** Record that a Safe was opened (keeps its nickname and pin). */
export function touch(chainId, address, ref) {
  const l = safes(), e = l.find((x) => same(x, chainId, address));
  if (e) Object.assign(e, { at: Date.now() }, ref ? { ref } : {});
  else l.push({ chainId, address, ref: ref || null, label: '', pinned: false, at: Date.now() });
  write(l);
}

export function update(chainId, address, fields) {
  const l = safes(), e = l.find((x) => same(x, chainId, address));
  if (e) Object.assign(e, fields), write(l);
}

/** Remove and return the entry, so it can be restored with `restore`. */
export function remove(chainId, address) {
  const l = safes(), e = l.find((x) => same(x, chainId, address));
  write(l.filter((x) => x !== e));
  return e;
}
export const restore = (e) => e && !find(e.chainId, e.address) && write([...safes(), e]);

/** "today", "yesterday", "3 days ago", "Mar 4". */
export function ago(ms) {
  const d = Math.floor((Date.now() - ms) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 7 ? d + ' days ago' : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---- layout: order and folders (iOS-style), kept in sync with the saved Safes ----
// Node: { t: 's', k: '<chainId>:<address>' } | { t: 'f', id, name, items: [node] }. Folders nest.
export const keyOf = (e) => e.chainId + ':' + e.address;
const readTree = () => {
  const t = load('tree', []);
  return Array.isArray(t) ? t : [];
};
export const saveTree = (t) => store('tree', t);

/** The layout, reconciled: saved Safes missing from it go on top (newest first); removed ones and empty folders disappear. */
export function tree() {
  const byKey = new Map(safes().map((e) => [keyOf(e), e])), seen = new Set();
  const clean = (items) =>
    items
      .map((n) => (n && n.t === 'f' ? { ...n, items: clean(n.items || []) } : n))
      .filter((n) => n && (n.t === 'f' ? n.items.length : byKey.has(n.k) && !seen.has(n.k) && seen.add(n.k)));
  const t = clean(readTree());
  const fresh = [...byKey.values()].filter((e) => !seen.has(keyOf(e))).sort((a, b) => b.at - a.at);
  const out = [...fresh.map((e) => ({ t: 's', k: keyOf(e) })), ...t];
  saveTree(out);
  return out;
}

/** Safes inside a folder, at any depth. */
export const count = (n) => (n.t === 's' ? 1 : n.items.reduce((c, x) => c + count(x), 0));
export const folderName = (f) => f.name || count(f) + (count(f) === 1 ? ' safe' : ' safes');
