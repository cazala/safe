// DOM helpers. Text is always set via text nodes, never innerHTML, so nothing
// read from chain or from a shared payload can inject markup.
export const $ = (id) => document.getElementById(id);

/** h('div.cls', {attrs}, ...children). Children: string | Node | array | null. */
export function h(tag, attrs, ...kids) {
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) kids.unshift(attrs);
  else for (const k in attrs) k.startsWith('on') ? (el[k] = attrs[k]) : attrs[k] != null && attrs[k] !== false && el.setAttribute(k, attrs[k]);
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

/** An address (or hash) in monospace with a copy button; `shown` can be a shortened form. */
export const addr = (a, note, shown = a) => h('span.addr', h('code', shown), copy(a, 'Copy ' + (a.length > 42 ? 'hash' : 'address')), note && [' ', note]);

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
