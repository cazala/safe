// Deployer page: sends the planned CREATE2 deployments from the browser wallet,
// then verifies html() against the planned contentHash. Nothing else.
import { bytes, cd, dbytes, keccakHex, keccakText, strip } from '../../src/abi.js';
import { h, put } from '../../src/ui.js';

const P = window.PLAN;
const eth = window.ethereum;
const $ = (id) => document.getElementById(id);
const rpc = (method, params = []) => eth.request({ method, params });
const CAP = 16_000_000n; // just under EIP-7825's 16,777,216 per-transaction cap
const log = (...m) => $('log').append(h('div', ...m));
let from = null, chain = null;

const status = async () =>
  Promise.all(P.steps.map(async (s) => (await rpc('eth_getCode', [s.address, 'latest'])) !== '0x'));

async function render() {
  const done = eth && chain ? await status() : P.steps.map(() => null);
  put(
    $('steps'),
    P.steps.map((s, i) =>
      h('tr', h('td', s.name), h('td', h('code', s.address)), h('td', (s.initcode.length - 2) / 2 + ' B'), h('td', done[i] == null ? '?' : done[i] ? h('b.ok', 'deployed') : 'pending')),
    ),
  );
  const todo = done.filter((d) => d === false).length;
  $('deploy').disabled = !from || !todo;
  $('deploy').textContent = todo ? 'Deploy (' + todo + ' transaction' + (todo > 1 ? 's' : '') + ')' : 'Deploy';
  if (done.every(Boolean)) await verify();
}

async function connect() {
  if (!eth) return put($('wallet'), h('b.bad', 'No browser wallet found.'));
  [from] = await rpc('eth_requestAccounts');
  chain = Number(await rpc('eth_chainId'));
  const code = await rpc('eth_getCode', [P.deployer, 'latest']);
  put(
    $('wallet'),
    h('code', from),
    ' on chain ',
    h('b', String(chain)),
    chain === 1 ? ' (Ethereum mainnet)' : h('b.bad', ' (not mainnet: fine for a rehearsal, addresses are the same on every chain)'),
    code === '0x' && h('p.bad', 'The CREATE2 deployer does not exist on this chain.'),
  );
  const gp = BigInt(await rpc('eth_gasPrice'));
  put($('cost'), '≈ ' + P.gas.toLocaleString() + ' gas × ' + (Number(gp) / 1e9).toFixed(3) + ' gwei ≈ ' + (Number(BigInt(P.gas) * gp) / 1e18).toFixed(5) + ' ETH (estimate)');
  await render();
}

async function wait(hash) {
  for (;;) {
    const r = await rpc('eth_getTransactionReceipt', [hash]);
    if (r) return r;
    await new Promise((f) => setTimeout(f, 3000));
  }
}

async function deploy() {
  $('deploy').disabled = true;
  try {
    for (const s of P.steps) {
      if ((await rpc('eth_getCode', [s.address, 'latest'])) !== '0x') continue;
      const tx = { from, to: P.deployer, data: P.salt + strip(s.initcode) };
      const est = BigInt(await rpc('eth_estimateGas', [tx]));
      const gas = (est * 12n) / 10n < CAP ? (est * 12n) / 10n : CAP;
      log('Sending ' + s.name + ' (' + est + ' gas estimated)… confirm it in your wallet.');
      const hash = await rpc('eth_sendTransaction', [{ ...tx, gas: '0x' + gas.toString(16) }]);
      log('  tx ', h('code', hash), ' waiting for confirmation…');
      const r = await wait(hash);
      if (r.status !== '0x1') throw Error(s.name + ' reverted in ' + hash);
      if ((await rpc('eth_getCode', [s.address, 'latest'])) === '0x') throw Error(s.name + ' is not at ' + s.address);
      log('  ✓ ', s.name, ' at ', h('code', s.address), ' · ' + BigInt(r.gasUsed) + ' gas');
    }
  } catch (e) {
    log(h('b.bad', 'Stopped: ' + (e.message || e) + '. Press Deploy again to continue; finished steps are skipped.'));
  }
  await render();
}

async function verify() {
  const page = dbytes(await rpc('eth_call', [{ to: P.app, data: keccakText('html()').slice(0, 10) }, 'latest']));
  const ok = keccakHex(page) === P.contentHash && bytes(page).length === P.size;
  const tokenId = '0x5ee9ac06dcbb65a76f1f67124f33a87fb2fcd41386337c01a2e166f5c938c62d'; // namehash("safe.wei")
  const record = { chainId: chain, app: P.app, chunks: P.chunks, salt: P.salt, size: P.size, contentHash: P.contentHash, codeHash: keccakHex(await rpc('eth_getCode', [P.app, 'latest'])) };
  put(
    $('result'),
    ok ? h('p.ok', '✓ html() matches the build: ' + P.size + ' bytes, contentHash ' + P.contentHash) : h('p.bad', '✗ html() does NOT match the planned page. Do not point safe.wei at it.'),
    ok && [
      h('h2', 'Next: point safe.wei'),
      h('p', 'From the wallet that owns safe.wei, send this transaction (setAddr(uint256,address) on the WNS NameNFT):'),
      h('pre', 'to   0x0000000000696760E15f265e828DB644A0c242EB\ndata ' + cd(keccakText('setAddr(uint256,address)').slice(2, 10), tokenId, P.app)),
      h('p', 'Then open safe.wei.limo and check it loads this build. Save this record as deploy/' + chain + '.json in the repo:'),
      h('pre', JSON.stringify(record, null, 2)),
    ],
  );
}

$('connect').onclick = () => connect().catch((e) => log(h('b.bad', e.message || String(e))));
$('deploy').onclick = deploy;
if (eth && eth.on) eth.on('chainChanged', () => location.reload()), eth.on('accountsChanged', () => location.reload());
render();
