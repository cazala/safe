// Your Safes on Home: one list of Safes and (nested) folders that expand in place.
// Drag to reorder, drop onto a Safe to make a folder, onto a folder to move in, or
// before / after any row to move there, at any depth. Pinned Safes sit on top of their level.
import { label } from './chains.js';
import * as labels from './labels.js';
import * as recent from './recent.js';
import { h, icon, iconButton, ICONS, put, short } from './ui.js';

const FOLDER = ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'];
// A folder with an arrow coming out of it.
const UNGROUP = ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 16v-5', 'm9.5 13.5 2.5-2.5 2.5 2.5'];

// Which folders are open, per browser.
const OPEN = 'safe.wei:open';
const openSet = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN) || '[]'));
  } catch {
    return new Set();
  }
};
const saveOpen = (s) => {
  try {
    localStorage.setItem(OPEN, JSON.stringify([...s]));
  } catch {}
};

// One drag at a time, tracked with document listeners registered once.
let drag = null;
document.addEventListener('pointermove', (e) => drag && drag.move(e));
document.addEventListener('pointerup', (e) => drag && drag.end(e));
document.addEventListener('pointercancel', (e) => drag && drag.end(e));

/** Words a Safe can be found by: nickname, the name it was opened by, its label, its address. */
const words = (e) => [e.label, e.ref, labels.get(e.address), e.address].filter(Boolean).join(' ').toLowerCase();

/**
 * Mount the list into `root`. `chainId()` gives the connected chain: Safes on other chains are
 * dimmed and show their chain. Returns { refresh, filter(query) → matching Safes, or null with no query }.
 */
