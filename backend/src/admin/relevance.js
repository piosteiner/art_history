// Which fields of an entry form matter for what is being entered (owner 2026-11-04: forms that fill themselves out
// "round and easy"). Declared here, applied in the browser (editor/relevance.js): a field a kind doesn't use is hidden
// while it is empty (one with a value stays, dimmed, so nothing is ever lost), a field the kind needs is marked
// "needed" while empty and listed in a checklist above the form; a section or group whose fields are all hidden hides
// with them. Nothing here is enforced — the server's validation (src/content.js) decides what is required.
//
// A type's rules: { driver, values, always, when }
//   driver   the field whose value picks a set from `values` (lower-cased); '*' = any other value
//   values   { value: { label, only, need, note } } — only: the fields that matter (the rest hidden while empty);
//            need: fields to fill; note: shown under the driver; label: how the checklist names it ("a web page")
//   always   { need: [...] } for every entry of the type
//   rare     fields hidden while empty whatever the kind (overrides, rarities) — "show all" brings them back
//   when     cross-field rules, each { field, filled | is | matches | allEmpty: [...] , need, show, note } — the note
//            shows under `field` (or, for allEmpty, under the first of them);
//            show: these fields matter only while the condition holds (hidden while empty otherwise; a `matches`
//            rule waits until its field has a value)
//   values[].sections  the order of the form's sections for that value (ids of forms.js SECTIONS; the rest follow)
const FIELDS = require('../content').BY_TYPE;

// object types that open a group as soon as they are typed (editor.js) and that the rules below use
const IMMOVABLE = ['building', 'garden', 'park', 'bridge', 'temple hall', 'shrine', 'pagoda', 'gate', 'monument', 'tower', 'mural'];
const WHOLES = ['series', 'versions', 'cycle', 'pair', 'album', 'diptych', 'triptych', 'polyptych', 'altarpiece', 'set'];
// an artwork's fields that describe one physical object — none for a group of works (migration 132)
const OBJECT_FIELDS = ['conceived', 'medium', 'materials', 'dimensions', 'dimensions_note', 'other_dimensions', 'institution',
  'inventory_number', 'on_loan', 'on_loan_since', 'location', 'area', 'provenance_status', 'provenance_status_note', 'fate',
  'fate_date', 'fate_note', 'web_url'];
