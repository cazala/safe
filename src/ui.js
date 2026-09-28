import * as labels from './labels.js';

// DOM helpers. Text is always set via text nodes, never innerHTML, so nothing
// read from chain or from a shared payload can inject markup.
export const $ = (id) => document.getElementById(id);

/** h('div.cls', {attrs}, ...children). Children: string | Node | array | null. */
export function h(tag, attrs, ...kids) {
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) kids.unshift(attrs);
  else
    for (const k in attrs)
      if (k.startsWith('on')) {
        const f = attrs[k];
        el[k] = function (e) {
          f.call(this, e); // return value ignored: a handler returning false must never cancel the event
        };
      }
      else if (attrs[k] == null || attrs[k] === false) continue;
      else if (k === 'class') el.classList.add(...String(attrs[k]).split(' ').filter(Boolean)); // adds to the tag's classes
      else el.setAttribute(k, attrs[k]);
  return put(el, ...kids);
}

/** Replace an element's children, skipping null/false and flattening arrays. */
export function put(el, ...kids) {
  el.replaceChildren(...kids.flat(9).filter((k) => k != null && k !== false).map((k) => (k instanceof Node ? k : String(k))));
  return el;
}

export const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);

/** Key/value table rows. */
export const kv = (rows) => h('table.kv', rows.filter(Boolean).map(([k, v]) => h('tr', h('th', k), h('td', v))));

/** A full address in monospace with a copy button. */
// Inline SVG icons, built with DOM calls (no markup strings).
const NS = 'http://www.w3.org/2000/svg';
export function icon(...paths) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }))
    svg.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
const COPY = ['M9 9h11v11H9z', 'M5 15H4V4h11v1'], CHECK = ['m5 12.5 4.5 4.5L19 7.5'];
export const ICONS = {
  shield: ['M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z', 'm8.5 12 2.5 2.5 4.5-5'],
  pin: ['M12 16v6', 'M8 3h8l-1.5 6.5L18 13H6l3.5-3.5z'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'm13.5 6.5 4 4'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  next: ['m9 6 6 6-6 6'],
  plus: ['M12 5v14', 'M5 12h14'],
  tag: ['M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z', 'M7.5 7.5h.01'],
  gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
};

/** Copy button: a copy icon that turns into a check for a moment. Fixed size, so nothing moves. */
export function copy(text, what = 'Copy') {
  const b = h('button.copy', { title: what, 'aria-label': what });
  b.append(icon(...COPY));
  b.onclick = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).catch(() => {});
    b.replaceChildren(icon(...CHECK));
    b.classList.add('done');
    clearTimeout(b.t);
    b.t = setTimeout(() => (b.replaceChildren(icon(...COPY)), b.classList.remove('done')), 1200);
  };
  return b;
}

// ENS / WNS names seen for addresses (typed and resolved, or reverse-resolved), set by the app.
const names = new Map();
/** Remember a name for `a` and update every rendered occurrence (labels still win). */
export function setName(a, n) {
  a = a.toLowerCase();
  if (!n || names.get(a) === n) return;
  names.set(a, n);
  relabel(a);
}

/** What an address shows: the viewer's label, else its ENS / WNS name, else the address (or `shown`). */
const face = (a, shown) => {
  const k = a.length === 42 && a.toLowerCase(), l = k && labels.get(a), n = k && names.get(k);
  return l ? h('b.lbl', { title: a }, l) : n ? h('b.lbl.ens', { title: a }, n) : h('code', { title: a }, shown || a);
};

/**
 * An address with copy (and, for addresses, a label button); `shown` can be a shortened form.
 * One name at most: label, else ENS / WNS, else the address. The full address is on hover,
 * and clicking it copies, like the copy button.
 */
export function addr(a, note, shown) {
  const isAddr = a.length === 42;
  const c = copy(a, 'Copy ' + (isAddr ? 'address' : 'hash'));
  const el = h('span.addr', { 'data-addr': isAddr ? a.toLowerCase() : null }, face(a, shown), c, isAddr && tagButton(a), note && [' ', note]);
  el.shown = shown;
  el.firstChild.onclick = faceClick;
  return el;
}
// Clicking the shown name or address copies it, with the copy button's feedback.
function faceClick(e) {
  e.preventDefault();
  e.stopPropagation();
  this.nextSibling.click();
}
// Refresh every rendered occurrence in place when a label or name changes.
const relabel = (a) =>
  document.querySelectorAll('span.addr[data-addr="' + a + '"]').forEach((el) => {
    const f = face(a, el.shown);
    f.onclick = faceClick;
    el.firstChild.replaceWith(f);
  });
addEventListener('labels', (e) => relabel(e.detail));

