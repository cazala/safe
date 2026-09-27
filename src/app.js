// safe.wei — app shell, routing and views.
import { cd, fmt, isAddr, isHex, parse, strip } from './abi.js';
import { chainInfo, label } from './chains.js';
import { approve, checkSigs, collect, execute, sign } from './flow.js';
import { review } from './review.js';
import * as rpc from './rpc.js';
import { create, createCall, newTx, predict, readSafe, safeTxHash } from './safe.js';
import { compact, fragment, importPayload, toJSON } from './share.js';
import { payloadGas, scan } from './pending.js';
import { decode } from './decode.js';
import { balances, listed, meta, save, saved } from './tokens.js';
import { S } from './sel.js';
import { nameOf, resolveName } from './names.js';
import { batch } from './multisend.js';
import { parseCSV, toCSV } from './csv.js';
import { $, act, addr, bad, h, kv, put, short, warn } from './ui.js';
import { discover, get, list, remember, remembered } from './wallets.js';

const st = { account: null, chainId: null, safe: null, tokens: {}, named: {}, batch: [], batchNames: {} };

/** An address input: a 0x address, or a .eth / .wei name resolved onchain (remembered for display and re-checks). */
async function target(v) {
  v = v.trim();
  if (isAddr(v)) return v.toLowerCase();
  const addr = await resolveName(v, st.chainId);
  st.named[addr] = v;
  return addr;
}
/** Re-resolve every name used in the current transaction; refuse if any changed (spec §25). */
async function recheck() {
  for (const [addr, name] of Object.entries(st.named)) {
    const now = await resolveName(name, st.chainId);
    if (now !== addr) throw Error(name + ' now resolves to ' + now + ' instead of ' + addr + '. Rebuild the transaction.');
  }
}
const MAXU = (1n << 256n) - 1n;
/** Token amount for display; 2^256-1 is shown as "unlimited" rather than 78 digits. */
const amount = (v, t) => (v === MAXU ? 'unlimited (2^256 - 1)' : t ? fmt(v, t.decimals) + ' ' + t.symbol : String(v));
const named = (x, m = st.named) => (m[x] ? [h('b', m[x]), ' → ', h('code', x)] : h('code', x));
/** Fill in a reverse name next to an address, for display only. */
const rev = (x) => {
  const el = h('span.mut');
  nameOf(x, st.chainId).then((n) => n && put(el, ' ' + n), () => {});
  return el;
};
const main = $('main');
const chain = () => st.chain;

// ---- wallet ----
let wallet = null; // { key, name, provider } in use, or null

async function refreshWallet() {
  if (!wallet) {
    st.chainId = st.account = st.chain = null;
    put($('connect'), list().length ? 'Connect' : 'No wallet');
    return;
  }
  [st.chainId, [st.account = null] = []] = await Promise.all([rpc.chainId(), rpc.accounts()]);
  if (!st.chain || st.chain.id !== st.chainId) st.chain = await chainInfo(st.chainId);
  // The connected chain lives on the account button, subtly, and in its menu.
  put($('connect'), st.account ? [h('span.net', { title: st.chain.name + ' · chain ' + st.chainId }, st.chain.name), short(st.account)] : 'Connect');
}

// Any wallet change invalidates everything loaded so far (spec §15).
const reset = () => ((st.safe = null), refreshWallet().then(route));

function useWallet(w) {
  const old = wallet && wallet.provider;
  if (old && old.removeListener) old.removeListener('chainChanged', reset), old.removeListener('accountsChanged', reset);
  wallet = w;
  rpc.use(w && w.provider);
  if (w && w.provider.on) w.provider.on('chainChanged', reset), w.provider.on('accountsChanged', reset);
}

async function connectTo(w) {
  const prev = wallet;
  useWallet(w);
  try {
    await rpc.connect();
  } catch (e) {
    useWallet(prev); // rejected or failed: stay on the previous wallet
    throw e;
  }
  remember(w.key);
  await reset();
}

async function disconnect() {
  // Ask the wallet to forget this site where supported (EIP-2255); otherwise just stop using it.
  await wallet.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
  remember('none');
  useWallet(null);
  await reset();
}

// Account popover, anchored to the header button: the account menu, or the wallet list.
const drop = $('drop');
const closeDrop = () => put(drop);
// pointerdown, not click: by the time a click bubbles up, the popover may have re-rendered.
document.addEventListener('pointerdown', (e) => !e.target.closest('.acct') && closeDrop());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrop());

function popover(view) {
  const err = h('div');
  const item = (label, fn) => h('button', { onclick: () => fn().catch((e) => put(err, h('p.bad', e.message || String(e)))) }, label);
  if (view === 'menu')
    return put(drop, h('div.dropdown', h('div.head', h('div', h('b', wallet.name), h('div', chain().name + ' · chain ' + st.chainId))), item('Switch wallet', async () => popover('pick')), item('Disconnect', async () => (closeDrop(), disconnect())), err));
  // Wallet list: every wallet except the one already connected.
  const ws = list().filter((w) => !st.account || w.key !== wallet.key);
  put(
    drop,
    h(
      'div.dropdown',
      h('div.head', st.account && h('button.back', { onclick: () => popover('menu'), 'aria-label': 'Back' }, '‹'), st.account ? 'Switch wallet' : 'Connect a wallet'),
      ws.length ? ws.map((w) => item(w.name, async () => (await connectTo(w), closeDrop()))) : h('div.empty', st.account ? 'No other wallet found.' : 'No wallet found. Install or enable a browser wallet.'),
      err,
    ),
  );
}

