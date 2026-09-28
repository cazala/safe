// Thin EIP-1193 wrapper. The provider is the user's wallet; nothing else is contacted.
let P;
export const use = (p) => (P = p);
export const rpc = (method, params = []) => {
  if (!P) throw Error('No wallet found. Install or enable an EIP-1193 wallet.');
  return P.request({ method, params });
};
export const call = (to, data, from) => rpc('eth_call', [from ? { from, to, data } : { to, data }, 'latest']);
export const chainId = async () => Number(await rpc('eth_chainId'));
export const accounts = () => rpc('eth_accounts');
export const connect = () => rpc('eth_requestAccounts');
export const send = (from, to, data, value = 0n) =>
  rpc('eth_sendTransaction', [{ from, to, data, value: '0x' + value.toString(16) }]);

/** Wait for a receipt; throws if the transaction reverted. */
export async function wait(hash, ms = 1500) {
  for (;;) {
    const r = await rpc('eth_getTransactionReceipt', [hash]);
    if (r) {
      if (r.status !== '0x1') throw Error('Transaction reverted: ' + hash);
      return r;
    }
    await new Promise((f) => setTimeout(f, ms));
  }
}
