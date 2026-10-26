// Text pages written in the CMS (API 114). `page`: read chapter by chapter (116) — the project documentation.
// `textPage`: a short page in one piece — the privacy statement at /privacy (CMS page "privacy").
//   /dokumentation               the overview: title, date of the last change, words and characters with spaces, the
//                                introduction, the chapters (words, characters, minutes to read)
//   /dokumentation/<chapter>     one chapter: its text, its own contents beside it (sticky on wide screens), previous / next
// The chapters are the text's top-level headings (the API splits it); the HTML comes sanitized from the API. de-CH:
// Swiss German spelling, so browsers hyphenate and read it aloud as German. An old link to a heading of the whole text
// (/dokumentation#provenienz) opens that chapter.
import { ApiError, getPage, getWholePage, type Page, type PageChapter } from '../api';
import { html, render, trusted } from '../html';
import { navigate } from '../router';
import { guard, showError } from './common';

const DATE = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });
const BASE = '/dokumentation';
const minutes = (words: number) => Math.max(1, Math.round(words / 200));
const count = (n: number) => n.toLocaleString('de-CH');
const chapterHref = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

function overview(box: HTMLElement, p: Page) {
  document.title = `${p.title} · Art History`;
  render(box, html`<h1>${p.title}</h1>
    <p class="muted small">Stand ${DATE.format(new Date(p.updated_at))} · ${count(p.words)} Wörter · ${count(p.chars)} Zeichen mit Leerzeichen · rund ${String(minutes(p.words))} Minuten</p>
    ${p.intro_html ? html`<div class="doc-body">${trusted(p.intro_html)}</div>` : ''}
    ${p.chapters.length ? html`<h2 class="doc-chapters-title">Kapitel</h2>
      <ol class="doc-chapters">${p.chapters.map((c) => html`<li><a href="${chapterHref(c.id)}">${c.title}</a>
        <span class="muted small">${count(c.words)} Wörter · ${count(c.chars)} Zeichen · ${String(minutes(c.words))} min</span></li>`)}</ol>` : ''}`);
}

function chapter(box: HTMLElement, p: Page, c: PageChapter) {
  document.title = `${c.title} · ${p.title} · Art History`;
  // its own contents: the levels below its heading
  const top = c.toc[0]?.level ?? 1;
  const toc = c.toc.filter((t) => t.level > top && t.level <= top + 2);
  const nav = html`<nav class="doc-pager" aria-label="Kapitel">
    ${c.prev ? html`<a href="${chapterHref(c.prev.id)}" rel="prev">← ${c.prev.title}</a>` : html`<span></span>`}
    <a href="${BASE}">Übersicht</a>
    ${c.next ? html`<a href="${chapterHref(c.next.id)}" rel="next">${c.next.title} →</a>` : html`<span></span>`}</nav>`;
  render(box, html`<p class="muted small doc-crumb"><a href="${BASE}">${p.title}</a> · Kapitel ${String(c.index)} von ${String(p.chapters.length)}</p>
    <div class="doc-layout${toc.length ? ' has-toc' : ''}">
      ${toc.length ? html`<nav class="doc-toc" aria-label="In diesem Kapitel"><p class="doc-toc-title">In diesem Kapitel</p><ol>${toc.map((t) => html`<li class="doc-toc-${String(t.level - top)}"><a href="#${t.id}">${t.text}</a></li>`)}</ol></nav>` : ''}
      <div class="doc-body">${trusted(c.html)}${nav}</div>
    </div>`);
}

/** A short page in one piece: its title and whole text (its headings are sections, not chapters). */
export function textPage(main: HTMLElement, slug: string) {
  render(main, html`<article class="page prose-page text-page"><p class="muted small">Loading…</p></article>`);
  const box = main.querySelector<HTMLElement>('article')!;
  const current = guard();
  getWholePage(slug)
    .then((p) => {
      if (!current()) return;
      document.title = `${p.title} · Art History`;
      box.lang = p.lang;
      render(box, html`<h1>${p.title}</h1>${trusted(p.html)}`);
      const hash = decodeURIComponent(location.hash.slice(1));
      if (hash) document.getElementById(hash)?.scrollIntoView();
    })
    .catch((err) => { if (current()) showError(box, err); });
}

export function page(main: HTMLElement, slug: string, chapterId: string | null) {
  render(main, html`<article class="page prose-page doc-page"><p class="muted small">Loading…</p></article>`);
  const box = main.querySelector<HTMLElement>('article')!;
  const current = guard();
  getPage(slug, chapterId)
    .then((p) => {
      if (!current()) return;
      box.lang = p.lang;
      // /dokumentation#provenienz (a heading of the whole text before it was split): that chapter
      const hash = decodeURIComponent(location.hash.slice(1));
      if (!chapterId && hash && p.chapters.some((c) => c.id === hash)) { navigate(chapterHref(hash), { replace: true }); return; }
      if (p.chapter) chapter(box, p, p.chapter); else overview(box, p);
      if (hash) document.getElementById(hash)?.scrollIntoView();
      else if (chapterId) window.scrollTo(0, 0);
    })
    .catch((err) => {
      if (!current()) return;
      if (err instanceof ApiError && err.status === 404) {
        render(box, chapterId
          ? html`<h1>Kapitel nicht gefunden</h1><p><a href="${BASE}">Zur Übersicht der Projekt Dokumentation</a></p>`
          : html`<h1>Projekt Dokumentation</h1><p class="muted">Diese Seite ist noch nicht veröffentlicht.</p>`);
      } else showError(box, err);
    });
}
