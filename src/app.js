// safe.wei — app shell, routing and views.
import { cd, fmt, fmtShort, hex, isAddr, isHex, keccakText, parse, strip, utf8, ZERO } from './abi.js';
import { chainInfo, label } from './chains.js';
import { approve, checkSigs, collect, execute, sign } from './flow.js';
import { review } from './review.js';
import * as rpc from './rpc.js';
import { create, createCall, modules, newTx, predict, readSafe, safeTxHash, SENTINEL } from './safe.js';
import { compact, fragment, importPayload, toJSON } from './share.js';
import { payloadGas, scan } from './pending.js';
import { decode } from './decode.js';
import { balances, listed, meta, save, saved } from './tokens.js';
import { S } from './sel.js';
import { nameOf, resolveName } from './names.js';
import { batch } from './multisend.js';
import { parseCSV, toCSV } from './csv.js';
import { canonical, encodeCall, parseAbi, parseValue } from './abicoder.js';
import { $, act, addr, bad, copy, h, icon, ICONS, kv, put, short, warn } from './ui.js';
import * as recent from './recent.js';
import { discover, get, list, remember, remembered } from './wallets.js';
import { identify } from './zodiac.js';

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
const named = (x, m = st.named) => (m[x] ? [h('b', m[x]), ' → ', addr(x)] : addr(x));
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
  }, out, '.primary');
  input.onkeydown = (e) => {
    if (e.key === 'Enter') open.click(); // never return false here: that would cancel every keystroke
  };
  const list = h('div');
  const draw = () => put(list, savedSafes(draw));
  draw();
  const c = chain();
  return h(
    'div.home',
    h('div.hero', h('span.mark', icon(...ICONS.shield)), h('h1', 'safe.wei'), h('p', 'Your Safe, straight from the chain. No servers, no sign-ups: just your wallet.')),
    h('div.panel', h('label', { for: 'safeIn' }, 'Open a Safe'), h('div.row', input, open), out),
    list,
    h(
      'div.panel.create',
      h('div', h('b', 'Create a new Safe'), h('p.mut', !c ? 'Connect a wallet to create a Safe.' : c.canCreate ? 'A shared account on ' + c.name + ' that several owners control together (Safe v' + c.version + ').' : 'Safe’s contracts are not deployed on ' + c.name + ', so new Safes can’t be created here.')),
      c && c.canCreate && h('button', { onclick: () => (location.hash = '/new') }, icon(...ICONS.plus), ' Create'),
    ),
    h('p.foot', 'Everything is read from the chain through your wallet. Your saved Safes stay in this browser.'),
  );
}

/** The "Your Safes" list: pinned first, then most recent. */
function savedSafes(redraw) {
  const l = recent.sorted();
  if (!l.length) return null;
  const iconBtn = iconButton;
  const row = (e) => {
    const title = e.label || e.ref || 'Safe ' + short(e.address), here = st.chainId === e.chainId;
    const name = h('b.name', title);
    const rename = () => {
      const inp = h('input.rename', { value: e.label || '', placeholder: e.ref || 'Name this Safe', maxlength: 40 });
      const save = (keep) => (keep && recent.update(e.chainId, e.address, { label: inp.value.trim().slice(0, 40) }), redraw());
      inp.onkeydown = (k) => (k.key === 'Enter' ? save(true) : k.key === 'Escape' ? save(false) : null);
      inp.onblur = () => save(true);
      inp.onclick = (k) => (k.preventDefault(), k.stopPropagation());
      name.replaceWith(inp);
      inp.focus();
      inp.select();
    };
    const remove = () => {
      const gone = recent.remove(e.chainId, e.address);
      const undo = h('div.saferow.removed', h('span.mut', 'Removed ' + title + '.'), h('button.link', { onclick: () => (recent.restore(gone), redraw()) }, 'Undo'));
      el.replaceWith(undo);
      setTimeout(() => undo.isConnected && undo.remove(), 6000);
    };
    const el = h(
      'a.saferow' + (here ? '' : '.other'),
      { href: '#/' + (e.ref || e.address), title: here ? null : 'Switch your wallet to ' + label(e.chainId).name + ' to open this Safe' },
      h('div.info', h('div', name, e.pinned && h('span.pinned', icon(...ICONS.pin))), h('div.meta', h('code', short(e.address)), h('span.chip', label(e.chainId).name), h('span', recent.ago(e.at)))),
      h(
        'div.acts',
        iconBtn('pin', e.pinned ? 'Unpin' : 'Pin', () => (recent.update(e.chainId, e.address, { pinned: !e.pinned }), redraw()), e.pinned),
        iconBtn('edit', 'Rename', rename),
        iconBtn('close', 'Remove from this list', remove),
      ),
      h('span.go', icon(...ICONS.next)),
    );
    return el;
  };
  return h('div.saved', h('h2', 'Your Safes'), l.map(row));
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
          ['Predicted address', h('b', addr(at))],
          ['Chain', c.name + ' · chainId ' + st.chainId],
          ['Owners', h('ol.owners', k.owners.map((o) => h('li', named(o), o === st.account.toLowerCase() && [' ', h('b.ok', 'you')])))],
          ['Threshold', k.threshold + ' of ' + k.owners.length],
          ['Singleton', [addr(c.singleton), (c.mainnet ? ' (Safe v' : ' (SafeL2 v') + c.version + ')']],
          ['Factory', addr(c.factory)],
          ['Fallback', [addr(c.fallback), ' (CompatibilityFallbackHandler)']],
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
  ['settings', 'Settings'],
];
const link = (tab, q) => '#/' + st.ref + (tab && tab !== 'assets' ? '/' + tab : '') + (q ? '?' + new URLSearchParams(q) : '');
const chip = (text, cls = '') => h('span.chip' + cls, text);

