// A form shown again with errors: the first marked field (.field.has-error) is opened if it sits in a collapsed group
// ("Exact location on the map…"), scrolled into view and focused; the "Marked in red" links do the same for theirs.
function reveal(field) {
  for (let d = field.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  field.scrollIntoView({ block: 'center' });
  const input = field.querySelector('input:not([type=hidden]), textarea, select');
  if (input) input.focus({ preventScroll: true });
}

export function initErrorFields() {
  const first = document.querySelector('form.form .field.has-error');
  if (first) reveal(first);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-error-field]');
    if (!a) return;
    const input = document.getElementById(`f-${a.dataset.errorField}`) || document.querySelector(`[name^="f.${a.dataset.errorField}"]`);
    const field = input && input.closest('.field');
    if (!field) return;
    e.preventDefault();
    reveal(field);
  });
}