$('connect').onclick = () => {
  if (drop.firstChild) return closeDrop();
  const ws = list();
  if (st.account) return popover('menu');
  if (ws.length === 1) return connectTo(ws[0]).catch((e) => (popover('pick'), drop.querySelector('.dropdown').append(h('p.bad', e.message || String(e)))));
  popover('pick');
};

// ---- views ----
function home() {
  const input = h('input', { placeholder: 'Safe address 0x… or name.eth / name.wei', id: 'safeIn', spellcheck: 'false' });
  const out = h('div');
  // Keep a name in the URL (readable, shareable); it is resolved again on every load.
  const open = button('Open', async () => {
    const v = input.value.trim();
    await target(v);
    location.hash = '/' + (isAddr(v) ? v.toLowerCase() : v);
  }, out);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') open.click(); // never return false here: that would cancel every keystroke
  };
  return [
    h('section', h('h2', 'Open Safe'), h('div.row', input, open), out),
    h(
      'section',
      h('h2', 'Create Safe'),
      !chain()
        ? h('p.mut', 'Connect a wallet to create a Safe.')
        : chain().canCreate
          ? [h('p.mut', 'Deploy a new ' + (chain().mainnet ? 'Safe' : 'SafeL2') + ' v1.4.1 on ' + chain().name + ' from the canonical proxy factory.'), h('button', { onclick: () => (location.hash = '/new') }, 'Create Safe')]
          : h('p.mut', 'The canonical Safe v1.4.1 contracts are not deployed on ' + chain().name + ', so Safes cannot be created here. Existing Safes can still be opened.'),
    ),
  ];
}

function createView() {
  const c = chain();
  const owners = h('textarea', { placeholder: 'One owner per line: 0x address or name.eth / name.wei', spellcheck: 'false' }, st.account || '');
  const threshold = h('input', { value: '1', inputmode: 'numeric' });
  const rand = crypto.getRandomValues(new Uint8Array(8)).reduce((n, b) => n * 256n + BigInt(b), 0n);
  const salt = h('input', { value: String(rand) });
  const out = h('div'), plan = h('div');
  const btn = h('button.primary', 'Review');
  btn.onclick = act(
    btn,
    async () => {
      put(plan);
      if (!st.account) throw Error('Connect a wallet first.');
      if (!/^\d+$/.test(threshold.value.trim()) || !/^\d+$/.test(salt.value.trim())) throw Error('Threshold and salt must be whole numbers.');
      const list = await Promise.all(owners.value.split(/[\s,]+/).filter(Boolean).map(target));
      const k = createCall(c, list, threshold.value.trim(), BigInt(salt.value.trim()));
      const at = await predict(k, st.account);
      const deploy = h('button.primary', 'Deploy Safe');
      deploy.onclick = act(deploy, async () => {
        await recheck();
        const s = await create(k, st.account);
        location.hash = '/' + s.address;
      });
      put(
        plan,
        h('h2', 'Deployment summary'),
        kv([
          ['Predicted address', h('b', h('code', at))],
          ['Chain', c.name + ' · chainId ' + st.chainId],
          ['Owners', h('ol.owners', k.owners.map((o) => h('li', named(o), o === st.account.toLowerCase() && [' ', h('b.ok', 'you')])))],
          ['Threshold', k.threshold + ' of ' + k.owners.length],
          ['Singleton', [h('code', c.singleton), c.mainnet ? ' (Safe v1.4.1)' : ' (SafeL2 v1.4.1)']],
          ['Factory', h('code', c.factory)],
          ['Fallback', [h('code', c.fallback), ' (CompatibilityFallbackHandler)']],
          ['Salt nonce', String(k.salt)],
        ]),
        !k.owners.includes(st.account.toLowerCase()) && warn('The connected wallet is not one of the owners.'),
        h('div.actions', deploy),
      );
    },
    out,
  );
  return h(
    'section',
    h('h2', 'Create Safe'),
    h('label', 'Owners'),
    owners,
    h('label', 'Threshold'),
    threshold,
    h('details', h('summary', 'Advanced'), h('label', 'Salt nonce (the address depends on it)'), salt),
    h('div.actions', btn),
    out,
    plan,
  );
}

// ---- Safe page: header, tabs, batch bar ----
const TABS = [
  ['assets', 'Assets'],
  ['send', 'Send'],
  ['transactions', 'Transactions'],
  ['custom', 'Custom'],
  ['setup', 'Setup'],
];
const link = (tab, q) => '#/' + st.ref + (tab && tab !== 'assets' ? '/' + tab : '') + (q ? '?' + new URLSearchParams(q) : '');
const chip = (text, cls = '') => h('span.chip' + cls, text);