/** Small icon-only button. */
function iconButton(name, title, fn, on) {
  const b = h('button.ib' + (on ? '.on' : ''), { title, 'aria-label': title });
  b.append(icon(...ICONS[name]));
  b.onclick = (e) => (e.preventDefault(), e.stopPropagation(), fn());
  return b;
}

/** `back`: [href, text] for the single back link; defaults to Home. */
function safeHeader(s, back = ['#', '‹ Home']) {
  const c = chain(), me = st.account && s.owners.includes(st.account.toLowerCase());
  const title = h('h1', st.safeName || 'Safe ' + short(s.address));
  if (!st.safeName)
    nameOf(s.address, st.chainId).then((n) => n && ((st.safeName = n), put(title, n)), () => {});
  // Rename in place: the nickname is shared with the list on Home.
  const rename = iconButton('edit', 'Rename this Safe', () => {
    if (!title.isConnected) return; // already editing
    const cur = (recent.find(s.chainId, s.address) || {}).label || '';
    const inp = h('input.rename.big', { value: cur, placeholder: st.refName || 'Name this Safe', maxlength: 40 });
    const done = (save) => {
      if (save) {
        const v = inp.value.trim().slice(0, 40);
        recent.update(s.chainId, s.address, { label: v });
        st.safeName = v || st.refName || null;
      }
      put(title, st.safeName || 'Safe ' + short(s.address));
      inp.replaceWith(title);
    };
    inp.onkeydown = (k) => (k.key === 'Enter' ? done(true) : k.key === 'Escape' ? done(false) : null);
    inp.onblur = () => inp.isConnected && done(true);
    // Only the title becomes an input, styled like the title and sized to its text, so nothing around it moves.
    const ctx = document.createElement('canvas').getContext('2d'), w0 = title.getBoundingClientRect().width;
    const fit = () => {
      ctx.font = getComputedStyle(inp).font;
      inp.style.width = Math.ceil(Math.max(ctx.measureText(inp.value || inp.placeholder).width + 16, w0 + 14)) + 'px';
    };
    inp.oninput = fit;
    title.replaceWith(inp);
    fit();
    inp.focus();
    inp.select();
  });
  const row = h('div.titlerow', title, rename);
  return h(
    'div.safehead',
    h('a.back', { href: back[0] }, back[1]),
    row,
    h('div.sub', addr(s.address)),
    h(
      'div.chips',
      chip(c.name),
      chip(s.threshold + ' of ' + s.owners.length + ' owners'),
      chip('v' + (s.version || '?'), s.supported ? (s.tested ? '' : '.warn') : '.bad'),
      h('span.chip', { title: fmt(s.balance) + ' ' + c.sym }, fmtShort(s.balance) + ' ' + c.sym),
      me ? chip('You are an owner', '.ok') : st.account && chip('Not an owner'),
    ),
    !s.supported && bad('Unsupported Safe version "' + s.version + '". Versions before 1.3.0 use a different signing format; signing is disabled.'),
    s.supported && !s.tested && warn('Safe ' + s.version + ' is newer than this version of safe.wei was tested with. It should work: every transaction is checked against the Safe’s own hash before you sign, so an incompatible change would be refused.'),
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
const tokenLabel = (t) => [h('b', t.symbol), ' ', addr(t.address), ' ', t.listed ? h('span.mut', '(zOrg TokenList)') : h('b.bad', '(unlisted)')];

/** Token by CSV/link spec: '' or the native symbol → null (native); a TokenList symbol; or a token address. */
async function findToken(spec) {
  const c = chain(), v = (spec || '').trim();
  if (!v || v.toUpperCase() === c.sym) return null;
  if (isAddr(v)) {
    const a = v.toLowerCase();
    return (st.tokens[a] = st.tokens[a] || (await meta(a, chain().name)));
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
        h('tr', h('td', h('b', c.sym), h('div.mut', 'Native')), h('td.num', { title: fmt(s.balance) + ' ' + c.sym }, fmtShort(s.balance)), h('td.act', h('a.btn', { href: link('send') }, 'Send'))),
        held().map((t) =>
          h(
            'tr',
            h(
              'td',
              h('b', t.symbol),
              !t.listed && [' ', h('span.chip.bad', 'unlisted'), ' ', h('button.link', { onclick: () => (save(st.chainId, saved(st.chainId).filter((x) => x.address !== t.address)), delete st.tokens[t.address], draw()), title: 'Remove from your token list' }, 'remove')],
              h('div.mut', addr(t.address)),
            ),
            h(
              'td.num',
              { title: st.bal[t.address] == null ? null : fmt(st.bal[t.address], t.decimals) + ' ' + t.symbol },
              st.bal[t.address] == null ? h('span.mut', 'unreadable') : fmtShort(st.bal[t.address], t.decimals),
            ),
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
      const t = await meta(a, chain().name);
      save(st.chainId, [...saved(st.chainId).filter((x) => x.address !== a), t]);
      st.tokens[a] = st.tokens[a] || t;
      st.balFor = null;
      addIn.value = '';
      await loadBalances(s);
      draw();
    },
    addOut,
  );
  return [pend, rows, h('details', h('summary', 'Add a token by address'), h('p.mut', 'Added tokens are saved in this browser for every Safe on ' + c.name + '.'), h('div.row', addIn, add), addOut)];
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
          await showReview(newTx(s, p.calls.length > 1 ? batch(chain().multiSendCallOnly, p.calls) : p.calls[0]));
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
          h('div', d ? d.label : p.tx.data === '0x' ? fmt(p.tx.value) + ' ' + c.sym + ' transfer' : 'Contract call', ' → ', addr(p.tx.to, null, short(p.tx.to))),
          h('div.mut', 'Proposed by ', addr(p.proposer, null, short(p.proposer)), ' · SafeTx ', addr(p.hash, null, short(p.hash))),
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

/** "Zodiac Roles 2.1.1 · owner this Safe", filled in once the contract is recognized. */
function whatIs(contract, s) {
  const el = h('div.modinfo');
  identify(contract).then(
    (z) =>
      put(
        el,
        z.name ? [h('span.chip.ok', 'Zodiac ' + z.name), z.faulty && [' ', h('span.chip.bad', 'faulty version')]] : h('span.chip', z.proxy ? 'Unknown contract (proxy to ' + short(z.impl) + ')' : 'Unknown contract'),
        z.owner && h('span', h('span.mut', 'Owner '), z.owner === s.address ? 'this Safe' : s.owners.includes(z.owner) ? [addr(z.owner, null, short(z.owner)), ' (an owner)'] : [h('b.bad', addr(z.owner, null, short(z.owner))), ' (not this Safe or an owner: it can reconfigure this module)']),
        z.faulty && warn('Zodiac lists ' + z.name + ' as a faulty version. Consider replacing it.'),
      ),
    () => {},
  );
  return el;
}

function settingsTab(s) {
  const me = st.account && st.account.toLowerCase(), n = s.owners.length;
  const self = (data) => ({ to: s.address, value: 0n, data });
  const prevOf = (o) => (s.owners.indexOf(o) === 0 ? SENTINEL : s.owners[s.owners.indexOf(o) - 1]);
  /** Review / Add to batch for a Safe self-call built by `mk` (async, may throw). */
  const acts = (mk, out) =>
    h('div.actions', button('Review', async () => showReview(newTx(s, self(await mk()))), out, '.primary'), chain().canBatch && button('Add to batch', async () => queue(self(await mk())), out));
  const thPick = (max, cur) => h('select.th', Array.from({ length: max }, (_, i) => h('option', { value: i + 1, selected: i + 1 === cur ? '' : null }, String(i + 1))));
  const open = (el, panel) => (el.firstChild ? put(el) : put(el, panel));

  // Owners: one row each, with Replace / Remove opening an inline panel.
  const rows = s.owners.map((o) => {
    const panel = h('div');
    const remove = () => {
      const th = thPick(n - 1, Math.min(Number(s.threshold), n - 1)), out = h('div');
      return h('div.card', h('b', 'Remove owner'), h('div.row.inline', 'New threshold:', th, 'of ' + (n - 1) + ' owners'), acts(async () => {
        if (n < 2) throw Error('A Safe needs at least one owner.');
        return cd(S.removeOwner, prevOf(o), o, BigInt(th.value));
      }, out), out);
    };
    const replace = () => {
      const input = h('input', { placeholder: 'New owner 0x… or name.eth / name.wei', spellcheck: 'false' }), out = h('div');
      return h('div.card', h('b', 'Replace owner'), input, acts(async () => {
        st.named = {};
        const nw = await target(input.value);
        if (s.owners.includes(nw)) throw Error('That address is already an owner.');
        return cd(S.swapOwner, prevOf(o), o, nw);
      }, out), out);
    };
    return h(
      'li',
      h('div.owner', addr(o, [o === me && h('b.ok', 'you'), rev(o)]), h('span.links', h('button.link', { onclick: () => open(panel, replace()) }, 'replace'), n > 1 && h('button.link', { onclick: () => open(panel, remove()) }, 'remove'))),
      panel,
    );
  });
  const addIn = h('input', { placeholder: 'New owner 0x… or name.eth / name.wei', spellcheck: 'false' }), addTh = thPick(n + 1, Number(s.threshold)), addOut = h('div');
  const add = h('details', h('summary', 'Add owner'), addIn, h('div.row.inline', 'New threshold:', addTh, 'of ' + (n + 1) + ' owners'), acts(async () => {
    st.named = {};
    const nw = await target(addIn.value);
    if (s.owners.includes(nw)) throw Error('That address is already an owner.');
    return cd(S.addOwnerWithThreshold, nw, BigInt(addTh.value));
  }, addOut), addOut);

  // Threshold
  const th = thPick(n, Number(s.threshold)), thOut = h('div');
  const thActs = acts(async () => cd(S.changeThreshold, BigInt(th.value)), thOut);
  // Nothing to submit until a different threshold is picked.
  const syncTh = () => (thActs.hidden = BigInt(th.value) === s.threshold);
  th.onchange = syncTh;
  syncTh();
  const threshold = [h('div.row.inline', 'Any transaction requires', th, 'out of ' + n + ' owner' + (n > 1 ? 's' : '') + ' to approve.'), thActs, thOut];

  // Modules: can execute transactions without any owner signature.
  const mods = h('div', h('p.mut', 'Loading modules…'));
  modules(s.address).then(
    (ms) =>
      put(
        mods,
        ms.length
          ? [
              warn('Enabled modules can execute any transaction from this Safe without owner approval. Keep only modules you trust.'),
              h('ul.owners', ms.map((m, i) => {
                const out = h('div');
                return h('li', h('div.owner', addr(m), h('span.links', button('disable', async () => showReview(newTx(s, self(cd(S.disableModule, i ? ms[i - 1] : SENTINEL, m)))), out, '.link'))), whatIs(m, s), out);
              })),
            ]
          : h('p.mut', 'No modules enabled. Only owner-approved transactions can move funds.'),
      ),
    (e) => put(mods, warn('Could not read modules: ' + e.message)),
  );
  const modIn = h('input', { placeholder: 'Module contract 0x…', spellcheck: 'false' }), modOut = h('div');
  const enable = h('details', h('summary', 'Enable a module (dangerous)'), h('p.bad', 'A module gets unrestricted control of this Safe: it can move every asset without the owners. Only enable audited modules you fully understand.'), modIn, acts(async () => cd(S.enableModule, await target(modIn.value)), modOut), modOut);

  // Guard and fallback handler
  const gOut = h('div');
  return [
    h('h2', 'Owners'),
    h('ol.owners', rows),
    add,
    h('h2', 'Threshold'),
    threshold,
    h('h2', 'Modules'),
    mods,
    enable,
    h('h2', 'Guard'),
    s.guard
      ? [warn('A guard checks every transaction and can block any of them, including removing it. Current guard: ', addr(s.guard)), whatIs(s.guard, s), h('div.actions', button('Remove guard', async () => showReview(newTx(s, self(cd(S.setGuard, ZERO)))), gOut)), gOut]
      : h('p.mut', 'No guard. A guard is an optional contract that checks every transaction before and after execution.'),
    h('h2', 'Contract'),
    kv([
      ['Version', s.version || '(unreadable)'],
      ['Nonce', String(s.nonce) + ' (next transaction)'],
      ['Singleton', addr(s.singleton)],
      ['Fallback handler', s.fallback ? [addr(s.fallback), h('div.mut', 'Handles calls the Safe itself does not implement, such as EIP-1271 signature checks and token callbacks.')] : 'none'],
      ['Chain', chain().name + ' · chainId ' + s.chainId],
    ]),
  ];
}

// ---- batch (MultiSendCallOnly) ----
// Desktop: a counter in the header that opens a popover. Mobile: a bar fixed to the bottom
// of the screen that expands upward. Both render the same list; CSS picks one by width.
const bq = h('div'); // mobile bottom bar (lives in the Safe page)
const bb = $('batch'); // desktop header badge + popover
const queue = (call) => {
  Object.assign(st.batchNames, st.named);
  st.batch.push(call);
  renderBatch();
  flashAdded();
};
/** Inline confirmation next to whatever button added the call. */
let lastClicked = null; // the button that triggered an action (focus is lost while it is disabled)
document.addEventListener('click', (e) => (lastClicked = e.target.closest('button')), true);
function flashAdded() {
  const n = st.batch.length, el = lastClicked && lastClicked.isConnected && lastClicked.closest('.actions');
  if (!el) return;
  const note = el.parentNode.querySelector(':scope > .added') || h('p.ok.added');
  put(note, '✓ Added to batch (' + n + ' call' + (n > 1 ? 's' : '') + ')');
  el.after(note);
}
const batchWord = (n) => n + ' call' + (n > 1 ? 's' : '');
/** The batch contents and actions, shared by the popover and the bottom bar. */
function batchBody() {
  const out = h('div'), n = st.batch.length;
  return [
    h('p.mut.small', 'Runs atomically in one Safe transaction: if one call fails, none happen.'),
    h('ol.calls', st.batch.map((x, i) => h('li', h('span', callLabel(x)), h('button.link', { onclick: () => (st.batch.splice(i, 1), renderBatch(true)) }, 'remove')))),
    h(
      'div.actions',
      n > 1 ? button('Review batch', async () => (closeBatch(), (st.named = { ...st.batchNames }), await showReview(newTx(st.safe, batch(chain().multiSendCallOnly, st.batch)))), out, '.primary') : h('span.mut', 'Add at least one more call to batch'),
      h('button', { onclick: () => ((st.batch = []), (st.batchNames = {}), renderBatch()) }, 'Clear'),
    ),
    out,
  ];
}
const closeBatch = () => {
  const p = bb.querySelector('.batchpop');
  if (p) p.remove();
  const d = bq.querySelector('details');
  if (d) d.open = false;
};
document.addEventListener('pointerdown', (e) => !e.target.closest('#batch') && bb.querySelector('.batchpop') && bb.querySelector('.batchpop').remove());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeBatch());

/** Re-render both views. `keep` keeps an open popover / expanded bar open. */
function renderBatch(keep) {
  const n = st.batch.length, onSafe = st.safe && main.querySelector('.safehead');
  const wasOpen = !!bb.querySelector('.batchpop'), wasExpanded = !!(bq.querySelector('details') || {}).open;
  if (!n || !onSafe) return put(bb), put(bq), document.body.classList.remove('hasbar');
  const badge = h('button.batchbtn', { 'aria-label': 'Batch: ' + batchWord(n), 'aria-expanded': String(keep && wasOpen) }, 'Batch ', h('span.badge', String(n)));
  badge.onclick = () => (bb.querySelector('.batchpop') ? closeBatch() : bb.append(h('div.dropdown.batchpop', h('div.head', h('b', 'Batch · ' + batchWord(n))), batchBody())));
  put(bb, badge, keep && wasOpen && h('div.dropdown.batchpop', h('div.head', h('b', 'Batch · ' + batchWord(n))), batchBody()));
  const reviewNow = n > 1 && button('Review', async () => ((st.named = { ...st.batchNames }), await showReview(newTx(st.safe, batch(chain().multiSendCallOnly, st.batch)))), null, '.primary');
  put(
    bq,
    h(
      'div.batchbar',
      h('details', { open: (keep && wasExpanded) || null }, h('summary', h('b', 'Batch · ' + batchWord(n)), h('span.mut', ' tap to view')), batchBody()),
      reviewNow && h('div.quick', reviewNow),
    ),
  );
  document.body.classList.add('hasbar');
}
const callLabel = (x) => {
  const d = decode({ ...x, safe: st.safe.address }), tok = d && d.label.startsWith('ERC-20') && tokenOf(x.to);
  // Safe settings: "Change threshold · threshold 3", "Add owner · owner vitalik.eth → 0x…, threshold 2"
  if (d && x.to === st.safe.address)
    return [d.label, ' · ', d.args.map((a, i) => [i ? ', ' : '', a.name + ' ', a.type === 'address' ? named(a.value, st.batchNames) : String(a.value)])];
  const note = !d && st.notes[strip(x.data || '0x').toLowerCase()];
  if (note) return [h('code', note.sig.replace(/\(.+\)$/, '(…)')), ' on ', named(x.to, st.batchNames), x.value ? ' · ' + fmt(x.value) + ' ' + chain().sym : ''];
  return d
    ? [d.label, tok ? ' ' + amount(d.args.at(-1).value, tok) : '', ' → ', named((d.args.find((a) => a.name === 'to' || a.name === 'spender') || d.args[0]).value, st.batchNames), tok ? '' : [' on ', named(x.to, st.batchNames)]]
    : [fmt(x.value || 0n) + ' ' + chain().sym + ' → ', named(x.to, st.batchNames), x.data && x.data !== '0x' ? ' with ' + (x.data.length - 2) / 2 + ' bytes of calldata' : ''];
};


// ---- transaction builder (Custom tab), in the spirit of Etherscan's "Write Contract" ----
// Every ABI pasted or uploaded is kept in one browser-local map, "<chainId>:<address>" → ABI text.
const ABIS = 'safe.wei:abis';
const abiMap = () => {
  try {
    return JSON.parse(localStorage.getItem(ABIS) || '{}');
  } catch {
    return {};
  }
};
const loadAbi = (addr) => {
  const k = st.chainId + ':' + addr;
  let v = abiMap()[k];
  try {
    v = v || localStorage.getItem('safe.wei:abi:' + k); // earlier per-contract key
  } catch {}
  return v || null;
};
const storeAbi = (addr, text) => {
  try {
    localStorage.setItem(ABIS, JSON.stringify({ ...abiMap(), [st.chainId + ':' + addr]: text }));
  } catch {}
};
/** What the builder encoded, so the review can show it (clearly marked as coming from the user's ABI). */
st.notes = {};
const noteView = (data) => {
  const n = st.notes[strip(data).toLowerCase()];
  return n && [h('b', n.sig), h('div.mut', 'Encoded here from the ABI you provided; safe.wei did not decode this independently.'), kv(n.args)];
};

function builder(s) {
  const mode = h('select', h('option', { value: 'abi' }, 'Custom ABI'), h('option', { value: 'raw' }, 'Raw calldata'));
  const to = h('input', { spellcheck: 'false' });
  const abiText = h('textarea', { placeholder: '[{"type":"function","name":"stake","inputs":[…]}]  (a Hardhat/Foundry artifact, or one function signature per line, also works)', spellcheck: 'false', rows: 5 });
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  const abiBox = h('div', h('label', 'Paste JSON ABI'), abiText, h('label', 'Or upload a .json file'), file);
  const methods = h('div'), out = h('div'), toLabel = h('label');
  let contract = null;

  const render = async () => {
    const raw = mode.value === 'raw';
    put(toLabel, raw ? 'To' : 'Contract');
    to.placeholder = (raw ? 'Address' : 'Contract address') + ' 0x… or name.eth / name.wei';
    abiBox.hidden = raw;
    put(methods);
    if (raw) return put(methods, rawBuilder(s, to));
    if (!contract || !abiText.value.trim()) return;
    let fns;
    try {
      fns = parseAbi(abiText.value).filter((f) => f.write);
    } catch (e) {
      return put(methods, bad('ABI: ' + e.message));
    }
    storeAbi(contract, abiText.value);
    if (!fns.length) return put(methods, h('p.mut', 'This ABI has no write methods.'));
    const code = await rpc.rpc('eth_getCode', [contract, 'latest']).catch(() => '0x');
    put(
      methods,
      code === '0x' && warn('There is no contract at this address on ' + chain().name + '.'),
      h('h3', 'Write methods'),
      fns.map((f, i) => methodCard(s, contract, f, i + 1)),
    );
  };
  to.onchange = async () => {
    put(out);
    try {
      st.named = {};
      await loadBalances(s).catch(() => {}); // token metadata, for decimals-aware amount inputs
      contract = to.value.trim() ? await target(to.value) : null;
      if (contract && !abiText.value.trim() && loadAbi(contract)) abiText.value = loadAbi(contract); // remembered for this contract
    } catch (e) {
      contract = null;
      put(out, bad(e.message));
    }
    if (mode.value !== 'raw') render();
  };
  mode.onchange = render;
  abiText.oninput = () => clearTimeout(abiText.t) || (abiText.t = setTimeout(render, 300));
  file.onchange = async () => {
    const f = file.files[0];
    if (f) (abiText.value = await f.text()), render();
  };
  render();
  return h(
    'div.form.wide',
    h('p.mut', 'Call any contract from its ABI, or send raw calldata. Review each call, or add several to a batch. Nothing is fetched: the ABI is only used here to encode the call.'),
    h('label', 'Type'),
    mode,
    toLabel,
    to,
    out,
    abiBox,
    methods,
  );
}

function methodCard(s, contract, f, n) {
  const fields = f.inputs.map((p) => paramField(s, contract, f, p));
  const value = f.payable && h('input', { placeholder: '0', inputmode: 'decimal' });
  const out = h('div'), preview = h('div');
  const read = async () => {
    st.named = {};
    const vals = [];
    for (const x of fields) vals.push(await x.read());
    const data = encodeCall(f, vals);
    st.notes[strip(data)] = {
      sig: f.name + '(' + f.inputs.map((p) => canonical(p) + ' ' + p.name).join(', ') + ')',
      args: f.inputs.map((p, i) => [p.name, show(p, vals[i])]),
    };
    put(preview, h('div.mut', 'Calldata · ' + (data.length - 2) / 2 + ' bytes ', copy(data, 'Copy calldata')), h('code.mono', data));
    return { to: contract, value: value ? parse(value.value || '0', 18) : 0n, data };
  };
  return h(
    'details.method',
    h('summary', n + '. ' + f.name, f.payable && chip('payable')),
    h('div.mut.sig', f.sig),
    fields.map((x) => x.el),
    value && [h('label', 'Value (' + chain().sym + ')'), value],
    h(
      'div.actions',
      chain().canBatch && button('Add to batch', async () => queue(await read()), out, '.primary'),
      button('Review', async () => showReview(newTx(s, await read())), out, chain().canBatch ? '' : '.primary'),
      button('Show calldata', read, out),
    ),
    out,
    preview,
  );
}

const show = (p, v) => (Array.isArray(v) ? JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)) : typeof v === 'bigint' ? v.toString() : String(v));

/** One parameter input with helpers by type. Returns { el, read() → parsed value }. */
function paramField(s, contract, f, p) {
  const type = p.type, head = h('label', p.name, ' ', h('span.mut', type));
  const input = /\[|tuple/.test(type) ? h('textarea', { rows: 2, spellcheck: 'false', placeholder: shape(p) }) : h('input', { spellcheck: 'false', placeholder: hint(type) });
  const help = h('div.helpers'), note = h('div.mut.small');
  let read = async () => parseValue(p, input.value);

  if (type === 'address') {
    read = async () => parseValue(p, await target(input.value));
  } else if (/^u?int\d*$/.test(type)) {
    // Etherscan-style "add zeros": type a decimal amount and pick the unit.
    const tok = tokenOf(contract);
    const unit = h('select.unit', [['0', '× 1 (raw)'], ['6', '× 10^6'], ['8', '× 10^8'], ['9', '× 10^9 (gwei)'], ['18', '× 10^18 (ether)']].map(([v, t]) => h('option', { value: v }, t)), h('option', { value: 'c' }, 'custom…'));
    const custom = h('input.dec', { placeholder: 'decimals', inputmode: 'numeric', hidden: true });
    if (tok && /amount|value|wad|qty/i.test(p.name)) {
      if (![...unit.options].some((o) => o.value === String(tok.decimals))) unit.prepend(h('option', { value: String(tok.decimals) }, '× 10^' + tok.decimals + ' (' + tok.symbol + ')'));
      unit.value = String(tok.decimals);
    }
    const dec = () => (unit.value === 'c' ? Number(custom.value || 0) : Number(unit.value));
    read = async () => {
      const v = input.value.trim();
      return parseValue(p, dec() && !/^0x/i.test(v) ? parse(v, dec()).toString() : v);
    };
    const upd = () => {
      custom.hidden = unit.value !== 'c';
      input.placeholder = dec() ? '0.0 (decimal amount)' : type;
      read().then((v) => put(note, dec() ? '= ' + v + ' (raw)' : ''), () => put(note));
    };
    input.oninput = unit.onchange = custom.oninput = upd;
    input.placeholder = dec() ? '0.0 (decimal amount)' : type;
    const row = h('div.row', input, unit, custom);
    if (type.startsWith('uint')) help.append(h('button.link', { onclick: () => ((unit.value = '0'), (input.value = String((1n << BigInt(/\d+/.exec(type) ? /\d+/.exec(type)[0] : 256)) - 1n)), upd()) }, 'max'));
    return { el: h('div.param', head, row, help, note), read };
  } else if (type === 'bool') {
    const sel = h('select', h('option', 'false'), h('option', 'true'));
    return { el: h('div.param', head, sel), read: async () => sel.value === 'true' };
  } else if (/^bytes\d*$/.test(type)) {
    const n = /\d+/.exec(type);
    const text = () => input.value;
    if (type === 'bytes32') help.append(h('button.link', { onclick: () => ((input.value = keccakText(text())), put(note, 'keccak256 of the text')) }, 'keccak256(text)'));
    help.append(
      h('button.link', { onclick: () => {
        const b = strip(hex(utf8(text())));
        if (n && b.length / 2 > Number(n[0])) return put(note, 'Text is longer than ' + n[0] + ' bytes.');
        input.value = '0x' + (n ? b.padEnd(Number(n[0]) * 2, '0') : b);
        put(note, 'UTF-8 text as hex');
      } }, 'text → hex'),
    );
  }
  return { el: h('div.param', head, input, help, note), read };
}
const hint = (t) => (t === 'address' ? '0x… or name.eth / name.wei' : t === 'string' ? 'text' : /^bytes\d+$/.test(t) ? '0x… (' + /\d+/.exec(t)[0] + ' bytes)' : t === 'bytes' ? '0x…' : t);
function shape(p) {
  const ex = (q) => {
    const m = /^(.*)\[(\d*)\]$/.exec(q.type);
    if (m) return '[' + ex({ ...q, type: m[1] }) + (m[2] === '' ? ', …' : '') + ']';
    if (q.type === 'tuple') return '[' + q.components.map(ex).join(', ') + ']';
    return q.type === 'address' ? '"0x…"' : q.type === 'bool' ? 'true' : /int/.test(q.type) ? '"1"' : '"…"';
  };
  return 'JSON, e.g. ' + ex(p);
}

/** Raw call: value, calldata, operation, nonce. The destination is the builder's "To" field. */
function rawBuilder(s, to) {
  const sym = chain().sym;
  const value = h('input', { placeholder: '0', inputmode: 'decimal' });
  const data = h('textarea', { placeholder: '0x (calldata, optional)', spellcheck: 'false' });
  const op = h('select', h('option', { value: 0 }, 'CALL'), h('option', { value: 1 }, 'DELEGATECALL (dangerous)'));
  const nonce = h('input', { value: String(s.nonce) });
  const out = h('div');
  const read = async () => {
    st.named = {};
    if (!to.value.trim()) throw Error('Enter the destination in "To" above.');
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
    'div',
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
      rv.append(h('p.ok', msg + ' ', addr(rc.transactionHash)));
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
        s.owners.map((o) => h('li', addr(o), ' ', approved.includes(o) ? h('b.ok', '✓ approved onchain') : signed.includes(o) ? h('b.ok', '✓ signed offchain') : h('span.mut', '· not approved'), o === me && ' (you)')),
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
      d.label.startsWith('ERC-20') && ['token', tok ? tokenLabel(tok) : [addr(t.to), ' ', h('b.bad', '(unknown token: amount shown in raw units)')]],
      ...d.args.map((x) => [x.name, x.type === 'address' ? named(x.value) : x.name === 'amount' ? amount(x.value, tok) + (tok && x.value !== MAXU ? ' (' + x.value + ' raw)' : '') : String(x.value)]),
    ]),
  ];
}

