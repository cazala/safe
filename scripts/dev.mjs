// Dev server for dist/index.html (run `npm run build` first).
//   node scripts/dev.mjs                 serve on :5173
//   node scripts/dev.mjs --anvil URL     also inject a test wallet backed by an Anvil node,
//                                        using its unlocked accounts (?acct=N picks one).
//   ... --port N                         listen on N
//   ... --onchain 0xAPP                  serve html() read from that deployed app via the node,
//                                        instead of dist/index.html
// The injected wallet exists ONLY in this dev server, never in the build.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { str } from '../src/abi.js';
import { shim } from './shim.mjs';

const root = new URL('..', import.meta.url).pathname;
const i = process.argv.indexOf('--anvil');
const anvil = i > 0 ? process.argv[i + 1] : null;
const k = process.argv.indexOf('--port');
const port = Number(k > 0 ? process.argv[k + 1] : process.env.PORT || (process.argv.includes('--onchain') ? 5174 : 5173));
const j = process.argv.indexOf('--onchain');
const app = j > 0 ? process.argv[j + 1] : null;
const page = async () => {
  if (!app) return readFileSync(root + 'dist/index.html', 'utf8');
  const r = await fetch(anvil, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: app, data: '0x33c34ac3' }, 'latest'] }) }).then((r) => r.json());
  return str(r.result); // html()
};

createServer(async (req, res) => {
  if (req.url === '/favicon.ico') return res.writeHead(404).end();
  // The test wallet talks to Anvil through this server, so it also works from other devices on the LAN.
  if (anvil && req.method === 'POST' && req.url === '/rpc') {
    const body = await new Response(req).text();
    const r = await fetch(anvil, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then((r) => r.text(), (e) => JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: String(e.message) } }));
    return res.writeHead(200, { 'content-type': 'application/json' }).end(r);
  }
  let html = await page();
  if (anvil) html = html.replace('<head>', '<head>' + shim('/rpc'));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
}).listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces()).flat().filter((x) => x.family === 'IPv4' && !x.internal).map((x) => x.address);
  for (const ip of ['localhost', ...lan]) console.log('http://' + ip + ':' + port + (anvil ? '  (test wallet → ' + anvil + ')' : '') + (app ? '  serving html() of ' + app : ''));
});
