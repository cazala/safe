// safe.wei — app shell, routing and views.
import { cd, fmt, fmtShort, hex, isAddr, isHex, keccakText, parse, strip, utf8, ZERO } from './abi.js';
import { chainInfo, gatewayOf, HANDLERS, label } from './chains.js';
import { approve, checkSigs, collect, execute, sign } from './flow.js';
import { review, signMessageOf } from './review.js';
import * as rpc from './rpc.js';
import { create, createCall, modules, newTx, predict, readSafe, safeTxHash, SENTINEL } from './safe.js';
import { compact, fragment, importMessage, importPayload, messageFragment, toJSON } from './share.js';
import { payloadGas, scan } from './pending.js';
import { decode } from './decode.js';
import { balances, listed, meta, save, saved } from './tokens.js';
import { S } from './sel.js';
import { checkName, isName, nameOf, resolveName } from './names.js';
import { batch, unpack } from './multisend.js';
import { parseCSV } from './csv.js';
import { encodeCall, humanSig, matchCall, parseAbi, parseValue } from './abicoder.js';
import { $, act, addr, bad, copy, h, icon, iconButton, ICONS, kv, labelDialog, put, setName, setResolver, toClipboard, sheet, short, warn } from './ui.js';
import { mountSafes } from './homeview.js';
import * as labels from './labels.js';
import * as backup from './backup.js';
import * as recent from './recent.js';
import { discover, get, list, remember, remembered } from './wallets.js';
import { identify } from './zodiac.js';
import { checkMessage, combine, isValid, KINDS, onchainSignCall, signMessage } from './message.js';

const st = { account: null, chainId: null, safe: null, tokens: {}, named: {}, batch: [], batchNames: {} };
let framed = false;
try {
  framed = window.top !== window.self;
} catch {
  framed = true; // a cross-origin parent: framed
}

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
// An address with the name it was typed as (st.named); labels still win (see addr()).
const named = (x, m = st.named) => (m[x] && setName(x, m[x]), addr(x));
/** Look up a reverse name for an address; rendered occurrences switch to it when found. */
const rev = (x) => (nameOf(x, st.chainId).then((n) => n && setName(x, n), () => {}), null);
const main = $('main');
const chain = () => st.chain;

// ---- wallet ----
let wallet = null; // { key, name, provider } in use, or null

async function refreshWallet() {
  if (!wallet) {
    st.chainId = st.account = st.chain = null;
    put($('connect'), list().length ? 'Connect' : 'No wallet');
    $('connect').classList.toggle('nowallet', !list().length);
    $('connect').title = list().length ? '' : 'No wallet found in this browser';
    return;
  }
  $('connect').classList.remove('nowallet');
  $('connect').title = '';
  [st.chainId, [st.account = null] = []] = await Promise.all([rpc.chainId(), rpc.accounts()]);
  if (!st.chain || st.chain.id !== st.chainId) st.chain = await chainInfo(st.chainId);
  // The connected chain lives on the account button, subtly, and in its menu.
  put($('connect'), st.account ? [h('span.net', { title: st.chain.name + ' · chain ' + st.chainId }, st.chain.name), short(st.account)] : 'Connect');
}

// Any wallet change invalidates everything loaded so far (spec §15).
const reset = () => ((st.safe = null), refreshWallet().then(route).then(footer, footer));

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

// ---- gates: what an action needs (a wallet, a connection, a chain), shown instead of an error ----
// `st.intent` marks that the user just asked to open something, so a single wallet is connected,
// or the chain switched, right away; a link opened on its own waits for a click.
class Gate extends Error {
  constructor(view) {
    super('gate');
    this.view = view;
  }
}
const chainName = (id) => label(id).name;

function gateCard(title, text, ...rest) {
  return h('div.home.gate', h('div.panel.gatecard', h('span.mark', icon(...ICONS.shield)), h('h2', title), text && h('p.mut', text), ...rest), !framed && h('p.gateback', h('a.back', { href: '#/' }, icon('m15 6-6 6 6 6'), 'Home')));
}

function noWalletView() {
  const b = h('button', 'Copy link to this page');
  b.onclick = () => toClipboard(location.href).then(() => (put(b, '✓ Link copied'), setTimeout(() => put(b, 'Copy link to this page'), 1500)), () => {});
  return gateCard(
    'safe.wei needs a wallet',
    'It reads your Safe and signs through your wallet, with no servers in between. No wallet was found in this browser.',
    h('ul.gatesteps', h('li', h('b', 'On a computer: '), 'install a browser wallet extension, then reload this page.'), h('li', h('b', 'On a phone: '), 'open this page in your wallet app’s built-in browser.')),
    h('div.actions', b),
  );
}

/** Connect a wallet to continue; with one wallet and a fresh click, it asks right away. */
function connectView(what) {
  const ws = list(), out = h('div');
  const go = (w, b) => act(b, () => connectTo(w), out)();
  const buttons = ws.map((w, i) => {
    const b = h('button' + (i ? '' : '.primary'), 'Connect ' + w.name);
    b.onclick = () => go(w, b);
    return b;
  });
  if (st.intent && ws.length === 1) setTimeout(() => buttons[0].click());
  st.intent = false;
  return gateCard('Connect a wallet to ' + what, 'safe.wei reads the Safe through your wallet. Nothing is sent anywhere else.', h('div.actions.gatebtns', buttons), out);
}

async function switchChain(id) {
  try {
    await rpc.rpc('wallet_switchEthereumChain', [{ chainId: '0x' + id.toString(16) }]);
  } catch (e) {
    throw Error(e && e.code === 4902 ? 'Your wallet does not know ' + chainName(id) + '. Add it to your wallet first.' : e.code === 4001 ? 'Switch cancelled.' : 'Your wallet could not switch to ' + chainName(id) + '. Switch it from the wallet.');
  }
}
/** The Safe is on another chain: offer (or, right after a click, request) the switch. */
function switchView(id, title, text, extra) {
  const out = h('div'), b = h('button.primary', 'Switch to ' + chainName(id));
  b.onclick = act(b, () => switchChain(id), out);
  if (st.intent) setTimeout(() => b.click());
  st.intent = false;
  return gateCard(title, text, h('div.actions.gatebtns', b), out, extra);
}

/** Resolve what a Safe URL points at, or throw a Gate saying what is needed first. */
async function openTarget(ref, wantChain) {
  const lower = ref.toLowerCase();
  const saved = recent.safes().filter((e) => e.address === lower || e.ref === ref);
  // Call it what the user calls it: its saved name, a label, the name it was opened by, else a short address.
  const what = (saved.find((e) => e.label) || {}).label || (isAddr(ref) ? labels.get(lower) || 'Safe ' + short(ref) : ref);
  if (!list().length) throw new Gate(noWalletView());
  if (!chain()) throw new Gate(connectView('open ' + what));
  // A transaction link says its chain; a saved Safe known only on another chain says it too.
  const want = wantChain || (saved.length && !saved.some((e) => e.chainId === st.chainId) && st.skipChain !== lower ? saved[0].chainId : null);
  if (want && want !== st.chainId)
    throw new Gate(switchView(want, what + ' is on ' + chainName(want), 'Your wallet is on ' + chain().name + '.', !wantChain && isAddr(ref) && h('p.gatealt', h('button.link', { onclick: () => ((st.skipChain = lower), route()) }, 'Open it on ' + chain().name + ' anyway'))));
  if (isAddr(ref)) return lower;
  if (st.chainId === 1) return target(ref);
  // Names resolve on Ethereum only. A Safe saved on this chain under this name opens by its saved address.
  const here = saved.find((e) => e.chainId === st.chainId && e.ref === ref);
  if (here) return here.address;
  throw new Gate(switchView(1, ref + ' is a name on Ethereum', 'ENS and .wei names resolve on Ethereum, and your wallet is on ' + chain().name + '. Switch to Ethereum, or open the Safe by its 0x address.'));
}