function batchView(r) {
  return [
    h('b', 'Batch of ' + r.inner.length + ' calls'),
    ' via MultiSendCallOnly ',
    addr(r.tx.to),
    r.inner.map((c, i) =>
      h(
        'div.card',
        h('b', 'Call ' + (i + 1)),
        kv([
          ['To', named(c.to)],
          ['Value', fmt(c.value) + ' ' + chain().sym],
          ['Action', c.decoded ? actionView(c.decoded, c) : c.data !== '0x' ? noteView(c.data) || 'Unknown calldata' : c.value ? 'Native transfer' : 'Empty call'],
          c.data !== '0x' && ['Data', [h('code', c.data), copy(c.data, 'Copy calldata')]],
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
      ['Safe', addr(t.safe)],
      ['Chain', (c.name || 'unknown') + ' · chainId ' + t.chainId],
      ['Nonce', String(t.nonce)],
      ['To', st.named[t.to] ? named(t.to) : [addr(t.to), rev(t.to)]],
      ['Value', fmt(t.value) + ' ' + (c.sym || '') + ' (' + t.value + ' wei)'],
      ['Operation', t.operation ? (r.batch ? 'DELEGATECALL into MultiSendCallOnly (batch)' : h('b.bad', 'DELEGATECALL')) : 'CALL'],
      ['Action', r.batch ? batchView(r) : r.decoded ? actionView(r.decoded, t) : len ? noteView(t.data) || 'Unknown calldata (not decoded; check the raw data)' : t.value ? 'Native transfer' : 'Empty call'],
      ['Data', len ? [h('div', 'selector ', h('code', t.data.slice(0, 10)), ' · ' + len + ' bytes ', copy(t.data, 'Copy calldata')), h('code.mono', t.data)] : 'none'],
      ['Gas fields', 'safeTxGas ' + t.safeTxGas + ' · baseGas ' + t.baseGas + ' · gasPrice ' + t.gasPrice + ' · gasToken ' + t.gasToken + ' · refundReceiver ' + t.refundReceiver],
      ['SafeTx hash', h('b', addr(r.local))],
      ['Onchain hash', r.chain ? [addr(r.chain), ' ', r.chain === r.local ? h('b.ok', '✓ verified') : h('b.bad', '✗ MISMATCH')] : h('b.bad', 'unavailable')],
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
    if (path === '/new') return put(main, chain() && chain().canCreate ? createView() : bad(chain() ? 'Safe’s contracts are not deployed on ' + chain().name + '.' : 'Connect a wallet first.'));
    if (path.startsWith('tx=')) (p = importPayload(path)), (m = [0, p.tx.safe, 'review']);
    if (!m) return put(main, home()), renderBatch();
    if (!chain()) throw Error('Connect a wallet to open a Safe.');
    const ref = decodeURIComponent(m[1]), tab = m[2] || 'assets', q = new URLSearchParams(m[3] || '');
    const address = isAddr(ref) ? ref.toLowerCase() : await target(ref);
    if (!st.safe || st.safe.address !== address || st.stale) {
      if (!st.safe || st.safe.address !== address) put(main, h('p.mut', 'Loading ' + ref + '…'));
      const s = await readSafe(address);
      if (n !== seq) return;
      if (!st.safe || st.safe.address !== s.address) (st.refName = isAddr(ref) ? null : ref), (st.safeName = (recent.find(s.chainId, s.address) || {}).label || st.refName);
      recent.touch(s.chainId, s.address, isAddr(ref) ? null : ref);
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
    const tabs = { assets: assetsTab, send: sendTab, batch: sendTab, transactions: transactionsTab, custom: builder, settings: settingsTab, setup: settingsTab };
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
