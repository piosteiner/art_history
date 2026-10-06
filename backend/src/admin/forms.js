// Entity forms, driven by the field kinds in src/content.js. A submitted form becomes a doc (the same shape as a
// YAML file), which then goes through the same toRow() validation as the import.
const { html } = require('./html');
const names = require('../names');
const { thumbUrl } = require('./images');
const dimensions = require('../dimensions');

// Language tags offered in the pickers (any BCP 47 tag can be typed).
const LANGS = [['en', 'English'], ['de', 'German'], ['fr', 'French'], ['it', 'Italian'], ['nl', 'Dutch'], ['es', 'Spanish'],
  ['ja', 'Japanese'], ['ja-Latn', 'Japanese, romanized (Hepburn)'], ['zh', 'Chinese'], ['zh-Hant', 'Chinese, traditional'],
  ['zh-Latn-pinyin', 'Chinese, pinyin'], ['ko', 'Korean'], ['ko-Latn', 'Korean, romanized'], ['ru', 'Russian'], ['ru-Latn', 'Russian, romanized'],
  ['ar', 'Arabic'], ['fa', 'Persian'], ['el', 'Greek'], ['la', 'Latin']];

const DATE_HINT = html`e.g. <code>1853</code> · <code>1888-02</code> · <code>1853-03-30</code> · <code>1886-03/1888-02-20</code> (from/to, inclusive)
  · <code>c. 1755</code> (±5 years) · <code>13th century</code> · <code>late 13th century</code> · <code>first half of the 13th century</code> · <code>1880s</code>`;
