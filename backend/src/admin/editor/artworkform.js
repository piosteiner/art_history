// The artwork form for a group of works (migration 132: its kind is a term of the glossary category "group of works" —
// series, versions, cycle, pair …, listed in the form's data-group-kinds): the fields of a physical object are hidden
// while they are empty — a series in three museums has no size, inventory number or place of its own. A field with a
// value stays (nothing disappears), and the rest stays in the form, hidden: switching the kind back loses nothing.
// Like the bibliography form (sourceform.js); a section whose fields are all hidden hides with them.
const OBJECT_FIELDS = ['conceived', 'medium', 'materials', 'dimensions', 'dimensions_note', 'other_dimensions', 'institution',
  'inventory_number', 'on_loan', 'on_loan_since', 'location', 'area', 'provenance_status', 'provenance_status_note', 'fate',
  'fate_date', 'fate_note'];

export function initArtworkForm() {
  const form = document.querySelector('form.form[data-group-kinds]');
  const kind = document.getElementById('f-kind');
  if (document.body.dataset.pageType !== 'artwork' || !form || !kind) return;
  const groups = new Set(form.dataset.groupKinds.split('|'));
  const fields = [...form.querySelectorAll('.field')];
  const keyOf = (field) => {
    const el = field.querySelector('[name^="f."]');
    return el ? el.name.slice(2).replace(/_(label|lang|lon|lat|h|w|d|unit)$/, '') : null;
  };
  // empty: no input of the field holds a value (a checkbox: unticked)
  const empty = (field) => [...field.querySelectorAll('input, textarea, select')]
    .every((el) => (el.type === 'checkbox' || el.type === 'radio' ? !el.checked : !String(el.value || '').trim()));
  const note = document.createElement('p');
  note.className = 'hint group-note';
  note.textContent = 'A group of works: the fields of a single object (size, museum, inventory number …) are hidden while empty — each part has its own.';
  kind.closest('.field').append(note);
  const update = () => {
    const group = groups.has(kind.value.trim().toLowerCase());
    note.hidden = !group;
    for (const field of fields) {
      const key = keyOf(field);
      field.hidden = group && OBJECT_FIELDS.includes(key) && empty(field);
    }
    for (const sec of form.querySelectorAll('.form-section')) {
      sec.hidden = ![...sec.querySelectorAll('.field')].some((f) => !f.hidden);
    }
    for (const d of form.querySelectorAll('details.field-group')) {
      d.hidden = ![...d.querySelectorAll('.field')].some((f) => !f.hidden);
    }
  };
  kind.addEventListener('input', update);
  kind.addEventListener('change', update);
  update();
}