/** `back`: [href, text] for the single back link; defaults to Home. */
function safeHeader(s, back = ['#', '‹ Home']) {
  const c = chain(), me = st.account && s.owners.includes(st.account.toLowerCase());
  const title = h('h1', st.safeName || 'Safe ' + short(s.address));
  if (!st.safeName)
    nameOf(s.address, st.chainId).then((n) => n && ((st.safeName = n), put(title, n)), () => {});
  return h(
    'div.safehead',
    h('a.back', { href: back[0] }, back[1]),
    title,
    h('div.sub', h('code', s.address), ' ', h('button.link', { onclick: () => navigator.clipboard.writeText(s.address) }, 'copy')),
    h(
      'div.chips',
      chip(c.name),
      chip(s.threshold + ' of ' + s.owners.length + ' owners'),
      chip('v' + (s.version || '?'), s.supported ? '' : '.bad'),
      chip(fmt(s.balance) + ' ' + c.sym),
      me ? chip('You are an owner', '.ok') : st.account && chip('Not an owner'),
    ),
    !s.supported && bad('Unsupported Safe version "' + s.version + '". Only 1.3.0 and 1.4.1 are supported; signing is disabled.'),
    s.guard && warn('This Safe has a transaction guard (' + s.guard + '). It can block or alter the execution of any transaction.'),
  );
}

function tabBar(tab) {
  const n = st.pending ? st.pending.found.length : 0;
  return h(
    'nav.tabs',
    TABS.map(([id, text]) => h('a', { href: link(id), class: id === tab ? 'on' : null, 'aria-current': id === tab ? 'page' : null }, text, id === 'transactions' && n > 0 && h('span.badge', String(n)))),
  );
}

/** Renders the Safe page shell and returns the content element. */
function page(s, tab, ...content) {
  put(main, st.flash && h('p.ok', st.flash), safeHeader(s), tabBar(tab), h('div.tab', ...content), bq);
  st.flash = null;
  renderBatch();
}

// ---- data shared across tabs (cached per Safe) ----
async function loadBalances(s) {
  if (st.balFor === s.address) return st.bal;
  const list = [...(await listed(st.chainId).catch(() => [])), ...saved(st.chainId)];
  for (const t of list) st.tokens[t.address] = st.tokens[t.address] || t;
  const tokens = Object.values(st.tokens), b = await balances(s.address, tokens);
  st.bal = {};
  tokens.forEach((t, i) => (st.bal[t.address] = b[i]));
  st.balFor = s.address;
  return st.bal;
}
const balanceOf = (t) => (t ? st.bal && st.bal[t.address] : st.safe.balance);
const held = () => Object.values(st.tokens).filter((t) => (st.bal && st.bal[t.address]) || !t.listed);

function loadPending(s) {
  if (st.pendingFor === s.address) return st.pendingJob;
  st.pendingFor = s.address;
  st.pending = null;
  return (st.pendingJob = scan(s).then((r) => {
    st.pending = r;
    const badge = document.querySelector('.tabs a[href$="/transactions"]');
    if (badge && r.found.length && !badge.querySelector('.badge')) badge.append(h('span.badge', String(r.found.length)));
    return r;
  }));
}

// ---- tabs ----
const tokenOf = (addr) => st.tokens[addr];
const tokenLabel = (t) => [h('b', t.symbol), ' ', h('code', t.address), ' ', t.listed ? h('span.mut', '(zOrg TokenList)') : h('b.bad', '(unlisted)')];

/** Token by CSV/link spec: '' or the native symbol → null (native); a TokenList symbol; or a token address. */
async function findToken(spec) {
  const c = chain(), v = (spec || '').trim();
  if (!v || v.toUpperCase() === c.sym) return null;
  if (isAddr(v)) {
    const a = v.toLowerCase();
    return (st.tokens[a] = st.tokens[a] || (await meta(a)));
  }
  const hits = Object.values(st.tokens).filter((t) => t.listed && t.symbol.toLowerCase() === v.toLowerCase());
  if (hits.length !== 1) throw Error(hits.length ? 'Symbol "' + v + '" is ambiguous; use the token address.' : 'Unknown token "' + v + '"; use a TokenList symbol or the token address.');
  return hits[0];
}
const tokenSpec = (t) => (t ? (t.listed ? t.symbol : t.address) : '');
const transfer = (t, to, v) => (t ? { to: t.address, value: 0n, data: cd(S.transfer, to, v) } : { to, value: v, data: '0x' });
const abs = (hash) => location.href.split('#')[0] + hash;
const prefilled = () => warn('Prefilled from a link. Check every recipient, amount and token before reviewing.');

function assetsTab(s) {
  const c = chain(), rows = h('div', h('p.mut', 'Loading balances…')), pend = h('div');
  const draw = () =>
    put(
      rows,
      h(
        'table.assets',
        h('tr', h('th', 'Asset'), h('th.num', 'Balance'), h('th', '')),
        h('tr', h('td', h('b', c.sym), h('div.mut', 'Native')), h('td.num', fmt(s.balance)), h('td.act', h('a.btn', { href: link('send') }, 'Send'))),
        held().map((t) =>
          h(
            'tr',
            h('td', h('b', t.symbol), !t.listed && [' ', h('span.chip.bad', 'unlisted')], h('div', h('code.mut', t.address))),
            h('td.num', st.bal[t.address] == null ? h('span.mut', 'unreadable') : fmt(st.bal[t.address], t.decimals)),
            h('td.act', h('a.btn', { href: link('send', { token: tokenSpec(t) }) }, 'Send')),
          ),
        ),
      ),
      h('p.mut', c.mainnet ? Object.values(st.tokens).filter((t) => t.listed).length + ' tokens from the zOrg TokenList checked; zero balances are hidden.' : 'The zOrg TokenList lives on Ethereum mainnet; add tokens on this chain by address.'),
    );
  loadBalances(s).then(draw, (e) => put(rows, warn('Could not read token balances: ' + e.message)));
  loadPending(s).then((r) => r.found.length && put(pend, h('a.callout', { href: link('transactions') }, h('b', r.found.length + ' pending transaction' + (r.found.length > 1 ? 's' : '')), ' published onchain · Review ›')), () => {});

  const addIn = h('input', { placeholder: 'Token address 0x…', spellcheck: 'false' }), addOut = h('div');
  const add = button(
    'Add token',
    async () => {
      const a = addIn.value.trim().toLowerCase();
      if (!isAddr(a)) throw Error('Enter a token contract address.');
      const t = await meta(a);
      save(st.chainId, [...saved(st.chainId).filter((x) => x.address !== a), t]);
      st.tokens[a] = st.tokens[a] || t;
      st.balFor = null;
      addIn.value = '';
      await loadBalances(s);
      draw();
    },
    addOut,
  );
  return [pend, rows, h('details', h('summary', 'Add a token by address'), h('div.row', addIn, add), addOut)];
}

