// Address labels: the viewer's own names for addresses, in this browser only.
// Keyed by lowercase address (the same account on every chain).
const KEY = 'safe.wei:labels';
export function all() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}');
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}
export const get = (a) => (a && all()[a.toLowerCase()]) || null;

// When each label was added, for sorting: { address: ms }. Labels older than this map have none (0).
const AT = 'safe.wei:labelsAt';
export function dates() {
  try {
    const m = JSON.parse(localStorage.getItem(AT) || '{}');
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}

/** Set or clear (empty name) a label, then tell every rendered address. Renaming keeps the date; `at` restores one (undo). */
export function set(a, name, at) {
  const m = all(), d = dates(), k = a.toLowerCase();
  name = (name || '').trim().slice(0, 40);
  if (name) (m[k] = name), (d[k] = at || d[k] || Date.now());
  else delete m[k], delete d[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
    localStorage.setItem(AT, JSON.stringify(d));
  } catch {}
  dispatchEvent(new CustomEvent('labels', { detail: k }));
}
