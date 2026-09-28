// Safes opened in this browser: a per-viewer convenience in localStorage, never required.
// Entry: { chainId, address, ref (name it was opened by, if any), label (nickname), pinned, at (ms) }.
const KEY = 'safe.wei:safes';
const same = (e, chainId, address) => e.chainId === chainId && e.address === address;

export function safes() {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(l) ? l.filter((e) => e && typeof e.address === 'string') : [];
  } catch {
    return [];
  }
}
const write = (l) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {}
};

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
