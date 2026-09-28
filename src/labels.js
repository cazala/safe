// Address labels: the viewer's own names for addresses, in this browser only.
// Keyed by lowercase address (the same account on every chain).
import { load, store } from './store.js';

const map = (k) => {
  const m = load(k, {});
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
};
export const all = () => map('labels');
export const get = (a) => (a && all()[a.toLowerCase()]) || null;

// When each label was added, for sorting: { address: ms }. Labels older than this map have none (0).
export const dates = () => map('labelsAt');

/** Set or clear (empty name) a label, then tell every rendered address. Renaming keeps the date; `at` restores one (undo). */
export function set(a, name, at) {
  const m = all(), d = dates(), k = a.toLowerCase();
  name = (name || '').trim().slice(0, 40);
  if (name) (m[k] = name), (d[k] = at || d[k] || Date.now());
  else delete m[k], delete d[k];
  store('labels', m);
  store('labelsAt', d);
  dispatchEvent(new CustomEvent('labels', { detail: k }));
}