// ---- header breadcrumb: safe.wei / <Safe> ▾, with a switcher to your other saved Safes ----
function setCrumb(s) {
  const el = $('crumb');
  if (!s) return put(el);
  const here = recent.keyOf({ chainId: s.chainId, address: s.address });
  const m = h('div.hmenu.crumbmenu', { hidden: true });
  const nameOfEntry = (e) => e.label || e.ref || labels.get(e.address) || 'Safe ' + short(e.address);
  const items = recent.sorted().map((e) =>
    h(
      'a' + (recent.keyOf(e) === here ? '.on' : ''),
      { href: '#/' + (e.ref || e.address), onclick: () => ((m.hidden = true), (st.intent = true)) },
      h('span.cname', nameOfEntry(e)),
      h('span.grow'),
      e.chainId !== st.chainId && h('span.chip', label(e.chainId).name),
      nameOfEntry(e) !== 'Safe ' + short(e.address) && h('code', short(e.address)),
    ),
  );
  put(m, items, h('a.all', { href: '#/', onclick: () => (m.hidden = true) }, 'All Safes'));
  const btn = h('button.crumbbtn', { 'aria-haspopup': 'menu', title: 'Switch Safe', onclick: () => (m.hidden = !m.hidden) }, h('span', st.safeName || 'Safe ' + short(s.address)), icon('m6 9 6 6 6-6'));
  put(el, h('span.slash', '/'), h('div.gearwrap.crumbwrap', btn, m));
}

// ---- views ----
function home() {
  const c = chain(), out = h('div');
  // Keep a name in the URL (readable, shareable); it is resolved again on every load.
  const openRef = async (v) => {
    v = v.trim();
    if (!isAddr(v)) checkName(v.toLowerCase());
    if (st.chainId === 1 && !isAddr(v)) await target(v); // catch typos right here
    st.intent = true;
    location.hash = '/' + v.toLowerCase();
  };
  const fail = (e) => put(out, bad(e.message));
  return recent.safes().length ? homeReturning(c, openRef, out, fail) : homeFirstRun(c, openRef, out);
}

/** First visit (nothing saved yet): what safe.wei is, and the two ways in. */
function homeFirstRun(c, openRef, out) {
  const input = h('input', { placeholder: 'Safe address 0x… or name.eth / name.wei', id: 'safeIn', spellcheck: 'false' });
  const open = button('Open', () => openRef(input.value), out, '.primary');
  input.onkeydown = (e) => {
    if (e.key === 'Enter') open.click(); // never return false here: that would cancel every keystroke
  };
  const create = !c || c.canCreate
    ? h('a.alt', { href: '#/new', onclick: () => (st.intent = true) }, h('span.mut', 'New to Safe?'), ' ', h('b', 'Create one'), icon(...ICONS.next))
    : h('p.alt.mut', 'Safe’s contracts are not deployed on ' + c.name + ', so new Safes can’t be created here.');
  const nl = Object.keys(labels.all()).length;
  return h(
    'div.home',
    h('div.hero', h('span.mark', icon(...ICONS.shield)), h('h1', 'safe.wei'), h('p', 'Your Safe, straight from the chain. No servers, everything stays in your browser.')),
    !list().length
      ? h('div.panel.nowallet', h('b', 'No wallet found'), h('p.mut', 'safe.wei reads and signs through your wallet, with no servers in between. On a computer, install a browser wallet extension and reload. On a phone, open this page in your wallet app’s browser.'))
      : h('div.panel', h('label', { for: 'safeIn' }, 'Open a Safe'), h('div.row', input, open), !c && h('p.fhint.connecthint', 'You’ll connect your wallet to open it. safe.wei reads the Safe through your wallet.'), out, create),
    h('p.importhint', h('span.mut', 'Moving from another device? '), h('button.link', { onclick: () => backupDialog() }, 'Import a backup'), nl > 0 && [h('span.mut', ' · '), h('button.link', { onclick: labelsSheet }, 'Labels (' + nl + ')')]),
  );
}

const SEARCH = ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-4-4'];