export function mountSafes(root, chainId) {
  let query = '';
  const meta = () => new Map(recent.safes().map((e) => [recent.keyOf(e), e]));

  // ---- tree helpers ----
  const levelOf = (t, p) => p.reduce((items, id) => (items.find((n) => n.id === id) || { items }).items, t);
  const pinned = (n, m) => n.t === 's' && !!(m.get(n.k) || {}).pinned;
  const view = (items, m) => [...items.filter((n) => pinned(n, m)), ...items.filter((n) => !pinned(n, m))];
  const same = (a, b) => a === b || (a.t === 's' ? b.t === 's' && a.k === b.k : a.id === b.id);
  const detach = (items, n) => items.splice(items.findIndex((x) => same(x, n)), 1);
  const safesIn = (n) => (n.t === 's' ? [n.k] : n.items.flatMap(safesIn));
  const contains = (f, id) => f.t === 'f' && f.items.some((x) => x.id === id || contains(x, id));

  // Show a chain only where it tells you something: not on Safes of the connected chain, and
  // not at all when every Safe is on one chain and no wallet is connected.
  const showChain = (e) => (chainId() ? e.chainId !== chainId() : new Set(recent.safes().map((x) => x.chainId)).size > 1);

  // ---- rows ----
  function safeRow(n, m) {
    const e = m.get(n.k), here = !chainId() || chainId() === e.chainId;
    const title = e.label || e.ref || labels.get(e.address) || 'Safe ' + short(e.address);
    const name = h('b.name', title);
    const rename = () => {
      const inp = h('input.rename', { value: e.label || '', placeholder: e.ref || 'Name this Safe', maxlength: 40 });
      const save = (keep) => (keep && recent.update(e.chainId, e.address, { label: inp.value.trim().slice(0, 40) }), draw());
      inp.onkeydown = (k) => (k.key === 'Enter' ? save(true) : k.key === 'Escape' ? save(false) : null);
      inp.onblur = () => save(true);
      inp.onclick = (k) => (k.preventDefault(), k.stopPropagation());
      name.replaceWith(inp);
      inp.focus();
      inp.select();
    };
    const remove = () => {
      const snapshot = recent.tree(), gone = recent.remove(e.chainId, e.address);
      const undo = h('div.srow.removed', h('span.mut', 'Removed ' + title + '.'), h('span.grow'), h('button.link', { onclick: () => (recent.restore(gone), recent.saveTree(snapshot), draw()) }, 'Undo'));
      el.replaceWith(undo);
      setTimeout(() => undo.isConnected && draw(), 6000);
    };
    const el = h(
      'a.srow.node' + (here ? '' : '.other'),
      { href: '#/' + (e.ref || e.address), title: (here ? '' : 'On ' + label(e.chainId).name + ' · ') + 'Opened ' + recent.ago(e.at) },
      h('span.nline', name, e.pinned && h('span.pinned', icon(...ICONS.pin))),
      title !== 'Safe ' + short(e.address) && h('code.sa', short(e.address)),
      showChain(e) && h('span.chip', label(e.chainId).name),
      h('span.grow'),
      h(
        'span.acts',
        iconButton('pin', e.pinned ? 'Unpin' : 'Pin', () => (recent.update(e.chainId, e.address, { pinned: !e.pinned }), draw()), e.pinned),
        iconButton('edit', 'Rename', rename),
        iconButton('close', 'Remove from this list', remove),
      ),
      h('span.go', icon(...ICONS.next)),
    );
    return el;
  }

  function folderRow(n, path, isOpen, toggle) {
    const name = h('b.name', recent.folderName(n));
    const rename = () => {
      const inp = h('input.rename', { value: n.name || '', placeholder: recent.folderName({ ...n, name: '' }), maxlength: 40 });
      const save = (keep) => {
        if (keep) {
          const t = recent.tree(), f = levelOf(t, path).find((x) => x.id === n.id);
          if (f) (f.name = inp.value.trim().slice(0, 40)), recent.saveTree(t);
        }
        draw();
      };
      inp.onkeydown = (k) => (k.key === 'Enter' ? save(true) : k.key === 'Escape' ? save(false) : null);
      inp.onblur = () => save(true);
      inp.onclick = (k) => k.stopPropagation();
      name.replaceWith(inp);
      inp.focus();
      inp.select();
    };
    const ungroup = () => {
      const t = recent.tree(), up = levelOf(t, path), i = up.findIndex((x) => x.id === n.id);
      if (i >= 0) up.splice(i, 1, ...up[i].items), recent.saveTree(t);
      draw();
    };
    return h(
      'div.srow.node.folder' + (isOpen ? '.open' : ''),
      { role: 'button', tabindex: 0, 'aria-expanded': String(isOpen), onclick: toggle, onkeydown: (k) => { if (k.target === k.currentTarget && (k.key === 'Enter' || k.key === ' ')) k.preventDefault(), toggle(); } },
      h('span.caret', icon(...ICONS.next)),
      h('span.nline', h('span.finl', icon(...FOLDER)), name),
      n.name && h('span.count', String(safesIn(n).length)),
      h('span.grow'),
      h('span.acts', iconButton('edit', 'Rename folder', rename), h('button.ib', { title: 'Ungroup: move its Safes out and remove the folder', 'aria-label': 'Ungroup', onclick: (e) => (e.stopPropagation(), ungroup()) }, icon(...UNGROUP))),
    );
  }

  // ---- the list ----
  function level(items, path, m, open) {
    return view(items, m).map((n) => {
      if (n.t === 's') {
        const el = safeRow(n, m);
        el.node = n;
        el.path = path;
        dragify(el);
        return el;
      }
      const isOpen = open.has(n.id);
      const toggle = () => {
        const s = openSet();
        s.has(n.id) ? s.delete(n.id) : s.add(n.id);
        saveOpen(s);
        draw();
      };
      const row = folderRow(n, path, isOpen, toggle);
      row.node = n;
      row.path = path;
      dragify(row);
      return h('div.fwrap', row, isOpen && h('div.kids', level(n.items, [...path, n.id], m, open)));
    });
  }

  function listView() {
    const m = meta();
    if (query) {
      // Searching: a flat list of matching Safes, wherever they are filed.
      const hits = recent.sorted().filter((e) => words(e).includes(query));
      return h('div', hits.length ? h('div.slist', hits.map((e) => safeRow({ t: 's', k: recent.keyOf(e) }, m))) : null);
    }
    return h('div', h('div.slist', level(recent.tree(), [], m, openSet())), recent.safes().length > 1 && h('p.hint', 'Drag to reorder; drop one Safe onto another to make a folder.'));
  }
  const draw = () => put(root, listView());

  // ---- drag and drop (pointer events: mouse drags directly, touch long-presses first) ----
  function dragify(el) {
    // Rows are links: without this, the browser's own link drag takes over and cancels ours.
    el.draggable = false;
    el.addEventListener('dragstart', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.button || e.target.closest('button, input') || drag) return;
      const s = { el, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse', armed: false, move, end };
      if (s.touch) s.timer = setTimeout(() => arm(s), 350);
      drag = s;
    });
    // Once a touch drag is armed, keep the page from scrolling.
    el.addEventListener('touchmove', (e) => drag && drag.el === el && drag.armed && e.preventDefault(), { passive: false });
    el.addEventListener('click', (e) => el.suppress && (e.preventDefault(), e.stopImmediatePropagation(), (el.suppress = false)), true);
    el.addEventListener('contextmenu', (e) => drag && drag.el === el && e.preventDefault());
  }
  function arm(s) {
    s.armed = true;
    s.el.classList.add('dragging');
    // A dragged folder carries its contents: hide them while it moves.
    if (s.el.node.t === 'f') s.el.parentElement.classList.add('carrying');
    try {
      s.el.setPointerCapture(s.id);
    } catch {} // the pointer may already be gone (a long-press released just now)
  }
  const clearMarks = () => root.querySelectorAll('.before,.after,.merge').forEach((x) => x.classList.remove('before', 'after', 'merge'));
  function hover(x, y) {
    clearMarks();
    drag.target = null;
    const hit = document.elementFromPoint(x, y), row = hit && hit.closest('.node');
    if (!row || row === drag.el || !root.contains(row)) return;
    // Nothing can go inside itself.
    if (drag.el.node.t === 'f' && drag.el.parentElement.contains(row)) return;
    const r = row.getBoundingClientRect(), f = (y - r.top) / r.height;
    const where = f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'merge';
    row.classList.add(where);
    drag.target = { node: row.node, path: row.path, where };
  }
  function move(e) {
    const s = drag;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.armed) {
      if (s.touch) Math.hypot(dx, dy) > 10 && (clearTimeout(s.timer), (drag = null)); // a scroll, not a drag
      else if (Math.hypot(dx, dy) > 6) arm(s);
      return;
    }
    e.preventDefault();
    s.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    hover(e.clientX, e.clientY);
  }
  function end(e) {
    const s = drag;
    if (!s || e.pointerId !== s.id) return;
    clearTimeout(s.timer);
    drag = null;
    if (!s.armed) return;
    s.el.suppress = true; // the pointerup would otherwise open the Safe or toggle the folder
    s.el.classList.remove('dragging');
    s.el.style.transform = '';
    if (s.el.parentElement) s.el.parentElement.classList.remove('carrying');
    clearMarks();
    if (e.type === 'pointerup' && s.target) drop(s.el.node, s.el.path, s.target);
  }

  function drop(node, from, target) {
    const t = recent.tree(), m = meta(), src = levelOf(t, from).find((x) => same(x, node));
    if (!src || same(src, target.node) || (src.t === 'f' && (target.path.includes(src.id) || contains(src, target.node.id)))) return draw();
    detach(levelOf(t, from), src);
    const items = levelOf(t, target.path), dst = items.find((x) => same(x, target.node));
    if (!dst) return draw();
    if (target.where === 'merge') {
      const open = openSet();
      if (dst.t === 'f') dst.items.unshift(src), open.add(dst.id);
      else {
        const f = { t: 'f', id: Math.random().toString(36).slice(2, 10), name: '', items: [dst, src] };
        items.splice(items.indexOf(dst), 1, f);
        open.add(f.id);
      }
      saveOpen(open);
    } else {
      // Reorder in display order, keeping pinned Safes on top.
      const v = view(items, m), firstFree = v.findIndex((x) => !pinned(x, m)), edge = firstFree < 0 ? v.length : firstFree;
      let i = v.findIndex((x) => same(x, dst)) + (target.where === 'after' ? 1 : 0);
      i = pinned(src, m) ? Math.min(i, edge) : Math.max(i, edge);
      v.splice(i, 0, src);
      items.splice(0, items.length, ...v);
    }
    recent.saveTree(t);
    draw();
  }

  draw();
  return {
    refresh: draw,
    filter(q) {
      query = q.trim().toLowerCase();
      draw();
      return query ? recent.safes().filter((e) => words(e).includes(query)) : null;
    },
  };
}
