// Entity forms, driven by the field kinds in src/content.js. A submitted form becomes a doc (the same shape as a
// YAML file), which then goes through the same toRow() validation as the import.
const { html } = require('./html');
const names = require('../names');

// Language tags offered in the pickers (any BCP 47 tag can be typed).
const LANGS = [['en', 'English'], ['de', 'German'], ['fr', 'French'], ['it', 'Italian'], ['nl', 'Dutch'], ['es', 'Spanish'],
  ['ja', 'Japanese'], ['ja-Latn', 'Japanese, romanized (Hepburn)'], ['zh', 'Chinese'], ['zh-Hant', 'Chinese, traditional'],
  ['zh-Latn-pinyin', 'Chinese, pinyin'], ['ko', 'Korean'], ['ko-Latn', 'Korean, romanized'], ['ru', 'Russian'], ['ru-Latn', 'Russian, romanized'],
  ['ar', 'Arabic'], ['fa', 'Persian'], ['el', 'Greek'], ['la', 'Latin']];

const DATE_HINT = html`e.g. <code>1853</code> · <code>1888-02</code> · <code>1853-03-30</code> · <code>1886-03/1888-02-20</code> (from/to, inclusive)
  · <code>13th century</code> · <code>late 13th century</code> · <code>first half of the 13th century</code> · <code>1880s</code>`;
const HINTS = {
  md: html`Markdown: <code>*italic*</code>, <code>**bold**</code>, <code>[link](https://…)</code>, blank line = new paragraph.`,
  'text[]': 'One per line.',
  names: html`One per line: <code>name | language | role</code> — role: original, translation, romanization or alternative
    (the default). E.g. <code>Kanagawa-oki nami ura | ja-Latn | romanization</code> · <code>The Great Wave off Kanagawa | en | translation</code>.
    Furigana work here too.`,
  name: html`Furigana: <code>{神奈川|かながわ}</code> — or select kanji and press “Add reading”. Language: e.g. <code>ja</code>, <code>en</code>, <code>zh-Hant</code>.`,
  country_codes: 'Modern countries on its territory, ISO codes, one per line (e.g. CN for the Han dynasty; UA, RU, BY … for the USSR). Shown as "today …" only for entries without a place.',
  inventory_number: 'Only together with the institution above — the number belongs to its collection.',
  json: 'JSON object, e.g. {"sources": ["…"]}. Leave empty for none.',
  area: 'GeoJSON Polygon or MultiPolygon, [longitude, latitude] pairs (optional outline for regions).',
  date: DATE_HINT,
  period: html`${DATE_HINT} · <code>1808/</code> (since 1808, ongoing)`,
  label: 'Optional display text, e.g. "c. 1480". Empty = generated from the date.',
  point: 'Decimal degrees. Tip: right-click a spot in OpenStreetMap → "Show address" shows its coordinates.',
  slug: 'Lowercase, digits and hyphens: used in URLs (typed text is converted). Keep stable once published.',
};

