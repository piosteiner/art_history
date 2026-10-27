// Typo-tolerant pickers for form fields that reference another entity (browser code, part of editor.js).
//
//   <input data-lookup="place">                 value = a slug of that type (e.g. a place's parent, an artwork's creator)
//   <input data-lookup="artist,person">         several types: value = "type/slug" (the Enrich page's "link to another")
//   <input data-lookup-from="r-type">           value = "type/slug"; allowed types come from the selected <option
//                                               data-object-types="place,institution"> of that <select> (relationship target)
//
//   data-quick-new="person,institution,artist"  also offers "+ New person “…”" for the name as typed (not for a type that
//                                               has an entry of exactly that name): value "new:person:Name" — the
//                                               server creates it on save, flagged "to complete" (src/admin/provenance.js)
//
// Suggestions come from GET /lookup (fuzzy name + alternative-name match, src/admin/match.js). The input keeps
// holding the slug, so the form posts exactly what it did before; the browser's <datalist> is the no-JS fallback.

let uid = 0;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function enhance(input) {
  const withType = input.hasAttribute('data-lookup-from');
  const several = !withType && String(input.dataset.lookup || '').includes(',');
  const typeSelect = withType ? document.getElementById(input.dataset.lookupFrom) : null;
  const allowedTypes = () => (withType
    ? (typeSelect.selectedOptions[0]?.dataset.objectTypes || '').split(',').filter(Boolean)
    : String(input.dataset.lookup).split(','));
  const quickTypes = String(input.dataset.quickNew || '').split(',').filter(Boolean);
  const valueOf = (hit) => (hit.quick ? `new:${hit.type}:${hit.name}` : withType || several ? `${hit.type}/${hit.slug}` : hit.slug);
  const fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // "+ New …" for the name as typed: the allowed quick types without an entry of exactly that name
  const quickHits = (typed, found) => quickTypes.filter((type) => allowedTypes().includes(type)
    && !found.some((h) => h.type === type && fold(h.name) === fold(typed))).map((type) => ({ quick: true, type, name: typed }));

  input.removeAttribute('list');  // our list replaces the browser's datalist
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  const wrap = el('div', 'ac');
  input.replaceWith(wrap);
  wrap.append(input);
  const list = el('ul', 'ac-list');
  list.id = `ac-${++uid}`;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.setAttribute('aria-controls', list.id);
  const chosen = el('div', 'hint ac-chosen');
  wrap.append(list, chosen);

  let hits = [];
  let active = -1;
  let timer = null;
  let seq = 0;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function highlight(i) {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', list.children[i].id);
      list.children[i].scrollIntoView({ block: 'nearest' });
    }
  }

  function showChosen(hit) {
    chosen.textContent = !hit ? '' : hit.quick ? `→ new ${hit.type} “${hit.name}” — created when you save, marked “to complete” on the Quality page`
      : `→ ${hit.name} (${hit.type}${hit.period_label ? `, ${hit.period_label}` : ''})`;
  }

  function pick(i) {
    const hit = hits[i];
    if (!hit) return;
    input.value = valueOf(hit);
    showChosen(hit);
    close();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function render() {
    list.textContent = '';
    hits.forEach((h, i) => {
      const li = el('li', 'ac-item');
      li.id = `${list.id}-${i}`;
      li.setAttribute('role', 'option');
      const top = el('div');
      if (h.quick) {
        li.classList.add('ac-new');
        top.append(el('b', '', `+ New ${h.type} “${h.name}”`));
        li.append(top, el('div', 'muted small', 'created with this step — complete it later'));
      } else {
        top.append(el('b', '', h.name), ' ', el('span', 'tag', h.type), ' ', el('span', 'muted', h.period_label || ''));
        li.append(top, el('div', 'muted small', [h.slug, h.alt].filter(Boolean).join(' · ')));
      }
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });  // before the input loses focus
      list.append(li);
    });
    if (!hits.length) list.append(el('li', 'ac-empty muted', 'No match — check the spelling, or create it first.'));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(hits.length ? 0 : -1);
  }

  async function query(q) {
    const types = allowedTypes();
    const mine = ++seq;
    const res = await fetch(`/lookup?${new URLSearchParams({ q, types: types.join(',') })}`, { credentials: 'same-origin' });
    if (!res.ok || mine !== seq) return null;  // a newer keystroke already asked again
    return res.json();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    showChosen(null);
    const q = input.value.trim().replace(/^[a-z]+\//, '');  // "place/par" → search "par"
    if (!q) { close(); return; }
    timer = setTimeout(async () => {
      const result = await query(q);
      if (!result) return;
      // Typed (or pasted) exactly an existing value: that is the choice — no list over the form's buttons.
      const exact = result.find((h) => valueOf(h) === input.value.trim());
      if (exact) { showChosen(exact); close(); return; }
      hits = [...result, ...quickHits(input.value.trim(), result)];
      render();
    }, 150);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(active + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }  // pick, don't submit the form
    else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); close(); }  // an open list only: else Esc is the page's (closing a dialog)
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
  if (typeSelect) typeSelect.addEventListener('change', () => { if (!list.hidden) input.dispatchEvent(new Event('input')); });

  // Editing an existing value: show which entity the slug stands for.
  const current = input.value.trim();
  const pending = /^new:([a-z]+):(.+)$/s.exec(current);   // a quick-add not saved yet (the form came back with an error)
  if (pending) showChosen({ quick: true, type: pending[1], name: pending[2] });
  else if (current) {
    query(current.replace(/^[a-z]+\//, '')).then((result) => {
      showChosen((result || []).find((h) => valueOf(h) === current) || null);
    });
  }
}

export function initAutocomplete(root = document) {
  root.querySelectorAll('input[data-lookup], input[data-lookup-from]').forEach(enhance);
}
