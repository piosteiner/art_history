// A field's help text behind an ⓘ beside its label (owner 2026-11-04: "hints of any length, shown only when truly
// needed"). The server renders it as <div class="hint help"> in the field (forms.js hint()); here it is hidden and the
// ⓘ opens and closes it. Without this script the hints simply stay visible.
let n = 0;
export function initHints(root = document) {
  for (const field of root.querySelectorAll('.field')) {
    const helps = [...field.querySelectorAll(':scope > .hint.help, :scope > * > .hint.help')].filter((h) => h.closest('.field') === field);
    if (!helps.length || field.querySelector(':scope .hint-toggle')) continue;
    const label = field.querySelector(':scope > label, :scope > .label-row > label');
    if (!label) continue;
    const ids = helps.map((h) => { h.id = h.id || `hint-${++n}`; h.hidden = true; return h.id; });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hint-toggle';
    btn.textContent = 'i';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', ids.join(' '));
    btn.setAttribute('aria-label', `help: ${label.textContent.replace(/\s+/g, ' ').trim()}`);
    btn.title = 'Help';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      for (const h of helps) h.hidden = !open;
    });
    // beside the label: in its row (made here when the field has none yet; the citation badges join it later)
    if (!label.parentElement.classList.contains('label-row')) {
      const row = document.createElement('div');
      row.className = 'label-row';
      label.before(row);
      row.append(label);
    }
    label.parentElement.append(btn);
  }
}