// Field names and explanations per entry type, where one word means different things ("kind" of an artwork vs. of a
// place) or two fields are easily confused (an artwork's object type, medium and materials).
const LABELS = {
  'artwork.kind': 'Object type', 'place.kind': 'Kind of place', 'institution.kind': 'Kind of institution',
  'polity.kind': 'Kind of polity', 'person.kind': 'Kind (person or group)', 'movement.kind': 'Kind',
};
const TYPE_HINTS = {
  'artwork.kind': 'What sort of object it is, in a word or two: painting, woodblock print, hanging scroll, sculpture, vase. Pick a term from the list so works group together.',
  'artwork.medium': html`For people to read: one line, worded like a museum label and shown exactly as written — <i>Oil on canvas</i> · <i>Woodblock print; ink and colour on paper</i> · <i>Bronze, lost-wax cast</i>.`,
  'artwork.materials': 'For filtering: the individual materials, one per line, lowercase and singular — ink · paper · bronze · silk. Substances and supports only, no techniques ("woodblock print" belongs in object type / medium).',
  'place.kind': 'settlement (city, town, village) · building · site (archaeological site, landscape) · region · country',
  'movement.kind': 'period (Edo period) · movement (Impressionism) · school (Ukiyo-e, Rinpa) · style',
  'institution.kind': 'museum · academy · temple · church · gallery · library … — pick a term from the list',
  'person.kind': 'person — or a group: family · dynasty · religious order · guild',
  'polity.kind': 'empire · kingdom · dynasty · republic · shogunate …',
  'person.occupations': 'One per line, lowercase: poet · monk · emperor · art dealer · collector',
};
const humanize = (key) => key.replace(/_md$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const fieldLabel = (type, key) => LABELS[`${type}.${key}`] || humanize(key);

// doc → the string values the inputs show.
function docToForm(doc, fields) {
  const f = {};
  for (const [key, kind] of Object.entries(fields)) {
    const v = doc[key];
    if (kind === 'text[]') f[key] = (v || []).join('\n');
    else if (kind === 'name') { f[key] = v ?? ''; f[`${key}_lang`] = doc[`${key}_lang`] ?? ''; }
    else if (kind === 'names') f[key] = names.namesToLines((v || []).map((n) => (typeof n === 'string' ? { text: n, role: 'alternative' } : n)));
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
    if (kind === 'name') {
      if (v) doc[key] = v;
      const lang = get(`${key}_lang`).trim();
      if (lang) doc[`${key}_lang`] = lang;
    } else if (kind === 'names') {
      try { const list = names.linesToNames(get(key)); if (list.length) doc[key] = list; } catch (err) { errors.push(`${key}: ${err.message}`); }
    } else if (kind === 'md') {
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
  const label = fieldLabel(ctx.type, key);
  const typeHint = TYPE_HINTS[`${ctx.type}.${key}`];
  const used = (ctx.used || {})[key];  // terms already in use (materials, occupations): reuse the same word
  const name = `f.${key}`;
  const id = `f-${key}`;
  const err = ctx.errorKeys.has(key) ? ' has-error' : '';
  const hint = (h) => (h ? html`<div class="hint">${h}</div>` : '');

  if (kind === 'name') {
    // the browser adds the "Add reading" button and the furigana preview (editor/names.js)
    return html`<div class="field name-field${err}"><label for="${id}">${label}</label>
      <input id="${id}" name="${name}" value="${f[key]}" data-ruby lang="${f[`${key}_lang`] || ''}">
      <div class="name-meta"><input name="${name}_lang" value="${f[`${key}_lang`]}" placeholder="language" aria-label="${label} language" class="lang-input" list="lang-list" autocomplete="off"></div>
      <div class="ruby-preview" hidden></div>${hint(HINTS.name)}
      <datalist id="lang-list">${LANGS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</datalist></div>`;
  }
  if (kind === 'names') {
    // a plain textarea (works without script); the browser turns it into rows (editor/names.js)
    return html`<div class="field${err}"><label for="${id}">Other names, translations, romanizations</label>
      <textarea id="${id}" name="${name}" rows="3" data-names>${f[key]}</textarea>${hint(HINTS.names)}</div>`;
  }
  if (kind === 'md') {
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <textarea class="md" id="${id}" name="${name}">${f[key]}</textarea>${hint(HINTS.md)}</div>`;
  }
  if (kind === 'area') {
    // Drawn on the map (see the point field); the raw GeoJSON stays editable for pasting or fine-tuning.
    return html`<div class="field${err}"><label>${label}</label>
      <details${err ? ' open' : ''}><summary class="muted">Draw it on the map above — or edit the GeoJSON (advanced)</summary>
      <textarea id="${id}" name="${name}" rows="3">${f[key]}</textarea>${hint(HINTS[kind])}</details></div>`;
  }
  if (kind === 'text[]' || kind === 'json') {
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <textarea id="${id}" name="${name}" rows="3">${f[key]}</textarea>${hint(typeHint || HINTS[key] || HINTS[kind])}
      ${used && used.length ? html`<div class="hint">Used so far: ${used.join(' · ')}</div>` : ''}</div>`;
  }
  if (kind === 'dimensions') {
    const box = (x, label) => html`<input name="${name}_${x}" value="${f[`${key}_${x}`]}" placeholder="${label}" inputmode="decimal" aria-label="${label} in cm">`;
    return html`<div class="field${err}"><label>${label} (cm)</label>
      <div class="row dims">${box('h', 'height')}<span class="x">×</span>${box('w', 'width')}<span class="x">×</span>${box('d', 'depth (3D only)')}</div>
      ${hint('Height × width, plus depth for objects. Height alone is fine (e.g. a sculpture). Decimals allowed.')}
      <div class="hint dims-height-only">Height only — shown as “50 cm (height)”.</div></div>`;
  }
  if (kind === 'point') {
    return html`<div class="field${err}"><label>${label}</label>
      <div class="row"><input name="${name}_lon" value="${f[`${key}_lon`]}" placeholder="longitude (east +)" inputmode="decimal" aria-label="longitude">
      <input name="${name}_lat" value="${f[`${key}_lat`]}" placeholder="latitude (north +)" inputmode="decimal" aria-label="latitude"></div>
      <div class="map-picker" data-point="${name}"${ctx.areaKey ? html` data-area="f.${ctx.areaKey}"` : ''}></div>
      <noscript>${hint(HINTS.point)}</noscript></div>`;
  }
  if (kind === 'date' || kind === 'period') {
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <div class="row"><input id="${id}" name="${name}" value="${f[key]}" placeholder="date">
      <input name="${name}_label" value="${f[`${key}_label`]}" placeholder="label (optional)" aria-label="${label} label"></div>
      ${hint(HINTS[kind])}</div>`;
  }
  if (kind === 'parent' || kind.startsWith('ref:')) {
    const options = ctx.refs[key] || [];
    const target = kind === 'parent' ? ctx.type : kind.slice(4);
    const canCreate = ['artist', 'institution'].includes(target) && kind !== 'parent';  // src/admin/autocreate.js
    const confirm = (ctx.confirmNew || {})[key];
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <input id="${id}" name="${name}" value="${f[key]}" list="${id}-list" placeholder="start typing a name (typos are fine)" autocomplete="off"
        data-lookup="${kind === 'parent' ? ctx.type : kind.slice(4)}">
      <datalist id="${id}-list">${options.map((o) => html`<option value="${o.slug}">${o.name}</option>`)}</datalist>
      ${confirm ? html`<label class="choice"><input type="checkbox" name="new.${key}" value="1"> create a new ${target} “${confirm}” anyway</label>` : ''}
      ${hint(canCreate ? `Pick from the list — or type the name of a new ${target}: it is created with the save and marked “to complete”. Empty = none.`
        : `Slug of the ${kind === 'parent' ? 'parent' : kind.slice(4)}. Empty = none.`)}</div>`;
  }
  if (ctx.enums[key]) {
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <select id="${id}" name="${name}">${ctx.enums[key].map((v) => html`<option${v === f[key] ? ' selected' : ''}>${v}</option>`)}</select>${hint(typeHint)}</div>`;
  }
  const list = ctx.suggestions[key];
  return html`<div class="field${err}"><label for="${id}">${label}</label>
    <input id="${id}" name="${name}" value="${f[key]}"${list ? html` list="${id}-list" autocomplete="off"` : ''}>
    ${list ? html`<datalist id="${id}-list">${list.map((v) => html`<option value="${v}">`)}</datalist>` : ''}${hint(typeHint || HINTS[key])}</div>`;
}

// version: the row's updated_at when the form was opened (optimistic locking on save).
// collab: an existing entry's shared working copy (live step 2) — the browser binds the form to it; Save = Publish.
// collab: { key: 'artist:12:<epoch>', state: base64 } for a working copy.
function entityForm({ t, slug, f, ctx, action, errors, isNew, version, collab = null }) {
  ctx = { ...ctx, type: t.type, areaKey: Object.keys(t.fields).find((k) => t.fields[k] === 'area') };  // map draws into areaKey
  return html`
  ${errors.length ? html`<ul class="errors">${errors.map((e) => html`<li>${e}</li>`)}</ul>` : ''}
  <form method="post" action="${action}" class="form"${collab ? html` data-collab="${collab.key}" data-state="${collab.state}"` : html` data-draft="1"`}${collab && collab.published ? html` data-published="${Buffer.from(JSON.stringify(collab.published)).toString('base64')}" data-published-url="${action}/published.json"` : ''}>
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

module.exports = { docToForm, formToDoc, entityForm, humanize, fieldLabel, HINTS, LANGS };