function sendTab(s, bulkMode, q) {
  const c = chain();
  const seg = h(
    'div.seg',
    h('a', { href: link('send'), class: bulkMode ? null : 'on' }, 'One recipient'),
    h('a', { href: link('batch'), class: bulkMode ? 'on' : null }, 'Many (CSV)'),
  );
  const body = h('div', h('p.mut', 'Loading balances…'));
  loadBalances(s).then(
    () => put(body, bulkMode ? bulkForm(s, q) : sendForm(s, q)),
    (e) => put(body, warn('Could not read token balances: ' + e.message), bulkMode ? bulkForm(s, q) : sendForm(s, q)),
  );
  return [seg, body];
}

function sendForm(s, q) {
  const c = chain(), fromLink = q.has('to') || q.has('amount');
  const assets = [null, ...held()];
  const sel = h('select', assets.map((t, i) => h('option', { value: i }, t ? t.symbol + ' · ' + short(t.address) + (t.listed ? '' : ' (unlisted)') : c.sym + ' (native)')));
  const to = h('input', { placeholder: '0x… or name.eth / name.wei', spellcheck: 'false', value: q.get('to') || null });
  const amt = h('input', { placeholder: '0.0', inputmode: 'decimal', value: q.get('amount') || null });
  const avail = h('span.mut'), out = h('div');
  const asset = () => assets[Number(sel.value)];
  const showAvail = () => {
    const t = asset(), b = balanceOf(t);
    put(avail, b == null ? '' : 'Available: ' + (t ? fmt(b, t.decimals) + ' ' + t.symbol : fmt(b) + ' ' + c.sym));
  };
  sel.onchange = showAvail;
  const read = async () => {
    st.named = {};
    const t = asset(), r = await target(to.value), v = parse(amt.value, t ? t.decimals : 18), b = balanceOf(t);
    if (!v) throw Error('Amount must be greater than zero.');
    if (b != null && v > b) throw Error('Amount exceeds the Safe balance.');
    return transfer(t, r, v);
  };
  const form = h(
    'div.form',
    fromLink && prefilled(),
    h('label', 'Asset'),
    sel,
    h('label', 'Recipient'),
    to,
    h('label', 'Amount'),
    h('div.row', amt, h('button', { onclick: () => {
      const t = asset(), b = balanceOf(t);
      if (b != null) amt.value = fmt(b, t ? t.decimals : 18);
    } }, 'Max')),
    avail,
    h(
      'div.actions',
      button('Review', async () => showReview(newTx(s, await read())), out, '.primary'),
      chain().canBatch && button('Add to batch', async () => (queue(await read()), (to.value = amt.value = '')), out),
      button('Copy link', () => navigator.clipboard.writeText(abs(link('send', { to: to.value.trim(), amount: amt.value.trim(), token: tokenSpec(asset()) }))), out),
    ),
    out,
  );
  if (q.has('token'))
    findToken(q.get('token')).then(
      (t) => {
        if (t && !assets.includes(t)) assets.push(t), sel.append(h('option', { value: assets.length - 1 }, t.symbol + ' · ' + short(t.address)));
        sel.value = String(assets.indexOf(t));
        showAvail();
      },
      (e) => form.prepend(bad('Link: ' + e.message)),
    );
  showAvail();
  return form;
}

