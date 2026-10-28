// Text pages written in the CMS (API 114). `page`: read chapter by chapter (116) — the project documentation.
// `textPage`: a short page in one piece — the privacy statement at /privacy (CMS page "privacy").
//   /dokumentation               the overview: title, date of the last change, words and characters with spaces, the
//                                introduction, the chapters (words, characters, minutes to read)
//   /dokumentation/<chapter>     one chapter: its text, its own contents beside it (sticky on wide screens), previous / next
//   /dokumentation?q=…           the overview with the hits of a search instead of the chapter list (API …/search);
//                                a hit opens its chapter at the heading above it, the words marked (?hl=)
// The chapters are the text's top-level headings (the API splits it); the HTML comes sanitized from the API. de-CH:
// Swiss German spelling, so browsers hyphenate and read it aloud as German. An old link to a heading of the whole text
// (/dokumentation#provenienz) opens that chapter.
import { ApiError, getPage, getWholePage, searchPage, type Page, type PageChapter, type PageSearch } from '../api';
import { keepInView, markedWords, markWords, wordsToMark } from '../highlight';
import { html, linksInNewTab, render, trusted } from '../html';
import { navigate, replaceUrl } from '../router';
import { guard, showError } from './common';

const DATE = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });
const BASE = '/dokumentation';
const minutes = (words: number) => Math.max(1, Math.round(words / 200));
const count = (n: number) => n.toLocaleString('de-CH');
const chapterHref = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

// The search field of the documentation (overview and chapters): Enter or a pause in typing shows the hits on the
// overview (/dokumentation?q=…); a hit opens its chapter at the heading above it, the words marked (?hl=, highlight.ts).
const searchForm = (q = '') => html`<form class="doc-search" role="search" action="${BASE}">
  <input type="search" name="q" value="${q}" placeholder="In der Dokumentation suchen…" aria-label="In der Dokumentation suchen" autocomplete="off">
  <button type="submit">Suchen</button></form>`;

function wireSearch(box: HTMLElement, onResults: ((q: string) => void) | null) {
  const form = box.querySelector<HTMLFormElement>('.doc-search');
  if (!form) return;
  const input = form.querySelector('input')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (onResults) onResults(q); else if (q) navigate(`${BASE}?${new URLSearchParams({ q })}`);
  });
  if (!onResults) return;
  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(() => onResults(input.value.trim()), 300); });
}

function hitHref(r: PageSearch['hits'][number]) {
  const words = markedWords(r.passage_html);
  const query = words.length ? `?${new URLSearchParams({ hl: words.join(' ') })}` : '';
  return `${r.chapter ? chapterHref(r.chapter.id) : BASE}${query}${r.heading ? `#${encodeURIComponent(r.heading.id)}` : ''}`;
}

function results(list: HTMLElement, s: PageSearch) {
  if (!s.terms.length) { render(list, html``); return; }
  if (!s.hits.length) { render(list, html`<p class="muted">Nichts gefunden für „${s.q}“.</p>`); return; }
  // grouped by chapter, in the order of the text
  const groups: { chapter: PageSearch['hits'][number]['chapter']; hits: PageSearch['hits'] }[] = [];
  for (const h of s.hits) {
    const last = groups[groups.length - 1];
    if (last && last.chapter?.id === h.chapter?.id) last.hits.push(h); else groups.push({ chapter: h.chapter, hits: [h] });
  }
  render(list, html`<p class="muted small">${count(s.total)} ${s.total === 1 ? 'Treffer' : 'Treffer'}${s.total > s.hits.length ? ` — die ersten ${count(s.hits.length)}` : ''}</p>
    ${groups.map((g) => html`<section class="doc-hits"><h2>${g.chapter ? html`<span class="muted">Kapitel ${String(g.chapter.index)}</span> ${g.chapter.title}` : 'Einleitung'}</h2>
      <ol>${g.hits.map((h) => html`<li><a href="${hitHref(h)}">${h.heading && h.heading.text !== g.chapter?.title ? h.heading.text : (g.chapter?.title ?? 'Einleitung')}</a>
        <p>${trusted(h.passage_html)}</p></li>`)}</ol></section>`)}`);
}

