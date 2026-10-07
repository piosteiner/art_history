// The bibliography form shows the fields a kind of source uses (the rest stays in the form, hidden — switching the
// kind back loses nothing). Which fields: the citation patterns of the KHIST guide (src/bibliography.js).
const COMMON = ['kind', 'name', 'subtitle', 'names', 'authors', 'year', 'url', 'isbn', 'doi', 'siglum', 'primary_source',
  'reading_status', 'read_on', 'description_md', 'wikidata_id', 'metadata'];
const BY_KIND = {
  book: ['editors', 'compilers', 'edition', 'original_year', 'series', 'volumes_total', 'thesis', 'place', 'publisher'],
  catalogue: ['editors', 'compilers', 'exhibition', 'place', 'publisher', 'original_year'],
  chapter: ['container', 'container_editors', 'place', 'publisher', 'pages', 'pages_are_columns', 'original_year'],
  article: ['container', 'volume', 'issue', 'issue_date', 'pages', 'pages_are_columns'],
  lexicon_entry: ['container', 'container_editors', 'volumes_total', 'volume', 'place', 'publisher', 'pages', 'pages_are_columns'],
  catalogue_entry: ['catalogue_number', 'container', 'compilers', 'exhibition', 'place', 'pages'],
  web: ['container', 'volume', 'pages', 'accessed'],
  video: ['container', 'place', 'date_text', 'uploader', 'uploaded', 'accessed'],
  archival: ['date_text', 'archive', 'shelfmark'],
};

export function initSourceForm() {
  if (document.body.dataset.pageType !== 'source') return;
  const kind = document.querySelector('form.form select[name="f.kind"]');
  if (!kind) return;
  const fields = [...document.querySelectorAll('form.form .field')];
  const keyOf = (field) => {
    const el = field.querySelector('[name^="f."]');
    return el ? el.name.slice(2).replace(/_(label|lang|lon|lat)$/, '') : null;
  };
  const update = () => {
    const show = BY_KIND[kind.value];
    for (const field of fields) {
      const key = keyOf(field);
      if (!key || !show) { field.hidden = false; continue; }  // "other": everything
      field.hidden = !COMMON.includes(key) && !show.includes(key);
    }
    // a section (forms.js SECTIONS) whose fields are all hidden hides with them, title included
    for (const sec of document.querySelectorAll('form.form .form-section')) {
      sec.hidden = ![...sec.querySelectorAll('.field')].some((f) => !f.hidden);
    }
  };
  kind.addEventListener('change', update);
  update();
}