function bulkForm(s, q) {
  const c = chain();
  const csv = h('textarea', { placeholder: 'One transfer per line: recipient,amount[,token]\n0x1234…,1.5,USDC\nvitalik.eth,0.1\ntreasury.wei,250,0xa0b8…', spellcheck: 'false', rows: 7 }, q.get('csv') || '');
  const preview = h('div'), out = h('div');
  let parsed = null;
  const check = async () => {
    parsed = null;
    const { rows: rs, errors } = parseCSV(csv.value);
    if (!rs.length && !errors.length) throw Error('Paste at least one row.');
    st.named = {};
    const lines = [], errs = errors.map((e) => (e.line ? 'Line ' + e.line + ': ' : '') + e.error), sums = new Map();
    for (const r of rs) {
      try {
        const t = await findToken(r.token), to = await target(r.to), v = parse(r.amount, t ? t.decimals : 18);
        if (!v) throw Error('amount must be greater than zero');
        const k = t ? t.address : '';
        sums.set(k, { t, v: ((sums.get(k) || {}).v || 0n) + v });
        lines.push({ r, t, to, v });
      } catch (e) {
        errs.push('Line ' + r.line + ': ' + e.message);
      }
    }
    errs.sort((x, y) => (+(/\d+/.exec(x) || [0])[0]) - (+(/\d+/.exec(y) || [0])[0]));
    for (const { t, v } of sums.values()) {
      const b = balanceOf(t);
      if (b != null && v > b) errs.push('Total ' + (t ? fmt(v, t.decimals) + ' ' + t.symbol : fmt(v) + ' ' + c.sym) + ' exceeds the Safe balance (' + (t ? fmt(b, t.decimals) : fmt(b)) + ').');
    }
    put(
      preview,
      lines.length > 0 &&
        h(
          'table.assets',
          h('tr', h('th', 'Line'), h('th', 'Recipient'), h('th.num', 'Amount')),
          lines.map((x) => h('tr', h('td', String(x.r.line)), h('td', named(x.to)), h('td.num', x.t ? fmt(x.v, x.t.decimals) + ' ' + x.t.symbol : fmt(x.v) + ' ' + c.sym))),
        ),
      sums.size > 0 && h('p', h('b', 'Totals: '), [...sums.values()].map(({ t, v }) => (t ? fmt(v, t.decimals) + ' ' + t.symbol : fmt(v) + ' ' + c.sym)).join(' · ')),
      errs.map((e) => bad(e)),
    );
    if (errs.length) throw Error('Fix the rows above before continuing.');
    return (parsed = { calls: lines.map((x) => transfer(x.t, x.to, x.v)), names: { ...st.named } });
  };
  const need = async () => parsed || check();
  csv.oninput = () => ((parsed = null), put(preview));
  if (q.get('csv')) setTimeout(() => check().catch(() => {}));
  return h(
    'div.form',
    q.get('csv') && prefilled(),
    h('p.mut', 'One transfer per line: recipient,amount[,token]. The token is a TokenList symbol or a token address; leave it empty for ' + c.sym + '. All rows run in one Safe transaction.'),
    csv,
    h(
      'div.actions',
      button('Preview', check, out),
      button(
        'Review',
        async () => {
          const p = await need();
          if (p.calls.length > 1 && !chain().canBatch) throw Error('MultiSendCallOnly is not deployed on ' + chain().name + ': send one transfer at a time.');
          st.named = p.names;
          await showReview(newTx(s, p.calls.length > 1 ? batch(st.chainId, p.calls) : p.calls[0]));
        },
        out,
        '.primary',
      ),
      chain().canBatch && button('Add to batch', async () => {
        const p = await need();
        st.named = p.names;
        p.calls.forEach(queue);
      }, out),
      button('Copy link', () => navigator.clipboard.writeText(abs(link('batch', { csv: toCSV(parseCSV(csv.value).rows) }))), out),
    ),
    preview,
    out,
  );
}

function transactionsTab(s) {
  const list = h('div'), status = h('p.mut', 'Scanning recent ApproveHash events…'), seen = new Set();
  const draw = (r) => {
    for (const p of r.found) {
      if (seen.has(p.hash)) continue;
      seen.add(p.hash);
      const d = decode(p.tx), c = chain();
      list.append(
        h(
          'div.card.txrow',
          h('div', h('b', 'Nonce ' + p.tx.nonce), p.tx.nonce > s.nonce ? chip('queued') : chip('next', '.ok')),
          h('div', d ? d.label : p.tx.data === '0x' ? fmt(p.tx.value) + ' ' + c.sym + ' transfer' : 'Contract call', ' → ', h('code', short(p.tx.to))),
          h('div.mut', 'Proposed by ', h('code', short(p.proposer)), ' · ', h('code', short(p.hash))),
          h('button', { onclick: () => ((st.named = {}), showReview(p.tx)) }, 'Review'),
        ),
      );
    }
    // Wallet RPCs often refuse old or wide log ranges: say how far back we looked, keep the raw error out of the way.
    const head = r.head, back = r.next + 1, blocks = head - back + 1;
    put(
      status,
      seen.size ? '' : 'No pending transactions found',
      blocks > 0 ? (seen.size ? 'Searched' : ' in') + ' the last ' + blocks.toLocaleString() + ' blocks' + (r.next < 0 ? ' (to genesis).' : '.') : '',
      r.error && [blocks > 0 ? ' This wallet’s RPC does not serve older logs.' : ' This wallet’s RPC could not be searched for pending transactions.', h('details.err', h('summary', 'Details'), h('code', r.error.slice(0, 300)))],
    );
    more.disabled = r.next < 0 || !!r.error;
  };
  const more = button('Scan older blocks', async () => draw((st.pending = { ...(await scan(s, { end: st.pending.next })), head: st.pending.head })), status);
  more.disabled = true; // until the first scan finishes
  loadPending(s).then(draw, (e) => put(status, warn('Could not scan logs through the wallet RPC: ' + e.message)));
  return [
    st.review && st.review.tx.safe === s.address && st.review.tx.nonce >= s.nonce &&
      h('a.callout', { href: '#' + fragment(st.review.tx, st.sigs) }, h('b', 'In progress: '), 'nonce ' + st.review.tx.nonce + ' · ' + short(st.review.local) + ' · Continue ›'),
    h('h2', 'Pending'),
    h('p.mut', 'Transactions a proposer published onchain together with its approval. Transactions shared only by link are not listed; import them below.'),
    list,
    status,
    h('div.actions', more),
    h('h2', 'Import'),
    importer(),
  ];
}

