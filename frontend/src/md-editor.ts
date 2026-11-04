// A small Markdown editor for texts written on the site (owner 2026-11-04: set descriptions "with our markdown
// formatting environment") — the same Markdown as the entries' texts, rendered by the backend (src/markdown.js +
// md-extras.js: raw HTML escaped, then sanitised), so the preview is exactly what is shown:
//   **bold**, *italic*, ## headings, lists, > quotes, ==highlight==, ||spoiler||, > [!tip] callouts, [text](https://…)
//   [[type/slug]] links to entries — typing "[[" and a few letters offers entries from the site's search
// A toolbar over a plain <textarea> (no editor library on the site): Write | Preview tabs, Ctrl+B / Ctrl+I.
import { search } from './api';
import { html, render, trusted } from './html';
import type { SearchHit } from './types';

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

export function markdownEditor(area: HTMLTextAreaElement, preview: (text: string) => Promise<string>) {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-editor';
  area.replaceWith(wrapper);
  render(wrapper, html`<div class="md-bar" role="toolbar" aria-label="Formatting">
      <span class="md-tabs" role="tablist"><button type="button" role="tab" class="md-tab" data-tab="write" aria-selected="true">Write</button><button type="button" role="tab" class="md-tab" data-tab="preview" aria-selected="false">Preview</button></span>
      <span class="md-tools">${TOOLS.map((t, i) => html`<button type="button" class="md-tool" data-i="${String(i)}" title="${t.title}" aria-label="${t.title}">${t.label}</button>`)}</span></div>
    <div class="md-body"></div><div class="md-preview prose" hidden></div><ul class="md-suggest" role="listbox" hidden></ul>
    <p class="muted small md-help">Markdown: **bold**, *italic*, ## heading, - list, ==highlight==, [[ for a link to an entry.</p>`);
  wrapper.querySelector('.md-body')!.append(area);
  const view = wrapper.querySelector<HTMLElement>('.md-preview')!;
  const list = wrapper.querySelector<HTMLUListElement>('.md-suggest')!;

  const edit = (before: string, middle: string, after: string, select: [number, number]) => {
    area.focus();
    // execCommand keeps the browser's undo (Ctrl+Z); setRangeText where it is gone
    if (!document.execCommand?.('insertText', false, before + middle + after)) area.setRangeText(before + middle + after, area.selectionStart, area.selectionEnd, 'end');
    const start = area.selectionEnd - (before + middle + after).length;
    area.setSelectionRange(start + select[0], start + select[1]);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const apply = (a: Wrap) => {
    const { selectionStart: s, selectionEnd: e, value } = area;
    const chosen = value.slice(s, e);
    if ('wrap' in a) {
      const mid = chosen || a.placeholder;
      edit(a.wrap[0], mid, a.wrap[1], [a.wrap[0].length, a.wrap[0].length + mid.length]);
    } else if ('line' in a) {
      const from = value.lastIndexOf('\n', s - 1) + 1;
      area.setSelectionRange(from, e);
      const lines = value.slice(from, e).split('\n');
      const done = lines.map((l, i) => (a.line === '1. ' ? `${String(i + 1)}. ` : a.line) + l.replace(/^(#{1,6} |[-*] |\d+\. |> )/, '')).join('\n');
      edit('', done, '', [done.length, done.length]);
    } else {
      const caret = a.insert.length + (a.caret ?? 0);
      edit(a.insert, '', '', [caret, caret]);
    }
  };
  wrapper.querySelector('.md-tools')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.md-tool');
    if (b) apply(TOOLS[Number(b.dataset.i)].action);
  });
  area.addEventListener('keydown', (e) => {
    if (!list.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return suggestKey(e);
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
    if (tool) { e.preventDefault(); apply(tool.action); }
  });

  // Write | Preview
  wrapper.querySelector('.md-tabs')!.addEventListener('click', (e) => {
    const tab = (e.target as Element).closest<HTMLButtonElement>('.md-tab');
    if (!tab) return;
    const showPreview = tab.dataset.tab === 'preview';
    wrapper.querySelectorAll<HTMLButtonElement>('.md-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    wrapper.querySelector<HTMLElement>('.md-body')!.hidden = showPreview;
    wrapper.querySelector<HTMLElement>('.md-tools')!.hidden = showPreview;
    view.hidden = !showPreview;
    if (!showPreview) { area.focus(); return; }
    render(view, html`<p class="muted small">…</p>`);
    preview(area.value).then((h) => render(view, h ? trusted(h) : html`<p class="muted small">Nothing written yet.</p>`))
      .catch(() => render(view, html`<p class="muted small">The preview could not be made.</p>`));
  });

  // "[[" + letters → entries from the search
  let hits: SearchHit[] = [];
  let active = 0;
  let timer = 0;
  let asked = '';
  const typed = () => /\[\[([^\]|\n/]{2,60})$/.exec(area.value.slice(0, area.selectionStart))?.[1] ?? null;
  const close = () => { list.hidden = true; hits = []; };
  const choose = (h: SearchHit) => {
    const q = typed();
    if (q === null) return close();
    area.setSelectionRange(area.selectionStart - q.length - 2, area.selectionStart);
    const link = `[[${h.type}/${h.slug}]]`;
    edit(link, '', '', [link.length, link.length]);
    close();
  };
  const draw = () => {
    render(list, html`${hits.map((h, i) => html`<li role="option" class="md-hit${i === active ? ' md-hit-on' : ''}" aria-selected="${String(i === active)}" data-i="${String(i)}">
      ${h.name} <span class="muted small">${h.type}${h.subtitle ? ` · ${h.subtitle}` : ''}</span></li>`)}`);
    list.hidden = !hits.length;
  };
  function suggestKey(e: KeyboardEvent) {
    e.preventDefault();
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowDown') active = (active + 1) % hits.length;
    else if (e.key === 'ArrowUp') active = (active + hits.length - 1) % hits.length;
    else return choose(hits[active]);
    draw();
  }
  list.addEventListener('mousedown', (e) => {
    const li = (e.target as Element).closest<HTMLElement>('.md-hit');
    if (li) { e.preventDefault(); choose(hits[Number(li.dataset.i)]); }
  });
  area.addEventListener('blur', () => setTimeout(close, 150));
  area.addEventListener('input', () => {
    const q = typed();
    clearTimeout(timer);
    if (q === null) return close();
    timer = window.setTimeout(() => {
      asked = q;
      search(q).then((found) => {
        if (asked !== q || typed() !== q) return;
        hits = found.slice(0, 8);
        active = 0;
        draw();
      }).catch(close);
    }, 200);
  });
  return wrapper;
}
