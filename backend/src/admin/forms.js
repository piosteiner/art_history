// Entity forms, driven by the field kinds in src/content.js. A submitted form becomes a doc (the same shape as a
// YAML file), which then goes through the same toRow() validation as the import.
const { html } = require('./html');

const DATE_HINT = html`e.g. <code>1853</code> · <code>1888-02</code> · <code>1853-03-30</code> · <code>1886-03/1888-02-20</code> (from/to, inclusive)
  · <code>13th century</code> · <code>late 13th century</code> · <code>first half of the 13th century</code> · <code>1880s</code>`;
const HINTS = {
  md: html`Markdown: <code>*italic*</code>, <code>**bold**</code>, <code>[link](https://…)</code>, blank line = new paragraph.`,
  'text[]': 'One per line.',
  country_codes: 'Modern countries on its territory, ISO codes, one per line (e.g. CN for the Han dynasty; UA, RU, BY … for the USSR). Shown as "today …" only for entries without a place.',
  inventory_number: 'Only together with the institution above — the number belongs to its collection.',
  materials: 'One per line, e.g. oil paint · canvas — or bronze · marble. The "medium" above stays the readable description.',
  json: 'JSON object, e.g. {"sources": ["…"]}. Leave empty for none.',
  area: 'GeoJSON Polygon or MultiPolygon, [longitude, latitude] pairs (optional outline for regions).',
  date: DATE_HINT,
  period: html`${DATE_HINT} · <code>1808/</code> (since 1808, ongoing)`,
  label: 'Optional display text, e.g. "c. 1480". Empty = generated from the date.',
  point: 'Decimal degrees. Tip: right-click a spot in OpenStreetMap → "Show address" shows its coordinates.',
  slug: 'Lowercase, digits and hyphens: used in URLs (typed text is converted). Keep stable once published.',
};

