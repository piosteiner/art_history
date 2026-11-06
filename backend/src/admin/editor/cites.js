// The sources dialogs (src/admin/citations.js → marker): open one at a time, close with Esc / "close" / a click beside;
// add and remove sources without reloading the page. The server answers a fetch with the affected markers rendered
// anew ({markers: {key: html}, recent: html}); they replace the old ones, the open dialog stays open, the quick-select
// chips are refreshed in every dialog. "Also for" adds the same source to other fields of the entry in one go.
// On the edit page the dialogs sit after the entry's form (forms can't nest): a button with the same badges stands
// next to each field's label, and each chosen field's current form values go along (`expect`) — a source for a value
// changed in the working copy waits for it to be published.
// The entry's own web page (an artwork's "Web page", an institution's website) is offered first in every dialog as
// soon as the field holds an address — on the edit page from the form, so also before it is published (owner
// 2026-11-06); one click adds it like a pasted link (the website as the source, this page and today's date).
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

// The page's "Data quality" box and queue bar (.qa-slot, routes/entries.js qaSlot): asked again after a change in a
// dialog — the server answers once the entry's findings are computed again (a moment), at most a few tries
async function refreshQuality(tries = 4) {
  const slot = document.querySelector('.qa-slot[data-qa-url]');
  if (!slot) return;
  try {
    const res = await fetch(slot.dataset.qaUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const { settled, html } = await res.json();
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    const fresh = tpl.content.firstElementChild;
    if (fresh) slot.replaceWith(fresh);
    if (!settled && tries > 1) setTimeout(() => refreshQuality(tries - 1), 1000);
  } catch { /* offline: the next reload shows it */ }
}

// the entry's web page: the form's field (the working copy, published or not), else the published one (view page)
function entryWebPage() {
  const main = mainForm();
  const field = main && (main.elements['f.web_url'] || main.elements['f.website_url']);
  const v = (field ? field.value : document.body.dataset.pageWebUrl || '').trim();
  return /^https?:\/\/\S+$/.test(v) ? v : '';
}

// "This entry's web page …" at the top of a dialog's add form — not when that page is a source here already
function offerWebPage(d) {
  if (!d) return;
  const form = d.querySelector('form.cite-add');
  if (!form) return;
  form.querySelector('.cite-webpage')?.remove();
  const url = entryWebPage();
  if (!url || [...d.querySelectorAll('.cite-panel > ul a[href]')].some((a) => a.getAttribute('href') === url)) return;
  const box = document.createElement('div');
  box.className = 'cite-webpage';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cite-chip cite-chip-webpage';
  let shown = url;
  try { const u = new URL(url); shown = `${u.host}${u.pathname}`.replace(/\/$/, ''); } catch { /* as typed */ }
  btn.textContent = 'This entry’s web page';
  const page = document.createElement('span');
  page.className = 'cite-chip-page';
  page.textContent = ` ${shown.length > 60 ? `${shown.slice(0, 57)}…` : shown}`;
  btn.append(page);
  btn.title = `${url} — adds it as a source (with the page no. and note above, if any)`;
  btn.addEventListener('click', () => {
    form.elements.url.value = url;
    form.requestSubmit();
  });
  box.append(btn);
  form.prepend(box);
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
    // (the ⓘ of the help may have made the row already — editor/hints.js: then the badges go right after the label)
    if (label.parentElement.classList.contains('label-row')) label.after(btn);
    else {
      const row = document.createElement('div');
      row.className = 'label-row';
      label.before(row);
      row.append(label, btn);
    }
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
    // a button standing in for it elsewhere (a further number's on the edit page): the same badges
    document.querySelectorAll(`.cite-trigger[data-for-key="${CSS.escape(key)}"]`).forEach((b) => { b.innerHTML = fresh.querySelector(':scope > summary').innerHTML; });
    if (key === openKey) { fresh.open = true; fillAlso(fresh); }
  }
  if (result.recent) {
    document.querySelectorAll('details.cite .cite-recent').forEach((el) => {
      const tpl = document.createElement('template');
      tpl.innerHTML = result.recent.trim();
      const chips = tpl.content.firstElementChild;
      el.replaceWith(chips);
      markUsed(chips);
    });
  }
}

