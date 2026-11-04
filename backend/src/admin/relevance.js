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
//   when     cross-field rules, each { field, filled | is | matches | allEmpty: [...] , need, show, note } —
//            show: these fields matter only while the condition holds (hidden while empty otherwise)
const FIELDS = require('../content').BY_TYPE;

// object types that open a group as soon as they are typed (editor.js) and that the rules below use
const IMMOVABLE = ['building', 'garden', 'park', 'bridge', 'temple hall', 'shrine', 'pagoda', 'gate', 'monument', 'tower', 'mural'];
const WHOLES = ['series', 'versions', 'cycle', 'pair', 'album', 'diptych', 'triptych', 'polyptych', 'altarpiece', 'set'];
// an artwork's fields that describe one physical object — none for a group of works (migration 132)
const OBJECT_FIELDS = ['conceived', 'medium', 'materials', 'dimensions', 'dimensions_note', 'other_dimensions', 'institution',
  'inventory_number', 'on_loan', 'on_loan_since', 'location', 'area', 'provenance_status', 'provenance_status_note', 'fate',
  'fate_date', 'fate_note', 'web_url'];
// the bibliography: the fields each kind of source uses (the citation patterns of the KHIST guide, src/bibliography.js)
const SOURCE_COMMON = ['kind', 'name', 'subtitle', 'names', 'authors', 'year', 'url', 'isbn', 'doi', 'siglum', 'primary_source', 'reliability',
  'reading_status', 'read_on', 'description_md', 'wikidata_id', 'metadata', 'edition_of'];
