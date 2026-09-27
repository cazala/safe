// safe.wei — app shell, routing and views.
import { fmt, isAddr, isHex, parse, strip } from './abi.js';
import { CHAINS } from './chains.js';
import { review } from './review.js';
import * as rpc from './rpc.js';
import { newTx, readSafe } from './safe.js';
import { $, act, addr, bad, h, kv, short, warn } from './ui.js';

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

function builder(s) {
  const sym = chain().sym;
  const to = h('input', { placeholder: '0x… recipient or contract', spellcheck: 'false' });
  const value = h('input', { placeholder: '0', inputmode: 'decimal' });
  const data = h('textarea', { placeholder: '0x (calldata, optional)', spellcheck: 'false' });
  const op = h('select', h('option', { value: 0 }, 'CALL'), h('option', { value: 1 }, 'DELEGATECALL (dangerous)'));
  const nonce = h('input', { value: String(s.nonce) });
  const out = h('div');
  const btn = h('button.primary', 'Review');
  btn.onclick = act(
    btn,
    async () => {
      const t = to.value.trim(), d = data.value.trim() || '0x', n = nonce.value.trim();
      if (!isAddr(t)) throw Error('To: enter a 0x address (40 hex characters).');
      if (!isHex(d)) throw Error('Data: must be 0x-prefixed hex with an even number of digits.');
      if (!/^\d+$/.test(n)) throw Error('Nonce: must be a whole number.');
      await showReview(newTx(s, { to: t, value: parse(value.value || '0', 18), data: d, operation: Number(op.value), nonce: n }));
    },
    out,
  );
  return h(
    'section',
    h('h2', 'New transaction'),
    h('label', 'To'),
    to,
    h('label', 'Value (' + sym + ')'),
    value,
    h('label', 'Data'),
    data,
    h('details', h('summary', 'Advanced'), h('label', 'Operation'), op, h('label', 'Nonce'), nonce),
    h('div.actions', btn),
    out,
  );
}

const rv = h('div');
async function showReview(tx) {
  const r = await review(tx, st.safe, st.chainId);
  st.review = r;
  rv.replaceChildren(txView(r));
  rv.scrollIntoView({ behavior: 'smooth' });
}

function txView(r) {
  const t = r.tx, c = CHAINS[t.chainId] || {}, len = strip(t.data).length / 2;
  return h(
    'section',
    h('h2', 'Transaction summary'),
    kv([
      ['Safe', h('code', t.safe)],
      ['Chain', (c.name || 'unknown') + ' · chainId ' + t.chainId],
      ['Nonce', String(t.nonce)],
      ['To', h('code', t.to)],
      ['Value', fmt(t.value) + ' ' + (c.sym || '') + ' (' + t.value + ' wei)'],
      ['Operation', t.operation ? h('b.bad', 'DELEGATECALL') : 'CALL'],
      ['Data', len ? [h('div', 'selector ', h('code', t.data.slice(0, 10)), ' · ' + len + ' bytes'), h('code.mono', t.data)] : 'none'],
      ['Gas fields', 'safeTxGas ' + t.safeTxGas + ' · baseGas ' + t.baseGas + ' · gasPrice ' + t.gasPrice + ' · gasToken ' + t.gasToken + ' · refundReceiver ' + t.refundReceiver],
      ['SafeTx hash', h('b', h('code', r.local))],
      ['Onchain hash', r.chain ? [h('code', r.chain), ' ', r.chain === r.local ? h('b.ok', '✓ verified') : h('b.bad', '✗ MISMATCH')] : h('b.bad', 'unavailable')],
    ]),
    r.errors.map((e) => bad(e)),
    r.warnings.map((w) => warn(w)),
  );
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
    rv.replaceChildren();
    main.replaceChildren(...safeView(s), builder(s), rv);
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
