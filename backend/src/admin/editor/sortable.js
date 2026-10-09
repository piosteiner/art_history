// Drag-and-drop ordering for lists like the provenance (src/admin/provenance.js): a container [data-sortable="<url>"]
// with items .sort-item[data-sort-id] (each item may be several rows: a <tbody>) and a .drag-handle in each.
// Pointer events, not HTML drag and drop — the same code for mouse, pen and touch (touch-action: none on the handle).
// Keyboard: focus the handle, ↑ / ↓ move the item. The new order is posted as ids=3,1,2; the page then reloads, so
// everything computed from the order (periods, "passed on directly") is shown anew.
export function initSortable() {
  document.querySelectorAll('[data-sortable]').forEach(setup);
}

function setup(box) {
  const items = () => [...box.querySelectorAll(':scope > .sort-item')];
  const order = () => items().map((i) => i.dataset.sortId).join(',');
  const initial = order();
  let timer = null;

  const save = async (focusId) => {
    const now = order();
    if (now === initial) return;
    box.classList.add('sort-saving');
    try { if (focusId) sessionStorage.setItem('sort-focus', focusId); } catch { /* storage off: no refocus */ }
    let res;
    try {
      res = await fetch(box.dataset.sortable, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ids: now }) });
    } catch { res = null; }
    if (!res || !res.ok) window.alert(res ? await res.text() : 'Not saved — no connection. The page reloads with the old order.');
    window.location.reload();
  };

  // after a keyboard move and the reload: the same handle has the focus again
  try {
    const id = sessionStorage.getItem('sort-focus');
    if (id) {
      sessionStorage.removeItem('sort-focus');
      const h = box.querySelector(`.sort-item[data-sort-id="${CSS.escape(id)}"] .drag-handle`);
      if (h) h.focus();
    }
  } catch { /* storage off */ }

  // Dragging: the item stays where it is (hidden) while a floating copy follows the pointer and a placeholder of the
  // same height shows where it will land — the other items make room. The listeners are on the window, not on the
  // handle: nothing that is being moved holds the pointer (moving a captured element loses the capture in Firefox).
  // Esc cancels.
  box.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    if (handle.hasPointerCapture && handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    const item = handle.closest('.sort-item');
    const home = item.nextElementSibling;
    const rect = item.getBoundingClientRect();
    const row = handle.closest('tr');                                   // the item's main row (the one with the handle)
    const rowRect = row.getBoundingClientRect();
    const offset = e.clientY - rowRect.top;

    // the floating copy: a table of its own with the main row's cells at their current widths
    const ghost = box.cloneNode(false);
    ghost.removeAttribute('data-sortable');
    ghost.classList.add('sort-ghost');
    const copy = document.createElement('tbody');
    const rowCopy = row.cloneNode(true);
    [...row.cells].forEach((td, k) => { rowCopy.cells[k].style.width = `${td.getBoundingClientRect().width}px`; });
    copy.append(rowCopy);
    ghost.append(copy);
    Object.assign(ghost.style, { left: `${rowRect.left}px`, top: `${rowRect.top}px`, width: `${rowRect.width}px` });
    document.body.append(ghost);

    // the gap where it would land
    const gap = document.createElement('tbody');
    gap.className = 'sort-placeholder';
    gap.innerHTML = `<tr><td colspan="99" style="height:${rect.height}px"></td></tr>`;
    box.insertBefore(gap, item);
    item.hidden = true;
    document.body.classList.add('sorting');

    const move = (ev) => {
      ghost.style.top = `${ev.clientY - offset}px`;
      // the gap goes before the first other item whose middle (of its main row, the one with the handle) is below
      // the pointer — not counting a step's "passed on directly" line above it
      const before = items().filter((i) => i !== item && !i.hidden).find((o) => {
        const main = o.querySelector('.drag-handle');
        const r = (main ? main.closest('tr') || o : o).getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (before) { if (gap.nextElementSibling !== before) box.insertBefore(gap, before); } else if (box.lastElementChild !== gap) box.append(gap);
      if (ev.clientY < 60) window.scrollBy(0, -12);                     // near the edges: scroll along
      else if (ev.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    };
    const finish = (commit) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      box.insertBefore(item, commit ? gap : home);
      gap.remove();
      ghost.remove();
      item.hidden = false;
      document.body.classList.remove('sorting');
      if (commit) save();
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  });

  box.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const item = handle.closest('.sort-item');
    if (e.key === 'ArrowUp' && item.previousElementSibling && item.previousElementSibling.matches('.sort-item')) box.insertBefore(item, item.previousElementSibling);
    if (e.key === 'ArrowDown' && item.nextElementSibling) box.insertBefore(item.nextElementSibling, item);
    handle.focus();
    clearTimeout(timer);
    timer = setTimeout(() => save(item.dataset.sortId), 800);              // several presses, one save
  });
}