const SOURCE_KINDS = {
  book: { label: 'a book', only: ['editors', 'compilers', 'edition', 'original_year', 'series', 'volumes_total', 'thesis', 'place', 'publisher'],
    need: ['authors', 'year', 'place', 'publisher'] },
  catalogue: { label: 'an exhibition catalogue', only: ['editors', 'compilers', 'exhibition', 'place', 'publisher', 'original_year'],
    need: ['exhibition', 'year', 'place', 'publisher'] },
  chapter: { label: 'a chapter in a volume', only: ['container', 'container_editors', 'place', 'publisher', 'pages', 'pages_are_columns', 'original_year'],
    need: ['authors', 'container', 'pages', 'year'] },
  article: { label: 'a journal article', only: ['container', 'volume', 'issue', 'issue_date', 'pages', 'pages_are_columns'],
    need: ['authors', 'container', 'year', 'pages'] },
  lexicon_entry: { label: 'a lexicon entry', only: ['container', 'container_editors', 'volumes_total', 'volume', 'place', 'publisher', 'pages', 'pages_are_columns'],
    need: ['container', 'volume', 'pages', 'year'] },
  catalogue_entry: { label: 'a catalogue entry', only: ['catalogue_number', 'container', 'compilers', 'exhibition', 'place', 'pages'],
    need: ['container', 'catalogue_number', 'year'] },
  web: { label: 'a web page', only: ['container', 'volume', 'pages', 'accessed'], need: ['url', 'accessed'],
    note: 'A web page: its address and the day you read it are what a citation needs; the site as “appeared in”.' },
  video: { label: 'a video', only: ['container', 'place', 'date_text', 'uploader', 'uploaded', 'accessed'], need: ['url', 'accessed', 'uploader'] },
  archival: { label: 'an archival source', only: ['date_text', 'archive', 'shelfmark'], need: ['archive', 'shelfmark'] },
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
    when: [
      { field: 'url', filled: true, need: ['accessed'], note: 'A link needs the day you read it.' },
      { field: 'reading_status', is: 'read', need: ['read_on'] },
    ],
  },
  artwork: {
    driver: 'kind',
    values: {
      ...Object.fromEntries(IMMOVABLE.map((k) => [k, { label: `a ${k}`, need: ['location'] }])),
      '*': { label: null },
    },
    always: { need: ['title', 'kind', 'created'] },
    when: [
      { field: 'on_loan', is: 'yes', need: ['institution', 'on_loan_since'] },
      { field: 'institution', filled: true, need: ['inventory_number', 'web_url'], note: 'In a museum: its inventory number and its page there.' },
      { field: 'parent', filled: true, need: ['part_number'] },
      { field: 'fate', filled: true, need: ['fate_date'] },
      { field: 'completion', filled: true, need: ['completion_date'] },
      { field: 'authenticity', filled: true, need: ['authenticity_note'] },
      { field: 'created', matches: '/|c\\.|ca\\.|circa|century|\\?', show: ['created_span'] },
      { field: 'kind', matches: 'print|cast|bronze|etch|engrav|woodcut|woodblock|lithograph|medal|plaster|relief', show: ['conceived'] },
    ],
  },
  artist: {
    always: { need: ['name'] },
    when: [{ allEmpty: ['birth', 'death'], show: ['active'], need: ['active'], note: 'No dates of life: when were they active?' }],
  },
  person: {
    driver: 'kind',
    values: {
      ...Object.fromEntries(PERSON_GROUPS.map((k) => [k, { label: `a ${k}`,
        only: ['name', 'names', 'kind', 'active', 'description_md', 'wikidata_id', 'metadata', 'provenance_flag', 'given_name', 'family_name', 'sort_name'], need: ['active'] }])),
      '*': { label: null },
    },
    always: { need: ['name'] },
    when: [{ allEmpty: ['birth', 'death'], show: ['active'], need: ['active'], note: 'No dates of life: when were they active?' }],
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
  },
  place: {
    driver: 'kind',
    values: {
      continent: { label: 'a continent', only: ['name', 'names', 'kind', 'description_md', 'wikidata_id', 'metadata', 'boundary_code', 'area'] },
      country: { label: 'a country', only: ['name', 'names', 'kind', 'parent', 'country_code', 'boundary_code', 'area', 'location', 'designation', 'existed', 'description_md', 'wikidata_id', 'metadata'],
        need: ['country_code', 'boundary_code'], note: 'A country: its outline comes with the boundary code (its ISO code, JP).' },
      region: { label: 'a region', only: ['name', 'names', 'kind', 'parent', 'country_code', 'boundary_code', 'area', 'location', 'designation', 'existed', 'description_md', 'wikidata_id', 'metadata'],
        need: ['parent', 'country_code'], note: 'A region: its outline from the boundary code (JP-13) or drawn as an area; the country or region it lies in as parent.' },
      district: { label: 'a district', only: ['name', 'names', 'kind', 'parent', 'country_code', 'area', 'location', 'designation', 'existed', 'description_md', 'wikidata_id', 'metadata'],
        need: ['parent', 'location'] },
      settlement: { label: 'a settlement', only: ['name', 'names', 'kind', 'parent', 'country_code', 'area', 'location', 'designation', 'existed', 'description_md', 'wikidata_id', 'metadata'],
        need: ['parent', 'country_code', 'location'] },
      building: { label: 'a building', only: ['name', 'names', 'kind', 'parent', 'country_code', 'area', 'location', 'existed', 'description_md', 'wikidata_id', 'metadata'], need: ['parent', 'location'] },
      site: { label: 'a site', only: ['name', 'names', 'kind', 'parent', 'country_code', 'area', 'location', 'description_md', 'wikidata_id', 'metadata'], need: ['parent', 'location'] },
      archaeological: { label: 'an archaeological site', only: ['name', 'names', 'kind', 'parent', 'country_code', 'area', 'location', 'description_md', 'wikidata_id', 'metadata'], need: ['parent', 'location'] },
      natural: { label: 'a natural feature', only: ['name', 'names', 'kind', 'parent', 'country_code', 'area', 'location', 'route', 'description_md', 'wikidata_id', 'metadata'], need: ['location'],
        note: 'A mountain, lake, island, river — a river or road as a line: route.' },
      street: { label: 'a street or road', only: ['name', 'names', 'kind', 'parent', 'country_code', 'location', 'route', 'existed', 'description_md', 'wikidata_id', 'metadata'], need: ['parent', 'location'] },
    },
    always: { need: ['name', 'kind'] },
  },
  movement: { always: { need: ['name', 'kind', 'period', 'region'] } },
  polity: { always: { need: ['name', 'kind', 'period', 'country_codes'] } },
  event: { always: { need: ['name', 'kind', 'period', 'place'] } },
  literature: { always: { need: ['name', 'kind', 'written'] }, when: [{ field: 'parent', filled: true, need: ['part_number'] }] },
  term: { always: { need: ['name', 'category', 'definition'] } },
};

/** The rules of a type for the browser; ctx.groupKinds (artworks: the glossary's group-of-works terms) completes them. */
function rulesFor(type, ctx = {}) {
  const base = RULES[type];
  if (!base) return null;
  const rules = { ...base, values: { ...(base.values || {}) } };
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
