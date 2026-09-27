// Deploy dist/index.html as an ERC-8244 app.
//
//   node scripts/deploy.mjs --rpc <url> --plan                 print addresses + calldata, send nothing
//   node scripts/deploy.mjs --rpc <url> --from <unlocked addr>  send through the node (anvil)
//   PRIVATE_KEY=0x… node scripts/deploy.mjs --rpc <url>         sign locally
//   add --salt 0x<32 bytes> to change the CREATE2 salt
//
// Idempotent: steps whose address already has code are skipped. After deploying,
// html() is compared byte for byte with dist/index.html and the result is written
// to deploy/<chainId>.json. This never touches safe.wei; pointing the name is a
// separate, manual step (docs/deploy.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { compile, deploy, plan, verify } from './deploy-lib.mjs';

const arg = (k) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] ?? true : undefined;
};
const url = arg('rpc');
if (!url) throw Error('--rpc <url> is required');
const root = new URL('..', import.meta.url).pathname;
let id = 0;
const rpc = async (method, params = []) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }).then((r) => r.json());
  if (r.error) throw Error(method + ': ' + r.error.message);
  return r.result;
};

const html = readFileSync(root + 'dist/index.html', 'utf8');
const p = plan(html, compile(), arg('salt'));
const chainId = Number(await rpc('eth_chainId'));
console.log('chain ' + chainId + ' · page ' + p.size + ' B · ' + p.chunks.length + ' chunk(s) · contentHash ' + p.contentHash);
console.log('app  ' + p.app);

if (arg('plan')) {
  for (const s of p.steps) console.log('\n# ' + s.name + ' → ' + s.address + '\nto   0x4e59b44847b379578588920ca78fbf26c0b4956c\ndata ' + p.salt + s.initcode.slice(2));
  process.exit(0);
}

const wait = async (h) => {
  for (;;) {
    const r = await rpc('eth_getTransactionReceipt', [h]);
    if (r) return r;
    await new Promise((f) => setTimeout(f, 2000));
  }
};
let send;
if (arg('from')) {
  send = async (tx) => wait(await rpc('eth_sendTransaction', [{ from: arg('from'), ...tx }]));
} else if (process.env.PRIVATE_KEY) {
  const { createWalletClient, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const w = createWalletClient({ account, transport: http(url), chain: { id: chainId, name: 'target', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [url] } } } });
  // Pin a generous limit instead of trusting estimation padding (EIP-7825 caps a tx at 16,777,216 gas).
  send = async (tx) => wait(await w.sendTransaction({ ...tx, gas: 15_000_000n }));
  console.log('signer ' + account.address);
} else throw Error('Use --plan, --from <unlocked address>, or set PRIVATE_KEY');

const gas = await deploy(p, rpc, send, console.log);
const v = await verify(p, rpc, html);
const record = { chainId, app: p.app, chunks: p.chunks, salt: p.salt, ...v, gasUsed: String(gas), deployedAt: new Date().toISOString() };
// A fork reports the real chainId; keep its records out of deploy/<chainId>.json.
const local = /anvil|hardhat/i.test(await rpc('web3_clientVersion').catch(() => ''));
const out = root + 'deploy/' + (local ? 'local-' : '') + chainId + '.json';
mkdirSync(root + 'deploy', { recursive: true });
writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
console.log('wrote ' + out.slice(root.length));
console.log('verified: html() matches dist/index.html\n' + JSON.stringify(record, null, 2));