function setupTab(s) {
  const me = st.account && st.account.toLowerCase();
  return [
    h('h2', 'Owners'),
    h('p.mut', s.threshold + ' of ' + s.owners.length + ' owners must approve each transaction.'),
    h('ol.owners', s.owners.map((o) => h('li', addr(o, [o === me && h('b.ok', 'you'), rev(o)])))),
    h('h2', 'Configuration'),
    kv([
      ['Version', s.version || '(unreadable)'],
      ['Nonce', String(s.nonce) + ' (next transaction)'],
      ['Singleton', h('code', s.singleton)],
      ['Fallback handler', s.fallback ? h('code', s.fallback) : 'none'],
      ['Guard', s.guard ? h('b.bad', s.guard) : 'none'],
      ['Chain', chain().name + ' · chainId ' + s.chainId],
    ]),
    h('p.mut', 'To change owners or the threshold, build the call in Custom with this Safe as the target; the review decodes it.'),
  ];
}

// ---- batch bar (MultiSendCallOnly) ----
const bq = h('div');
const queue = (call) => {
  Object.assign(st.batchNames, st.named);
  st.batch.push(call);
  renderBatch(true);
};
function renderBatch(open) {
  const out = h('div'), n = st.batch.length;
  const prev = bq.querySelector('details');
  put(
    bq,
    n > 0 &&
      h(
        'div.batchbar',
        h(
          'details',
          { open: open || (prev && prev.open) || null },
          h('summary', h('b', 'Batch · ' + n + ' call' + (n > 1 ? 's' : '')), h('span.mut', ' runs atomically in one Safe transaction')),
          h('ol', st.batch.map((x, i) => h('li', callLabel(x), ' ', h('button.link', { onclick: () => (st.batch.splice(i, 1), renderBatch(true)) }, 'remove')))),
        ),
        h(
          'div.actions',
          n > 1 ? button('Review batch', async () => ((st.named = { ...st.batchNames }), await showReview(newTx(st.safe, batch(st.chainId, st.batch)))), out, '.primary') : h('span.mut', 'Add at least one more call to batch'),
          h('button', { onclick: () => ((st.batch = []), (st.batchNames = {}), renderBatch()) }, 'Clear'),
        ),
        out,
      ),
  );
}
const callLabel = (x) => {
  const d = decode({ ...x, safe: st.safe.address }), tok = d && d.label.startsWith('ERC-20') && tokenOf(x.to);
  return d
    ? [d.label, tok ? ' ' + amount(d.args.at(-1).value, tok) : '', ' → ', named((d.args.find((a) => a.name === 'to' || a.name === 'spender') || d.args[0]).value, st.batchNames), tok ? '' : [' on ', named(x.to, st.batchNames)]]
    : [fmt(x.value || 0n) + ' ' + chain().sym + ' → ', named(x.to, st.batchNames), x.data && x.data !== '0x' ? ' with ' + (x.data.length - 2) / 2 + ' bytes of calldata' : ''];
};


function builder(s) {
  const sym = chain().sym;
  const to = h('input', { placeholder: '0x… or name.eth / name.wei', spellcheck: 'false' });
  const value = h('input', { placeholder: '0', inputmode: 'decimal' });
  const data = h('textarea', { placeholder: '0x (calldata, optional)', spellcheck: 'false' });
  const op = h('select', h('option', { value: 0 }, 'CALL'), h('option', { value: 1 }, 'DELEGATECALL (dangerous)'));
  const nonce = h('input', { value: String(s.nonce) });
  const out = h('div');
  const read = async () => {
    st.named = {};
    const t = await target(to.value), d = data.value.trim() || '0x', n = nonce.value.trim();
    if (!isHex(d)) throw Error('Data: must be 0x-prefixed hex with an even number of digits.');
    if (!/^\d+$/.test(n)) throw Error('Nonce: must be a whole number.');
    return { to: t, value: parse(value.value || '0', 18), data: d.toLowerCase(), operation: Number(op.value), nonce: n };
  };
  const add = chain().canBatch && button(
    'Add to batch',
    async () => {
      const x = await read();
      if (x.operation) throw Error('Batches can only contain CALLs.');
      queue({ to: x.to, value: x.value, data: x.data });
    },
    out,
  );
  return h(
    'div.form',
    h('p.mut', 'Any call from the Safe: a contract interaction with raw calldata, or a plain transfer. Known calls are decoded in the review.'),
    h('label', 'To'),
    to,
    h('label', 'Value (' + sym + ')'),
    value,
    h('label', 'Data'),
    data,
    h('details', h('summary', 'Advanced'), h('label', 'Operation'), op, h('label', 'Nonce'), nonce),
    h('div.actions', button('Review', async () => showReview(newTx(s, await read())), out, '.primary'), add),
    out,
  );
}

function importer() {
  const ta = h('textarea', { placeholder: 'Paste a safe.wei link, a tx= fragment, or transaction JSON from another owner', spellcheck: 'false' });
  const out = h('div');
  const btn = button(
    'Import',
    async () => {
      const p = importPayload(ta.value);
      st.named = {};
      if (p.tx.safe !== st.safe.address || p.tx.chainId !== st.chainId) return (location.hash = fragment(p.tx, p.sigs));
      // Same transaction as the one under review: merge the imported signatures into it.
      const same = st.review && st.review.local === safeTxHash(p.tx);
      await showReview(p.tx, same ? [...st.sigs, ...p.sigs] : p.sigs);
    },
    out,
  );
  return h('div.form', ta, h('div.actions', btn), out);
}

