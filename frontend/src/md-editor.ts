// A small Markdown editor for texts written on the site (owner 2026-11-04: set descriptions "with our markdown
// formatting environment") — the same Markdown as the entries' texts, rendered by the backend (src/markdown.js +
// md-extras.js: raw HTML escaped, then sanitised), so the preview is exactly what is shown:
//   **bold**, *italic*, ## headings, lists, > quotes, ==highlight==, ||spoiler||, > [!tip] callouts, [text](https://…)
//   [[type/slug]] links to entries — typing "[[" and a few letters offers entries from the site's search
// Live styling as in the CMS editor (owner 2026-11-06, "like in Obsidian"): CodeMirror 6 — **bold** looks bold,
// headings are larger, links coloured, the Markdown markers stay visible but dimmed, so what you see is what is
// saved. The textarea stays in the form (hidden) and is kept in sync. Loaded only where a text is edited
// (callers import this module dynamically), so CodeMirror never weighs on the other pages.
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection, Decoration, ViewPlugin, MatchDecorator, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, LanguageSupport } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { autocompletion, startCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { search } from './api';
import { html, render, trusted } from './html';

type Wrap = { wrap: [string, string]; placeholder: string } | { line: string } | { insert: string; caret?: number };
const TOOLS: { label: string; title: string; key?: string; action: Wrap }[] = [
  { label: 'B', title: 'Bold (Ctrl+B)', key: 'b', action: { wrap: ['**', '**'], placeholder: 'bold' } },
  { label: 'I', title: 'Italic (Ctrl+I)', key: 'i', action: { wrap: ['*', '*'], placeholder: 'italic' } },
  { label: 'H', title: 'Heading', action: { line: '## ' } },
  { label: '•', title: 'List', action: { line: '- ' } },
  { label: '1.', title: 'Numbered list', action: { line: '1. ' } },
  { label: '❝', title: 'Quote', action: { line: '> ' } },
  { label: 'Mark', title: 'Highlight (==…==)', action: { wrap: ['==', '=='], placeholder: 'highlighted' } },
  { label: 'Hide', title: 'Spoiler — hidden until clicked (||…||), e.g. an answer', action: { wrap: ['||', '||'], placeholder: 'hidden' } },
  { label: 'Box', title: 'Callout box (> [!tip])', action: { insert: '\n> [!tip] \n> ', caret: -3 } },
  { label: 'Link', title: 'Web link', action: { wrap: ['[', '](https://)'], placeholder: 'text' } },
  { label: '[[ ]]', title: 'Link to an entry of this site — type a few letters after [[', action: { insert: '[[' } },
];

const liveStyle = HighlightStyle.define([
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.heading1, fontWeight: '700', fontSize: '1.35em', fontFamily: 'var(--serif)' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.2em', fontFamily: 'var(--serif)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', fontSize: '1.05em' },
  { tag: t.link, color: 'var(--link)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--muted)', fontSize: '.9em' },
  { tag: t.monospace, fontFamily: 'ui-monospace, monospace', fontSize: '.9em' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'var(--muted)', opacity: '.55', fontWeight: '400', fontStyle: 'normal' },
]);

const theme = EditorView.theme({
  '&': { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-1px' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.55', minHeight: 'var(--md-min-height, 9rem)', maxHeight: '70vh' },
  '.cm-content': { padding: '.5rem .7rem', caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--text)' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.cm-mark': { background: 'var(--mark)', borderRadius: '2px' },
  '.cm-wiki': { color: 'var(--link)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'color-mix(in srgb, var(--accent) 25%, transparent)' },
  '.cm-tooltip': { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '8px', boxShadow: 'var(--shadow)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '16em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '.25rem .7rem' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--picked-bg)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '.6rem' },
});

/** ==highlight== and [[links]] look like what they become (the Markdown grammar doesn't know them) */
const marks = (re: RegExp, cls: string) => {
  const deco = new MatchDecorator({ regexp: re, decoration: () => Decoration.mark({ class: cls }) });
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(v: EditorView) { this.decorations = deco.createDeco(v); }
    update(u: ViewUpdate) { this.decorations = deco.updateDeco(u, this.decorations); }
  }, { decorations: (v) => v.decorations });
};