const HINTS = {
  md: html`Markdown: <code>*italic*</code>, <code>**bold**</code>, <code>[link](https://…)</code>, blank line = new paragraph.
    Links: type <code>[[</code> and a name to pick any entry — <code>[[artist/katsushika-hokusai]]</code>, a glossary term <code>[[contrapposto]]</code>; own words after <code>|</code>: <code>[[contrapposto|the pose]]</code>.
    Cite: <code>[[source/busch-1993|55]]</code> → footnote "Busch 1993, S. 55."; own footnote: <code>^[Vgl. [[source/busch-1993|bes. S. 55]].]</code>`,
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
  'place.boundary_code': 'Boundary (outline)', 'artwork.kind': 'Object type',
  'institution.location': 'Exact location', 'institution.place': 'Place (city)',
  'artwork.parent': 'Part of', 'artwork.part_number': 'Number in it', 'artwork.parts_count': 'Number of parts',
  'artwork.location': 'Where it stands', 'artwork.area': 'Outline (gardens, parks, precincts)', 'artwork.other_dimensions': 'Further measurements', 'term.name': 'Term',
  'term.definition': 'Short definition',
  'source.name': 'Title', 'source.kind': 'Kind of source', 'source.names': 'Other titles (translations …)',
  'source.container': 'Appeared in', 'source.container_editors': 'Editors of that volume', 'source.volume': 'Volume (Jahrgang / Bd.)',
  'source.issue': 'Issue (Nr.)', 'source.issue_date': 'Issue date', 'source.volumes_total': 'Number of volumes',
  'source.original_year': 'Year of the first edition', 'source.thesis': 'Thesis note', 'source.place': 'Place of publication',
  'source.year': 'Year', 'source.pages': 'Pages', 'source.pages_are_columns': 'Columns instead of pages',
  'source.catalogue_number': 'Catalogue number', 'source.exhibition': 'Exhibition', 'source.accessed': 'Last accessed',
  'source.uploader': 'Uploaded by', 'source.uploaded': 'Upload date', 'source.date_text': 'Date', 'source.archive': 'Archive / collection',
  'source.shelfmark': 'Shelfmark (Signatur)', 'source.siglum': 'Short reference (override)', 'source.primary_source': 'Primary source (Quelle)',
  'source.reading_status': 'Reading status', 'source.read_on': 'Finished reading', 'source.description_md': 'Notes', 'place.kind': 'Kind of place', 'institution.kind': 'Kind of institution',
  'polity.kind': 'Kind of polity', 'person.kind': 'Kind (person or group)', 'movement.kind': 'Kind',
};
const TYPE_HINTS = {
  'artwork.medium': html`For people to read: one line, worded like a museum label and shown exactly as written — <i>Oil on canvas</i> · <i>Woodblock print; ink and colour on paper</i> · <i>Bronze, lost-wax cast</i>.`,
  'artwork.materials': 'For filtering: the individual materials, one per line, lowercase and singular — ink · paper · bronze · silk. Substances and supports only, no techniques ("woodblock print" belongs in object type / medium). Type them, or click a suggestion below.',
  'place.boundary_code': html`ISO code of a country (<code>JP</code>) or region (<code>JP-13</code> Tokyo, <code>FR-IDF</code>) — the outline and
    the marker then come from Natural Earth, no point or drawing needed. Countries get it from their country code automatically.`,
  'institution.place': 'The city it is in (Zürich, not the building): for grouping, the country and the map when there is no exact location.',
  'institution.address': 'Street address, as written locally, e.g. Heimplatz 1, 8001 Zürich.',
  'artwork.parent': 'The series, album, triptych or altarpiece it belongs to — an artwork of its own (object type series, album …). Empty = none.',
  'artwork.part_number': 'Its place in the whole: 21 · left panel · plate 3 · leaf 12. A number in it sorts the parts.',
  'artwork.parts_count': 'Only for a whole (series, album …): how many parts it has, e.g. 46 — pages then show “No. 21 of 46”.',
  'artwork.location': 'Only for works that don’t move — buildings, gardens, bridges, temple halls, monuments, murals. Paintings, prints and sculptures in collections: leave empty (they are where their institution is).',
  'artwork.kind': html`What sort of object it is, in a word or two: painting, woodblock print, hanging scroll, sculpture, vase — or building, garden,
    bridge, temple hall … Pick a term from the list so works group together. A building that houses an institution: link them with <i>houses</i>.`,
  'place.kind': 'settlement (city, town, village) · building · site (archaeological site, landscape) · region · country',
  'movement.kind': 'period (Edo period) · movement (Impressionism) · school (Ukiyo-e, Rinpa) · style',
  'institution.kind': 'museum · academy · temple · church · gallery · library … — pick a term from the list',
  'person.kind': 'person — or a group: family · dynasty · religious order · guild',
  'polity.kind': 'empire · kingdom · dynasty · republic · shogunate …',
  'term.category': 'technique · architecture · material · iconography · style · format · other — what the glossary is browsed by',
  'term.definition': 'One or two sentences (max. 500 characters): shown as a tooltip wherever a text links the term, and in the A–Z list. Plain text.',
  'term.description_md': html`The full explanation (Markdown). Link other terms with <code>[[slug]]</code> or <code>[[slug|own words]]</code>, other entries with <code>[[type/slug]]</code>.`,
  'source.kind': 'Decides how the citation is put together (KHIST guide): book, exhibition catalogue, chapter in a volume, journal article, lexicon or catalogue entry, website, video, archival source.',
  'source.authors': html`One per line, <b>Surname, Given names</b>: <code>Busch, Werner</code>. More than three are cited as “… u. a.”.`,
  'source.editors': 'hrsg. von — one per line, Surname, Given names.',
  'source.compilers': 'Bearb. (catalogues, editions) — one per line, Surname, Given names.',
  'source.subtitle': 'Shown after the title with a full stop: "Titel. Untertitel".',
  'source.container': 'The volume, journal, lexicon, exhibition catalogue or website it appeared in.',
  'source.issue_date': 'e.g. Mai 1972 — shown in the parenthesis instead of the year: Artforum 10 (Mai 1972).',
  'source.volumes_total': 'e.g. 4 → "4 Bde."',
  'source.thesis': 'e.g. Diss. masch. — written before the place: "Diss. masch. Hamburg 1924".',
  'source.place': 'e.g. München, or Stuttgart und Teufen.',
  'source.year': 'Also a span: 1955–1989.',
  'source.pages': 'The page range of the part: 190–221.',
  'source.pages_are_columns': 'Lexicons often count columns: "Sp. 1209–1210".',
  'source.exhibition': 'Place: institution — e.g. Paris: Bibliothèque Nationale.',
  'source.date_text': 'Letters, events, conference talks: e.g. 30.09.1913.',
  'source.siglum': 'Leave empty: generated from surnames and year (Busch 1993, Kimpel und Suckale 1995, Kat. Paris 2007, Jacobsen 1992a).',
  'source.primary_source': 'Letters, documents, historical texts — listed apart as “Quellen”.',
  'source.description_md': 'Your own notes: what it says, what it is good for. Not part of the citation.',
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
    else if (kind === 'dimsets') f[key] = dimensions.setsToLines(v);
    else if (kind === 'bool') f[key] = v ? 'yes' : '';
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
    } else if (kind === 'bool') {
      if (v === 'yes') doc[key] = true;
    } else if (kind === 'dimsets') {
      try { const list = dimensions.linesToSets(get(key)); if (list.length) doc[key] = list; } catch (err) { errors.push(`${key}: ${err.message}`); }
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

// ctx: { enums: {key: [values]}, suggestions: {key: [values]}, refs: {key: [{slug, name}]}, coCreators: [{name, label}], errorKeys: Set }
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
  if (kind === 'bool') {
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <select id="${id}" name="${name}" class="short"><option value=""${f[key] ? '' : ' selected'}>no</option><option value="yes"${f[key] ? ' selected' : ''}>yes</option></select>
      ${hint(typeHint)}</div>`;
  }
  if (kind === 'dimsets') {
    // a plain textarea (one "part | h × w × d" per line); the browser shows it as rows (editor/dims.js)
    return html`<div class="field${err}"><label for="${id}">Further measurements (cm)</label>
      <textarea id="${id}" name="${name}" rows="2" data-dimsets>${f[key]}</textarea>
      <datalist id="part-list">${dimensions.PARTS.map((p) => html`<option value="${p}">`)}</datalist>
      ${hint(html`Optional — other parts measured separately: mount, frame, sheet, overall, with base … One per line: <code>mount | 180 × 95.5</code>. The dimensions above are the work itself.`)}</div>`;
  }
  if (kind === 'names') {
    // a plain textarea (works without script); the browser turns it into rows (editor/names.js)
    return html`<div class="field${err}"><label for="${id}">Other names, translations, romanizations</label>
      <textarea id="${id}" name="${name}" rows="3" data-names>${f[key]}</textarea>${hint(HINTS.names)}</div>`;
  }
  if (kind === 'md') {
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <textarea class="md" id="${id}" name="${name}">${f[key]}</textarea>${hint(typeHint || HINTS.md)}</div>`;
  }
  if (kind === 'area') {
    // Drawn on the map (see the point field); the raw GeoJSON stays editable for pasting or fine-tuning.
    return html`<div class="field${err}"><label>${label}</label>
      <details${err ? ' open' : ''}><summary class="muted">Draw it on the map above — or edit the GeoJSON (advanced)</summary>
      <textarea id="${id}" name="${name}" rows="3">${f[key]}</textarea>${hint(HINTS[kind])}</details></div>`;
  }
  if (kind === 'text[]' || kind === 'json') {
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <textarea id="${id}" name="${name}" rows="3"${key === 'materials' ? html` data-suggest-from="f-medium" data-used="${JSON.stringify(used || [])}"` : ''}>${f[key]}</textarea>${hint(typeHint || HINTS[key] || HINTS[kind])}
      ${used && used.length ? html`<div class="hint used-terms">Used so far: ${used.join(' · ')}</div>` : ''}</div>`;
  }
  if (kind === 'dimensions') {
    const box = (x, label) => html`<input name="${name}_${x}" value="${f[`${key}_${x}`]}" placeholder="${label}" inputmode="decimal" aria-label="${label} in cm">`;
    return html`<div class="field${err}"><label>${label} (cm) — the work itself</label>
      <div class="row dims">${box('h', 'height')}<span class="x">×</span>${box('w', 'width')}<span class="x">×</span>${box('d', 'depth (3D only)')}</div>
      ${hint('Height × width, plus depth for objects. Height alone is fine (e.g. a sculpture). Decimals allowed. Paste a whole line ("139.4 × 85.1 cm", "54 7/8 × 33 1/2 in.") to fill all boxes — inches and mm are converted.')}
      <div class="hint dims-height-only">Height only — shown as “50 cm (height)”.</div></div>`;
  }
  if (kind === 'point') {
    return html`<div class="field${err}"><label>${label}</label>
      <div class="row"><input name="${name}_lon" value="${f[`${key}_lon`]}" placeholder="longitude (east +)" inputmode="decimal" aria-label="longitude">
      <input name="${name}_lat" value="${f[`${key}_lat`]}" placeholder="latitude (north +)" inputmode="decimal" aria-label="latitude"></div>
      <div class="map-picker" data-point="${name}"${ctx.areaKey ? html` data-area="f.${ctx.areaKey}"` : ''}></div>
      ${hint(typeHint)}<noscript>${hint(HINTS.point)}</noscript></div>`;
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
    const placeParent = kind === 'parent' && target === 'place';
    const confirm = (ctx.confirmNew || {})[key];
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <input id="${id}" name="${name}" value="${f[key]}" list="${id}-list" placeholder="start typing a name (typos are fine)" autocomplete="off"
        data-lookup="${kind === 'parent' ? ctx.type : kind.slice(4)}">
      <datalist id="${id}-list">${options.map((o) => html`<option value="${o.slug}">${o.name}</option>`)}</datalist>
      ${confirm ? html`<label class="choice"><input type="checkbox" name="new.${key}" value="1"> create a new ${target} “${confirm}” anyway</label>` : ''}
      ${hint(typeHint || (canCreate ? `Pick from the list — or type the name of a new ${target}: it is created with the save and marked “to complete”. Empty = none.`
        : placeParent ? 'Pick from the list — or type a country or region name (Japan, Provence-Alpes-Côte d’Azur): it is created with its outline. Empty = none.'
          : `Slug of the ${kind === 'parent' ? 'parent' : kind.slice(4)}. Empty = none.`))}
      ${key === 'creator' ? hint(ctx.coCreators && ctx.coCreators.length
        ? html`The main creator. Co-creators: ${ctx.coCreators.map((c, i) => html`${i ? ', ' : ''}<b>${c.name}</b>${c.label ? ` (${c.label})` : ''}`)} — changed on the artwork's page.`
        : 'The main creator. Further creators: “+ Add co-creator” on the artwork\'s page.') : ''}</div>`;
  }
  if (ctx.enums[key]) {
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <select id="${id}" name="${name}">${ctx.enums[key].map((v) => html`<option${v === f[key] ? ' selected' : ''}>${v}</option>`)}</select>${hint(typeHint)}</div>`;
  }
  if (key === 'definition') {
    return html`<div class="field${err}"><label for="${id}">${label}</label>
      <textarea id="${id}" name="${name}" rows="2" maxlength="500">${f[key]}</textarea>${hint(typeHint)}</div>`;
  }
  const list = ctx.suggestions[key];
  return html`<div class="field${err}"><label for="${id}">${label}</label>
    <input id="${id}" name="${name}" value="${f[key]}"${list ? html` list="${id}-list" autocomplete="off"` : ''}>
    ${list ? html`<datalist id="${id}-list">${list.map((v) => html`<option value="${v}">`)}</datalist>` : ''}${hint(typeHint || HINTS[key])}</div>`;
}