// ---- review screen ----
const rv = h('div');
/** Review a transaction on its own screen. `nav`: 'push' (from a form), 'replace' (refresh), 'none' (from the URL). */
async function showReview(tx, sigs = [], nav = 'push') {
  // One back link: to the screen that opened this review, else the Transactions tab.
  if (nav === 'push') st.backTo = location.hash && !location.hash.startsWith('#tx=') ? location.hash : null;
  else if (nav === 'none') st.backTo = null;
  put(main, safeHeader(st.safe, [st.backTo || link('transactions'), '‹ Back']), rv);
  put(rv, h('p.mut', 'Checking the transaction…'));
  const r = await review(tx, st.safe, st.chainId);
  const c = await checkSigs(st.safe, r.local, sigs);
  st.review = r;
  st.off = c.valid;
  st.sigs = c.valid.map((x) => x.sig); // only valid signatures are kept and re-shared
  st.rejected = c.rejected;
  // The URL carries the transaction, so reloading or sharing the address bar returns here.
  const h2 = '#' + fragment(tx, st.sigs);
  if (nav === 'push') history.pushState(null, '', h2);
  else if (nav === 'replace') history.replaceState(null, '', h2);
  put(rv, txView(r), r.ok ? [actionsView(r), shareView(r)] : bad('All actions are disabled until the errors above are resolved.'));
  scrollTo(0, 0);
}

const button = (label, fn, out, cls = '') => {
  const b = h('button' + cls, label);
  b.onclick = act(b, fn, out);
  return b;
};

function actionsView(r) {
  const box = h('section', h('p.mut', 'Loading approvals…'));
  const s = st.safe, t = r.tx, me = st.account && st.account.toLowerCase();
  (async () => {
    const { approved, sigs } = await collect(s, r.local, me, st.off);
    const signed = st.off.map((x) => x.signer);
    const owner = me && s.owners.includes(me), mine = approved.includes(me) || signed.includes(me);
    const ready = BigInt(sigs.length) >= s.threshold, current = t.nonce === s.nonce;
    const out = h('div');
    const payload = compact(t);
    const publish = h('input', { type: 'checkbox' });
    const done = (msg) => async (rc) => {
      st.safe = await readSafe(s.address);
      st.pendingFor = null;
      await showReview(t, st.sigs, 'replace');
      rv.append(h('p.ok', msg + ' ', h('code', rc.transactionHash)));
    };
    const executed = async (rc) => {
      if (r.batch) (st.batch = []), (st.batchNames = {});
      st.stale = true;
      st.review = null;
      st.flash = '✓ Executed nonce ' + t.nonce + ' in ' + rc.transactionHash;
      location.hash = link('assets');
    };
    put(
      box,
      h('h2', 'Approvals · ' + (approved.length + st.off.filter((x) => !approved.includes(x.signer)).length) + ' of ' + s.threshold + ' required'),
      h(
        'ul.owners',
        s.owners.map((o) => h('li', h('code', o), ' ', approved.includes(o) ? h('b.ok', '✓ approved onchain') : signed.includes(o) ? h('b.ok', '✓ signed offchain') : h('span.mut', '· not approved'), o === me && ' (you)')),
      ),
      st.rejected.map((x) => warn('Ignored signature: ' + x.reason + '.')),
      !me && h('p.mut', 'Connect a wallet to approve or execute.'),
      me && !owner && h('p.mut', 'The connected wallet is not an owner: it can execute once enough owners have approved.'),
      !current && h('p.mut', 'Execution is possible only once the Safe nonce reaches ' + t.nonce + '.'),
      owner &&
        !mine &&
        h(
          'label.check',
          publish,
          ' Publish this transaction onchain with my approval (+' + (payload.length - 2) / 2 + ' bytes, ≈' + payloadGas(payload) + ' gas) so other owners can find it without a link',
        ),
      h(
        'div.actions',
        owner && !mine && button('Approve onchain', () => recheck().then(() => approve(t, me, publish.checked ? compact(t) : '0x')).then(done('Approved.')), out),
        owner && !mine && button('Sign offchain', async () => (await recheck(), showReview(t, [...st.sigs, await sign(t, me)], 'replace')), out),
        me && ready && current && button(owner && !mine ? 'Approve and execute' : 'Execute', () => recheck().then(() => execute(t, me, st.sigs)).then(executed), out, '.primary'),
        button('Refresh', () => showReview(t, st.sigs, 'replace'), out),
      ),
      out,
    );
  })().catch((e) => box.replaceChildren(bad(e.message)));
  return box;
}

function shareView(r) {
  const link = location.href.split('#')[0] + '#' + fragment(r.tx, st.sigs);
  const copy = (label, text) => button(label, () => navigator.clipboard.writeText(text));
  return h(
    'section',
    h('h2', 'Share'),
    h(
      'p.mut',
      'Other owners open this link, or paste it into Import, to review and approve the same transaction. It carries the transaction and any offchain signatures collected so far: anyone who has it can read it, nobody can sign with it. Signatures from others can be merged by importing their link here.',
    ),
    h('input', { readonly: true, value: link, onclick: (e) => e.target.select() }),
    h('div.actions', copy('Copy link', link), copy('Copy JSON', toJSON(r.tx, st.sigs))),
  );
}