// The quick-select chips are the same for every dialog: in each, those of sources it cites already are disabled (a
// source cites a piece of information once, 143 — the dialog's source field knows them: data-cited)
function markUsed(chips) {
  const d = chips.closest('details.cite');
  const cited = new Set(String(d?.querySelector('input[name=source]')?.dataset.cited || '').split(',').filter(Boolean));
  chips.querySelectorAll('.cite-chip[data-slug]').forEach((b) => {
    if (!cited.has(b.dataset.slug) || b.disabled) return;
    b.disabled = true;
    b.type = 'button';
    b.removeAttribute('name');
    b.classList.add('cite-chip-used');
    b.title = 'already a source here';
    b.textContent = `${b.textContent.trim()} ✓`;
  });
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
  const confirming = form.classList.contains('cite-confirm');
  status(d, form.classList.contains('cite-add') ? 'Adding …' : confirming ? 'Saving …' : 'Removing …');
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
  offerWebPage(fresh);   // gone once that page is a source here
  refreshQuality();      // the findings follow (a source added, removed or confirmed): the box and the queue's bar
  const n = keys.length;
  status(fresh, form.classList.contains('cite-add') ? (n > 1 ? `Source added to ${n} fields.` : 'Source added.') : confirming ? 'Noted: the source still supports it.' : 'Source removed.');
  const first = fresh && fresh.querySelector('form.cite-add input[name="url"]');
  if (first) first.focus();
}

// A dialog the page doesn't have yet — a name typed in the edit form (190): the server renders it, it joins the others.
async function fetchMarker(key, label) {
  const box = document.querySelector('.cite-dialogs[data-type]');
  if (!box) return null;
  const body = new URLSearchParams({ back: box.dataset.back,
    refresh: JSON.stringify([{ key, label, edit: false, type: box.dataset.type, id: box.dataset.id }]) });
  try {
    const res = await fetch('/citations/markers', { method: 'POST', credentials: 'same-origin', body,
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/x-www-form-urlencoded' } });
    const markup = res.ok ? ((await res.json()).markers || {})[key] : null;
    if (!markup) return null;
    if (markerFor(key, false)) return markerFor(key, false);   // pressed twice meanwhile
    const tpl = document.createElement('template');
    tpl.innerHTML = markup.trim();
    const fresh = tpl.content.firstElementChild;
    box.append(fresh);
    initAutocomplete(fresh);
    fresh.querySelectorAll('.cite-recent').forEach(markUsed);
    return fresh;
  } catch { return null; }
}

// The badges of a marker by its key — for a button made on the page (editor/names.js); "+" when there is none yet.
export function badgesFor(key) {
  const d = markerFor(key, false);
  return d ? d.querySelector(':scope > summary').innerHTML : '<span class="cite-badge cite-none" title="no source yet — click to add one">+</span>';
}

export function initCiteDialogs() {
  const closeAll = (except) => document.querySelectorAll('details.cite[open]').forEach((d) => { if (d !== except) d.open = false; });
  document.addEventListener('toggle', (e) => {
    if (e.target.matches && e.target.matches('details.cite') && e.target.open) { closeAll(e.target); fillAlso(e.target); offerWebPage(e.target); }
  }, true);
  // Esc: not when something inside used it already (an autocomplete list closes first)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) closeAll(null); });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.cite-close');
    if (btn) { e.preventDefault(); btn.closest('details.cite').open = false; }
    const opener = e.target.closest('.cite-trigger[data-for-key]');
    if (opener) {
      e.preventDefault();
      const d = markerFor(opener.dataset.forKey, false);
      if (d) d.open = true;
      else fetchMarker(opener.dataset.forKey, opener.dataset.citeLabel || '').then((m) => { if (m) m.open = true; });
    }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.closest || !form.closest('details.cite') || !(form.matches('form.cite-add') || form.matches('form.cite-remove') || form.matches('form.cite-confirm'))) return;
    e.preventDefault();
    send(form, e.submitter);
  });
}

export function initCiteTriggers() {
  if (!mainForm()) return;
  document.querySelectorAll('details.cite-edit[data-cite-field]').forEach(placeTrigger);
}