/** Returning (Safes saved): the page is your Safes, under one field that searches them or opens a new one. */
function homeReturning(c, openRef, out, fail) {
  const q = h('input.search', { placeholder: 'Search, or open 0x… / name.eth', id: 'safeIn', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search or open a Safe' });
  const openRow = h('div'), listRoot = h('div.saved');
  const v = mountSafes(listRoot, () => st.chainId);
  listRoot.addEventListener('click', (e) => e.target.closest('a.srow') && (st.intent = true));
  let hits = null;
  const update = () => {
    put(out);
    const s = q.value.trim(), lower = s.toLowerCase();
    hits = v.filter(s);
    const valid = isAddr(s) || isName(lower);
    const known = hits && hits.some((e) => e.address === lower || e.ref === lower);
    put(
      openRow,
      valid && !known
        ? h('div.slist.openlist', h('a.srow', { href: '#/' + lower, onclick: (e) => (e.preventDefault(), openRef(s).catch(fail)) }, h('span.mut', 'Open'), h('b.name', isAddr(s) ? short(lower) : lower), h('span.grow'), h('span.go', icon(...ICONS.next))))
        : hits && !hits.length && h('p.empty', 'No saved Safe matches. Paste a 0x address or a .eth / .wei name to open one.'),
    );
  };
  q.oninput = update;
  q.onkeydown = (e) => {
    if (e.key === 'Escape') (q.value = ''), update();
    if (e.key !== 'Enter') return; // never return false here: that would cancel every keystroke
    const first = openRow.querySelector('a.srow') || (hits && hits.length === 1 && listRoot.querySelector('a.srow'));
    if (first) first.click();
  };
  const note = !list().length
    ? 'No wallet found in this browser. Your Safes are listed, but opening one needs a wallet.'
    : !c && 'You’ll connect your wallet when you open a Safe.';
  return h(
    'div.home.returning',
    h(
      'div.hbar',
      h('label.sfield', icon(...SEARCH), q),
      moreMenu(!c || c.canCreate),
    ),
    note && h('p.hnote', note),
    out,
    openRow,
    listRoot,
  );
}

/**
 * "+ New" split button: the main action on the left, a caret on the right for the things you
 * manage now and then (Labels, Backup & sync). Without Safe contracts on this chain, just the menu.
 */
const CARET = ['m6 9 6 6 6-6'];
function moreMenu(canCreate) {
  const n = Object.keys(labels.all()).length;
  const m = h('div.hmenu', { hidden: true });
  const item = (ic, text, fn) => h('button', { onclick: () => ((m.hidden = true), fn()) }, icon(...ICONS[ic]), text);
  put(m, item('tag', n ? 'Labels (' + n + ')' : 'Labels', labelsSheet), item('gear', 'Backup & sync', () => backupDialog()));
  const caret = h('button.splitcaret', { title: 'More: labels, backup & sync', 'aria-label': 'More', 'aria-haspopup': 'menu', onclick: () => (m.hidden = !m.hidden) }, icon(...CARET));
  return h('div.gearwrap.split' + (canCreate ? '' : '.solo'), canCreate && h('a.splitmain', { href: '#/new', onclick: () => (st.intent = true), title: 'Create a new Safe' }, icon(...ICONS.plus), h('span', 'New')), caret, m);
}
// Menus (New ▾, the Safe switcher) close on any click outside them.
document.addEventListener('pointerdown', (e) => document.querySelectorAll('.hmenu').forEach((m) => !m.parentElement.contains(e.target) && (m.hidden = true)));

function labelsSheet() {
  const { body } = sheet('tag', 'Labels', true);
  body.append(labelsView());
}


/** Backup & sync: export as a link or JSON, or import by pasting one (with a preview before anything changes). */
function backupDialog(incoming) {
  const { body: d, close, setTitle } = sheet('gear', 'Backup & sync', true);
  const words = (c) => [c.safes + ' Safe' + (c.safes === 1 ? '' : 's'), c.labels + ' label' + (c.labels === 1 ? '' : 's'), c.abis + ' ABI' + (c.abis === 1 ? '' : 's'), c.tokens + ' token' + (c.tokens === 1 ? '' : 's')].join(' · ');
  const refresh = () => (close(), route());

  function exportView() {
    const data = backup.collect(), out = h('div');
    const done = (b, text) => (put(b, text), setTimeout(() => put(b, b.dataset.l), 1500));
    const btn = (text, fn, cls = '') => {
      const b = h('button' + cls, { 'data-l': text }, text);
      b.onclick = () => fn(b).catch((e) => put(out, h('p.bad', e.message)));
      return b;
    };
    const ta = h('textarea', { placeholder: 'Paste a safe.wei link or backup JSON', spellcheck: 'false', rows: 3 });
    const inErr = h('div');
    const next = async (text) => {
      try {
        preview(await backup.parse(text));
      } catch (e) {
        put(inErr, h('p.bad', e.message.startsWith('Unexpected') || e.message.includes('JSON') ? 'That does not look like a safe.wei backup.' : e.message));
      }
    };
    setTitle('Backup & sync');
    put(
      d,
      h('p.mut.small.lead', 'Move your saved Safes, folders, labels, ABIs and added tokens to another device. Nothing is uploaded: it all travels in the link or JSON.'),
      h('div.bsec', h('b', 'Export'), h('div.mut.small', words(backup.counts(data)))),
      h(
        'div.actions',
        btn('Copy link', async (b) => (await toClipboard(await backup.link(data)), done(b, '✓ Link copied')), '.primary'),
        btn('Copy JSON', async (b) => (await toClipboard(JSON.stringify(data, null, 2)), done(b, '✓ Copied'))),
      ),
      h('p.mut.small', 'Open the link on your other device, or import the JSON there.'),
      out,
      h('div.bsec', h('b', 'Import')),
      ta,
      h('div.dfoot', h('span.grow'), h('button.primary', { onclick: () => next(ta.value) }, 'Continue')),
      inErr,
    );
  }

  function preview(data) {
    const c = backup.counts(data), mine = labels.all();
    const mode = { v: 'merge' };
    const opt = (v, title, desc) =>
      h('label.opt', h('input', { type: 'radio', name: 'mode', value: v, checked: v === 'merge' ? '' : null, onchange: () => (mode.v = v) }), h('span', h('b', title), h('span.mut.small', desc)));
    const ls = Object.entries(data.labels);
    setTitle('Import backup');
    put(
      d,
      h('p', words(c), data.at && h('span.mut', ' · exported ' + new Date(data.at).toLocaleDateString())),
      ls.length > 0 && [
        warn('Labels are shown instead of addresses. Check that each one is right before importing, especially if this backup came from someone else.'),
        h('ul.importlabels', ls.map(([a, l]) => h('li', h('b', l), ' ', h('code', a), mine[a] && mine[a] !== l && h('span.mut', ' (yours stays: ' + mine[a] + ')')))),
      ],
      h('div.opts', opt('merge', 'Merge', 'Add what is missing. Nothing you already have is changed.'), opt('replace', 'Replace', 'Delete everything saved in this browser and use the backup instead.')),
      h(
        'div.dfoot',
        h('span.grow'),
        h('button', { onclick: () => (incoming ? close() : exportView()) }, incoming ? 'Cancel' : 'Back'),
        h('button.primary', { onclick: () => {
          if (mode.v === 'replace' && !confirm('Replace all Safes, labels and ABIs saved in this browser?')) return;
          backup.apply(data, mode.v);
          history.replaceState(null, '', '#');
          refresh();
        } }, 'Import'),
      ),
    );
  }

  if (incoming) backup.parse(incoming).then(preview, (e) => (exportView(), d.prepend(bad('That link could not be read: ' + e.message))));
  else exportView();
}

/** Home → Labels: every label in this browser, one line each, sorted by date or name; add / edit / remove. */
function labelsView() {
  const el = h('div.labels');
  const SORT = 'safe.wei:labelsort';
  let by = 'date';
  try {
    by = localStorage.getItem(SORT) === 'name' ? 'name' : 'date';
  } catch {}
  const draw = () => {
    const at = labels.dates();
    const l = Object.entries(labels.all()).sort(by === 'name' ? (a, b) => a[1].localeCompare(b[1]) : (a, b) => (at[b[0]] || 0) - (at[a[0]] || 0) || a[1].localeCompare(b[1]));
    const sort = h('select.lsort', { 'aria-label': 'Sort labels', onchange: () => {
      by = sort.value;
      try {
        localStorage.setItem(SORT, by);
      } catch {}
      draw();
    } }, h('option', { value: 'date' }, 'Newest first'), h('option', { value: 'name' }, 'Name (A–Z)'));
    sort.value = by;
    put(
      el,
      h('div.lhead', l.length > 1 && sort, h('span.grow'), h('button', { onclick: () => labelDialog() }, icon(...ICONS.plus), ' Add label')),
      l.length
        ? h('div.llist', l.map(([a, name]) => {
            const c = copy(a, 'Copy address');
            return h(
              'div.lrow',
              h('b.lname', { title: name }, name),
              h('code', { title: a, onclick: () => c.click() }, short(a)),
              c,
              h('span.grow'),
              iconButton('edit', 'Edit label', () => labelDialog(a)),
              iconButton('close', 'Remove label', () => {
                const when = at[a];
                labels.set(a, '');
                const undo = h('div.lrow.removed', h('span.mut', 'Removed ' + name + '.'), h('button.link', { onclick: () => labels.set(a, name, when) }, 'Undo'));
                setTimeout(() => undo.isConnected && undo.remove(), 6000);
                el.append(undo);
              }),
            );
          }))
        : h('p.empty', 'Name any address with its tag icon, or add one here.'),
    );
  };
  addEventListener('labels', () => el.isConnected && draw());
  draw();
  return el;
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
        h('div.panel.summary.fulladdr',
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
        ),
      );
      plan.scrollIntoView({ block: 'start' });
    },
    out,
  );
  // "N of M owners", kept in sync with the owners list.
  const ofN = h('span.mut');
  const count = () => {
    const n = owners.value.split(/[\s,]+/).filter(Boolean).length;
    ofN.textContent = 'of ' + n + (n === 1 ? ' owner' : ' owners') + ' must approve each transaction';
  };
  owners.addEventListener('input', count);
  count();
  return h(
    'div.home.newsafe',
    h('a.homeback', { href: '#/' }, icon('m15 6-6 6 6 6'), 'Home'),
    h('div.hero', h('span.mark', icon(...ICONS.shield)), h('h1', 'Create a Safe'), h('p', 'A shared account on ' + c.name + ' that moves funds only with enough owner approvals.')),
    h(
      'div.panel',
      h('label', 'Owners'),
      h('p.fhint', 'One per line: a 0x address or a name.eth / name.wei. Your wallet is filled in.'),
      owners,
      h('label', 'Threshold'),
      h('div.thresh', threshold, ofN),
      h('details', h('summary', 'Advanced'), h('label', 'Salt nonce (the address depends on it)'), salt),
      h('div.actions', btn),
      out,
    ),
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

/** `back`: [href, text] for the single back link; defaults to Home. */
function safeHeader(s, back) {
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
      setCrumb(s);
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
    back && h('a.back', { href: back[0] }, icon('m15 6-6 6 6 6'), back[1]),
    row,
    // One quiet line: the chain is the wallet's, the balance is in Assets, the version is in Settings
    // (and warned about below when it matters). Not being an owner is said where it changes what you can do.
    h(
      'div.sub.hmeta',
      addr(s.address, null, short(s.address), true),
      h('span.dot', '·'),
      h('span', s.threshold + ' of ' + s.owners.length + ' owners'),
      me && [h('span.dot', '·'), h('span.ok', 'You’re an owner')],
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
  setCrumb(s);
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
const tokenLabel = (t) => [h('b', t.symbol), ' ', addr(t.address), ' ', h('span.mut', t.listed ? '(zOrg TokenList)' : saved(st.chainId).some((x) => x.address === t.address) ? '(added by you)' : '(not in the TokenList)')];

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
const prefilled = () => warn('Prefilled from a link. Check every recipient, amount and token before reviewing.');

function assetsTab(s) {
  const c = chain(), rows = h('div', h('p.mut', 'Loading balances…')), pend = h('div');
  // Actions show on row hover (always on touch). Nothing to send: no Send.
  // Actions sit next to the asset and show on row hover (always on touch), so balances stay flush right.
  const acts = (bal, href, extra) => h('span.racts', extra, bal > 0n ? h('a.btn', { href }, 'Send') : h('span.btn.off', { title: 'Nothing to send' }, 'Send'));
  const asset = (name, sub, actions) => h('td', h('div.arow', h('div', name, sub), h('span.grow'), actions));
  const removeBtn = (t) =>
    !t.listed && h('button.ib', { title: 'Remove from your token list', 'aria-label': 'Remove ' + t.symbol, onclick: () => (save(st.chainId, saved(st.chainId).filter((x) => x.address !== t.address)), delete st.tokens[t.address], draw()) }, icon(...ICONS.close));
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
  const addBox = h('div.addtoken', { hidden: true }, h('p.mut', 'Added tokens are saved in this browser for every Safe on ' + c.name + '.'), h('div.row', addIn, add), addOut);
  const draw = () =>
    put(
      rows,
      h(
        'table.assets',
        h('tr', h('th', 'Asset'), h('th.num', 'Balance')),
        h('tr', asset(h('b', c.sym), h('div.mut', c.sym === 'ETH' ? 'Ether' : 'Native token'), acts(s.balance, link('send'))), h('td.num', { title: fmt(s.balance) + ' ' + c.sym }, amt2(s.balance, 18))),
        held().map((t) =>
          h(
            'tr',
            asset(h('b', t.symbol), h('div.mut', addr(t.address)), acts(st.bal[t.address] || 0n, link('send', { token: tokenSpec(t) }), removeBtn(t))),
            h(
              'td.num',
              { title: st.bal[t.address] == null ? null : fmt(st.bal[t.address], t.decimals) + ' ' + t.symbol },
              st.bal[t.address] == null ? h('span.mut', 'unreadable') : amt2(st.bal[t.address], t.decimals),
            ),
          ),
        ),
      ),
      h(
        'div.afoot',
        h('span.mut', c.mainnet ? Object.values(st.tokens).filter((t) => t.listed).length + ' TokenList tokens checked · zero balances hidden' : 'The zOrg TokenList is on Ethereum; add tokens on ' + c.name + ' by address.'),
        h('span.grow'),
        h('button.link.addlink', { onclick: () => ((addBox.hidden = !addBox.hidden), addBox.hidden || addIn.focus()) }, icon(...ICONS.plus), 'Add token'),
      ),
    );
  loadBalances(s).then(draw, (e) => put(rows, warn('Could not read token balances: ' + e.message)));
  loadPending(s).then((r) => r.found.length && put(pend, h('a.callout', { href: link('transactions') }, h('b', r.found.length + ' pending transaction' + (r.found.length > 1 ? 's' : '')), ' published onchain · Review ›')), () => {});
  return [pend, rows, addBox];
}

/** Balance with two decimals when it has any fraction, so a column compares at a glance (exact on hover). */
function amt2(v, dec) {
  const t = fmtShort(v, dec);
  if (!dec || t.startsWith('<') || t === '0') return t;
  const [i, f = ''] = t.split('.');
  return i + '.' + f.padEnd(2, '0');
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
      addHints(p.abi);
      const d = decode(p.tx), c = chain(), hm = !d && hintOf(p.tx.data);
      list.append(
        h(
          'div.card.txrow',
          h('div', h('b', 'Nonce ' + p.tx.nonce), p.tx.nonce > s.nonce ? chip('queued') : chip('next', '.ok')),
          h('div', d ? d.label : hm ? hm.f.name : p.tx.data === '0x' ? fmt(p.tx.value) + ' ' + c.sym + ' transfer' : 'Contract call', ' → ', addr(p.tx.to, null, short(p.tx.to))),
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
      h('a.callout', { href: '#' + fragment(st.review.tx, st.sigs, hintsFor(st.review.tx)) }, h('b', 'In progress: '), 'nonce ' + st.review.tx.nonce + ' · ' + short(st.review.local) + ' · Continue ›'),
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
  // The fallback handler, with a shortcut to Safe's canonical one when it is missing or unknown.
  const fallbackView = () => {
    const known = s.fallback && HANDLERS[s.fallback], want = chain().libFor(s.version, 'handler'), fbOut = h('div');
    const fix = want && !known && h('div.actions', button((s.fallback ? 'Replace with' : 'Set') + ' Safe’s CompatibilityFallbackHandler ' + HANDLERS[want], async () => showReview(newTx(s, self(cd(S.setFallbackHandler, want)))), fbOut));
    if (!s.fallback) return [warn('No fallback handler: this Safe cannot sign messages (EIP-1271), and contracts that send tokens with safe-transfer callbacks (ERC-721, ERC-1155) may refuse it.'), fix, fbOut];
    return [
      addr(s.fallback),
      h('div.mut', known ? 'Safe’s CompatibilityFallbackHandler ' + known + '. It handles calls the Safe itself does not implement, such as EIP-1271 signature checks and token callbacks.' : 'Not a fallback handler safe.wei recognizes. It receives every call the Safe does not implement and affects signature validation.'),
      fix,
      fbOut,
    ];
  };
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
      ['Fallback handler', fallbackView()],
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
    h('ol.calls', st.batch.map((x, i) => h('li', h('div.crow', h('span.call', callLabel(x)), h('button.link', { onclick: () => (st.batch.splice(i, 1), renderBatch(true)) }, 'remove'))))),
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
// Compact amount for one-line summaries (up to 6 decimals); the exact amount is on hover.
const brief = (v, dec, sym) => (v === MAXU ? 'unlimited ' + sym : h('span', { title: fmt(v, dec) + ' ' + sym }, fmtShort(v, dec, 6) + ' ' + sym));
const callLabel = (x, names = st.batchNames) => {
  const sm = signMessageOf(x);
  if (sm) return ['Sign a message onchain · ', h('code', short(sm))];
  const d = decode({ ...x, safe: st.safe.address }), tok = d && d.label.startsWith('ERC-20') && tokenOf(x.to);
  // Safe settings: "Change threshold · threshold 3", "Add owner · owner vitalik.eth → 0x…, threshold 2"
  if (d && x.to === st.safe.address)
    return [d.label, ' · ', d.args.map((a, i) => [i ? ', ' : '', a.name + ' ', a.type === 'address' ? named(a.value, names) : String(a.value)])];
  const m = !d && hintOf(x.data);
  if (m) return [h('b', m.f.name), ' on ', named(x.to, names), x.value ? ' · ' + fmt(x.value) + ' ' + chain().sym : ''];
  return d
    ? [d.label, tok ? [' ', brief(d.args.at(-1).value, tok.decimals, tok.symbol)] : '', ' → ', named((d.args.find((a) => a.name === 'to' || a.name === 'spender') || d.args[0]).value, names), tok ? '' : [' on ', named(x.to, names)]]
    : [brief(x.value || 0n, 18, chain().sym), ' → ', named(x.to, names), x.data && x.data !== '0x' ? ' with ' + (x.data.length - 2) / 2 + ' bytes of calldata' : ''];
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
// ---- call signatures: names for calls safe.wei cannot decode on its own ----
// They come from the ABI used in Custom, or with a #tx= link. A call is shown decoded only if its
// values re-encode to exactly its calldata (abicoder.js → matchCall): the names are someone's
// claim, the values are the truth. They travel on in share links, JSON and onchain publications.
st.hints = [];
const addHints = (list) => (st.hints = [...new Set([...st.hints, ...(list || [])])]);
const hintOf = (data) => matchCall(st.hints, data);
/** The call signatures a transaction actually uses (its call, or each call of a batch). */
const hintsFor = (t) => [...new Set((unpack(t) || [t]).map((c) => hintOf(c.data)).filter(Boolean).map((m) => m.signature))];

/** A decoded value, the way the review shows it: addresses by name, nested lists for arrays and tuples. */
function valueView(p, v) {
  const m = /^(.*)\[(\d*)\]$/.exec(p.type);
  if (m) return v.length ? h('ol.vlist', v.map((x) => h('li', valueView({ ...p, type: m[1] }, x)))) : h('span.mut', 'empty');
  if (p.type === 'tuple') return kv(p.components.map((c, i) => [c.name || String(i), valueView(c, v[i])]));
  if (p.type === 'address') return named(v);
  if (p.type === 'string') return JSON.stringify(v);
  if (p.type === 'bytes' || /^bytes\d+$/.test(p.type)) return v === '0x' ? h('span.mut', 'empty') : [h('code', v), strip(v).length > 64 && copy(v, 'Copy')];
  return String(v);
}
const noteView = (data) => {
  const m = hintOf(data);
  return (
    m && [
      h('b', m.f.name),
      h('p.hintnote', 'Decoded with a function signature that came with this transaction. The values are checked against the calldata; the names come from whoever built it.'),
      kv(m.f.inputs.map((p, i) => [p.name, valueView(p, m.values[i])])),
    ]
  );
};

function builder(s) {
  const mode = h('select', h('option', { value: 'abi' }, 'Custom ABI'), h('option', { value: 'raw' }, 'Raw calldata'), h('option', { value: 'msg' }, 'Message (signed by the Safe)'));
  const to = h('input', { spellcheck: 'false' });
  const abiText = h('textarea', { placeholder: '[{"type":"function","name":"stake","inputs":[…]}]  (a Hardhat/Foundry artifact, or one function signature per line, also works)', spellcheck: 'false', rows: 5 });
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  const abiBox = h('div', h('label', 'Paste JSON ABI'), abiText, h('label', 'Or upload a .json file'), file);
  const methods = h('div'), out = h('div'), toLabel = h('label');
  let contract = null;

  const render = async () => {
    const raw = mode.value === 'raw', msg = mode.value === 'msg';
    toLabel.hidden = to.hidden = msg;
    if (msg) return (abiBox.hidden = true), put(methods, messageBuilder(s));
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
    addHints([humanSig(f)]);
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
  const ta = h('textarea', { placeholder: 'Paste a safe.wei link (transaction or message), a tx= fragment, or transaction JSON from another owner', spellcheck: 'false' });
  const out = h('div');
  const btn = button(
    'Import',
    async () => {
      const pm = importMessage(ta.value);
      if (pm) {
        // Same message as the one on screen: merge its signatures; otherwise open it.
        const cur = st.message;
        if (cur && cur.m.safe === pm.msg.safe && cur.m.kind === pm.msg.kind && cur.m.content === pm.msg.content) return showMessage(cur.m, [...st.msgSigs, ...pm.sigs], 'replace');
        return (location.hash = messageFragment(pm.msg, pm.sigs));
      }
      const p = importPayload(ta.value);
      st.named = {};
      addHints(p.abi);
      if (p.tx.safe !== st.safe.address || p.tx.chainId !== st.chainId) return (location.hash = fragment(p.tx, p.sigs, p.abi));
      // Same transaction as the one under review: merge the imported signatures into it.
      const same = st.review && st.review.local === safeTxHash(p.tx);
      await showReview(p.tx, same ? [...st.sigs, ...p.sigs] : p.sigs);
    },
    out,
  );
  return h('div.form', ta, h('div.actions', btn), out);
}

// ---- review screen ----
const rv = h('div.fulladdr'); // what gets signed: addresses in full
/** Review a transaction on its own screen. `nav`: 'push' (from a form), 'replace' (refresh), 'none' (from the URL). */
async function showReview(tx, sigs = [], nav = 'push') {
  // One back link: to the screen that opened this review, else the Transactions tab.
  if (nav === 'push') st.backTo = location.hash && !location.hash.startsWith('#tx=') ? location.hash : null;
  else if (nav === 'none') st.backTo = null;
  put(main, safeHeader(st.safe, [st.backTo || link('transactions'), 'Back']), rv);
  setCrumb(st.safe);
  put(rv, h('p.mut', 'Checking the transaction…'));
  const r = await review(tx, st.safe, st.chainId);
  const c = await checkSigs(st.safe, r.local, sigs);
  st.review = r;
  st.off = c.valid;
  st.sigs = c.valid.map((x) => x.sig); // only valid signatures are kept and re-shared
  st.rejected = c.rejected;
  // The URL carries the transaction, so reloading or sharing the address bar returns here.
  const h2 = '#' + fragment(tx, st.sigs, hintsFor(tx));
  if (nav === 'push') history.pushState(null, '', h2);
  else if (nav === 'replace') history.replaceState(null, '', h2);
  put(rv, reviewHead(r), r.ok ? nextStep(r) : h('div.step.blocked', h('h3', 'Nothing can be approved or executed'), h('p', 'Resolve the problems above first.')), detailsView(r));
  scrollTo(0, 0);
}

const button = (label, fn, out, cls = '') => {
  const b = h('button' + cls, label);
  b.onclick = act(b, fn, out);
  return b;
};

/** What the transaction does, in plain words, with anything risky right under it. */
/** An empty transaction from the Safe to itself: what replaces (cancels) another one at the same nonce. */
const isCancel = (t) => t.to === t.safe && t.data === '0x' && !t.value && !t.operation;

function reviewHead(r) {
  const t = r.tx;
  // Before anyone signs, the nonce can still change (to queue after another pending transaction).
  const nonce = h('span', ' · nonce ' + t.nonce);
  if (!st.sigs.length)
    nonce.append(
      ' ',
      h('button.link', {
        onclick: () => {
          const inp = h('input.nonce', { value: String(t.nonce), inputmode: 'numeric', 'aria-label': 'Nonce' });
          const apply = () => {
            const v = inp.value.trim();
            if (!/^\d+$/.test(v) || BigInt(v) < st.safe.nonce) return inp.classList.add('invalid');
            showReview({ ...t, nonce: BigInt(v) }, [], 'replace');
          };
          inp.onkeydown = (e) => {
            if (e.key === 'Enter') apply();
            if (e.key === 'Escape') showReview(t, st.sigs, 'replace');
          };
          put(nonce, ' · nonce ', inp, ' ', h('button.link', { onclick: apply }, 'apply'), h('span.mut', ' (the Safe is at ' + st.safe.nonce + ')'));
          inp.focus();
          inp.select();
        },
      }, 'change'),
    );
  return h(
    'section.rvhead',
    h('div.rvkicker', r.batch ? 'Batch of ' + r.inner.length + ' calls' : 'Transaction', nonce),
    r.batch ? h('ol.rvcalls', r.inner.map((c) => h('li', callLabel(c, st.named)))) : h('h2.rvtitle', isCancel(t) ? 'Replacement for nonce ' + t.nonce + ' (an empty transaction)' : r.signMessage ? 'Sign a message onchain' : callLabel(t, st.named)),
    isCancel(t) && h('p.mut', 'Executing this uses up nonce ' + t.nonce + ', so any other transaction with that nonce can no longer execute. The Safe sends nothing to itself.'),
    r.signMessage && [
      h('p.mut', 'Once this executes, the Safe accepts message ', h('code', short(r.signMessage)), ' with an empty signature (apps call isValidSignature with 0x). It runs Safe’s canonical SignMessageLib, whose only effect is recording that the Safe signed this message.'),
      st.message && st.message.c.hash === r.signMessage && h('p.rvhash', h('a', { href: '#' + messageFragment(st.message.m, st.msgSigs) }, 'Open the message ›')),
    ],
    r.danger.map((d) => h('p.bad.danger', d)),
    r.errors.map((e) => bad(e)),
    r.warnings.map((w) => warn(w)),
    r.chain === r.local && h('p.rvhash', h('b.ok', '✓'), ' Hash matches the Safe’s own ', h('code', short(r.local)), ' · see details below'),
  );
}

/**
 * The one thing to do next, for whoever is looking: an owner approves (sign for free, or onchain),
 * then shares; anyone else sends it to the owners; once enough have approved, anyone executes.
 */
function nextStep(r) {
  const box = h('div', h('p.mut', 'Loading approvals…'));
  const s = st.safe, t = r.tx, me = st.account && st.account.toLowerCase();
  (async () => {
    const { approved, sigs } = await collect(s, r.local, me, st.off);
    const signed = st.off.map((x) => x.signer);
    const owner = me && s.owners.includes(me), mine = approved.includes(me) || signed.includes(me);
    const got = new Set([...approved, ...signed].filter((x) => s.owners.includes(x))).size, thr = Number(s.threshold);
    const ready = BigInt(sigs.length) >= s.threshold, current = t.nonce === s.nonce;
    const out = h('div');
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
    const count = got + ' of ' + thr + ' approval' + (thr === 1 ? '' : 's');
    let step;
    if (!me) step = h('div.step', h('h3', 'Connect a wallet to approve or execute'), h('p', count + ' so far. Owners approve with their wallet; you can also send this link to them.'), txShare(r, false));
    else if (ready && current)
      step = h(
        'div.step.go',
        h('h3', owner && !mine ? 'Your approval completes it' : 'Ready to execute'),
        h('p', owner && !mine ? count + ' so far; executing adds yours. It submits the transaction onchain and costs gas. You can also just sign and let someone else execute.' : count + ' collected. Executing submits it onchain: it costs gas, and any wallet can do it.'),
        h(
          'div.actions',
          button(owner && !mine ? 'Approve and execute' : 'Execute', () => recheck().then(() => execute(t, me, st.sigs)).then(executed), out, '.primary'),
          owner && !mine && button('Sign only', async () => (await recheck(), showReview(t, [...st.sigs, await sign(t, me)], 'replace')), out),
        ),
        out,
      );
    else if (ready) step = h('div.step', h('h3', 'Approved · waiting for nonce ' + s.nonce), h('p', 'This transaction is queued: it can execute once nonce ' + s.nonce + ' has.'), txShare(r, false));
    else if (owner && !mine) {
      const payload = compact(t, [], hintsFor(t)), publish = h('input', { type: 'checkbox', checked: true });
      step = h(
        'div.step',
        h('h3', 'Your approval is needed'),
        h('p', count + ' so far. Choose how to approve:'),
        h(
          'div.opts2',
          h(
            'div.opt',
            h('div', h('b', 'Sign'), h('span.tag', 'free')),
            h('p', 'Your wallet signs the transaction hash. The signature is added to the link you share; nothing goes onchain.'),
            button('Sign', async () => (await recheck(), showReview(t, [...st.sigs, await sign(t, me)], 'replace')), out, '.primary'),
          ),
          h(
            'div.opt',
            h('div', h('b', 'Approve onchain'), h('span.tag', 'costs gas')),
            h('p', 'Recorded in the Safe. With the details published, the other owners find it in Transactions without a link.'),
            h('label.check', publish, ' Publish the details too (+' + (payload.length - 2) / 2 + ' bytes, ≈' + payloadGas(payload) + ' gas)'),
            button('Approve onchain', () => recheck().then(() => approve(t, me, publish.checked ? payload : '0x')).then(done('Approved.')), out),
          ),
        ),
        out,
        h('p.fhint', 'Your wallet will show the SafeTx hash ', h('code', r.local), '. It must match.'),
      );
    } else if (owner)
      step = h('div.step', h('h3', h('span.ok', '✓ '), 'You approved · ' + (thr - got) + ' more needed'), h('p', 'Send this link to the other owners. Each one opens it, checks it and approves with their wallet.'), txShare(r, true));
    else
      step = h(
        'div.step',
        h('h3', 'Send this to the owners'),
        h('p', 'This wallet isn’t an owner, so it can’t approve. Copy the link and send it to the owners: they open it, check it and approve with their wallet, no setup needed. Once ' + thr + ' ' + (thr === 1 ? 'has' : 'have') + ', any wallet, this one included, can execute it.'),
        txShare(r, true),
      );
    put(
      box,
      step,
      h(
        'section.rvapprovals',
        h('div.rvsec', h('h3', 'Approvals · ' + count), h('span.grow'), button('Refresh', () => showReview(t, st.sigs, 'replace'), out, '.link')),
        h('ul.owners.shortaddr', s.owners.map((o) => h('li', addr(o), approved.includes(o) ? h('b.ok', '✓ approved onchain') : signed.includes(o) ? h('b.ok', '✓ signed') : h('span.mut', 'waiting'), o === me && h('span.mut', '(you)')))),
        st.rejected.map((x) => warn('Ignored signature: ' + x.reason + '.')),
        !current && !ready && h('p.mut', 'Queued: it can execute once nonce ' + s.nonce + ' has.'),
        owner && !isCancel(t) && h('p.cancel', h('span.mut', 'Changed your mind after signing? '), h('button.link', { onclick: () => ((st.named = {}), showReview(newTx(s, { to: s.address, nonce: t.nonce }))) }, 'Cancel it with a replacement'), h('span.mut', ': an empty transaction with the same nonce, which the owners approve and execute instead.')),
      ),
    );
  })().catch((e) => box.replaceChildren(bad(e.message)));
  return box;
}

/** The share link (with the signatures collected so far), a copy button, and the less common extras. */
/** A share link (carrying the signatures so far) with Copy link as its action, plus the rarer extras. */
function shareBlock(url, primary, { what = 'transaction', json, merge } = {}) {
  const b = h('button' + (primary ? '.primary' : ''), 'Copy link');
  b.onclick = () => toClipboard(url).then(() => (put(b, '✓ Copied'), setTimeout(() => put(b, 'Copy link'), 1500)), () => {});
  const more = merge && h('div.sharemore', { hidden: true }, h('p.mut', 'Got a link back with more signatures? Paste it to merge them here.'), merge);
  return h(
    'div.share',
    h('div.row', h('input.mono', { readonly: true, value: url, onclick: (e) => e.target.select(), 'aria-label': 'Share link' }), b),
    h('p.fhint', 'The link carries the ' + what + ' and the signatures so far. Anyone with it can read it; only owners can sign.'),
    h(
      'p.sharelinks',
      json && h('button.link', { onclick: () => toClipboard(json()) }, 'Copy as JSON'),
      json && merge && h('span.mut', ' · '),
      merge && h('button.link', { onclick: () => (more.hidden = !more.hidden) }, 'Merge signatures from another link'),
    ),
    more,
  );
}
const here = () => location.href.split('#')[0];
const txShare = (r, primary) => shareBlock(here() + '#' + fragment(r.tx, st.sigs, hintsFor(r.tx)), primary, { json: () => toJSON(r.tx, st.sigs, hintsFor(r.tx)), merge: importer() });

function actionView(d, t) {
  const tok = d.label.startsWith('ERC-20') && tokenOf(t.to);
  return [
    h('b', d.label),
    kv([
      d.label.startsWith('ERC-20') && ['token', tok ? tokenLabel(tok) : [addr(t.to), ' ', h('span.mut', '(unknown token · amount in raw units)')]],
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

function detailsView(r) {
  const t = r.tx, c = label(t.chainId), len = strip(t.data).length / 2;
  return h(
    'details.rvdetails',
    h('summary', 'Transaction details'),
    kv([
      ['Safe', addr(t.safe)],
      ['Chain', (c.name || 'unknown') + ' · chainId ' + t.chainId],
      ['Nonce', String(t.nonce)],
      ['To', st.named[t.to] ? named(t.to) : [addr(t.to), rev(t.to)]],
      ['Value', fmt(t.value) + ' ' + (c.sym || '') + ' (' + t.value + ' wei)'],
      ['Operation', t.operation ? (r.batch ? 'DELEGATECALL into MultiSendCallOnly (batch)' : h('b.bad', 'DELEGATECALL')) : 'CALL'],
      ['Action', r.signMessage ? [h('b', 'signMessage'), h('span.mut', ' · Safe’s SignMessageLib'), kv([['message', [h('code', r.signMessage), copy(r.signMessage, 'Copy')]]])] : r.batch ? batchView(r) : r.decoded ? actionView(r.decoded, t) : len ? noteView(t.data) || 'Unknown calldata (not decoded; check the raw data)' : t.value ? 'Native transfer' : 'Empty call'],
      ['Data', len ? [h('div', 'selector ', h('code', t.data.slice(0, 10)), ' · ' + len + ' bytes ', copy(t.data, 'Copy calldata')), h('code.mono', t.data)] : 'none'],
      ['Gas fields', 'safeTxGas ' + t.safeTxGas + ' · baseGas ' + t.baseGas + ' · gasPrice ' + t.gasPrice + ' · gasToken ' + t.gasToken + ' · refundReceiver ' + t.refundReceiver],
      ['SafeTx hash', h('b', addr(r.local))],
      ['Onchain hash', r.chain ? [addr(r.chain), ' ', r.chain === r.local ? h('b.ok', '✓ verified') : h('b.bad', '✗ MISMATCH')] : h('b.bad', 'unavailable')],
    ]),
  );
}

// ---- messages (EIP-1271): the Safe signs a message when enough owners sign it ----

/** Custom → Message: what to sign, as text, EIP-712 typed data or a raw hash. */
function messageBuilder(s) {
  const kind = h('select', h('option', { value: 1 }, 'Text'), h('option', { value: 2 }, 'Typed data (EIP-712 JSON)'), h('option', { value: 3 }, 'Hash (32 bytes)'));
  const text = h('textarea', { rows: 6, spellcheck: 'false' });
  const place = () => (text.placeholder = ['', 'The message, as the app shows it', '{"types":{…},"primaryType":"…","domain":{…},"message":{…}}', '0x… (the 32-byte hash an app will pass to isValidSignature)'][kind.value]);
  kind.onchange = place;
  place();
  const out = h('div');
  const go = button(
    'Review message',
    async () => {
      const k = Number(kind.value), v = text.value;
      let content;
      if (k === 1) {
        if (!v) throw Error('Enter the message.');
        content = hex(utf8(v));
      } else if (k === 2) {
        let td;
        try {
          td = JSON.parse(v);
        } catch {
          throw Error('Typed data must be valid JSON.');
        }
        content = JSON.stringify(td);
      } else {
        content = v.trim().toLowerCase();
        if (!/^0x[0-9a-f]{64}$/.test(content)) throw Error('A hash is 0x followed by 64 hex digits.');
      }
      await showMessage({ chainId: s.chainId, safe: s.address, kind: k, content }, [], 'push');
    },
    out,
    '.primary',
  );
  return h(
    'div',
    h('p.mut', 'Sign a message as the Safe (EIP-1271): once enough owners sign it, apps accept it as the Safe’s signature through its isValidSignature.'),
    h('label', 'Kind'),
    kind,
    h('label', 'Message'),
    text,
    h('div.actions', go),
    out,
  );
}

/** Review a message on its own screen (like transactions). */
async function showMessage(m, sigs = [], nav = 'push') {
  if (nav === 'push') st.backTo = location.hash && !/^#(tx|msg)=/.test(location.hash) ? location.hash : null;
  else if (nav === 'none') st.backTo = null;
  put(main, safeHeader(st.safe, [st.backTo || link('custom'), 'Back']), rv);
  setCrumb(st.safe);
  put(rv, h('p.mut', 'Checking the message…'));
  let c;
  try {
    c = await checkMessage(m, sigs);
  } catch (e) {
    return put(rv, bad('This message cannot be read: ' + e.message));
  }
  st.message = { m, c };
  st.msgSigs = c.valid.map((x) => x.sig);
  const h2 = '#' + messageFragment(m, st.msgSigs);
  if (nav === 'push') history.pushState(null, '', h2);
  else if (nav === 'replace') history.replaceState(null, '', h2);
  const ok = c.onchain === c.local;
  const blocked = c.onchain
    ? h('div.step.blocked', h('h3', 'This message cannot be signed here'), h('p', 'The Safe computes a different hash. Do not sign it.'))
    : h('div.step.blocked', h('h3', 'This Safe cannot sign messages yet'), h('p', 'It needs a fallback handler that validates signatures (EIP-1271). Settings can set Safe’s CompatibilityFallbackHandler, with the owners’ approval.'), h('div.actions', h('a.btn', { href: link('settings') }, 'Open Settings')));
  put(rv, messageHead(m, c), ok ? messageStep(m, c) : blocked, messageDetails(m, c));
  scrollTo(0, 0);
}

// Typed data that grants a spending permission: signing it can move the Safe's assets.
const PERMITS = /^(Permit|PermitSingle|PermitBatch|PermitTransferFrom|PermitBatchTransferFrom|PermitWitnessTransferFrom|PermitWitnessBatchTransferFrom|OrderComponents)$/;

function messageHead(m, c) {
  const td = c.typed, dc = td && td.domain && td.domain.chainId !== undefined && Number(td.domain.chainId);
  return h(
    'section.rvhead',
    h('div.rvkicker', KINDS[m.kind], ' · to be signed by the Safe'),
    m.kind === 1 ? (c.text !== null ? h('pre.msgtext', c.text) : [h('p.mut', 'Raw bytes (not text):'), h('code.mono', m.content)]) : m.kind === 2 ? typedView(td) : h('code.mono', m.content),
    td && PERMITS.test(td.primaryType) && h('p.bad.danger', 'PERMISSION TO MOVE ASSETS (' + td.primaryType + '). Once enough owners sign, whoever holds the signature can use it to move this Safe’s tokens, without another Safe transaction.'),
    dc && dc !== m.chainId && warn('This message names chain ' + dc + ', but the Safe is on chain ' + m.chainId + '.'),
    m.kind === 3 && warn('A raw hash: safe.wei cannot show what it stands for. Sign it only if you know which message it is.'),
    c.onchain === c.local
      ? h('p.rvhash', h('b.ok', '✓'), ' Hash matches the Safe’s own ', h('code', short(c.local)), ' · see details below')
      : bad(c.onchain ? 'The Safe computes a different hash for this message. Do not sign it.' : 'This Safe cannot validate message signatures: it has no compatible fallback handler (EIP-1271).'),
  );
}

/** EIP-712 typed data in words: what it is, which app and contract, then its fields. */
function typedView(td) {
  const types = td.types || {}, d = td.domain || {};
  const val = (type, v) => {
    const base = type.replace(/\[\d*\]$/, '');
    if (type !== base) return Array.isArray(v) && v.length ? h('ol.vlist', v.map((x) => h('li', val(base, x)))) : h('span.mut', 'empty');
    if (types[type]) return kv(types[type].map((f) => [f.name, val(f.type, v && v[f.name])]));
    if (type === 'address' && typeof v === 'string' && isAddr(v)) return named(v.toLowerCase());
    return typeof v === 'string' ? v : JSON.stringify(v);
  };
  return h(
    'div',
    h('h2.rvtitle', td.primaryType),
    kv([d.name && ['App', d.name + (d.version ? ' · version ' + d.version : '')], d.verifyingContract && ['Contract', isAddr(d.verifyingContract) ? named(d.verifyingContract.toLowerCase()) : String(d.verifyingContract)], d.chainId !== undefined && ['Chain', String(d.chainId)]].filter(Boolean)),
    td.primaryType !== 'EIP712Domain' && val(td.primaryType, td.message),
  );
}

function messageStep(m, c) {
  const s = c.s, me = st.account && st.account.toLowerCase(), owner = me && s.owners.includes(me);
  const signed = c.valid.map((x) => x.signer), mine = signed.includes(me);
  const thr = Number(s.threshold), got = signed.length, ready = got >= thr;
  const count = got + ' of ' + thr + ' signature' + (thr === 1 ? '' : 's');
  const out = h('div');
  const share = (primary) => shareBlock(here() + '#' + messageFragment(m, st.msgSigs), primary, { what: 'message', merge: importer() });
  const lib = chain().libFor(s.version, 'signMessage');
  const onchain = () => ((st.named = {}), showReview(newTx(s, onchainSignCall(lib, c.hash)), [], 'push'));
  let step;
  if (c.signed) {
    const status = h('p.rvhash', 'Checking with the Safe…');
    isValid(m.safe, c.hash, '0x').then((ok) => put(status, ok ? [h('b.ok', '✓'), ' The Safe accepts it with an empty signature (isValidSignature).'] : h('b.bad', '✗ The Safe does not accept it.')));
    step = h('div.step.go', h('h3', h('span.ok', '✓ '), 'Signed onchain'), h('p', 'This Safe signed the message onchain. Apps accept it with an empty signature (0x): no owner signatures need to be passed along.'), status);
  } else if (ready) {
    const sig = combine(c.valid, s.threshold), status = h('p.rvhash', 'Checking with the Safe…');
    isValid(m.safe, c.hash, sig).then((ok) => put(status, ok ? [h('b.ok', '✓'), ' The Safe accepts this signature (isValidSignature).'] : h('b.bad', '✗ The Safe rejects this signature.')));
    const b = h('button.primary', 'Copy signature');
    b.onclick = () => toClipboard(sig).then(() => (put(b, '✓ Copied'), setTimeout(() => put(b, 'Copy signature'), 1500)), () => {});
    step = h('div.step.go', h('h3', 'Signature ready'), h('p', count + ' collected. Give this signature to the app that asked for it.'), h('div.row', h('input.mono', { readonly: true, value: sig, onclick: (e) => e.target.select(), 'aria-label': 'Signature' }), b), status);
  } else if (!me) step = h('div.step', h('h3', 'Connect a wallet to sign'), h('p', count + ' so far. Owners sign with their wallet; you can also send this link to them.'), share(false));
  else if (owner && !mine)
    step = h(
      'div.step',
      h('h3', 'Your signature is needed'),
      h('p', count + ' so far. A signature moves nothing by itself, but apps treat the Safe’s signature as its consent to what the message says. Choose how to sign:'),
      h(
        'div.opts2',
        h(
          'div.opt',
          h('div', h('b', 'Sign'), h('span.tag', 'free')),
          h('p', 'Your wallet signs the message. The signature is added to the link you share; once enough owners sign, the combined signature is ready here.'),
          button('Sign', async () => showMessage(m, [...st.msgSigs, await signMessage(m, me)], 'replace'), out, '.primary'),
        ),
        lib &&
          h(
            'div.opt',
            h('div', h('b', 'Sign onchain'), h('span.tag', 'costs gas')),
            h('p', 'A Safe transaction records that the Safe signed the message. Owners approve and execute it like any transaction; then apps accept it with an empty signature, with nothing to pass around.'),
            button('Create the transaction', async () => onchain(), out),
          ),
      ),
      out,
      h('p.fhint', 'To sign, your wallet shows a SafeMessage for this Safe whose message is ', h('code', c.hash), '. It must match.'),
    );
  else if (owner) step = h('div.step', h('h3', h('span.ok', '✓ '), 'You signed · ' + (thr - got) + ' more needed'), h('p', 'Send this link to the other owners. Each one opens it, checks it and signs with their wallet.'), share(true));
  else
    step = h(
      'div.step',
      h('h3', 'Send this to the owners'),
      h('p', 'This wallet isn’t an owner, so it can’t sign. Copy the link and send it to the owners: they open it, check it and sign with their wallet. Once ' + thr + ' ' + (thr === 1 ? 'has' : 'have') + ', the Safe’s signature is ready here for the app that asked.'),
      share(true),
      lib && h('p.sharelinks', h('span.mut', 'Or have the Safe sign it onchain: '), h('button.link', { onclick: onchain }, 'create the Safe transaction'), h('span.mut', ' for the owners to approve and execute.')),
    );
  return [
    step,
    ready && share(false),
    h(
      'section.rvapprovals',
      h('div.rvsec', h('h3', 'Signatures · ' + count), h('span.grow'), button('Refresh', () => showMessage(m, st.msgSigs, 'replace'), out, '.link')),
      h('ul.owners.shortaddr', s.owners.map((o) => h('li', addr(o), signed.includes(o) ? h('b.ok', '✓ signed') : h('span.mut', 'waiting'), o === me && h('span.mut', '(you)')))),
      c.rejected.map((x) => warn('Ignored signature: ' + x.reason + '.')),
    ),
  ];
}

function messageDetails(m, c) {
  return h(
    'details.rvdetails',
    h('summary', 'Message details'),
    kv([
      ['Safe', addr(m.safe)],
      ['Chain', label(m.chainId).name + ' · chainId ' + m.chainId],
      ['Kind', KINDS[m.kind] + (m.kind === 1 ? ' (EIP-191, personal_sign)' : '')],
      ['Content', m.kind === 2 ? h('code.mono', m.content) : [h('code.mono', m.content), copy(m.content, 'Copy')]],
      ['Message hash', [h('code', c.hash), copy(c.hash, 'Copy'), h('div.mut', 'What the app asks the Safe about: isValidSignature(hash, signature).')]],
      ['SafeMessage hash', [h('b', addr(c.local)), h('div.mut', 'What the owners sign: SafeMessage(bytes message) with message = the hash above, for this Safe.')]],
      ['Safe’s own hash', c.onchain ? [addr(c.onchain), ' ', c.onchain === c.local ? h('b.ok', '✓ verified') : h('b.bad', '✗ MISMATCH')] : h('b.bad', 'unavailable')],
    ]),
  );
}

// ---- routing ----
// #/                         home          #/new                create a Safe
// #/<safe>[/<tab>][?params]  Safe page     #tx=<payload>        review a shared transaction
// <safe> is a 0x address or a .eth/.wei name; tabs: assets (default), send, batch (send, CSV), transactions, custom, setup.
let seq = 0;
async function route() {
  const n = ++seq;
  setCrumb(null);
  const path = location.hash.slice(1);
  let m = /^\/([^/?]+)(?:\/([a-z]+))?(?:\?(.*))?$/.exec(path), p, pm;
  if (m && m[1] === 'new') m = null;
  try {
    if (path.startsWith('import=')) return put(main, home()), backupDialog(path);
    if (path === '/new') {
      if (!list().length) throw new Gate(noWalletView());
      if (!chain()) throw new Gate(connectView('create a Safe'));
      return put(main, chain().canCreate ? createView() : bad('Safe’s contracts are not deployed on ' + chain().name + '.'));
    }
    if (path.startsWith('tx=')) (p = importPayload(path)), addHints(p.abi), (m = [0, p.tx.safe, 'review']);
    if (path.startsWith('msg=')) (pm = importMessage(path)), (m = [0, pm.msg.safe, 'review']);
    if (!m) return put(main, home()), renderBatch();
    const ref = decodeURIComponent(m[1]), tab = m[2] || 'assets', q = new URLSearchParams(m[3] || '');
    const address = await openTarget(ref, p ? p.tx.chainId : pm && pm.msg.chainId);
    st.intent = false;
    if (!st.safe || st.safe.address !== address || st.stale) {
      if (!st.safe || st.safe.address !== address) put(main, h('p.mut', 'Loading ' + ref + '…'));
      const s = await readSafe(address);
      if (n !== seq) return;
      if (!st.safe || st.safe.address !== s.address) (st.refName = isAddr(ref) ? null : ref), (st.safeName = (recent.find(s.chainId, s.address) || {}).label || st.refName || labels.get(s.address));
      recent.touch(s.chainId, s.address, isAddr(ref) ? null : ref);
      st.safe = s;
      st.stale = false;
      st.balFor = st.pendingFor = null;
      if (st.batchSafe !== s.address) (st.batch = []), (st.batchNames = {}), (st.batchSafe = s.address);
    }
    // How this Safe is addressed in links: the name it was opened by, else its address.
    if (!p && !pm) st.ref = isAddr(ref) ? st.safe.address : ref;
    else if (st.ref !== st.safe.address && st.ref !== st.safeName) st.ref = st.safe.address;
    const s = st.safe;
    if (p) return showReview(p.tx, p.sigs, 'none');
    if (pm) return showMessage(pm.msg, pm.sigs, 'none');
    const tabs = { assets: assetsTab, send: sendTab, batch: sendTab, transactions: transactionsTab, custom: builder, settings: settingsTab, setup: settingsTab };
    if (!tabs[tab]) return (location.hash = link('assets'));
    page(s, tab === 'batch' ? 'send' : tab, tab === 'send' || tab === 'batch' ? sendTab(s, tab === 'batch', q) : tabs[tab](s));
  } catch (e) {
    if (n !== seq) return;
    st.intent = false;
    if (e instanceof Gate) return put(main, e.view);
    put(main, bad(e.message), home());
  }
}

setResolver((v) => resolveName(v.trim().toLowerCase(), st.chainId));

// ---- footer: which build this is, and which app contract serves it ----
// The page cannot contain its own address (the address is derived from the page's bytes), so it is
// found at runtime: in the gateway's hostname (0x….w3link.io), or by resolving the name the page was
// opened by (safe.wei.limo → safe.wei) onchain through the wallet on Ethereum.
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
async function footer() {
  const g = gatewayOf(location.hostname);
  let app = g.app || null;
  if (g.name && st.chainId === 1) app = await resolveName(g.name, 1).catch(() => null);
  put(
    $('foot'),
    h('span', 'safe.wei · build ', h('code', { title: 'git tree hash of src/ this page was built from' }, BUILD)),
    app ? h('span', ' · app ', addr(app, null, short(app), true), g.name && h('span.mut', ' via ' + g.name)) : g.local ? h('span', ' · local build') : g.name && h('span.mut', ' · connect on Ethereum to see which app ' + g.name + ' points to'),
  );
}

// ---- boot ----
// safe.wei never runs inside another page: a frame could overlay a crafted transaction and trick clicks.
if (framed) {
  put(main, gateCard('Open safe.wei in its own tab', 'For your safety, safe.wei does not run inside another page.', h('div.actions', h('a.btn', { href: location.href, target: '_blank', rel: 'noopener' }, 'Open in a new tab'))));
  throw Error('safe.wei refuses to run in a frame');
}
window.onhashchange = route;
let booted = false;
discover(() => {
  if (!booted) return; // announcements during discovery are handled by the initial choice below
  // A wallet announced late: pick it up if it is the remembered one and nothing is in use.
  const k = remembered();
  if (!wallet && k && get(k)) useWallet(get(k)), reset();
  else if (!wallet) refreshWallet().then(route); // e.g. the "no wallet" state no longer applies
});
{
  const k = remembered(), ws = list();
  // Remembered wallet; else the only wallet present; else wait for the user to choose.
  useWallet(k === 'none' ? null : get(k) || (ws.length === 1 ? ws[0] : null));
  booted = true;
}
refreshWallet().then(route, route).then(footer, footer);
