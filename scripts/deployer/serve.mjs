// LAN deployer: a one-button page that deploys the current build of safe.wei from a
// browser wallet on another computer.
//
//   node scripts/deployer/serve.mjs                    serve on 0.0.0.0:8080
//   node scripts/deployer/serve.mjs --anvil <url>      inject the local test wallet (rehearsal)
//
// On start it rebuilds dist/index.html, compiles SafeWeiApp and embeds the exact CREATE2
// plan (addresses + calldata) in the page, so the other computer needs only a browser
// wallet. The page never points safe.wei; it prints that transaction for the name owner.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { build } from 'esbuild';
import { compile, DEPLOYER, plan } from '../deploy-lib.mjs';
import { shim } from '../shim.mjs';

const root = new URL('../..', import.meta.url).pathname;
const i = process.argv.indexOf('--anvil');
const anvil = i > 0 ? process.argv[i + 1] : null;
const port = Number(process.env.PORT || 8080);

execFileSync(process.execPath, [root + 'scripts/build.mjs'], { stdio: 'inherit' });
const html = readFileSync(root + 'dist/index.html', 'utf8');
const p = plan(html, compile());
// Rough cost: 32k create + 200/byte code deposit + ~16/byte calldata + 21k base, per step.
const gas = p.steps.reduce((g, s) => g + 53000 + ((s.initcode.length - 2) / 2) * 216, 0);
const js = (await build({ entryPoints: [root + 'scripts/deployer/client.js'], bundle: true, minify: true, format: 'iife', write: false })).outputFiles[0].text;
const PLAN = { deployer: DEPLOYER, salt: p.salt, app: p.app, chunks: p.chunks, contentHash: p.contentHash, size: p.size, gas, steps: p.steps };
const css = readFileSync(root + 'src/style.css', 'utf8');

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deploy safe.wei</title><style>${css}</style></head><body>
<header><b>Deploy safe.wei</b><span></span></header>
<main>
<section><h2>Build</h2><table class="kv">
<tr><th>App contract</th><td><code>${p.app}</code></td></tr>
<tr><th>Page</th><td>${p.size.toLocaleString()} bytes · ${p.chunks.length} data chunk(s)</td></tr>
<tr><th>contentHash</th><td><code>${p.contentHash}</code></td></tr>
<tr><th>CREATE2 deployer</th><td><code>${DEPLOYER}</code> · salt <code>${p.salt}</code></td></tr>
<tr><th>Cost</th><td id="cost">≈ ${gas.toLocaleString()} gas</td></tr>
</table>
<p class="mut">Addresses depend only on the build and the salt, not on who deploys. Steps that already exist are skipped, so it is safe to run again.</p></section>
<section><h2>Wallet</h2><p id="wallet" class="mut">Not connected.</p><div class="actions"><button id="connect">Connect wallet</button></div></section>
<section><h2>Steps</h2><table class="kv"><tbody id="steps"></tbody></table>
<div class="actions"><button id="deploy" class="primary" disabled>Deploy</button></div><div id="log" class="mono"></div></section>
<section id="result"></section>
</main>
<script>window.PLAN=${JSON.stringify(PLAN)}</script><script>${js}</script></body></html>`;

createServer((req, res) => {
  if (req.url.split('?')[0] !== '/') return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(anvil ? page.replace('<head>', '<head>' + shim(anvil)) : page);
}).listen(port, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log('\nsafe.wei deployer · app ' + p.app + ' · ' + p.size + ' B');
  for (const ip of ['localhost', ...ips]) console.log('  http://' + ip + ':' + port + '/');
  if (anvil) console.log('  (test wallet → ' + anvil + ')');
});
