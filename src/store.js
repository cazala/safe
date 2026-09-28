// Per-browser storage: JSON in localStorage under "safe.wei:<key>". Everything kept is a convenience,
// so a failed read (private mode, cleared data, bad JSON) returns the fallback and a failed write is ignored.
const P = 'safe.wei:';
export function load(k, d) {
  try {
    return JSON.parse(localStorage.getItem(P + k)) ?? d;
  } catch {
    return d;
  }
}
export function store(k, v) {
  try {
    localStorage.setItem(P + k, JSON.stringify(v));
  } catch {}
}
