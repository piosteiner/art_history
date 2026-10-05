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

// "Add reading" for one text input: select kanji, press it → a small panel under the field asks for the reading
// (Enter adds it, Esc cancels) and writes {神奈川|かながわ}. The preview (optional) shows the result as real ruby.
// → [button, panel]: the caller places them; the panel's input has no name, so forms and live copies ignore it.
function readingButton(input, preview, langOf) {
  const button = el('button', { type: 'button', className: 'secondary small add-reading', textContent: 'Add reading',
    title: 'Select kanji in the field first, then press this to add furigana' });
  const word = el('b');
  const reading = el('input', { className: 'reading-input', placeholder: 'reading, e.g. かながわ', autocomplete: 'off' });
  reading.setAttribute('aria-label', 'reading');
  const ok = el('button', { type: 'button', className: 'small', textContent: 'Add' });
  const cancel = el('button', { type: 'button', className: 'link small', textContent: 'Cancel' });
  const note = el('span', { className: 'muted small reading-note' });
  const ask = el('span', { className: 'reading-ask' }, 'Reading for ', word, ':');
  const panel = el('div', { className: 'reading-panel', hidden: true }, ask, reading, ok, cancel, note);
  let range = null;  // [start, end, text] of the selection being annotated

  const close = () => { panel.hidden = true; range = null; };
  const show = (message) => {  // a message only (no selection, nested reading …)
    panel.hidden = false;
    ask.hidden = true; reading.hidden = true; ok.hidden = true;
    note.textContent = message;
    cancel.textContent = 'OK';
  };
  button.addEventListener('mousedown', (e) => e.preventDefault());  // keep the selection in the field
  button.addEventListener('click', () => {
    const [a, b] = [input.selectionStart, input.selectionEnd];
    const sel = input.value.slice(a, b);
    if (!sel.trim()) return show('Select the kanji in the field first, then press “Add reading”.');
    if (/[{}|]/.test(sel)) return show('The selection already has a reading — select plain kanji.');
    range = [a, b, sel];
    ask.hidden = false; reading.hidden = false; ok.hidden = false;
    note.textContent = '';
    cancel.textContent = 'Cancel';
    word.textContent = sel;
    word.lang = langOf() || 'ja';
    reading.lang = word.lang;
    reading.value = '';
    panel.hidden = false;
    reading.focus();
  });
  const apply = () => {
    const r = reading.value.trim().replace(/[{}|]/g, '');
    if (!range || !r) { reading.focus(); return; }
    const [a, b, sel] = range;
    if (input.value.slice(a, b) !== sel) { show('The text changed meanwhile — select the kanji again.'); return; }
    input.value = `${input.value.slice(0, a)}{${sel}|${r}}${input.value.slice(b)}`;
    close();
    input.focus();
    const end = a + sel.length + r.length + 3;
    input.setSelectionRange(end, end);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  ok.addEventListener('click', apply);
  cancel.addEventListener('click', () => { close(); input.focus(); });
  reading.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }  // never submits the form
    if (e.key === 'Escape') { e.preventDefault(); close(); input.focus(); }
  });

  const update = () => {
    if (!preview) return;
    preview.hidden = !hasRuby(input.value);
    if (!preview.hidden) renderRuby(preview, input.value, langOf());
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  update();
  return [button, panel];
}

function initRubyInputs() {
  document.querySelectorAll('input[data-ruby]').forEach((input) => {
    const field = input.closest('.field');
    const lang = field.querySelector('.lang-input');
    const preview = field.querySelector('.ruby-preview');
    const langOf = () => (lang ? lang.value.trim() : '');
    const [button, panel] = readingButton(input, preview, langOf);
    field.querySelector('.name-meta').append(button);
    preview.before(panel);
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
    const text = el('input', { className: 'n-text', value: n.text, placeholder: 'name' });
    text.setAttribute('aria-label', 'name');
    const lang = el('input', { className: 'n-lang lang-input', value: n.lang, placeholder: 'language', autocomplete: 'off' });
    lang.setAttribute('list', 'lang-list');
    lang.setAttribute('aria-label', 'language');
    const role = el('select', { className: 'n-role' }, ...ROLES.map((r) => el('option', { value: r, textContent: r, selected: r === n.role })));
    role.setAttribute('aria-label', 'role');
    const remove = el('button', { type: 'button', className: 'link small n-remove', textContent: 'remove' });
    const preview = el('div', { className: 'ruby-preview', hidden: true });
    const meta = el('div', { className: 'name-meta' }, lang, role);
    const r = el('div', { className: 'names-row' }, text, meta);
    const [button, panel] = readingButton(text, preview, () => lang.value.trim());
    meta.append(button, remove);
    r.append(panel, preview);
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
