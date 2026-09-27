// Minimal Safe App used for docs/safe-apps.md. Bundle with esbuild together with
// @safe-global/safe-apps-sdk, serve it on another localhost origin, and open it from
// safe.wei (Safe Apps → http://localhost:<port>/?auto=1 to send a batch automatically).
import SafeAppsSDK from '@safe-global/safe-apps-sdk';
const sdk = new SafeAppsSDK({ debug: false });
const out = document.getElementById('out');
const log = (k, v) => { const l = k + ': ' + JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? String(x) : x)); out.textContent += l + '\n'; fetch('/log', { method: 'POST', body: l }); };
(async () => {
  try {
    log('safe', await sdk.safe.getInfo());
    log('chain', await sdk.safe.getChainInfo());
    log('env', await sdk.safe.getEnvironmentInfo());
    log('balance(rpc)', await sdk.eth.getBalance([(await sdk.safe.getInfo()).safeAddress]));
    log('balances', (await sdk.safe.experimental_getBalances()).items.map((i) => i.tokenInfo.symbol + '=' + i.balance));
    try { await sdk.eth.setSafeSettings([{ offChainSigning: false }]); log('settings', 'ok'); } catch (e) { log('settings', e.message); }
    try { await sdk.txs.signMessage('hi'); } catch (e) { log('signMessage', e.message); }
  } catch (e) { log('error', e.message); }
})();
document.getElementById('send').onclick = async () => {
  try {
    const r = await sdk.txs.send({ txs: [
      { to: '0x00000000000000000000000000000000000000a1', value: '1000', data: '0x' },
      { to: '0x00000000000000000000000000000000000000a2', value: '2000', data: '0x' },
    ] });
    log('sent', r);
    for (let i = 0; i < 20; i++) {
      const s = await sdk.txs.getBySafeTxHash(r.safeTxHash);
      log('status', s.txStatus + ' ' + (s.txHash || ''));
      if (s.txStatus === 'SUCCESS') break;
      await new Promise((f) => setTimeout(f, 1500));
    }
  } catch (e) { log('send error', e.message); }
};
if (location.search.includes('auto')) setTimeout(() => document.getElementById('send').click(), 1500);
