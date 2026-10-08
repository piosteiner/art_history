// Sources for facts (API migrations 049/050): a small marker after a value — one letter per kind of source, the most
// reliable first — and on hover, keyboard focus or tap a popover with the citations in KHIST style: the short form
// (linked to the exact page or the Wikidata item), the accessed date, the full reference from the bibliography.
// Markers: P primary source (archive, letters) · L literature (catalogue raisonné, scholarly) · M museum or collection
// database · D other database · W Wikidata · T a note in words (not verified). A citation whose value has changed since
// (`outdated`) gets no marker and is listed last, muted.
import { byKeyboard, hideSoon, openFor, show } from './glossary';
import { html, trusted, type Html } from './html';
import type { Citation, SourceHint } from './types';

const RANK: Record<string, number> = { primary: 4, scholarly: 3, institution: 2, database: 1 };
const rank = (c: Citation) => (c.outdated ? -1 : RANK[c.reliability ?? ''] ?? 0);

export const MARKER_TITLE: Record<string, string> = {
  P: 'primary source', L: 'literature', M: 'museum or collection', D: 'database', W: 'Wikidata', T: 'a note in words, not verified',
};
function marker(c: Citation): string {
  if (c.kind === 'wikidata') return 'W';
  if (c.kind === 'text') return 'T';
  return ({ primary: 'P', scholarly: 'L', institution: 'M', database: 'D' } as Record<string, string>)[c.reliability ?? ''] ?? 'L';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
};

/** Older responses had plain URLs as provenance sources. */
const asCitation = (c: Citation | string): Citation => (typeof c === 'string'
  ? { kind: 'text', reliability: null, text: c.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''), url: /^https?:\/\//.test(c) ? c : null,
    locator: null, accessed: null, note: null, outdated: false }
  : c);

function item(c: Citation, bibliography: Record<string, SourceHint> | undefined): Html {
  const href = c.url ?? c.wikidata?.url ?? null;
  const full = c.source ? bibliography?.[c.source.slug]?.citation : null;
  const accessed = day(c.accessed);
  return html`<li class="cite-item${c.outdated ? ' outdated' : ''}">
    <span class="cite-kind" title="${MARKER_TITLE[marker(c)]}">${marker(c)}</span>
    <span class="cite-body">${href ? html`<a href="${href}" target="_blank" rel="noopener">${c.text}</a>` : c.text}${c.kind === 'wikidata' || !accessed ? '' : html`, accessed ${accessed}`}${c.outdated ? html` <span class="tag">value changed since</span>` : ''}
      ${full ? html`<span class="cite-full">${trusted(full)} <a href="/bibliography/${c.source!.slug}">In the bibliography →</a></span>`
        : c.source ? html`<span class="cite-full"><a href="/bibliography/${c.source.slug}">${c.source.siglum} in the bibliography →</a></span>` : ''}
      ${c.note ? html`<span class="cite-note">${c.note}</span>` : ''}</span>
  </li>`;
}

// the popover contents of this page's markers, by number (rebuilt with every page)
let contents: Html[] = [];
export const resetCitations = () => { contents = []; };

/** The marker for a value's citations ('' without any that are current); wire it with wireCitations(). */
export function cite(list: (Citation | string)[] | null | undefined, bibliography?: Record<string, SourceHint>): Html | string {
  const all = (list ?? []).map(asCitation).sort((a, b) => rank(b) - rank(a));
  const current = all.filter((c) => !c.outdated);
  if (!current.length) return '';
  const letters = [...new Set(current.map(marker))];
  contents.push(html`<div class="glossary-popover-head"><strong>${all.length === 1 ? 'Source' : 'Sources'}</strong></div>
    <ul class="cite-list">${all.map((c) => item(c, bibliography))}</ul>`);
  const what = letters.map((l) => MARKER_TITLE[l]).join(', ');
  return html`<button type="button" class="cite-ref" data-cite="${String(contents.length - 1)}" aria-label="Sources: ${what}">${letters.map((l) => html`<span class="cite-kind">${l}</span>`)}</button>`;
}

/** Hover, keyboard focus and click/tap open the citations; a second click closes them. */
export function wireCitations(root: Element) {
  root.querySelectorAll<HTMLButtonElement>('button.cite-ref').forEach((b) => {
    const content = contents[Number(b.dataset.cite)];
    if (!content) return;
    b.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && show(b, content, 'cite'));
    b.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hideSoon());
    b.addEventListener('focus', () => byKeyboard() && show(b, content, 'cite'));
    b.addEventListener('blur', hideSoon);
    // touch: a tap opens, the next one closes; a mouse has opened it on hover already
    let touch = false;
    b.addEventListener('pointerdown', (e) => { touch = e.pointerType !== 'mouse'; });
    b.addEventListener('click', () => (touch && openFor() === b ? hideSoon() : show(b, content, 'cite')));
  });
}
