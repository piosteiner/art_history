// Markdown editor for the admin panel (browser code, bundled by `npm run build:admin` → static/editor.js).
//
// Every <textarea class="md"> becomes a CodeMirror 6 editor with "live styling": **bold** looks bold, *italic* looks
// italic, headings are larger, links coloured — the Markdown markers stay visible but dimmed, so what you see is
// exactly what is saved (the text is never rewritten). The textarea stays in the form (hidden) and is kept in sync,
// so saving works as before, and without JavaScript the plain textarea still works.
// "Preview" asks the server to render the text with the same markdown-it + sanitize-html as the public API.
import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, LanguageSupport } from '@codemirror/language';
// Just the Markdown (GFM) grammar — markdown() would also bundle HTML/CSS/JS highlighting for code blocks (~150 KB).
import { markdownLanguage } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { autocompletion } from '@codemirror/autocomplete';
import { initAutocomplete } from './autocomplete';
import { initLive } from './live';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { startCollab } from './collab';
import { initWikidataBulk } from './wikidata-bulk';
import { initSlug } from './slug';
import { guessLang } from '../../textlang';
import { fold as foldText } from '../../fold';
import { initNames } from './names';
import { initUnpublished } from './unpublished';
import { initMaterials } from './materials';
import { initDims } from './dims';
import { initSourceForm } from './sourceform';
import { initLiveSearch } from './livesearch';
import { initInfinite } from './infinite';
import { initDuplicates } from './duplicates';
import { initSortable } from './sortable';
import { initCiteDialogs, initCiteTriggers } from './cites';
import { initErrorFields } from './errors';

// Colours come from the admin stylesheet's CSS variables, so light/dark mode just works.
const liveStyle = HighlightStyle.define([
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.heading1, fontWeight: '700', fontSize: '1.35em' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.2em' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', fontSize: '1.05em' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--muted)', fontSize: '.9em' },
  { tag: t.monospace, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: '.9em', background: 'var(--code)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  // The markers themselves: ** * # > - [ ]( ) `
  { tag: t.processingInstruction, color: 'var(--muted)', opacity: '.55', fontWeight: '400', fontStyle: 'normal' },
]);

const theme = EditorView.theme({
  '&': { background: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: '0 0 6px 6px' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-1px' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.55', minHeight: 'var(--md-min-height, 11rem)', maxHeight: '70vh' },
  '.cm-content': { padding: '.5rem .6rem', caretColor: 'var(--caret)' },
  // drawSelection() draws its own cursor (black by default — invisible on the dark background)
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--caret)' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'color-mix(in srgb, var(--accent) 25%, transparent)' },
  // the [[ suggestions: the panel's colours (CodeMirror's own are light — bright text on bright ground in dark mode)
  '.cm-tooltip': { background: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: '6px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '16em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '.2rem .6rem' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent)', color: 'var(--accent-fg)' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '.6rem' },
  '.cm-tooltip-autocomplete li[aria-selected] .cm-completionDetail': { color: 'inherit', opacity: '.85' },
});

// Toggle a wrapper like ** or * around the selection (or insert an empty pair at the cursor).
function wrap(view, mark) {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    const before = view.state.sliceDoc(range.from - mark.length, range.from);
    const after = view.state.sliceDoc(range.to, range.to + mark.length);
    if (before === mark && after === mark) {  // already wrapped → unwrap
      return {
        changes: [{ from: range.from - mark.length, to: range.from }, { from: range.to, to: range.to + mark.length }],
        range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
      };
    }
    return {
      changes: { from: range.from, to: range.to, insert: mark + text + mark },
      range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
    };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
  view.focus();
  return true;
}

function link(view) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to) || 'link text';
  const insert = `[${text}](https://)`;
  const urlStart = from + text.length + 3;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: urlStart, head: urlStart + 'https://'.length }, userEvent: 'input' });
  view.focus();
  return true;
}

