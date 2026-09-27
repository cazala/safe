// safe.wei — app shell, routing and views.
import { fmt, isAddr } from './abi.js';
import { CHAINS } from './chains.js';
import * as rpc from './rpc.js';
import { readSafe } from './safe.js';
import { $, addr, bad, h, kv, short, warn } from './ui.js';

const st = { account: null, chainId: null, safe: null };
const main = $('main');
const chain = () => CHAINS[st.chainId];

// ---- wallet ----
async function refreshWallet() {
  if (!rpc.provider()) return;
  [st.chainId, [st.account = null] = []] = await Promise.all([rpc.chainId(), rpc.accounts()]);
  const c = chain();
  $('net').replaceChildren(c ? c.name + ' (' + st.chainId + ')' : h('b.bad', 'Unsupported chain ' + st.chainId));
  $('connect').textContent = st.account ? short(st.account) : 'Connect';
}

$('connect').onclick = async () => {
  try {
    await rpc.connect();
    await refreshWallet();
    route();
  } catch (e) {
    main.prepend(bad(e.message));
  }
};

// ---- views ----
function home() {
  const input = h('input', { placeholder: 'Safe address 0x…', id: 'safeIn', spellcheck: 'false' });
  const go = () => (isAddr(input.value.trim()) ? (location.hash = '/' + input.value.trim().toLowerCase()) : input.after(bad('Enter a 0x address (40 hex characters).')));
  input.onkeydown = (e) => e.key === 'Enter' && go();
  return h('section', h('h2', 'Open Safe'), h('div.row', input, h('button', { onclick: go }, 'Open')));
}

function safeView(s) {
  const c = chain();
  const me = st.account && s.owners.includes(st.account.toLowerCase());
  return [
    h(
      'section',
      h('h2', 'Safe'),
      kv([
        ['Address', addr(s.address)],
        ['Chain', (c ? c.name : 'unknown') + ' · chainId ' + s.chainId],
        ['Version', s.version || '(unreadable)'],
        ['Balance', fmt(s.balance) + ' ' + (c ? c.sym : '')],
        ['Threshold', s.threshold + ' of ' + s.owners.length],
        ['Nonce', String(s.nonce)],
        ['Singleton', h('code', s.singleton)],
        ['Fallback', s.fallback ? h('code', s.fallback) : 'none'],
        ['Guard', s.guard ? h('b.bad', s.guard) : 'none'],
      ]),
      !s.supported && warn('Unsupported Safe version "' + s.version + '". Only 1.3.0 and 1.4.1 are supported; signing is disabled.'),
      s.guard && warn('This Safe has a transaction guard. It can block or alter the execution of any transaction.'),
    ),
    h(
      'section',
      h('h2', 'Owners'),
      h('ol.owners', s.owners.map((o) => h('li', addr(o, st.account && o === st.account.toLowerCase() && h('b.ok', 'you'))))),
      st.account && !me && h('p.mut', 'The connected wallet is not an owner of this Safe.'),
    ),
  ];
}

// ---- routing ----
let seq = 0;
async function route() {
  const n = ++seq;
  const path = location.hash.slice(1);
  const m = /^\/(0x[0-9a-fA-F]{40})$/.exec(path);
  if (!m) return main.replaceChildren(home());
  main.replaceChildren(h('p.mut', 'Loading ' + m[1] + '…'));
  try {
    if (!chain()) throw Error('Connect a wallet on a supported chain (' + Object.values(CHAINS).map((c) => c.name).join(', ') + ').');
    const s = await readSafe(m[1]);
    if (n !== seq) return;
    st.safe = s;
    main.replaceChildren(...safeView(s));
  } catch (e) {
    if (n === seq) main.replaceChildren(bad(e.message), home());
  }
}

// ---- boot ----
const eth = window.ethereum;
rpc.use(eth);
if (eth && eth.on) {
  // Any wallet change invalidates everything loaded so far (spec §15).
  const reset = () => ((st.safe = null), refreshWallet().then(route));
  eth.on('chainChanged', reset);
  eth.on('accountsChanged', reset);
}
window.onhashchange = route;
(eth ? refreshWallet() : Promise.resolve($('net').replaceChildren(h('b.bad', 'No wallet detected')))).then(route, route);