// the bibliography: the fields each kind of source uses, in the order of its citation pattern (KHIST guide §§ 8–9,
// src/bibliography.js). `sections` = the order of the form's sections for that kind (forms.js SECTIONS.source): a web
// page asks for its address right after the kind, a book for its authors — the browser reorders the sections.
// SOURCE_COMMON: what every entry has besides (how it is cited, read and trusted); not in it: url, isbn, doi, names,
// subtitle, edition_of — per kind, and "show all" brings them back.
const SOURCE_COMMON = ['kind', 'name', 'siglum', 'primary_source', 'reliability', 'reading_status', 'read_on', 'description_md', 'wikidata_id', 'metadata'];
const SOURCE_KINDS = {
  book: { label: 'a book', sections: ['kind', 'people', 'title', 'publication', 'reading', 'text', 'ids'],
    only: ['subtitle', 'names', 'authors', 'editors', 'compilers', 'edition', 'original_year', 'series', 'volumes_total', 'thesis', 'place', 'publisher', 'year', 'isbn', 'edition_of'],
    need: ['authors', 'place', 'year'],
    note: 'Cited “Busch 1993: Werner Busch, Das sentimentalische Bild. Die Krise der Kunst …, München 1993.” — the publisher is optional.' },
  catalogue: { label: 'an exhibition catalogue', sections: ['kind', 'title', 'people', 'container', 'publication', 'reading', 'text', 'ids'],
    only: ['subtitle', 'names', 'editors', 'compilers', 'exhibition', 'place', 'publisher', 'year', 'original_year', 'isbn'],
    need: ['exhibition', 'place', 'year'],
    note: 'Cited “Kat. Paris 2007: Trésors carolingiens …, Bearb. Marie-Pierre Laffitte u. a., Ausst.-Kat. Paris: Bibliothèque Nationale, Paris 2007.” — the exhibition as “City: Institution”.' },
  chapter: { label: 'a chapter in a volume', sections: ['kind', 'people', 'title', 'container', 'publication', 'online', 'reading', 'text', 'ids'],
    only: ['subtitle', 'authors', 'container', 'container_editors', 'place', 'publisher', 'year', 'pages', 'pages_are_columns', 'original_year', 'doi', 'url', 'accessed'],
    need: ['authors', 'container', 'place', 'year', 'pages'],
    note: 'Cited “Raev und Labuda 2003: …, Der Mythos Sibirien …, in: Kunst, Kontext, Geschichte, hrsg. von Tatjana Bartsch und Jörg Meiner, Berlin 2003, S. 190–221.”' },
  article: { label: 'a journal article', sections: ['kind', 'people', 'title', 'container', 'publication', 'online', 'reading', 'text', 'ids'],
    only: ['subtitle', 'authors', 'container', 'volume', 'issue', 'issue_date', 'year', 'pages', 'pages_are_columns', 'doi', 'url', 'accessed'],
    need: ['authors', 'container', 'volume', 'year', 'pages'],
    note: 'Cited “Krauss 1972: Rosalind Krauss, Richard Serra. Sculpture Redrawn, in: Artforum 10 (Mai 1972), Nr. 9, S. 39–43.” — the journal as “appeared in”, its volume (Jahrgang), the issue only when the pages don’t run through the year.' },
  lexicon_entry: { label: 'a lexicon entry', sections: ['kind', 'people', 'title', 'container', 'publication', 'online', 'reading', 'text', 'ids'],
    only: ['authors', 'container', 'container_editors', 'volumes_total', 'volume', 'place', 'publisher', 'year', 'pages', 'pages_are_columns', 'url', 'accessed'],
    need: ['container', 'year'],
    note: 'Cited “Binding 1995: Günther Binding, Saalkirche, in: Lexikon des Mittelalters, 9 Bde., Bd. 7, München 1995, Sp. 1209–1210.” — no author: “Anon.”. An online lexicon (Wikipedia): its address and the day you read it.' },
  catalogue_entry: { label: 'a catalogue entry', sections: ['kind', 'people', 'title', 'container', 'publication', 'reading', 'text', 'ids'],
    only: ['authors', 'catalogue_number', 'container', 'compilers', 'exhibition', 'place', 'publisher', 'year', 'pages'],
    need: ['catalogue_number', 'container', 'year'],
    note: 'Cited “Denoël 2007: Charlotte Denoël, Kat.-Nr. 32 (Évangiles de Saint-Martin de Tours), in: Trésors carolingiens …, Ausst.-Kat. Paris: Bibliothèque Nationale, 2007, S. 154.”' },
  web: { label: 'a web page', sections: ['kind', 'online', 'title', 'people', 'container', 'publication', 'reading', 'text', 'ids'],
    only: ['url', 'accessed', 'subtitle', 'authors', 'container', 'year'],
    need: ['url', 'accessed'],
    note: 'Cited “Iversen 2012: Margaret Iversen, Index, Diagram, Graphic Trace, in: Tate Papers 18 (2012), http://… (aufgerufen am 2.8.2020).” — needed are the address and the day you read it (KHIST § 9.5). Optional: “appeared in” for an online journal or a page within a larger site; the year when the page states one — it makes the short reference (Iversen 2012), without it “o. J.”.' },
  video: { label: 'a video', sections: ['kind', 'online', 'title', 'people', 'container', 'more', 'reading', 'text', 'ids'],
    only: ['url', 'accessed', 'subtitle', 'authors', 'container', 'place', 'date_text', 'year', 'uploader', 'uploaded'],
    need: ['url', 'accessed'],
    note: 'Cited “Kodwo Eshun, Beitrag zur Tagung Public Assets …, Video-Dokumentation der Konferenz, organisiert von …, London, 1.5.2015, http://… (zuletzt abgerufen am 21.5.2020).” — a clip on a platform: who uploaded it and when.' },
  archival: { label: 'an archival source', sections: ['kind', 'title', 'more', 'online', 'reading', 'text', 'ids'],
    only: ['date_text', 'archive', 'shelfmark', 'url', 'accessed'],
    need: ['archive', 'shelfmark'],
    note: 'Cited “Brief von J.E. Wolfensberger an Wilhelm Barth, 30.09.1913, StABS, PA888 H 2.1 (1)” — the title describes the document; then its date, the archive and the shelfmark.' },
  other: { label: 'a source of another kind' },
};
// institutions: kinds with a building of their own (a point on the map) and kinds without one
const INSTITUTION_PLACES = ['museum', 'gallery', 'church', 'temple', 'monastery', 'library', 'university', 'art academy', 'auction house',
  'palace', 'castle', 'cathedral', 'chapel', 'abbey', 'shrine', 'school', 'archive', 'theatre', 'academy', 'villa'];
