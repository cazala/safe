// Wallet discovery: EIP-6963 announcements, with window.ethereum as a fallback for
// wallets that do not announce. The chosen wallet is remembered per browser; "none"
// means the user disconnected and no wallet is used until they connect again.
const found = new Map(); // key → { key, name, provider }
const KEY = 'safe.wei:wallet';

// WalletConnect (a wallet elsewhere, e.g. on a phone) is always offered, after the browser's wallets.
export const list = () => [...found.values()].sort((a, b) => (a.key === 'walletconnect') - (b.key === 'walletconnect'));
export const add = (w) => found.set(w.key, w);
export const get = (k) => found.get(k);

export const remembered = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const remember = (k) => {
  try {
    localStorage.setItem(KEY, k);
  } catch {}
};

/** Start discovery; `changed()` runs whenever the list changes. */
export function discover(changed) {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const { info, provider } = (e && e.detail) || {};
    if (!info || !provider || typeof provider.request !== 'function') return;
    const key = String(info.rdns || info.uuid);
    if (found.has(key)) return;
    // window.ethereum is almost always one of the announced wallets, often behind a proxy
    // object, so once any wallet announces itself the unnamed fallback is dropped.
    found.delete('injected');
    found.set(key, { key, name: String(info.name || key).slice(0, 40), provider });
    changed();
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const eth = window.ethereum;
  if (eth && ![...found.keys()].some((k) => k !== 'walletconnect')) found.set('injected', { key: 'injected', name: 'Browser wallet', provider: eth });
}
