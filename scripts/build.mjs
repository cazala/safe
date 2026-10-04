// Builds dist/index.html: one self-contained file with inline, minified CSS and JS.
// Fails if the output could load anything remote. Prints the size report.
import { build, transform } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const src = (f) => readFileSync(root + 'src/' + f, 'utf8');

// Build ID: the git tree hash of src/ (it changes only when the code does, so the same code always
// builds to the same bytes, hence the same onchain addresses), "+" when src/ has uncommitted changes.
const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: root }).toString().trim();
  } catch {
    return '';
  }
};
const BUILD = (git('rev-parse', '--short=7', 'HEAD:src') || 'unknown') + (git('status', '--porcelain', '--', 'src') ? '+' : '');

// Config that may need replacing after deployment (the WalletConnect project ID, links to roles.wei and the source) lives outside src/
// and goes into its own tiny first chunk, cut at the <!--config--> marker (scripts/deploy-lib.mjs).
// Replacing it redeploys only that chunk and the app contract; every other chunk stays byte for byte.
const config = JSON.parse(readFileSync(root + 'config/walletconnect.json', 'utf8'));
if (!/^[0-9a-f]{32}$/.test(config.projectId)) throw Error('config/walletconnect.json: projectId must be 32 hex characters');
const OPEN = '<!doctype html><html lang="en"><head><meta charset="utf-8">';
// Links to other places (roles.wei's gateways, the source code), also in the config chunk: config/links.json.
const links = JSON.parse(readFileSync(root + 'config/links.json', 'utf8'));
const url = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/[\w./-]*$/.test(u);
if (!Array.isArray(links.roles) || !links.roles.length || !links.roles.every((u) => url(u) && u.endsWith('/')) || !url(links.source + '/'))
  throw Error('config/links.json: roles must be https:// gateway URLs ending in /, source an https:// URL');
const LINKS = JSON.stringify({ roles: links.roles, source: links.source });
// Block explorers (config/explorers.json, also in the config chunk): the providers, the chains each one covers, and
// the default order. Any Etherscan-compatible API; replacing this file changes them without touching the code.
const explorers = JSON.parse(readFileSync(root + 'config/explorers.json', 'utf8'));
const api = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(\/[\w./{}-]*)?(\?[\w=&{}.-]*)?$/.test(u) && !/\{(?!chain\})/.test(u);
const explorerUrls = [];
for (const [id, p] of Object.entries(explorers.providers || {})) {
  const bad = (why) => { throw Error('config/explorers.json: ' + id + ' ' + why); };
  if (!/^[a-z0-9-]+$/.test(id) || ['default', 'none', 'custom'].includes(id)) bad('is not a valid id');
  if (typeof p.name !== 'string' || !p.name.trim()) bad('needs a name');
  if (!['required', 'optional', 'none'].includes(p.key)) bad('key must be required, optional or none');
  if (p.keyUrl !== undefined && !url(p.keyUrl)) bad('keyUrl must be an https:// URL');
  if (p.note !== undefined && (typeof p.note !== 'string' || /[<>]|https?:/i.test(p.note))) bad('note must be plain text');
  if (p.api !== undefined && (!api(p.api) || !p.api.includes('{chain}') || !Array.isArray(p.chains) || !p.chains.every((c) => Number.isSafeInteger(c) && c > 0))) bad('api must be an https:// URL with {chain}, with a list of chain ids');
  if (p.urls !== undefined && !Object.entries(p.urls).every(([c, u]) => /^[1-9]\d*$/.test(c) && api(u) && !u.includes('{'))) bad('urls must map chain ids to https:// URLs');
  if (!p.api && !p.urls) bad('needs api or urls');
  explorerUrls.push(...[p.api, p.keyUrl, ...Object.values(p.urls || {})].filter(Boolean));
}
if (!Array.isArray(explorers.default) || !explorers.default.every((id) => explorers.providers[id])) throw Error('config/explorers.json: default must list provider ids');
const EXPLORERS = JSON.stringify({ default: explorers.default, providers: explorers.providers });
const head = OPEN + '<script>var WC_PROJECT="' + config.projectId + '",LINKS=' + LINKS + ',EXPLORERS=' + EXPLORERS + '</script><!--config-->';

const js = (
  await build({
    entryPoints: [root + 'src/app.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    legalComments: 'none',
    charset: 'utf8',
    define: { __BUILD__: JSON.stringify(BUILD) },
  })
).outputFiles[0].text.trim();

const css = (await transform(src('style.css'), { loader: 'css', minify: true })).code.trim();

// Collapse whitespace between tags in the HTML shell (it holds no <pre>/<textarea> content).
const shell = src('index.html')
  .replace(/<!--[\s\S]*?-->/g, (m) => (m === '<!--CSS-->' || m === '<!--JS-->' ? m : ''))
  .replace(/>\s+</g, '><')
  .trim();

if (/<\/script/i.test(js)) throw Error('JS contains </script');
if (!shell.startsWith(OPEN)) throw Error('src/index.html must start with ' + OPEN);
const html = head + shell.slice(OPEN.length).replace('<!--CSS-->', () => '<style>' + css + '</style>').replace('<!--JS-->', () => '<script>' + js + '</script>');

// ---- no remote code / assets ----
const SVG_NS = 'http://www.w3.org/2000/svg';
// Reads for a WalletConnect wallet (which cannot serve them) go to WalletConnect's RPC: data, never code.
const WC_RPC = 'https://rpc.walletconnect.org/v1/?chainId=eip155:';
// The links in config/links.json are pages users open, in the config chunk: data, never code.
// The block explorers in config/explorers.json serve history and ABIs: data, never code. The Custom placeholder too.
const EXPLORER_EXAMPLE = 'https://explorer.example/api?chainid={chain}';
const scan = [...links.roles, links.source, ...explorerUrls, EXPLORER_EXAMPLE].reduce((t, u) => t.split(u).join(''), html.split(SVG_NS).join('').split(WC_RPC).join(''));
const banned = [/<script[^>]+src=/i, /<link[^>]+rel=["']?stylesheet/i, /http:\/\//i, /https:\/\//i, /@import/i];
for (const re of banned) if (re.test(scan)) throw Error('Build check failed: output matches ' + re);

mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/index.html', html);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const size = Buffer.byteLength(html);
console.log(
  [
    'dist/index.html (build ' + BUILD + ')',
    '  raw   ' + size + ' B (' + kb(size) + ')',
    '  gzip  ' + gzipSync(html, { level: 9 }).length + ' B',
    '  js    ' + Buffer.byteLength(js) + ' B',
    '  css   ' + Buffer.byteLength(css) + ' B',
  ].join('\n'),
);
if (size > 300 * 1024) throw Error('Output exceeds 300 KB budget; investigate before adding features');