function tagButton(a) {
  const b = h('button.copy.tag', { title: labels.get(a) ? 'Edit label' : 'Add a label', 'aria-label': 'Label this address' });
  b.append(icon(...ICONS.tag));
  b.onclick = (e) => (e.preventDefault(), e.stopPropagation(), labelDialog(a));
  return b;
}

// Optional name resolution for addresses typed into the label dialog (set by the app).
let resolver = null;
export const setResolver = (f) => (resolver = f);

/** A modal sheet with a header (icon, title, close) and the given body; returns { d, close }. */
export function sheet(iconName, title, wide) {
  const d = h('dialog.sheet' + (wide ? '.wide' : ''));
  const close = () => (d.close(), d.remove());
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => e.target === d && close()); // backdrop
  const x = h('button.ib.dclose', { title: 'Close', 'aria-label': 'Close', onclick: close });
  x.append(icon(...ICONS.close));
  const head = h('div.dhead', h('span.dicon', icon(...ICONS[iconName])), h('h3', title), x);
  const body = h('div.dbody');
  put(d, head, body);
  document.body.append(d);
  d.showModal();
  return { d, body, close, setTitle: (t) => put(head.querySelector('h3'), t) };
}

/** Dialog to set, change or remove a label. With no address, it asks for one (0x or name) too. */
export function labelDialog(a) {
  const cur = a && labels.get(a);
  const { body, close } = sheet('tag', cur ? 'Edit label' : 'Add a label');
  const who = !a && h('input.mono', { placeholder: '0x… or name.eth / name.wei', spellcheck: 'false', autocomplete: 'off' });
  const whoNote = h('div.fhint');
  const name = h('input.plain', { placeholder: 'Treasury, Alice, Payroll…', maxlength: 40, value: cur || null, autocomplete: 'off' });
  const err = h('div');
  const save = h('button.primary', 'Save');
  let target = a ? a.toLowerCase() : null;
  const valid = () => (save.disabled = !name.value.trim() || !(a || who.value.trim()));
  const resolveWho = async () => {
    const v = who.value.trim();
    target = null;
    put(whoNote);
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) target = v.toLowerCase();
    else if (/\.(eth|wei)$/i.test(v) && resolver) {
      put(whoNote, 'Resolving…');
      try {
        target = await resolver(v);
        if (who.value.trim() === v) put(whoNote, '→ ', h('code', target));
      } catch (e) {
        if (who.value.trim() === v) put(whoNote, h('span.bad', e.message));
      }
    } else if (v) put(whoNote, h('span.bad', 'Enter a 0x address (40 hex characters) or a .eth / .wei name.'));
    return target;
  };
  const submit = async () => {
    put(err);
    if (!a && !(await resolveWho())) return;
    if (!name.value.trim()) return put(err, h('p.bad', 'Enter a label.'));
    labels.set(target, name.value);
    close();
  };
  save.onclick = submit;
  name.oninput = valid;
  name.onkeydown = (k) => {
    if (k.key === 'Enter') k.preventDefault(), submit();
  };
  if (who) {
    who.oninput = () => (valid(), put(whoNote));
    who.onchange = resolveWho;
    who.onkeydown = (k) => {
      if (k.key === 'Enter') k.preventDefault(), name.focus();
    };
  }
  valid();
  put(
    body,
    h('label.f', 'Address'),
    a ? h('div.addrbox', h('code', a), copy(a, 'Copy address')) : [who, whoNote],
    h('label.f', 'Label'),
    name,
    h('div.fhint', 'Shown instead of the address everywhere in safe.wei. Saved only in this browser.'),
    err,
    h(
      'div.dfoot',
      cur && h('button.link.danger', { onclick: () => (labels.set(a, ''), close()) }, 'Remove label'),
      h('span.grow'),
      h('button', { onclick: close }, 'Cancel'),
      save,
    ),
  );
  (a ? name : who).focus();
  if (a) name.select();
}

export const warn = (...t) => h('p.warn', ...t);
export const bad = (...t) => h('p.bad', ...t);

/** Run an async action from a button: disables it and shows errors inline. */
export function act(btn, fn, out) {
  return async () => {
    btn.disabled = true;
    if (out) out.replaceChildren();
    try {
      await fn();
    } catch (e) {
      const m = (e && (e.shortMessage || e.message)) || String(e);
      (out || btn.parentNode).append(bad(m));
    } finally {
      btn.disabled = false;
    }
  };
}

/** Small icon-only button (click does not reach links or rows underneath). */
export function iconButton(name, title, fn, on) {
  const b = h('button.ib' + (on ? '.on' : ''), { title, 'aria-label': title });
  b.append(icon(...ICONS[name]));
  b.onclick = (e) => (e.preventDefault(), e.stopPropagation(), fn());
  return b;
}