function actionView(d, t) {
  const tok = d.label.startsWith('ERC-20') && tokenOf(t.to);
  return [
    h('b', d.label),
    kv([
      d.label.startsWith('ERC-20') && ['token', tok ? tokenLabel(tok) : [h('code', t.to), ' ', h('b.bad', '(unknown token: amount shown in raw units)')]],
      ...d.args.map((x) => [x.name, x.type === 'address' ? named(x.value) : x.name === 'amount' ? amount(x.value, tok) + (tok && x.value !== MAXU ? ' (' + x.value + ' raw)' : '') : String(x.value)]),
    ]),
  ];
}

function batchView(r) {
  return [
    h('b', 'Batch of ' + r.inner.length + ' calls'),
    ' via MultiSendCallOnly ',
    h('code', r.tx.to),
    r.inner.map((c, i) =>
      h(
        'div.card',
        h('b', 'Call ' + (i + 1)),
        kv([
          ['To', named(c.to)],
          ['Value', fmt(c.value) + ' ' + chain().sym],
          ['Action', c.decoded ? actionView(c.decoded, c) : c.data !== '0x' ? 'Unknown calldata' : c.value ? 'Native transfer' : 'Empty call'],
          c.data !== '0x' && ['Data', h('code', c.data)],
        ]),
      ),
    ),
  ];
}

function txView(r) {
  const t = r.tx, c = label(t.chainId), len = strip(t.data).length / 2;
  return h(
    'section',
    h('h2', 'Transaction summary'),
    r.danger.map((d) => h('p.bad.danger', d)),
    kv([
      ['Safe', h('code', t.safe)],
      ['Chain', (c.name || 'unknown') + ' · chainId ' + t.chainId],
      ['Nonce', String(t.nonce)],
      ['To', st.named[t.to] ? named(t.to) : [h('code', t.to), rev(t.to)]],
      ['Value', fmt(t.value) + ' ' + (c.sym || '') + ' (' + t.value + ' wei)'],
      ['Operation', t.operation ? (r.batch ? 'DELEGATECALL into MultiSendCallOnly (batch)' : h('b.bad', 'DELEGATECALL')) : 'CALL'],
      ['Action', r.batch ? batchView(r) : r.decoded ? actionView(r.decoded, t) : len ? 'Unknown calldata (not decoded; check the raw data)' : t.value ? 'Native transfer' : 'Empty call'],
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
// #/                         home          #/new                create a Safe
// #/<safe>[/<tab>][?params]  Safe page     #tx=<payload>        review a shared transaction
// <safe> is a 0x address or a .eth/.wei name; tabs: assets (default), send, batch (send, CSV), transactions, custom, setup.
let seq = 0;
async function route() {
  const n = ++seq;
  const path = location.hash.slice(1);
  let m = /^\/([^/?]+)(?:\/([a-z]+))?(?:\?(.*))?$/.exec(path), p;
  if (m && m[1] === 'new') m = null;
  try {
    if (path === '/new') return put(main, chain() && chain().canCreate ? createView() : bad(chain() ? 'Safe v1.4.1 is not deployed on ' + chain().name + '.' : 'Connect a wallet first.'));
    if (path.startsWith('tx=')) (p = importPayload(path)), (m = [0, p.tx.safe, 'review']);
    if (!m) return put(main, home());
    if (!chain()) throw Error('Connect a wallet to open a Safe.');
    const ref = decodeURIComponent(m[1]), tab = m[2] || 'assets', q = new URLSearchParams(m[3] || '');
    const address = isAddr(ref) ? ref.toLowerCase() : await target(ref);
    if (!st.safe || st.safe.address !== address || st.stale) {
      if (!st.safe || st.safe.address !== address) put(main, h('p.mut', 'Loading ' + ref + '…'));
      const s = await readSafe(address);
      if (n !== seq) return;
      if (!st.safe || st.safe.address !== s.address) st.safeName = isAddr(ref) ? null : ref;
      st.safe = s;
      st.stale = false;
      st.balFor = st.pendingFor = null;
      if (st.batchSafe !== s.address) (st.batch = []), (st.batchNames = {}), (st.batchSafe = s.address);
    }
    // How this Safe is addressed in links: the name it was opened by, else its address.
    if (!p) st.ref = isAddr(ref) ? st.safe.address : ref;
    else if (st.ref !== st.safe.address && st.ref !== st.safeName) st.ref = st.safe.address;
    const s = st.safe;
    if (p) return showReview(p.tx, p.sigs, 'none');
    const tabs = { assets: assetsTab, send: sendTab, batch: sendTab, transactions: transactionsTab, custom: builder, setup: setupTab };
    if (!tabs[tab]) return (location.hash = link('assets'));
    page(s, tab === 'batch' ? 'send' : tab, tab === 'send' || tab === 'batch' ? sendTab(s, tab === 'batch', q) : tabs[tab](s));
  } catch (e) {
    if (n === seq) put(main, bad(e.message), home());
  }
}

// ---- boot ----
window.onhashchange = route;
let booted = false;
discover(() => {
  if (!booted) return; // announcements during discovery are handled by the initial choice below
  // A wallet announced late: pick it up if it is the remembered one and nothing is in use.
  const k = remembered();
  if (!wallet && k && get(k)) useWallet(get(k)), reset();
  else if (!wallet) refreshWallet();
});
{
  const k = remembered(), ws = list();
  // Remembered wallet; else the only wallet present; else wait for the user to choose.
  useWallet(k === 'none' ? null : get(k) || (ws.length === 1 ? ws[0] : null));
  booted = true;
}
refreshWallet().then(route, route);
