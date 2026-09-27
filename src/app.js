// safe.wei — app shell, routing and views.
import { fmt, isAddr, isHex, parse, strip } from './abi.js';
import { CHAINS } from './chains.js';
import { approve, checkSigs, collect, execute, sign } from './flow.js';
import { review } from './review.js';
import * as rpc from './rpc.js';
import { create, createCall, newTx, predict, readSafe, safeTxHash } from './safe.js';
import { fragment, importPayload, toJSON } from './share.js';
import { $, act, addr, bad, h, kv, put, short, warn } from './ui.js';

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
  return [
    h('section', h('h2', 'Open Safe'), h('div.row', input, h('button', { onclick: go }, 'Open'))),
    h('section', h('h2', 'Create Safe'), h('p.mut', 'Deploy a new Safe v1.4.1 from the canonical proxy factory.'), h('button', { onclick: () => (location.hash = '/new') }, 'Create Safe')),
  ];
}

function createView() {
  const c = chain();
  const owners = h('textarea', { placeholder: 'One owner address per line', spellcheck: 'false' }, st.account || '');
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
      const list = owners.value.split(/[\s,]+/).filter(Boolean);
      const k = createCall(c, list, threshold.value.trim(), BigInt(salt.value.trim()));
      const at = await predict(k, st.account);
      const deploy = h('button.primary', 'Deploy Safe');
      deploy.onclick = act(deploy, async () => {
        const s = await create(k, st.account);
        location.hash = '/' + s.address;
      });
      put(
        plan,
        h('h2', 'Deployment summary'),
        kv([
          ['Predicted address', h('b', h('code', at))],
          ['Chain', c.name + ' · chainId ' + st.chainId],
          ['Owners', h('ol.owners', k.owners.map((o) => h('li', h('code', o), o === st.account.toLowerCase() && [' ', h('b.ok', 'you')])))],
          ['Threshold', k.threshold + ' of ' + k.owners.length],
          ['Singleton', [h('code', c.singleton), ' (Safe v1.4.1)']],
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

function importer() {
  const ta = h('textarea', { placeholder: 'Paste a safe.wei link, a tx= fragment, or transaction JSON', spellcheck: 'false' });
  const out = h('div');
  const btn = h('button', 'Import');
  btn.onclick = act(
    btn,
    async () => {
      const p = importPayload(ta.value);
      if (p.tx.safe !== st.safe.address || p.tx.chainId !== st.chainId) return (location.hash = fragment(p.tx, p.sigs));
      // Same transaction as the one under review: merge the imported signatures into it.
      const same = st.review && st.review.local === safeTxHash(p.tx);
      await showReview(p.tx, same ? [...st.sigs, ...p.sigs] : p.sigs);
    },
    out,
  );
  return h('details', h('summary', 'Import transaction'), ta, h('div.actions', btn), out);
}

const rv = h('div');
async function showReview(tx, sigs = []) {
  const r = await review(tx, st.safe, st.chainId);
  const c = await checkSigs(st.safe, r.local, sigs);
  st.review = r;
  st.off = c.valid;
  st.sigs = c.valid.map((x) => x.sig); // only valid signatures are kept and re-shared
  st.rejected = c.rejected;
  // Keep the transaction in the URL so a reload returns to this review (no hashchange fires).
  if (r.ok) history.replaceState(null, '', '#' + fragment(tx, sigs));
  put(rv, txView(r), r.ok ? [actionsView(r), shareView(r)] : bad('All actions are disabled until the errors above are resolved.'));
  rv.scrollIntoView({ behavior: 'smooth' });
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
    const done = (msg) => async (rc) => {
      st.safe = await readSafe(s.address);
      await showReview(t, st.sigs);
      rv.append(h('p.ok', msg + ' ', h('code', rc.transactionHash)));
    };
    const executed = async (rc) => {
      history.replaceState(null, '', '#/' + s.address);
      await route();
      main.prepend(h('p.ok', '✓ Executed nonce ' + t.nonce + ' in ', h('code', rc.transactionHash)));
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
      h(
        'div.actions',
        owner && !mine && button('Approve onchain', () => approve(t, me).then(done('Approved.')), out),
        owner && !mine && button('Sign offchain', async () => showReview(t, [...st.sigs, await sign(t, me)]), out),
        me && ready && current && button(owner && !mine ? 'Approve and execute' : 'Execute', () => execute(t, me, st.sigs).then(executed), out, '.primary'),
        button('Refresh', () => showReview(t, st.sigs), out),
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
  let m = /^\/(0x[0-9a-fA-F]{40})$/.exec(path), p;
  try {
    if (path.startsWith('tx=')) m = [0, (p = importPayload(path)).tx.safe];
    if (path === '/new') return put(main, chain() ? createView() : bad('Connect a wallet on a supported chain.'));
    if (!m) return put(main, home());
    main.replaceChildren(h('p.mut', 'Loading ' + m[1] + '…'));
    if (!chain()) throw Error('Connect a wallet on a supported chain (' + Object.values(CHAINS).map((c) => c.name).join(', ') + ').');
    const s = await readSafe(m[1]);
    if (n !== seq) return;
    st.safe = s;
    rv.replaceChildren();
    main.replaceChildren(...safeView(s), rv, builder(s), h('section', importer()));
    if (p) await showReview(p.tx, p.sigs);
  } catch (e) {
    if (n === seq) put(main, bad(e.message), home());
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