const humanize = (key) => key.replace(/_md$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// doc → the string values the inputs show.
function docToForm(doc, fields) {
  const f = {};
  for (const [key, kind] of Object.entries(fields)) {
    const v = doc[key];
    if (kind === 'text[]') f[key] = (v || []).join('\n');
    else if (kind === 'json' || kind === 'area') f[key] = v ? JSON.stringify(v, null, 2) : '';
    else if (kind === 'point') { f[`${key}_lon`] = v ? String(v[0]) : ''; f[`${key}_lat`] = v ? String(v[1]) : ''; }
    else if (kind === 'dimensions') ['h', 'w', 'd'].forEach((x, i) => { f[`${key}_${x}`] = v && v[i] !== undefined ? String(v[i]) : ''; });
    else if (kind === 'date' || kind === 'period') { f[key] = v ?? ''; f[`${key}_label`] = doc[`${key}_label`] ?? ''; }
    else f[key] = v ?? '';
  }
  return f;
}

// Submitted body → { doc, errors }. Empty inputs are left out of the doc (= NULL / default).
function formToDoc(body, fields) {
  const doc = {};
  const errors = [];
  const get = (k) => String(body[`f.${k}`] ?? '').replace(/\r\n/g, '\n');
  for (const [key, kind] of Object.entries(fields)) {
    const v = get(key).trim();
    if (kind === 'md') {
      if (v) doc[key] = get(key).replace(/\s+$/, '');
    } else if (kind === 'text[]') {
      const items = v.split('\n').map((s) => s.trim()).filter(Boolean);
      if (items.length) doc[key] = items;
    } else if (kind === 'json' || kind === 'area') {
      if (!v) continue;
      try { doc[key] = JSON.parse(v); } catch (err) { errors.push(`${key}: not valid JSON (${err.message})`); }
    } else if (kind === 'dimensions') {
      // decimal comma accepted (73,7); height and width together, depth optional
      const [h, w, d] = ['h', 'w', 'd'].map((x) => get(`${key}_${x}`).trim().replace(',', '.'));
      if (!h && !w && !d) continue;
      const num = /^\d+(\.\d+)?$/;
      if (!num.test(h) || (w && !num.test(w)) || (d && !num.test(d)) || (d && !w)) {
        errors.push(`${key}: numbers in cm — height alone, height × width, or height × width × depth`); continue;
      }
      doc[key] = [h, w, d].filter(Boolean).map(Number);
    } else if (kind === 'point') {
      const lon = get(`${key}_lon`).trim();
      const lat = get(`${key}_lat`).trim();
      if (!lon && !lat) continue;
      if (!/^-?\d+(\.\d+)?$/.test(lon) || !/^-?\d+(\.\d+)?$/.test(lat)) { errors.push(`${key}: longitude and latitude must be numbers`); continue; }
      doc[key] = [Number(lon), Number(lat)];
    } else if (kind === 'date' || kind === 'period') {
      if (v) doc[key] = v;
      const label = get(`${key}_label`).trim();
      if (label) doc[`${key}_label`] = label;
    } else if (v) {
      doc[key] = v;
    }
  }
  return { doc, errors };
}

// ctx: { enums: {key: [values]}, suggestions: {key: [values]}, refs: {key: [{slug, name}]}, errorKeys: Set }
function fieldInput(key, kind, f, ctx) {
  const name = `f.${key}`;
  const id = `f-${key}`;
  const err = ctx.errorKeys.has(key) ? ' has-error' : '';
  const hint = (h) => (h ? html`<div class="hint">${h}</div>` : '');

  if (kind === 'md') {
    return html`<div class="field${err}"><label for="${id}">${humanize(key)}</label>
      <textarea class="md" id="${id}" name="${name}">${f[key]}</textarea>${hint(HINTS.md)}</div>`;
  }
  if (kind === 'area') {
    // Drawn on the map (see the point field); the raw GeoJSON stays editable for pasting or fine-tuning.
    return html`<div class="field${err}"><label>${humanize(key)}</label>
      <details${err ? ' open' : ''}><summary class="muted">Draw it on the map above — or edit the GeoJSON (advanced)</summary>
      <textarea id="${id}" name="${name}" rows="3">${f[key]}</textarea>${hint(HINTS[kind])}</details></div>`;
  }
  if (kind === 'text[]' || kind === 'json') {
    return html`<div class="field${err}"><label for="${id}">${humanize(key)}</label>
      <textarea id="${id}" name="${name}" rows="3">${f[key]}</textarea>${hint(HINTS[key] || HINTS[kind])}</div>`;
  }
  if (kind === 'dimensions') {
    const box = (x, label) => html`<input name="${name}_${x}" value="${f[`${key}_${x}`]}" placeholder="${label}" inputmode="decimal" aria-label="${label} in cm">`;
    return html`<div class="field${err}"><label>${humanize(key)} (cm)</label>
      <div class="row dims">${box('h', 'height')}<span class="x">×</span>${box('w', 'width')}<span class="x">×</span>${box('d', 'depth (3D only)')}</div>
      ${hint('Height × width, plus depth for objects. Height alone is fine (e.g. a sculpture). Decimals allowed.')}
      <div class="hint dims-height-only">Height only — shown as “50 cm (height)”.</div></div>`;
  }
  if (kind === 'point') {
    return html`<div class="field${err}"><label>${humanize(key)}</label>
      <div class="row"><input name="${name}_lon" value="${f[`${key}_lon`]}" placeholder="longitude (east +)" inputmode="decimal" aria-label="longitude">
      <input name="${name}_lat" value="${f[`${key}_lat`]}" placeholder="latitude (north +)" inputmode="decimal" aria-label="latitude"></div>
      <div class="map-picker" data-point="${name}"${ctx.areaKey ? html` data-area="f.${ctx.areaKey}"` : ''}></div>
      <noscript>${hint(HINTS.point)}</noscript></div>`;
  }
  if (kind === 'date' || kind === 'period') {
    return html`<div class="field${err}"><label for="${id}">${humanize(key)}</label>
      <div class="row"><input id="${id}" name="${name}" value="${f[key]}" placeholder="date">
      <input name="${name}_label" value="${f[`${key}_label`]}" placeholder="label (optional)" aria-label="${humanize(key)} label"></div>
      ${hint(HINTS[kind])}</div>`;
  }
  if (kind === 'parent' || kind.startsWith('ref:')) {
    const options = ctx.refs[key] || [];
    const target = kind === 'parent' ? ctx.type : kind.slice(4);
    const canCreate = ['artist', 'institution'].includes(target) && kind !== 'parent';  // src/admin/autocreate.js
    const confirm = (ctx.confirmNew || {})[key];
    return html`<div class="field${err}"><label for="${id}">${humanize(key)}</label>
      <input id="${id}" name="${name}" value="${f[key]}" list="${id}-list" placeholder="start typing a name (typos are fine)" autocomplete="off"
        data-lookup="${kind === 'parent' ? ctx.type : kind.slice(4)}">
      <datalist id="${id}-list">${options.map((o) => html`<option value="${o.slug}">${o.name}</option>`)}</datalist>
      ${confirm ? html`<label class="choice"><input type="checkbox" name="new.${key}" value="1"> create a new ${target} “${confirm}” anyway</label>` : ''}
      ${hint(canCreate ? `Pick from the list — or type the name of a new ${target}: it is created with the save and marked “to complete”. Empty = none.`
        : `Slug of the ${kind === 'parent' ? 'parent' : kind.slice(4)}. Empty = none.`)}</div>`;
  }
  if (ctx.enums[key]) {
    return html`<div class="field${err}"><label for="${id}">${humanize(key)}</label>
      <select id="${id}" name="${name}">${ctx.enums[key].map((v) => html`<option${v === f[key] ? ' selected' : ''}>${v}</option>`)}</select></div>`;
  }
  const list = ctx.suggestions[key];
  return html`<div class="field${err}"><label for="${id}">${humanize(key)}</label>
    <input id="${id}" name="${name}" value="${f[key]}"${list ? html` list="${id}-list" autocomplete="off"` : ''}>
    ${list ? html`<datalist id="${id}-list">${list.map((v) => html`<option value="${v}">`)}</datalist>` : ''}${hint(HINTS[key])}</div>`;
}

// version: the row's updated_at when the form was opened (optimistic locking on save).
// collab: an existing entry's shared working copy (live step 2) — the browser binds the form to it; Save = Publish.
// collab: { key: 'artist:12:<epoch>', state: base64 } for a working copy.
function entityForm({ t, slug, f, ctx, action, errors, isNew, version, collab = null }) {
  ctx = { ...ctx, type: t.type, areaKey: Object.keys(t.fields).find((k) => t.fields[k] === 'area') };  // map draws into areaKey
  return html`
  ${errors.length ? html`<ul class="errors">${errors.map((e) => html`<li>${e}</li>`)}</ul>` : ''}
  <form method="post" action="${action}" class="form"${collab ? html` data-collab="${collab.key}" data-state="${collab.state}"` : html` data-draft="1"`}>
    ${version ? html`<input type="hidden" name="version" value="${version}">` : ''}
    <div class="field${ctx.errorKeys.has('slug') ? ' has-error' : ''}"><label for="f-slug">Slug</label>
      <input id="f-slug" name="slug" value="${slug}" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="${isNew ? `filled in from the ${t.name} — e.g. pine-trees-in-the-snow` : ''}"
        autocapitalize="none" spellcheck="false"${isNew ? html` data-slug-from="f-${t.name}"` : ''}>
      <div class="hint">${HINTS.slug}</div></div>
    ${Object.entries(t.fields).map(([key, kind]) => fieldInput(key, kind, f, ctx))}
    <div class="actions"><button>${isNew ? 'Create' : collab ? 'Publish' : 'Save'}</button>
      <a class="button secondary" href="${isNew ? `/${t.folder}` : `/${t.folder}/${slug}`}">${collab ? 'Close' : 'Cancel'}</a>
      ${collab ? html`<a class="button secondary" href="${action}/discard-changes">Discard unpublished changes…</a>
        <span class="muted small">Changes are shared live with everyone editing this entry; Publish makes them public.</span>` : ''}</div>
  </form>`;
}

module.exports = { docToForm, formToDoc, entityForm, humanize, HINTS };
