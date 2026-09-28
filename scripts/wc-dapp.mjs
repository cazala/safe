// Dev tool: a dapp played by the official WalletConnect SDK, to test safe.wei's Dapps tab end to end
// over the real relay. Prints a wc: link to paste into safe.wei, then (once connected) asks the Safe
// to sign a message and to send a transaction, and prints the answers.
//   node scripts/wc-dapp.mjs [--chain 1] [--to 0x…] [--value-wei 1000000000000000]
import { readFileSync, writeFileSync } from 'node:fs';
import { SignClient } from '@walletconnect/sign-client';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const chain = 'eip155:' + arg('--chain', '1');
const projectId = JSON.parse(readFileSync(new URL('../config/walletconnect.json', import.meta.url), 'utf8')).projectId;
const dapp = await SignClient.init({ projectId, metadata: { name: 'Local test dapp', description: 'safe.wei WalletConnect test', url: 'https://example.invalid', icons: [] } });
const { uri, approval } = await dapp.connect({
  optionalNamespaces: { eip155: { chains: [chain], methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'eth_chainId', 'eth_accounts'], events: ['chainChanged', 'accountsChanged'] } },
});
console.log('\nPaste this into safe.wei → Dapps:\n\n' + uri + '\n');
if (process.env.URI_FILE) writeFileSync(process.env.URI_FILE, uri);
const session = await approval();
const safe = session.namespaces.eip155.accounts[0].split(':')[2];
console.log('connected to', safe, 'topic', session.topic);
dapp.on('session_delete', () => (console.log('disconnected by the wallet'), process.exit(0)));
const ask = async (method, params) => {
  try {
    console.log(method, '→', await dapp.request({ topic: session.topic, chainId: chain, request: { method, params }, expiry: 3600 }));
  } catch (e) {
    console.log(method, '→ error:', e.message);
  }
};
await ask('eth_chainId', []);
await ask('personal_sign', ['0x' + Buffer.from('Hello from the local test dapp').toString('hex'), safe]);
await ask('eth_sendTransaction', [{ from: safe, to: arg('--to', '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'), value: '0x' + BigInt(arg('--value-wei', '1000000000000000')).toString(16), data: '0x' }]);
console.log('done; waiting for a disconnect (Ctrl-C to quit)');