function overview(box: HTMLElement, p: Page, q: string) {
  document.title = `${p.title} · Art History`;
  render(box, html`<h1>${p.title}</h1>
    <p class="muted small">Stand ${DATE.format(new Date(p.updated_at))} · ${count(p.words)} Wörter · ${count(p.chars)} Zeichen mit Leerzeichen · rund ${String(minutes(p.words))} Minuten</p>
    ${searchForm(q)}<div class="doc-results" aria-live="polite"></div><div class="doc-overview">
    ${p.intro_html ? html`<div class="doc-body">${trusted(p.intro_html)}</div>` : ''}
    ${p.chapters.length ? html`<h2 class="doc-chapters-title">Kapitel</h2>
      <ol class="doc-chapters">${p.chapters.map((c) => html`<li><a href="${chapterHref(c.id)}">${c.title}</a>
        <span class="muted small">${count(c.words)} Wörter · ${count(c.chars)} Zeichen · ${String(minutes(c.words))} min</span></li>`)}</ol>` : ''}</div>`);
  const list = box.querySelector<HTMLElement>('.doc-results')!;
  const rest = box.querySelector<HTMLElement>('.doc-overview')!;
  let asked = 0;
  const show = (query: string) => {
    replaceUrl(query ? `${BASE}?${new URLSearchParams({ q: query })}` : BASE);
    rest.hidden = !!query;
    if (!query) { render(list, html``); return; }
    const mine = ++asked;
    searchPage(p.slug, query).then((s) => { if (mine === asked) results(list, s); })
      .catch((err) => { if (mine === asked) showError(list, err); });
  };
  wireSearch(box, show);
  if (q) show(q);
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
    ${searchForm()}
    <div class="doc-layout${toc.length ? ' has-toc' : ''}">
      ${toc.length ? html`<nav class="doc-toc" aria-label="In diesem Kapitel"><p class="doc-toc-title">In diesem Kapitel</p><ol>${toc.map((t) => html`<li class="doc-toc-${String(t.level - top)}"><a href="#${t.id}">${t.text}</a></li>`)}</ol></nav>` : ''}
      <div class="doc-body">${trusted(c.html)}${nav}</div>
    </div>`);
  wireSearch(box, null);
}

/** A short page in one piece: its title and whole text (its headings are sections, not chapters). */
export function textPage(main: HTMLElement, slug: string) {
  render(main, html`<article class="page prose-page text-page"><p class="muted small">Loading…</p></article>`);
  const box = main.querySelector<HTMLElement>('article')!;
  linksInNewTab(box, 'article', (href) => href.startsWith('#'));
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
  // links in the text: a new tab — except to the documentation's own headings and chapters
  linksInNewTab(box, '.doc-body', (href) => href.startsWith(BASE));
  const current = guard();
  getPage(slug, chapterId)
    .then((p) => {
      if (!current()) return;
      box.lang = p.lang;
      // /dokumentation#provenienz (a heading of the whole text before it was split): that chapter
      const hash = decodeURIComponent(location.hash.slice(1));
      if (!chapterId && hash && p.chapters.some((c) => c.id === hash)) { navigate(chapterHref(hash), { replace: true }); return; }
      if (p.chapter) chapter(box, p, p.chapter); else overview(box, p, new URLSearchParams(location.search).get('q') ?? '');
      // from a search hit: the words marked, the first one after the heading in view
      const marks = p.chapter ? markWords(box.querySelector('.doc-body')!, wordsToMark()) : [];
      const anchor = hash ? document.getElementById(hash) : null;
      const first = anchor ? marks.find((m) => anchor.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) : marks[0];
      if (first) keepInView(first, box);
      else if (anchor) anchor.scrollIntoView();
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
