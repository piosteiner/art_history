// Does a new form hold anything written? (owner 2026-11-05: "entries with no content at all should not be saved as
// draft"). Content = a text field, a text area (the Markdown editors keep theirs in step) or a picker's hidden value
// that is not empty. Not content: the slug (made from the name), choices — selects, radio buttons (the "recent source"
// chips), tick boxes — and date fields (the form fills in today: a changelog day, "last accessed"). A new form without
// content is no draft: live.js and formdrafts.js remove the draft instead of saving it.
const NOT_TEXT = new Set(['checkbox', 'radio', 'date', 'datetime-local', 'month', 'week', 'time', 'color', 'range', 'submit', 'button', 'reset', 'file', 'image']);

export function hasContent(form) {
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.name === 'slug' || el.name === 'version' || el.name === 'base') continue;
    if (el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.tagName === 'FIELDSET') continue;
    if (el.tagName === 'INPUT' && NOT_TEXT.has(el.type)) continue;
    if (String(el.value).trim()) return true;
  }
  return false;
}
