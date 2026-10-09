// The sources dialogs (src/admin/citations.js → marker): open one at a time, close with Esc / "close" / a click beside;
// add and remove sources without reloading the page. The server answers a fetch with the affected markers rendered
// anew ({markers: {key: html}, recent: html}); they replace the old ones, the open dialog stays open, the quick-select
// chips are refreshed in every dialog. "Also for" adds the same source to other fields of the entry in one go.
// On the edit page the dialogs sit after the entry's form (forms can't nest): a button with the same badges stands
// next to each field's label, and each chosen field's current form values go along (`expect`) — a source for a value
// changed in the working copy waits for it to be published.
import { initAutocomplete } from './autocomplete';

const mainForm = () => document.querySelector('form.form[data-collab], form.form[data-draft]');
const editMode = (d) => d.dataset.citeEdit === '1';
const markerFor = (key, edit) => [...document.querySelectorAll('details.cite[data-cite-key]')]
  .find((d) => d.dataset.citeKey === key && editMode(d) === edit);

// a field's values in the entry's form (edit page)
function valuesOf(field) {
  const main = mainForm();
  if (!main) return {};
  return Object.fromEntries([...new FormData(main)]
    .filter(([k, v]) => typeof v === 'string' && (k === `f.${field}` || k.startsWith(`f.${field}_`))));
}

// the entry this page is about: from a field marker's form
function entityOf() {
  const f = document.querySelector('details.cite form.cite-add input[name="type"]');
  return f ? { type: f.value, id: f.form.elements.id.value } : {};
}

// "Also for": the other fields with a marker on this page, as checkboxes (filled when the dialog opens)
function fillAlso(d) {
  const box = d.querySelector('.cite-also');
  if (!box || box.dataset.filled) return;
  const own = d.dataset.citeKey;
  const others = [...document.querySelectorAll('details.cite[data-cite-key^="field:"]')]
    .filter((o) => o.dataset.citeKey !== own && editMode(o) === editMode(d));
  if (!others.length) return;
  box.replaceChildren();
  const title = document.createElement('div');
  title.className = 'small muted';
  title.textContent = 'Also for these fields (the same source):';
  box.append(title);
  for (const o of others) {
    const label = document.createElement('label');
    label.className = 'choice small';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'also';
    cb.value = o.dataset.citeKey.slice('field:'.length);
    label.append(cb, ` ${o.dataset.citeLabel.replace(/^“|”$/g, '')}`);
    box.append(label);
  }
  box.hidden = false;
  box.dataset.filled = '1';
}

function status(d, text, kind = 'ok') {
  const el = d && d.querySelector('.cite-status');
  if (!el) return;
  el.textContent = text;
  el.className = `cite-status small ${kind === 'ok' ? 'cite-ok' : 'cite-warn'}`;
}

// the edit page: a button with the marker's badges next to the field's label
function placeTrigger(d) {
  const main = mainForm();
  const field = d.dataset.citeField;
  let btn = document.querySelector(`.cite-trigger[data-for-field="${CSS.escape(field)}"]`);
  if (!btn) {
    const input = main && [...main.elements].find((el) => el.name === `f.${field}` || (el.name || '').startsWith(`f.${field}_`));
    const label = input && input.closest('.field') && input.closest('.field').querySelector('label');
    if (!label) return;  // a field this form doesn't show
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cite-trigger';
    btn.dataset.forField = field;
    btn.setAttribute('aria-label', `sources of ${label.textContent.trim()}`);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(`details.cite-edit[data-cite-field="${CSS.escape(field)}"]`);
      if (target) target.open = true;
    });
    // next to the label, not inside it: the label's text (and what a screen reader announces) stays the field's name
    const row = document.createElement('div');
    row.className = 'label-row';
    label.before(row);
    row.append(label, btn);
  }
  btn.innerHTML = d.querySelector(':scope > summary').innerHTML;  // the badges, rendered (and escaped) by the server
}

// Replace the markers the server sent; keep the one the user is working in open.
function apply(result, openKey, edit) {
  for (const [key, markup] of Object.entries(result.markers || {})) {
    const old = markerFor(key, edit);
    if (!old) continue;
    const tpl = document.createElement('template');
    tpl.innerHTML = markup.trim();
    const fresh = tpl.content.firstElementChild;
    old.replaceWith(fresh);
    initAutocomplete(fresh);
    if (edit) placeTrigger(fresh);
    if (key === openKey) { fresh.open = true; fillAlso(fresh); }
  }
  if (result.recent) {
    document.querySelectorAll('details.cite .cite-recent').forEach((el) => {
      const tpl = document.createElement('template');
      tpl.innerHTML = result.recent.trim();
      el.replaceWith(tpl.content.firstElementChild);
    });
  }
}

async function send(form, submitter) {
  const d = form.closest('details.cite');
  const edit = editMode(d);
  const body = new FormData(form, submitter || undefined);
  // which markers to get back: this one, and the fields ticked under "also for"
  const keys = [d.dataset.citeKey, ...body.getAll('also').map((f) => `field:${f}`)];
  const ent = entityOf();
  body.set('refresh', JSON.stringify(keys.map((key) => {
    const m = markerFor(key, edit);
    return { key, label: m ? m.dataset.citeLabel : '', edit, ...ent };
  })));
  if (edit && form.classList.contains('cite-add')) {
    body.set('expect', JSON.stringify(Object.fromEntries(keys.filter((k) => k.startsWith('field:'))
      .map((k) => [k.slice(6), valuesOf(k.slice(6))]))));
  }
  status(d, form.classList.contains('cite-add') ? 'Adding …' : 'Removing …');
  let res;
  try {
    res = await fetch(form.action, { method: 'POST', credentials: 'same-origin', body: new URLSearchParams(body),
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/x-www-form-urlencoded' } });
  } catch {
    status(d, 'Not saved — no connection.', 'warn');
    return;
  }
  const result = await res.json().catch(() => ({ error: 'Not saved — unexpected answer from the server.' }));
  if (!res.ok || result.error) { status(d, result.error || 'Not saved.', 'warn'); return; }
  apply(result, d.dataset.citeKey, edit);
  const fresh = markerFor(d.dataset.citeKey, edit);
  const n = keys.length;
  status(fresh, form.classList.contains('cite-add') ? (n > 1 ? `Source added to ${n} fields.` : 'Source added.') : 'Source removed.');
  const first = fresh && fresh.querySelector('form.cite-add input[name="url"]');
  if (first) first.focus();
}

export function initCiteDialogs() {
  const closeAll = (except) => document.querySelectorAll('details.cite[open]').forEach((d) => { if (d !== except) d.open = false; });
  document.addEventListener('toggle', (e) => {
    if (e.target.matches && e.target.matches('details.cite') && e.target.open) { closeAll(e.target); fillAlso(e.target); }
  }, true);
  // Esc: not when something inside used it already (an autocomplete list closes first)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) closeAll(null); });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.cite-close');
    if (btn) { e.preventDefault(); btn.closest('details.cite').open = false; }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.closest || !form.closest('details.cite') || !(form.matches('form.cite-add') || form.matches('form.cite-remove'))) return;
    e.preventDefault();
    send(form, e.submitter);
  });
}

export function initCiteTriggers() {
  if (!mainForm()) return;
  document.querySelectorAll('details.cite-edit[data-cite-field]').forEach(placeTrigger);
}