/** "[[" + letters → entries from the site's search */
async function entries(ctx: CompletionContext): Promise<CompletionResult | null> {
  const m = ctx.matchBefore(/\[\[[^\]|\n/]*$/);
  if (!m) return null;
  const q = m.text.slice(2);
  if (q.length < 2) return ctx.explicit ? { from: m.from + 2, options: [] } : null;
  const found = await search(q).catch(() => []);
  return {
    from: m.from,
    filter: false,
    options: found.slice(0, 8).map((h) => ({ label: h.name, detail: `${h.type}${h.subtitle ? ` · ${h.subtitle}` : ''}`, apply: `[[${h.type}/${h.slug}]]` })),
  };
}

function apply(view: EditorView, a: Wrap) {
  const { state } = view;
  if ('wrap' in a) {
    view.dispatch(state.changeByRange((r) => {
      const mid = state.sliceDoc(r.from, r.to) || a.placeholder;
      const text = a.wrap[0] + mid + a.wrap[1];
      return { changes: { from: r.from, to: r.to, insert: text }, range: EditorSelection.range(r.from + a.wrap[0].length, r.from + a.wrap[0].length + mid.length) };
    }));
  } else if ('line' in a) {
    const r = state.selection.main;
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    const changes = [];
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      const old = /^(#{1,6} |[-*] |\d+\. |> )/.exec(line.text)?.[0] ?? '';
      changes.push({ from: line.from, to: line.from + old.length, insert: a.line === '1. ' ? `${String(n - first + 1)}. ` : a.line });
    }
    view.dispatch({ changes });
  } else {
    const r = state.selection.main;
    view.dispatch({ changes: { from: r.from, to: r.to, insert: a.insert }, selection: { anchor: r.from + a.insert.length + (a.caret ?? 0) } });
    if (a.insert === '[[') startCompletion(view);
  }
  view.focus();
}

export function markdownEditor(area: HTMLTextAreaElement, preview: (text: string) => Promise<string>) {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-editor';
  area.replaceWith(wrapper);
  render(wrapper, html`<div class="md-bar" role="toolbar" aria-label="Formatting">
      <span class="md-tabs" role="tablist"><button type="button" role="tab" class="md-tab" data-tab="write" aria-selected="true">Write</button><button type="button" role="tab" class="md-tab" data-tab="preview" aria-selected="false">Preview</button></span>
      <span class="md-tools">${TOOLS.map((tool, i) => html`<button type="button" class="md-tool" data-i="${String(i)}" title="${tool.title}" aria-label="${tool.title}">${tool.label}</button>`)}</span></div>
    <div class="md-body"></div><div class="md-preview prose" hidden></div>
    <p class="muted small md-help">Markdown: **bold**, *italic*, ## heading, - list, ==highlight==, [[ for a link to an entry.</p>`);
  const body = wrapper.querySelector<HTMLElement>('.md-body')!;
  body.append(area);
  area.hidden = true;
  const sync = () => { area.value = cm.state.doc.toString(); area.dispatchEvent(new Event('input', { bubbles: true })); };
  const cm = new EditorView({
    parent: body,
    state: EditorState.create({
      doc: area.value,
      extensions: [
        history(), drawSelection(), EditorView.lineWrapping,
        keymap.of([
          ...TOOLS.filter((tool) => tool.key).map((tool) => ({ key: `Mod-${tool.key!}`, run: (v: EditorView) => { apply(v, tool.action); return true; } })),
          ...defaultKeymap, ...historyKeymap]),
        new LanguageSupport(markdownLanguage), syntaxHighlighting(liveStyle), theme,
        marks(/==(?=\S)[^=\n]*?\S==/g, 'cm-mark'), marks(/\[\[[^\]\n]+\]\]/g, 'cm-wiki'),
        autocompletion({ override: [entries], activateOnTyping: true }),
        placeholder(area.placeholder),
        EditorView.contentAttributes.of({ 'aria-label': area.getAttribute('aria-label') ?? area.name ?? 'Text', spellcheck: 'true' }),
        EditorView.updateListener.of((u) => { if (u.docChanged) sync(); }),
      ],
    }),
  });
  // a form reset or a value set from outside (a conflicting save puts theirs back) reaches the editor too
  area.addEventListener('md-set', () => cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: area.value } }));
  wrapper.querySelector('.md-tools')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.md-tool');
    if (b) apply(cm, TOOLS[Number(b.dataset.i)].action);
  });

  // Write | Preview
  const view = wrapper.querySelector<HTMLElement>('.md-preview')!;
  wrapper.querySelector('.md-tabs')!.addEventListener('click', (e) => {
    const tab = (e.target as Element).closest<HTMLButtonElement>('.md-tab');
    if (!tab) return;
    const showPreview = tab.dataset.tab === 'preview';
    wrapper.querySelectorAll<HTMLButtonElement>('.md-tab').forEach((x) => x.setAttribute('aria-selected', String(x === tab)));
    body.hidden = showPreview;
    wrapper.querySelector<HTMLElement>('.md-tools')!.hidden = showPreview;
    view.hidden = !showPreview;
    if (!showPreview) { cm.focus(); return; }
    render(view, html`<p class="muted small">…</p>`);
    preview(area.value).then((h) => render(view, h ? trusted(h) : html`<p class="muted small">Nothing written yet.</p>`))
      .catch(() => render(view, html`<p class="muted small">The preview could not be made.</p>`));
  });
  return wrapper;
}
