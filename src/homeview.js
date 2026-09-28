// "Safes" on Home: an iOS-style layout of Safes and (nested) folders.
// Drag to reorder, drop onto a Safe to make a folder, onto a folder to move in,
// onto the back bar to move up a level. Pinned Safes always sit on top of their level.
import { label } from './chains.js';
import * as recent from './recent.js';
import { h, icon, iconButton, ICONS, put, short } from './ui.js';

// A folder with an arrow coming out of it.
const UNGROUP = ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 16v-5', 'm9.5 13.5 2.5-2.5 2.5 2.5'];
const FOLDER = ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'];

// One drag at a time, tracked with document listeners registered once.
let drag = null;
document.addEventListener('pointermove', (e) => drag && drag.move(e));
document.addEventListener('pointerup', (e) => drag && drag.end(e));
document.addEventListener('pointercancel', (e) => drag && drag.end(e));

/** Mount the list into `root`; `chainId()` gives the connected chain (other chains are dimmed). */
export function mountSafes(root, chainId) {
  let path = []; // folder ids from the root to the open folder
  const meta = () => new Map(recent.safes().map((e) => [recent.keyOf(e), e]));

  // ---- tree helpers ----
  const levelOf = (t, p) => p.reduce((items, id) => (items.find((n) => n.id === id) || { items }).items, t);
  const folderAt = (t, p) => p.reduce((f, id) => (f ? f.items : t).find((n) => n.id === id), null);
  const pinned = (n, m) => n.t === 's' && !!(m.get(n.k) || {}).pinned;
  const view = (items, m) => [...items.filter((n) => pinned(n, m)), ...items.filter((n) => !pinned(n, m))];
  const same = (a, b) => a === b || (a.t === 's' ? b.t === 's' && a.k === b.k : a.id === b.id);
  const detach = (items, n) => items.splice(items.findIndex((x) => same(x, n)), 1);

  // ---- rows ----
  function safeRow(n, m) {
    const e = m.get(n.k), here = chainId() === e.chainId;
    const title = e.label || e.ref || 'Safe ' + short(e.address);
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
      const undo = h('div.saferow.removed', h('span.mut', 'Removed ' + title + '.'), h('button.link', { onclick: () => (recent.restore(gone), recent.saveTree(snapshot), draw()) }, 'Undo'));
      el.replaceWith(undo);
      setTimeout(() => undo.isConnected && undo.remove(), 6000);
    };
    const el = h(
      'a.saferow.node' + (here ? '' : '.other'),
      { href: '#/' + (e.ref || e.address), title: here ? null : 'Switch your wallet to ' + label(e.chainId).name + ' to open this Safe' },
      h('div.info', h('div.nline', name, e.pinned && h('span.pinned', icon(...ICONS.pin))), h('div.meta', h('code', short(e.address)), h('span.chip', label(e.chainId).name), h('span', recent.ago(e.at)))),
      h(
        'div.acts',
        iconButton('pin', e.pinned ? 'Unpin' : 'Pin', () => (recent.update(e.chainId, e.address, { pinned: !e.pinned }), draw()), e.pinned),
        iconButton('edit', 'Rename', rename),
        iconButton('close', 'Remove from this list', remove),
      ),
      h('span.go', icon(...ICONS.next)),
    );
    return el;
  }

  function folderRow(n, m) {
    const names = [];
    const walk = (x) => (x.t === 's' ? names.push((m.get(x.k) || {}).label || (m.get(x.k) || {}).ref || short((m.get(x.k) || { address: '' }).address)) : x.items.forEach(walk));
    walk(n);
    return h(
      'div.saferow.node.folder',
      { role: 'button', tabindex: 0, onclick: () => go([...path, n.id], 1), onkeydown: (k) => { if (k.key === 'Enter') go([...path, n.id], 1); } },
      h('div.info', h('div.nline', h('span.finl', icon(...FOLDER)), h('b.name', recent.folderName(n))), h('div.meta', h('span', (n.name ? names.length + (names.length === 1 ? ' Safe · ' : ' Safes · ') : '') + names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '')))),
      h('span.go', icon(...ICONS.next)),
    );
  }

  // ---- level view ----
  function levelView() {
    const t = recent.tree(), m = meta(), items = levelOf(t, path), f = folderAt(t, path);
    if (path.length && !f) return (path = []), levelView(); // folder vanished (e.g. emptied)
    const rows = view(items, m).map((n) => {
      const el = n.t === 's' ? safeRow(n, m) : folderRow(n, m);
      el.node = n;
      dragify(el);
      return el;
    });
    let head = h('h2', 'Safes');
    if (f) {
      const parent = path.length > 1 ? folderAt(t, path.slice(0, -1)) : null;
      const name = h('b.fname', recent.folderName(f));
      const rename = iconButton('edit', 'Rename folder', () => {
        const inp = h('input.rename', { value: f.name || '', placeholder: recent.folderName({ ...f, name: '' }), maxlength: 40 });
        const save = (keep) => {
          if (keep) {
            const t2 = recent.tree(), f2 = folderAt(t2, path);
            if (f2) (f2.name = inp.value.trim().slice(0, 40)), recent.saveTree(t2);
          }
          draw();
        };
        inp.onkeydown = (k) => (k.key === 'Enter' ? save(true) : k.key === 'Escape' ? save(false) : null);
        inp.onblur = () => save(true);
        name.replaceWith(inp);
        inp.focus();
        inp.select();
      });
      const ungroup = h('button.ungroup', { onclick: () => {
        const t2 = recent.tree(), up = levelOf(t2, path.slice(0, -1)), i = up.findIndex((x) => x.id === f.id);
        up.splice(i, 1, ...folderAt(t2, path).items);
        recent.saveTree(t2);
        go(path.slice(0, -1), -1);
      }, title: 'Ungroup: move these Safes to ' + (parent ? recent.folderName(parent) : 'Safes') + ' and remove the folder' }, icon(...UNGROUP), 'Ungroup');
      const back = h('button.homeback.dropup', { onclick: () => go(path.slice(0, -1), -1) }, icon('m15 6-6 6 6 6'), parent ? recent.folderName(parent) : 'Safes');
      head = h('div.fhead', back, h('div.ftitle', name, rename), ungroup);
    }
    return h('div.level', head, rows, !path.length && rows.length > 1 && recent.safes().length > 1 && h('p.hint', 'Drag to reorder; drop one Safe onto another to make a folder.'));
  }

  // ---- navigation with a quick slide ----
  function go(p, dir) {
    path = p;
    const old = root.firstChild, next = levelView();
    if (!old || !dir || matchMedia('(prefers-reduced-motion: reduce)').matches) return put(root, next);
    root.classList.add('sliding');
    next.classList.add(dir > 0 ? 'from-right' : 'from-left');
    old.classList.add('leaving', dir > 0 ? 'to-left' : 'to-right');
    root.append(next);
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove('from-right', 'from-left')));
    setTimeout(() => (old.remove(), root.classList.remove('sliding')), 200);
  }
  const draw = () => put(root, levelView());

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
    s.el.setPointerCapture && s.el.setPointerCapture(s.id);
  }
  const clearMarks = () => root.querySelectorAll('.before,.after,.merge,.dropup.over').forEach((x) => x.classList.remove('before', 'after', 'merge', 'over'));
  function hover(x, y) {
    clearMarks();
    drag.target = null;
    const el = document.elementFromPoint(x, y), up = el && el.closest('.dropup');
    if (up && root.contains(up)) return up.classList.add('over'), (drag.target = { up: true });
    const row = el && el.closest('.node');
    if (!row || row === drag.el || !root.contains(row)) return;
    const r = row.getBoundingClientRect(), f = (y - r.top) / r.height;
    const where = f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'merge';
    row.classList.add(where);
    drag.target = { node: row.node, where };
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
    s.el.suppress = true; // the pointerup would otherwise open the Safe
    s.el.classList.remove('dragging');
    s.el.style.transform = '';
    clearMarks();
    if (e.type === 'pointerup' && s.target) drop(s.el.node, s.target);
  }

  function drop(node, target) {
    const t = recent.tree(), m = meta(), items = levelOf(t, path);
    const src = items.find((x) => same(x, node));
    if (!src) return draw();
    if (target.up) {
      detach(items, src);
      levelOf(t, path.slice(0, -1)).unshift(src);
    } else if (target.where === 'merge') {
      const dst = items.find((x) => same(x, target.node));
      detach(items, src);
      if (dst.t === 'f') dst.items.unshift(src);
      else items.splice(items.indexOf(dst), 1, { t: 'f', id: Math.random().toString(36).slice(2, 10), name: '', items: [dst, src] });
    } else {
      // Reorder in display order, keeping pinned Safes on top.
      const v = view(items, m).filter((x) => !same(x, src)), firstFree = v.findIndex((x) => !pinned(x, m)), edge = firstFree < 0 ? v.length : firstFree;
      let i = v.findIndex((x) => same(x, target.node)) + (target.where === 'after' ? 1 : 0);
      i = pinned(src, m) ? Math.min(i, edge) : Math.max(i, edge);
      v.splice(i, 0, src);
      items.splice(0, items.length, ...v);
    }
    recent.saveTree(t);
    draw();
  }

  draw();
  return { refresh: draw };
}
