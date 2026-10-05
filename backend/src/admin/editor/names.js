// Names in several languages (src/names.js): furigana and the "other names" rows.
//
//  input[data-ruby]       gets an "Add reading" button: select kanji, press it, type the reading → {神奈川|かながわ};
//                         below it a live preview with real <ruby> (built as DOM nodes, never as HTML).
//  textarea[data-names]   stays the form field (one "text | lang | role" per line — what the server, the drafts and the
//                         shared working copy see) and is shown as rows; edits in the rows are written back into it,
//                         changes arriving in it (another editor, a restored draft) redraw the rows.
import { ROLES, plain, hasRuby, namesToLines, splitLine } from '../../names';

const GROUP = /\{([^{}|]+)\|([^{}|]+)\}/g;
const el = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); e.append(...children); return e; };

function renderRuby(target, text, lang) {
  target.replaceChildren();
  let last = 0;
  for (const m of text.matchAll(GROUP)) {
    target.append(text.slice(last, m.index), el('ruby', {}, m[1], el('rp', { textContent: '(' }), el('rt', { textContent: m[2] }), el('rp', { textContent: ')' })));
    last = m.index + m[0].length;
  }
  target.append(text.slice(last));
  if (lang) target.lang = lang; else target.removeAttribute('lang');
}

// "Add reading" for one text input; preview (optional) shows the result.
function readingButton(input, preview, langOf) {
  const note = el('span', { className: 'muted small reading-note' });
  const button = el('button', { type: 'button', className: 'secondary small add-reading', textContent: 'Add reading',
    title: 'Select kanji in the field first, then press this to add furigana' });
  button.addEventListener('mousedown', (e) => e.preventDefault());  // keep the selection in the field
  button.addEventListener('click', () => {
    const [a, b] = [input.selectionStart, input.selectionEnd];
    const sel = input.value.slice(a, b);
    note.textContent = '';
    if (!sel.trim()) { note.textContent = 'Select the kanji first.'; return; }
    if (/[{}|]/.test(sel)) { note.textContent = 'The selection already has a reading — select plain kanji.'; return; }
    const r = window.prompt(`Reading (furigana) for ${sel}:`, '');
    if (!r || !r.trim()) return;
    input.value = `${input.value.slice(0, a)}{${sel}|${r.trim().replace(/[{}|]/g, '')}}${input.value.slice(b)}`;
    input.focus();
    const end = a + sel.length + r.trim().length + 3;
    input.setSelectionRange(end, end);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const update = () => {
    if (!preview) return;
    preview.hidden = !hasRuby(input.value);
    if (!preview.hidden) renderRuby(preview, input.value, langOf());
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  update();
  return [button, note];
}

function initRubyInputs() {
  document.querySelectorAll('input[data-ruby]').forEach((input) => {
    const field = input.closest('.field');
    const lang = field.querySelector('.lang-input');
    const preview = field.querySelector('.ruby-preview');
    const langOf = () => (lang ? lang.value.trim() : '');
    const [button, note] = readingButton(input, preview, langOf);
    input.closest('.row').append(button);
    preview.before(note);
    if (lang) lang.addEventListener('input', () => { input.lang = langOf(); input.dispatchEvent(new Event('change')); });
  });
}

function initNamesEditor(ta) {
  const box = el('div', { className: 'names-editor' });
  const rows = el('div', { className: 'names-rows' });
  const add = el('button', { type: 'button', className: 'secondary small', textContent: '+ Add a name' });
  box.append(rows, add);
  ta.hidden = true;
  ta.after(box);

  const parse = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [t, lang, role] = splitLine(l);
    return { text: t || '', lang: lang || '', role: (role || 'alternative').toLowerCase() };
  });
  const write = () => {
    const list = [...rows.children].map((r) => ({ text: r.querySelector('.n-text').value.trim(), lang: r.querySelector('.n-lang').value.trim(),
      role: r.querySelector('.n-role').value })).filter((n) => n.text);
    const text = namesToLines(list.map((n) => ({ ...n, lang: n.lang || null })));
    if (text !== ta.value) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  };
  const row = (n = { text: '', lang: '', role: 'alternative' }) => {
    const text = el('input', { className: 'n-text grow', value: n.text, placeholder: 'name' });
    text.setAttribute('aria-label', 'name');
    const lang = el('input', { className: 'n-lang lang-input', value: n.lang, placeholder: 'language', autocomplete: 'off' });
    lang.setAttribute('list', 'lang-list');
    lang.setAttribute('aria-label', 'language');
    const role = el('select', { className: 'n-role' }, ...ROLES.map((r) => el('option', { value: r, textContent: r, selected: r === n.role })));
    role.setAttribute('aria-label', 'role');
    const remove = el('button', { type: 'button', className: 'link n-remove', textContent: 'remove' });
    const preview = el('div', { className: 'ruby-preview', hidden: true });
    const r = el('div', { className: 'names-row' }, el('div', { className: 'row' }, text, lang, role), preview);
    const [button, note] = readingButton(text, preview, () => lang.value.trim());
    r.firstChild.append(button, remove);
    r.append(note);
    remove.addEventListener('click', () => { r.remove(); write(); });
    for (const x of [text, lang, role]) x.addEventListener('input', write);
    role.addEventListener('change', write);
    text.addEventListener('change', write);
    return r;
  };
  const render = () => {
    rows.replaceChildren(...parse(ta.value).map(row));
    if (!rows.children.length) rows.append(row());
  };
  add.addEventListener('click', () => { const r = row(); rows.append(r); r.querySelector('.n-text').focus(); });
  // Changed from outside (another editor via the shared working copy, a restored draft): redraw, keeping the caret.
  ta.addEventListener('change', () => {
    const a = document.activeElement;
    const r = a && a.closest && a.closest('.names-row');
    const pos = r && rows.contains(r) ? { i: [...rows.children].indexOf(r), cls: a.classList[0], caret: a.selectionStart } : null;
    render();
    const back = pos && rows.children[pos.i] && rows.children[pos.i].querySelector(`.${pos.cls}`);
    if (back) { back.focus(); if (pos.caret != null && back.setSelectionRange) back.setSelectionRange(pos.caret, pos.caret); }
  });
  render();
}

export function initNames() {
  initRubyInputs();
  document.querySelectorAll('textarea[data-names]').forEach(initNamesEditor);
}

export { plain };