// version: the row's updated_at when the form was opened (optimistic locking on save).
// collab: an existing entry's shared working copy (live step 2) — the browser binds the form to it; Save = Publish.
// collab: { key: 'artist:12:<epoch>', state: base64 } for a working copy.
// pendingImages: JSON of images picked in the Wikidata review of a new entry — kept in a hidden field (and so in the
// draft) and saved with the entry on Create.
function entityForm({ t, slug, f, ctx, action, errors, isNew, version, collab = null, pendingImages = null }) {
  let pending = [];
  try { pending = pendingImages ? JSON.parse(pendingImages) : []; } catch { pending = []; }
  ctx = { ...ctx, type: t.type, areaKey: Object.keys(t.fields).find((k) => t.fields[k] === 'area') };  // map draws into areaKey
  return html`
  ${errors.length ? html`<ul class="errors">${errors.map((e) => html`<li>${e}</li>`)}</ul>` : ''}
  <form method="post" action="${action}" class="form"${collab ? html` data-collab="${collab.key}" data-state="${collab.state}"` : html` data-draft="1"`}${collab && collab.published ? html` data-published="${Buffer.from(JSON.stringify(collab.published)).toString('base64')}" data-published-url="${action}/published.json"` : ''}>
    ${version ? html`<input type="hidden" name="version" value="${version}">` : ''}
    ${pending.length ? html`<input type="hidden" name="wd.images" value="${pendingImages}">
      <div class="field pending-images"><label>Images from Wikidata</label>
        <div class="image-list">${pending.map((img) => html`<figure class="image-item"><img src="${thumbUrl(img.url, 250)}" alt="" loading="lazy">
          <figcaption class="muted small">${[img.credit, img.license].filter(Boolean).join(' · ')}</figcaption></figure>`)}</div>
        <div class="hint">Added with the entry when you press Create.</div></div>` : ''}
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