const INSTITUTION_ABSTRACT = ['collection', 'foundation', 'company', 'publisher', 'association', 'art society', 'society', 'family',
  'firm', 'dealer', 'art dealer', 'bank', 'government', 'trust', 'estate'];
// people: a person has a life; a group has a time it was active
const PERSON_GROUPS = ['family', 'dynasty', 'religious order', 'guild', 'couple', 'workshop', 'company', 'group'];

const RULES = {
  source: {
    driver: 'kind',
    values: Object.fromEntries(Object.entries(SOURCE_KINDS).map(([k, v]) => [k, { ...v, only: v.only ? [...SOURCE_COMMON, ...v.only] : undefined }])),
    always: { need: ['name'] },
    rare: ['siglum', 'wikidata_id', 'edition_of'],
    when: [
      { field: 'url', filled: true, need: ['accessed'], show: ['accessed'], note: 'A link needs the day you read it.' },
      { field: 'reading_status', is: 'read', show: ['read_on'], need: ['read_on'] },
    ],
  },
  artwork: {
    driver: 'kind',
    values: {
      ...Object.fromEntries(IMMOVABLE.map((k) => [k, { label: `a ${k}`, need: ['location'] }])),
      '*': { label: null },
    },
    always: { need: ['title', 'kind', 'created'] },
    // overrides and rarities, hidden while empty: a title's translation status, "attributed to", the region by hand …
    rare: ['title_status', 'attribution_label', 'dimensions_note', 'other_dimensions', 'region'],
    when: [
      { field: 'on_loan', is: 'yes', show: ['on_loan_since'], need: ['institution', 'on_loan_since'] },
      { field: 'institution', filled: true, show: ['inventory_number', 'on_loan'], need: ['inventory_number', 'web_url'], note: 'In a museum: its inventory number and its page there.' },
      { field: 'parent', filled: true, need: ['part_number'] },
      { field: 'fate', filled: true, show: ['fate_date', 'fate_note'], need: ['fate_date'] },
      { field: 'provenance_status', filled: true, show: ['provenance_status_note'] },
      { field: 'completion', filled: true, show: ['completion_date', 'completion_note'], need: ['completion_date'] },
      { field: 'authenticity', filled: true, show: ['authenticity_date', 'authenticity_note'], need: ['authenticity_note'] },
      { field: 'created', matches: '/|c\\.|ca\\.|circa|century|\\?', show: ['created_span'] },
      { field: 'kind', matches: 'print|cast|bronze|etch|engrav|woodcut|woodblock|lithograph|medal|plaster|relief', show: ['conceived'] },
    ],
  },
  artist: {
    always: { need: ['name'] },
    // given and family name are split from the name on save; "filed as" and the region override what is worked out
    rare: ['given_name', 'family_name', 'sort_name', 'region'],
    // birth (or death) is the normal case; "active" only stands in when the dates of life are unknown — asked for
    // birth first, active offered beside it; either one settles it
    when: [
      { allEmpty: ['birth', 'death'], show: ['active'] },
      { allEmpty: ['birth', 'death', 'active'], need: ['birth'], note: 'Dates of life unknown? Then when they were active.' },
    ],
  },
  person: {
    driver: 'kind',
    values: {
      ...Object.fromEntries(PERSON_GROUPS.map((k) => [k, { label: `a ${k}`,
        only: ['name', 'names', 'kind', 'active', 'description_md', 'wikidata_id', 'metadata', 'provenance_flag', 'given_name', 'family_name', 'sort_name'], need: ['active'] }])),
      '*': { label: null },
    },
    always: { need: ['name'] },
    rare: ['given_name', 'family_name', 'sort_name'],
    when: [
      { allEmpty: ['birth', 'death'], show: ['active'] },
      { allEmpty: ['birth', 'death', 'active'], need: ['birth'], note: 'Dates of life unknown? Then when they were active.' },
    ],
  },
  institution: {
    driver: 'kind',
    values: {
      ...Object.fromEntries(INSTITUTION_PLACES.map((k) => [k, { label: `a ${k}`, need: ['place', 'location'] }])),
      ...Object.fromEntries(INSTITUTION_ABSTRACT.map((k) => [k, { label: `a ${k}`, need: ['place'],
        only: ['name', 'names', 'kind', 'founded', 'dissolved', 'place', 'description_md', 'website_url', 'wikidata_id', 'metadata', 'provenance_flag'] }])),
      '*': { label: null, need: ['place'] },
    },
    always: { need: ['name', 'kind'] },
    rare: ['dissolved', 'address'],
  },
  place: {
    driver: 'kind',
    values: {
      continent: { label: 'a continent', only: ['name', 'names', 'kind', 'designation', 'description_md', 'wikidata_id', 'metadata', 'boundary_code', 'area'] },
      country: { label: 'a country', only: ['name', 'names', 'kind', 'parent', 'country_code', 'boundary_code', 'area', 'location', 'designation', 'existed', 'description_md', 'wikidata_id', 'metadata'],
        need: ['country_code', 'boundary_code'], note: 'A country: its outline comes with the boundary code (its ISO code, JP).' },
      region: { label: 'a region', only: ['name', 'names', 'kind', 'parent', 'country_code', 'boundary_code', 'area', 'location', 'designation', 'existed', 'description_md', 'wikidata_id', 'metadata'],
        need: ['parent', 'country_code'], note: 'A region: its outline from the boundary code (JP-13) or drawn as an area; the country or region it lies in as parent.' },
      district: { label: 'a district', only: ['name', 'names', 'kind', 'parent', 'country_code', 'area', 'location', 'designation', 'existed', 'description_md', 'wikidata_id', 'metadata'],
        need: ['parent', 'location'] },
      settlement: { label: 'a settlement', only: ['name', 'names', 'kind', 'parent', 'country_code', 'area', 'location', 'designation', 'existed', 'description_md', 'wikidata_id', 'metadata'],
        need: ['parent', 'country_code', 'location'] },
      building: { label: 'a building', only: ['name', 'names', 'kind', 'designation', 'parent', 'country_code', 'area', 'location', 'existed', 'description_md', 'wikidata_id', 'metadata'], need: ['parent', 'location'] },
      site: { label: 'a site', only: ['name', 'names', 'kind', 'designation', 'parent', 'country_code', 'area', 'location', 'description_md', 'wikidata_id', 'metadata'], need: ['parent', 'location'] },
      archaeological: { label: 'an archaeological site', only: ['name', 'names', 'kind', 'designation', 'parent', 'country_code', 'area', 'location', 'description_md', 'wikidata_id', 'metadata'], need: ['parent', 'location'] },
      natural: { label: 'a natural feature', only: ['name', 'names', 'kind', 'designation', 'parent', 'country_code', 'area', 'location', 'route', 'description_md', 'wikidata_id', 'metadata'], need: ['location'],
        note: 'A mountain, lake, island, river — a river or road as a line: route.' },
      street: { label: 'a street or road', only: ['name', 'names', 'kind', 'designation', 'parent', 'country_code', 'location', 'route', 'existed', 'description_md', 'wikidata_id', 'metadata'], need: ['parent', 'location'] },
    },
    always: { need: ['name', 'kind'] },
    rare: ['existed', 'designation'],
  },
  movement: { always: { need: ['name', 'kind', 'period'] }, rare: ['region'] },
  polity: { always: { need: ['name', 'kind', 'period', 'country_codes'] } },
  event: { always: { need: ['name', 'kind', 'period', 'place'] } },
  literature: { always: { need: ['name', 'kind', 'written'] }, when: [{ field: 'parent', filled: true, need: ['part_number'] }] },
  term: { always: { need: ['name', 'category', 'definition'] } },
};

/** The rules of a type for the browser; ctx.groupKinds (artworks: the glossary's group-of-works terms) completes them. */
function rulesFor(type, ctx = {}) {
  const base = RULES[type];
  if (!base) return null;
  // the Wikidata id comes from the "Wikidata…" button (owner 2026-11-04): hidden while empty on every form
  const rules = { ...base, values: { ...(base.values || {}) }, rare: [...new Set([...(base.rare || []), 'wikidata_id'])] };
  if (type === 'artwork') {
    const all = Object.keys(FIELDS.artwork.fields);
    for (const k of ctx.groupKinds || WHOLES) {
      rules.values[k] = { label: `a group of works (${k})`, only: all.filter((f) => !OBJECT_FIELDS.includes(f)), need: ['parts_count'],
        note: 'A group of works: the fields of a single object (size, museum, inventory number …) are hidden while empty — each part has its own.' };
    }
  }
  return rules;
}

module.exports = { RULES, rulesFor, IMMOVABLE, WHOLES, OBJECT_FIELDS, SOURCE_COMMON, SOURCE_KINDS };
