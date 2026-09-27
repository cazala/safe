// safe.wei name helper. Read-only: it never sends a transaction.
//
//   node scripts/name.mjs --rpc <url> [--name safe] [--app 0x…]
//
// Prints the WNS owner and current resolution of <name>.wei, and, with --app,
// the exact setAddr transaction the owner must send to point the name at the app,
// plus a check that the app's html() matches dist/index.html.
import { readFileSync } from 'node:fs';
import { a, cd, keccakHex, keccakText, str, strip } from '../src/abi.js';
import { CHAINS } from '../src/chains.js';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const url = arg('rpc'), name = arg('name', 'safe'), app = arg('app');
if (!url) throw Error('--rpc <url> is required');
const WNS = CHAINS[1].wns, WEI_NODE = '0xa82820059d5df798546bcc2985157a77c3eef25eba9ba01899927333efacbd6f';
const call = async (to, data) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) }).then((r) => r.json());
  if (r.error) throw Error(r.error.message);
  return r.result;
};

const sel = (sig) => keccakText(sig).slice(2, 10);
const id = keccakHex(WEI_NODE + strip(keccakText(name)));
const owner = a(await call(WNS, cd(sel('ownerOf(uint256)'), id)));
const resolved = a(await call(WNS, cd(sel('resolve(uint256)'), id)));
console.log(name + '.wei  tokenId ' + id + '\nowner    ' + owner + '\nresolves ' + resolved);

if (app) {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const live = str(await call(app, '0x' + sel('html()')));
  console.log('app html() ' + (live === html ? 'matches' : 'DOES NOT MATCH') + ' dist/index.html');
  if (resolved.toLowerCase() === app.toLowerCase()) console.log('\n' + name + '.wei already points at the app.');
  else
    console.log(
      '\nTo point ' + name + '.wei at the app, send from ' + owner + ':\n  to   ' + WNS + '\n  data ' + cd(sel('setAddr(uint256,address)'), id, app) + '   # setAddr(uint256,address)\n' +
        '  or: cast send ' + WNS + ' "setAddr(uint256,address)" ' + BigInt(id) + ' ' + app,
    );
}
