// Dev server for dist/index.html (run `npm run build` first).
//   node scripts/dev.mjs                 serve on :5173
//   node scripts/dev.mjs --anvil URL     also inject a test wallet backed by an Anvil node,
//                                        using its unlocked accounts (?acct=N picks one).
//   ... --onchain 0xAPP                  serve html() read from that deployed app via the node,
//                                        instead of dist/index.html
// The injected wallet exists ONLY in this dev server, never in the build.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { str } from '../src/abi.js';
import { shim } from './shim.mjs';

const root = new URL('..', import.meta.url).pathname;
const i = process.argv.indexOf('--anvil');
const anvil = i > 0 ? process.argv[i + 1] : null;
const port = Number(process.env.PORT || (process.argv.includes("--onchain") ? 5174 : 5173));
const j = process.argv.indexOf('--onchain');
const app = j > 0 ? process.argv[j + 1] : null;
const page = async () => {
  if (!app) return readFileSync(root + 'dist/index.html', 'utf8');
  const r = await fetch(anvil, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: app, data: '0x33c34ac3' }, 'latest'] }) }).then((r) => r.json());
  return str(r.result); // html()
};

createServer(async (req, res) => {
  if (req.url === '/favicon.ico') return res.writeHead(404).end();
  let html = await page();
  if (anvil) html = html.replace('<head>', '<head>' + shim(anvil));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
}).listen(port, () => console.log('http://localhost:' + port + (anvil ? '  (test wallet → ' + anvil + ')' : '') + (app ? '  serving html() of ' + app : '')));
