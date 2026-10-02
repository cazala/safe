// The web copy (Cloudflare Pages) only: adds link-preview tags and their image to site/, which CI deploys.
// The onchain page stays exactly dist/index.html: a preview image needs an absolute https URL, which it cannot carry.
//   node scripts/pages.mjs   (after npm run build)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ORIGIN = 'https://safe.caza.la';
const TITLE = 'safe.wei';
const DESCRIPTION = 'A minimal interface for Safe multisig accounts that lives on Ethereum: no backend, reads the chain through your wallet, agent-ready links.';
const root = new URL('../', import.meta.url).pathname;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const tags = [
  ['name', 'description', DESCRIPTION],
  ['property', 'og:title', TITLE],
  ['property', 'og:description', DESCRIPTION],
  ['property', 'og:url', ORIGIN + '/'],
  ['property', 'og:image', ORIGIN + '/og.jpg'],
  ['property', 'og:image:width', '1200'],
  ['property', 'og:image:height', '630'],
  ['name', 'twitter:card', 'summary_large_image'],
].map(([k, n, v]) => `<meta ${k}="${n}" content="${esc(v)}">`).join('\n');

const html = readFileSync(root + 'dist/index.html', 'utf8');
if (!html.includes('</title>')) throw Error('dist/index.html has no <title>');
mkdirSync(root + 'site', { recursive: true });
writeFileSync(root + 'site/index.html', html.replace('</title>', '</title>\n' + tags));
copyFileSync(root + 'pages/og.jpg', root + 'site/og.jpg');
console.log('site/: index.html with link-preview tags, og.jpg');