// Toggle a prefix ("## ", "- ", "> ") on every line the selection touches.
function linePrefix(view, prefix) {
  const { state } = view;
  const lines = new Set();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      lines.add(line.from);
      pos = line.to + 1;
    }
  }
  const starts = [...lines].map((from) => state.doc.lineAt(from));
  const allHave = starts.every((l) => l.text.startsWith(prefix));
  view.dispatch({
    changes: starts.map((l) => (allHave ? { from: l.from, to: l.from + prefix.length } : { from: l.from, insert: prefix })),
    userEvent: 'input',
  });
  view.focus();
  return true;
}

const shortcuts = [
  { key: 'Mod-b', run: (v) => wrap(v, '**') },
  { key: 'Mod-i', run: (v) => wrap(v, '*') },
  { key: 'Mod-k', run: link },
];

function button(label, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';  // never submits the form
  b.className = 'md-tool';
  b.textContent = label;
  b.title = title;
  b.addEventListener('mousedown', (e) => e.preventDefault());  // keep the editor's selection
  b.addEventListener('click', onClick);
  return b;
}

async function renderPreview(text) {
  const res = await fetch('/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text }),
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`preview failed (${res.status})`);
  return res.text();  // sanitized HTML from the server
}

// [[links]] to entries, as in Obsidian: typing "[[" and a few letters lists matching entries of every type (the same
// typo-tolerant /lookup as the pickers); "[[artist/hoku" narrows to one type. Picking one writes [[type/slug]] — a
// glossary term the short [[slug]] (src/markdown.js). filter: false — the server already ranked them, and the typed
// text ("[[hoku") wouldn't match the labels ("Katsushika Hokusai") by CodeMirror's own filter.
const LINK_TYPES = ['artist', 'artwork', 'institution', 'person', 'movement', 'place', 'polity', 'event', 'term', 'source'];
async function entryCompletions(context) {
  const m = context.matchBefore(/\[\[[^\[\]|\n]*$/);
  if (!m) return null;
  let q = m.text.slice(2).trim();
  let types = LINK_TYPES;
  const typed = /^([a-z]+)\/(.*)$/.exec(q);
  if (typed && LINK_TYPES.includes(typed[1])) { types = [typed[1]]; q = typed[2].trim(); }
  if (!q) return { from: m.from, options: [], filter: false };
  let hits = [];
  try {
    const res = await fetch(`/lookup?types=${types.join(',')}&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
    if (res.ok) hits = await res.json();
  } catch { return null; }
  const after = context.state.sliceDoc(context.pos, context.pos + 2);  // "]]" already typed after the cursor?
  const options = hits.map((h) => ({
    label: h.name,
    detail: [h.type === 'term' ? 'glossary' : h.type, h.period_label].filter(Boolean).join(' · '),
    type: 'text',
    apply: h.type === 'term' ? `[[${h.slug}]]` : `[[${h.type}/${h.slug}]]`,
  }));
  // nothing of that exact name: "+ Create …" — as in Obsidian, a link to what doesn't exist yet makes it.
  // "[[person/james-cook" → a person "James Cook" at once; "[[James Cook" → its type chosen in a small box.
  const name = nameOfTyped(q);
  const type = typed && LINK_TYPES.includes(typed[1]) ? typed[1] : null;
  if (name.length >= 2 && !hits.some((h) => fold(h.name) === fold(name) && (!type || h.type === type))) {
    options.push({
      label: type ? `＋ Create ${TYPE_NAME[type].toLowerCase()} “${name}”` : `＋ Create “${name}”…`,
      detail: 'new entry', type: 'text',
      apply: (view, _completion, from, to) => createLinked(view, from, to, name, type),
    });
  }
  return { from: m.from, to: after === ']]' ? context.pos + 2 : context.pos, filter: false, options };
}

const fold = (t) => foldText(t).trim();  // accents and special letters off (src/fold.js)
// "james-cook" (a slug typed by hand) → "James Cook"; anything else as typed
const nameOfTyped = (q) => (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(q) ? q.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : q.replace(/\s+/g, ' '));
const TYPE_NAME = { person: 'Person', artist: 'Artist', artwork: 'Artwork', institution: 'Institution', place: 'Place',
  movement: 'Movement', event: 'Event', polity: 'Polity', term: 'Glossary term', source: 'Source' };
const TYPE_HINT = { place: ' (looked up on OpenStreetMap)', polity: ' (state, dynasty …)', source: ' (bibliography)' };
const LAST_TYPE = 'arthistory-admin:link-type';

// Creates the entry (POST /lookup/create: minimal, "to complete"; an existing one of that name is used) and puts the
// link where "[[name" was typed. With no type given, a small box asks for it first.
function createLinked(view, from, to, name, type) {
  const typedText = view.state.sliceDoc(from, to);
  const make = async (chosen) => {
    let res;
    try {
      res = await fetch('/lookup/create', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ type: chosen, name }) });
    } catch { return 'Not created — no connection.'; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return body.error || `Not created (${res.status}).`;
    const link = chosen === 'term' ? `[[${body.slug}]]` : `[[${chosen}/${body.slug}]]`;
    // others may have typed meanwhile (shared working copy): the typed text where it was, else nearby, else the cursor
    let at = view.state.sliceDoc(from, from + typedText.length) === typedText ? from
      : view.state.doc.toString().indexOf(typedText, Math.max(0, from - 500));
    const len = at >= 0 ? typedText.length : 0;
    if (at < 0) at = view.state.selection.main.head;
    view.dispatch({ changes: { from: at, to: at + len, insert: link }, selection: { anchor: at + link.length }, userEvent: 'input' });
    view.focus();
    return null;
  };
  if (type) { make(type).then((err) => err && window.alert(err)); return; }
  typeChooser(view, from, name, make);
}

function typeChooser(view, pos, name, make) {
  const box = document.createElement('div');
  box.className = 'link-create';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', `Create “${name}”`);
  const label = Object.assign(document.createElement('label'), { textContent: `Create “${name}” as ` });
  const select = document.createElement('select');
  let last = 'person';
  try { last = localStorage.getItem(LAST_TYPE) || last; } catch { /* storage off */ }
  for (const t of Object.keys(TYPE_NAME)) select.append(new Option(TYPE_NAME[t] + (TYPE_HINT[t] || ''), t, false, t === last));
  label.append(select);
  const ok = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Create' });
  const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel', className: 'secondary' });
  const msg = Object.assign(document.createElement('div'), { className: 'hint error', hidden: true });
  const note = Object.assign(document.createElement('div'), { className: 'hint', textContent: 'A new entry with just its name, marked “to complete”.' });
  box.append(label, ok, cancel, msg, note);
  const c = view.coordsAtPos(pos) || view.dom.getBoundingClientRect();
  Object.assign(box.style, { left: `${Math.round(c.left + window.scrollX)}px`, top: `${Math.round(c.bottom + window.scrollY + 6)}px` });
  document.body.append(box);
  select.focus();
  const close = () => { box.remove(); document.removeEventListener('mousedown', outside, true); view.focus(); };
  const outside = (e) => { if (!box.contains(e.target)) close(); };
  document.addEventListener('mousedown', outside, true);
  const go = async () => {
    ok.disabled = true;
    ok.textContent = 'Creating…';
    const err = await make(select.value);
    if (err) { msg.textContent = err; msg.hidden = false; ok.disabled = false; ok.textContent = 'Create'; return; }
    try { localStorage.setItem(LAST_TYPE, select.value); } catch { /* storage off */ }
    close();
  };
  ok.addEventListener('click', go);
  cancel.addEventListener('click', close);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter') { e.preventDefault(); go(); }
  });
}

// collab: { ytext, awareness, undoManager } — edit a shared working copy's text (live step 2): the Y.Text is the source,
// other editors' cursors/selections are drawn, and undo only undoes your own changes.
function enhance(textarea, collab = null) {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-editor';
  const toolbar = document.createElement('div');
  toolbar.className = 'md-toolbar';
  const preview = document.createElement('div');
  preview.className = 'md-preview md';
  preview.hidden = true;
  // The editor lives in its own box so Preview can hide it (CodeMirror manages its own element's attributes).
  const editorBox = document.createElement('div');
  wrapper.append(editorBox);

  // The spell check language: the browser's own checker, told by the lang attribute of the editable area (Firefox and
  // Safari switch dictionaries by it; Chrome/Edge check every language enabled in their settings). Recognised from the
  // text as you type (src/textlang.js: English or German); the toolbar button switches it by hand for this field.
  const langOf = new Compartment();
  let lang = guessLang(collab ? collab.ytext.toString() : textarea.value) || 'en';
  let langByHand = false;
  let langTimer = null;
  const LANG_NAME = { en: 'English', de: 'German' };
  const langButton = button(lang.toUpperCase(), '', () => { langByHand = true; setLang(lang === 'de' ? 'en' : 'de'); });
  langButton.classList.add('md-lang');
  const showLang = () => {
    langButton.textContent = lang.toUpperCase();
    langButton.title = `Spelling: ${LANG_NAME[lang]} — ${langByHand ? 'chosen by you' : 'recognised from the text'}. Click to switch to ${LANG_NAME[lang === 'de' ? 'en' : 'de']}.`;
  };
  const setLang = (l) => {
    lang = l;
    view.dispatch({ effects: langOf.reconfigure(EditorView.contentAttributes.of({ lang: l })) });
    // Firefox picks the dictionary when spell checking starts (on focus): off and on again makes it check the text
    // anew with the new language, without leaving the field
    view.contentDOM.spellcheck = false;
    requestAnimationFrame(() => { view.contentDOM.spellcheck = true; });
    preview.lang = l;
    showLang();
  };

  const view = new EditorView({
    parent: editorBox,
    state: EditorState.create({
      doc: collab ? collab.ytext.toString() : textarea.value,
      extensions: [
        collab ? yCollab(collab.ytext, collab.awareness, { undoManager: collab.undoManager }) : history(),
        drawSelection(),
        keymap.of([...shortcuts, ...defaultKeymap, ...(collab ? yUndoManagerKeymap : historyKeymap)]),
        new LanguageSupport(markdownLanguage),
        syntaxHighlighting(liveStyle),
        EditorView.lineWrapping,
        autocompletion({ override: [entryCompletions], icons: false }),
        theme,
        placeholder(textarea.placeholder || 'Write here — Markdown styling appears as you type.'),
        EditorView.contentAttributes.of({ 'aria-label': textarea.getAttribute('aria-label') || textarea.id || 'Markdown', spellcheck: 'true' }),
        langOf.of(EditorView.contentAttributes.of({ lang })),
        // Keep the hidden textarea current: the form posts it as before.
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          if (!langByHand) {  // a pause in typing: is it still the same language?
            clearTimeout(langTimer);
            langTimer = setTimeout(() => { const g = guessLang(u.view.state.doc.toString()); if (g && g !== lang) setLang(g); }, 700);
          }
          textarea.value = u.state.doc.toString();
          textarea.dispatchEvent(new Event('md-change', { bubbles: true }));  // for editor/unpublished.js
        }),
      ],
    }),
  });
  if (textarea.rows && textarea.rows < 4) wrapper.style.setProperty('--md-min-height', '4.5rem');

  const previewButton = button('Preview', 'Show how it will look on the website', async () => {
    if (!preview.hidden) {
      preview.hidden = true;
      editorBox.hidden = false;
      previewButton.textContent = 'Preview';
      toolbar.classList.remove('previewing');
      view.focus();
      return;
    }
    previewButton.textContent = 'Edit';
    toolbar.classList.add('previewing');
    preview.textContent = 'Rendering…';
    preview.style.minHeight = `${view.dom.offsetHeight}px`;
    preview.hidden = false;
    editorBox.hidden = true;
    try {
      const html = await renderPreview(view.state.doc.toString());
      preview.innerHTML = html || '<p class="muted">(empty)</p>';  // server-sanitized
    } catch (err) {
      preview.textContent = err.message;
    }
  });

  toolbar.append(
    button('B', 'Bold (Ctrl/⌘+B)', () => wrap(view, '**')),
    button('I', 'Italic (Ctrl/⌘+I)', () => wrap(view, '*')),
    button('Link', 'Link (Ctrl/⌘+K)', () => link(view)),
    button('H', 'Heading', () => linePrefix(view, '## ')),
    button('• List', 'Bulleted list', () => linePrefix(view, '- ')),
    button('❝ Quote', 'Quote', () => linePrefix(view, '> ')),
    Object.assign(document.createElement('span'), { className: 'md-spacer' }),
    langButton,
    previewButton,
  );
  preview.lang = lang;
  showLang();
  toolbar.children[0].style.fontWeight = '700';
  toolbar.children[1].style.fontStyle = 'italic';

  wrapper.prepend(toolbar);
  wrapper.append(preview);
  textarea.hidden = true;
  textarea.after(wrapper);
  // Clicking the field's <label> focuses the editor.
  if (textarea.id) {
    const label = document.querySelector(`label[for="${CSS.escape(textarea.id)}"]`);
    if (label) label.addEventListener('click', (e) => { e.preventDefault(); view.focus(); });
  }
}

initAutocomplete();
// comparison pages: typing in "another of ours" chooses that option of the row
document.addEventListener('input', (e) => {
  if (!e.target.matches || !e.target.matches('.rel-picker')) return;
  const choice = e.target.closest('.rel-other') && e.target.closest('.rel-other').querySelector('input[type=radio]');
  if (choice && e.target.value.trim()) choice.checked = true;
});
initNames();
initMaterials();
initDims();
initSourceForm();
initLiveSearch();
initInfinite();
initDuplicates();
initSortable();
initCiteDialogs();
initCiteTriggers();
initErrorFields();
initSlug();
// A map inside a closed section (forms.js: "Where it stands…") was laid out at zero size: opening the section tells
// Leaflet to measure again (it listens to window resize).
for (const d of document.querySelectorAll('details.field-group')) d.addEventListener('toggle', () => window.dispatchEvent(new Event('resize')));
// Typing an object type that needs a group opens it: "building" → Where it stands, "series" → Part of a series.
const kindInput = document.getElementById('f-kind');
if (kindInput) {
  kindInput.addEventListener('input', () => {
    const kind = kindInput.value.trim().toLowerCase();
    for (const d of document.querySelectorAll('details.field-group[data-open-for-kind]')) {
      if (d.dataset.openForKind.split('|').includes(kind)) d.open = true;
    }
  });
}
initWikidataBulk();
const live = initLive();
const collabForm = document.querySelector('form[data-collab]');
if (collabForm && live) {
  // Existing entry: bind the form to the shared working copy; the Markdown editors are created once it is synced.
  startCollab(collabForm, live, enhance);
  initUnpublished(collabForm, live);
  document.querySelectorAll('textarea.md').forEach((ta) => { if (!collabForm.contains(ta)) enhance(ta); });
} else {
  document.querySelectorAll('textarea.md').forEach((ta) => enhance(ta));
}

// The map picker (Leaflet + Geoman, ~200 KB) is only fetched on pages that have one (place forms).
if (document.querySelector('.map-picker')) {
  // versioned URLs from the page (src/admin/assets.js), so a new deploy is never served from the browser cache
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: document.body.dataset.mapCss || '/static/map.css' }));
  document.head.append(Object.assign(document.createElement('script'), { src: document.body.dataset.mapJs || '/static/map.js' }));
}
