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
/** Set or clear (empty name) a label, then tell every rendered address. */
export function set(a, name) {
  const m = all(), k = a.toLowerCase();
  name = (name || '').trim().slice(0, 40);
  if (name) m[k] = name;
  else delete m[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {}
  dispatchEvent(new CustomEvent('labels', { detail: k }));
}
