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

  box.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    const item = handle.closest('.sort-item');
    item.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      // the item goes before the first other item whose middle is below the pointer — the middle of its main row
      // (the one with the handle), not of the whole item: a step's "passed on directly" line above it doesn't count
      const before = items().filter((i) => i !== item).find((o) => {
        const main = o.querySelector('.drag-handle');
        const r = (main ? main.closest('tr') || o : o).getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (before) { if (item.nextElementSibling !== before) box.insertBefore(item, before); } else if (box.lastElementChild !== item) box.appendChild(item);
      if (ev.clientY < 60) window.scrollBy(0, -12);                     // near the edges: scroll along
      else if (ev.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      item.classList.remove('dragging');
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
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
