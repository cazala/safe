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
export const addr = (a, note) =>
  h('span.addr', h('code', a), ' ', h('button.link', { onclick: () => navigator.clipboard.writeText(a), title: 'Copy' }, 'copy'), note && [' ', note]);

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
