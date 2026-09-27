// Builds dist/index.html: one self-contained file with inline, minified CSS and JS.
// Fails if the output could load anything remote. Prints the size report.
import { build, transform } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const src = (f) => readFileSync(root + 'src/' + f, 'utf8');

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
  })
).outputFiles[0].text.trim();

const css = (await transform(src('style.css'), { loader: 'css', minify: true })).code.trim();

// Collapse whitespace between tags in the HTML shell (it holds no <pre>/<textarea> content).
const shell = src('index.html')
  .replace(/<!--[\s\S]*?-->/g, (m) => (m === '<!--CSS-->' || m === '<!--JS-->' ? m : ''))
  .replace(/>\s+</g, '><')
  .trim();

if (/<\/script/i.test(js)) throw Error('JS contains </script');
const html = shell.replace('<!--CSS-->', () => '<style>' + css + '</style>').replace('<!--JS-->', () => '<script>' + js + '</script>');

// ---- no remote code / assets ----
const SVG_NS = 'http://www.w3.org/2000/svg';
const scan = html.split(SVG_NS).join('');
const banned = [/<script[^>]+src=/i, /<link[^>]+rel=["']?stylesheet/i, /http:\/\//i, /https:\/\//i, /@import/i];
for (const re of banned) if (re.test(scan)) throw Error('Build check failed: output matches ' + re);

mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/index.html', html);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const size = Buffer.byteLength(html);
console.log(
  [
    'dist/index.html',
    '  raw   ' + size + ' B (' + kb(size) + ')',
    '  gzip  ' + gzipSync(html, { level: 9 }).length + ' B',
    '  js    ' + Buffer.byteLength(js) + ' B',
    '  css   ' + Buffer.byteLength(css) + ' B',
  ].join('\n'),
);
if (size > 200 * 1024) throw Error('Output exceeds 200 KB budget; investigate before adding features');
