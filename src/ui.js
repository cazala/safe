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
      if (k.startsWith('on')) el[k] = attrs[k];
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
  b.onclick = async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text).catch(() => {});
    b.replaceChildren(icon(...CHECK));
    b.classList.add('done');
    clearTimeout(b.t);
    b.t = setTimeout(() => (b.replaceChildren(icon(...COPY)), b.classList.remove('done')), 1200);
  };
  return b;
}

/** What an address shows: its label if the viewer set one, else the address (or `shown`). */
const face = (a, shown) => {
  const l = a.length === 42 && labels.get(a);
  return l ? h('b.lbl', { title: a }, l) : h('code', shown || a);
};

/**
 * An address in monospace with copy (and, for addresses, a label button); `shown` can be a
 * shortened form. Labeled addresses show their label; the full address stays on hover and in copy.
 */
export function addr(a, note, shown) {
  const isAddr = a.length === 42;
  const el = h('span.addr', { 'data-addr': isAddr ? a.toLowerCase() : null }, face(a, shown), copy(a, 'Copy ' + (isAddr ? 'address' : 'hash')), isAddr && tagButton(a), note && [' ', note]);
  el.shown = shown;
  return el;
}
// Relabel every rendered occurrence in place when a label changes.
addEventListener('labels', (e) => document.querySelectorAll('span.addr[data-addr="' + e.detail + '"]').forEach((el) => el.firstChild.replaceWith(face(e.detail, el.shown))));

function tagButton(a) {
  const b = h('button.copy.tag', { title: labels.get(a) ? 'Edit label' : 'Add a label', 'aria-label': 'Label this address' });
  b.append(icon(...ICONS.tag));
  b.onclick = (e) => (e.preventDefault(), e.stopPropagation(), labelDialog(a));
  return b;
}

/** Dialog to set, change or remove a label. With no address, it asks for one too. */
export function labelDialog(a) {
  const cur = a && labels.get(a);
  const who = h('input', { placeholder: '0x…', spellcheck: 'false', value: a || null });
  const name = h('input', { placeholder: 'e.g. Treasury, Alice, Payroll', maxlength: 40, value: cur || null });
  const err = h('div');
  const d = h('dialog.sheet');
  const close = () => (d.close(), d.remove());
  const save = () => {
    const x = (a || who.value.trim()).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(x)) return put(err, h('p.bad', 'Enter a 0x address (40 hex characters).'));
    if (!name.value.trim()) return put(err, h('p.bad', 'Enter a label.'));
    labels.set(x, name.value);
    close();
  };
  name.onkeydown = who.onkeydown = (k) => k.key === 'Enter' && (k.preventDefault(), save());
  put(
    d,
    h('h3', cur ? 'Edit label' : 'Add a label'),
    a ? h('code.full', a) : [h('label', 'Address'), who],
    h('label', 'Label'),
    name,
    h('p.mut.small', 'Labels are saved in this browser and shown instead of the address.'),
    err,
    h(
      'div.actions',
      h('button.primary', { onclick: save }, 'Save'),
      h('button', { onclick: close }, 'Cancel'),
      cur && h('button.link.danger', { onclick: () => (labels.set(a, ''), close()) }, 'Remove label'),
    ),
  );
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => e.target === d && close()); // backdrop
  document.body.append(d);
  d.showModal();
  (a ? name : who).focus();
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
