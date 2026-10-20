// A text page written in the CMS (API 114): the project documentation at /dokumentation. The HTML comes sanitized from
// the API (src/pages.js there: Obsidian's Markdown — images, ==highlights==, task lists, tables); this view adds the
// title, the date of the last change, a table of contents of the main headings and the language (de-CH: Swiss German
// spelling, so browsers hyphenate and read it aloud as German).
import { ApiError, getPage } from '../api';
import { html, render, trusted } from '../html';
import { guard, showError } from './common';

const DATE = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });

export function page(main: HTMLElement, slug: string) {
  render(main, html`<article class="page prose-page doc-page"><p class="muted small">Loading…</p></article>`);
  const box = main.querySelector<HTMLElement>('article')!;
  const current = guard();
  getPage(slug)
    .then((p) => {
      if (!current()) return;
      document.title = `${p.title} · Art History`;
      box.lang = p.lang;
      // the contents: the two upper levels of the text's headings (the text's own top level may be h1 or h2)
      const top = Math.min(...p.toc.map((t) => t.level), 9);
      const toc = p.toc.filter((t) => t.level <= top + 1);
      render(box, html`<h1>${p.title}</h1>
        <p class="muted small">Stand ${DATE.format(new Date(p.updated_at))}</p>
        ${toc.length > 2 ? html`<details class="doc-toc" open><summary>Inhalt</summary><ol>${toc.map((t) => html`<li class="doc-toc-${String(t.level - top)}"><a href="#${t.id}">${t.text}</a></li>`)}</ol></details>` : ''}
        <div class="doc-body">${trusted(p.html)}</div>`);
      // opened at a heading (/dokumentation#provenienz): go there once the text is in
      if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    })
    .catch((err) => {
      if (!current()) return;
      if (err instanceof ApiError && err.status === 404) render(box, html`<h1>Projekt Dokumentation</h1><p class="muted">Diese Seite ist noch nicht veröffentlicht.</p>`);
      else showError(box, err);
    });
}
