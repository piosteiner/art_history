// Entry forms that fill themselves out (owner 2026-11-04): the rules of src/admin/relevance.js, applied as you type.
//  - a field the chosen kind doesn't use is hidden while empty; with a value it stays, dimmed ("unusual for …")
//  - a field the kind (or another field's value) needs is marked "needed" while empty, and listed in a checklist
//    above the form with links; a closed group holding a needed field opens
//  - a section or group whose fields are all hidden hides with them; "show all fields" brings everything back
//    (remembered per type in this browser)
const SUFFIX = /_(label|lang|lon|lat|h|w|d|unit)$/;
const STORE = (type) => `arthistory.cms.showAll:${type}`;

export function initRelevance() {
  const form = document.querySelector('form.form[data-relevance]');
  if (!form) return;
  let rules;
  try { rules = JSON.parse(form.dataset.relevance); } catch { return; }
  const type = document.body.dataset.pageType || '';
  const fields = [...form.querySelectorAll('.field')].map((el) => ({ el, key: keyOf(el) })).filter((f) => f.key);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const driver = rules.driver ? form.querySelector(`[name="f.${rules.driver}"]`) : null;
  const sections = [...form.querySelectorAll('.form-section')];
  const groups = [...form.querySelectorAll('details.field-group')];

  // the checklist bar before the sections, and a note under the driver
  const bar = document.createElement('div');
  bar.className = 'form-relevance';
  bar.setAttribute('aria-live', 'polite');
  (form.querySelector('.form-nav') || form.querySelector('.form-section') || form).insertAdjacentElement(
    form.querySelector('.form-nav') ? 'afterend' : 'beforebegin', bar);
  const note = document.createElement('div');
  note.className = 'hint relevance-note';
  if (driver) driver.closest('.field').append(note); else bar.insertAdjacentElement('afterend', note);   // no driver: under the checklist
  let showAll = false;
  try { showAll = localStorage.getItem(STORE(type)) === '1'; } catch { /* no storage */ }
  const opened = new Set();
  let lastBar = '';

  const valueOf = (key) => {
    const f = byKey.get(key);
    if (!f) return '';
    const el = f.el.querySelector('select, input:not([type=checkbox]):not([type=radio]), textarea');
    if (!el) return '';
    if (el.tagName === 'SELECT') return el.value;
    const box = f.el.querySelector('input[type=checkbox]');
    return box ? (box.checked ? 'yes' : '') : el.value;
  };
  const isEmpty = (f) => [...f.el.querySelectorAll('input, textarea, select')]
    .every((el) => (el.type === 'checkbox' || el.type === 'radio' ? !el.checked : !String(el.value || '').trim() || el.value === '{}'));
  const labelOf = (f) => (f.el.querySelector('label')?.textContent || f.key).replace(/\s*\(.*$/, '').trim();
  const holds = (c) => {
    if (c.allEmpty) return c.allEmpty.every((k) => !String(valueOf(k)).trim());
    const v = String(valueOf(c.field)).trim();
    if (c.filled !== undefined) return c.filled === !!v;
    if (c.is !== undefined) return v.toLowerCase() === String(c.is).toLowerCase();
    if (c.matches) return new RegExp(c.matches, 'i').test(v);
    return false;
  };

  function update() {
    const value = driver ? String(driver.value || '').trim().toLowerCase() : '';
    const set = (rules.values && (rules.values[value] || rules.values['*'])) || {};
    const only = set.only ? new Set(set.only) : null;
    const needed = new Set([...(rules.always?.need || []), ...(set.need || [])]);
    const shownWhen = new Map();   // key → relevant only while a rule holds
    const notes = [];
    if (set.note) notes.push(set.note);
    for (const c of rules.when || []) {
      const on = holds(c);
      // a "show only when" rule hides nothing before its field is filled in (no object type yet: "Designed earlier" stays)
      const undecided = c.field && !String(valueOf(c.field)).trim();
      for (const k of c.show || []) shownWhen.set(k, (shownWhen.get(k) || false) || on || !!undecided);
      if (on) {
        for (const k of c.need || []) needed.add(k);
        if (c.note) notes.push(c.note);
      }
    }
    const missing = [];
    for (const f of fields) {
      const empty = isEmpty(f);
      const used = (!only || only.has(f.key)) && !(shownWhen.has(f.key) && !shownWhen.get(f.key));
      const need = needed.has(f.key) && empty;
      f.el.classList.toggle('needed', need);
      f.el.classList.toggle('unusual', !used && !empty);
      f.el.hidden = !used && empty && !showAll;
      if (!used && !empty) f.el.dataset.unusual = set.label ? `unusual for ${set.label} — kept because it has a value` : 'not usual here — kept because it has a value';
      else delete f.el.dataset.unusual;
      if (need) {
        missing.push(f);
        // a needed field inside a closed group: opened once
        const d = f.el.closest('details.field-group');
        if (d && !d.open && !opened.has(d)) { d.open = true; opened.add(d); }
      }
    }
    for (const sec of sections) sec.hidden = ![...sec.querySelectorAll('.field')].some((f) => !f.hidden);
    for (const d of groups) d.hidden = ![...d.querySelectorAll('.field')].some((f) => !f.hidden);
    const hidden = fields.filter((f) => f.el.hidden).length;
    const hideable = fields.filter((f) => f.el.classList.contains('unusual') || f.el.hidden
      || ((only && !only.has(f.key)) || (shownWhen.has(f.key) && !shownWhen.get(f.key)))).length;
    note.textContent = notes.join(' ');
    note.hidden = !notes.length;
    const what = set.label ? `for ${set.label}` : '';
    const list = missing.map((f) => `<a href="#f-${f.key}" data-focus="${f.key}">${escapeHtml(labelOf(f))}</a>`).join(' · ');
    // rebuilt only when it changes: a blur's change event must not replace the link being clicked
    const barHtml = `${missing.length
      ? `<span class="relevance-missing">Still to fill in${what ? ` ${escapeHtml(what)}` : ''}: ${list}</span>`
      : `<span class="relevance-done">✓ Everything${what ? ` ${escapeHtml(what)}` : ''} is filled in.</span>`}${
      hideable ? `<button type="button" class="link relevance-toggle">${showAll ? `Hide the ${hideable} fields not used ${what ? escapeHtml(what) : 'here'}` : hidden ? `${hidden} ${hidden === 1 ? 'field' : 'fields'} not used ${what ? escapeHtml(what) : 'here'} — show all` : 'Show all fields'}</button>` : ''}`;
    if (barHtml !== lastBar) { bar.innerHTML = barHtml; lastBar = barHtml; }
    bar.hidden = !missing.length && !hideable;
  }
  bar.addEventListener('click', (e) => {
    const t = e.target.closest('.relevance-toggle, [data-focus]');
    if (!t) return;
    e.preventDefault();
    if (t.classList.contains('relevance-toggle')) {
      showAll = !showAll;
      try { localStorage.setItem(STORE(type), showAll ? '1' : '0'); } catch { /* no storage */ }
      update();
      return;
    }
    const f = byKey.get(t.dataset.focus);
    if (!f) return;
    const d = f.el.closest('details.field-group');
    if (d) d.open = true;
    const input = f.el.querySelector('input, select, textarea');
    if (input) { input.focus(); input.scrollIntoView({ block: 'center' }); }
  });
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}

function keyOf(field) {
  const el = field.querySelector('[name^="f."]');
  return el ? el.name.slice(2).replace(SUFFIX, '') : null;
}
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
