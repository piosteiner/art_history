// Links inside the API's texts (*_html), with popovers that need no further request:
// - glossary terms <a class="glossary-link" data-term> → name, category, definition (the detail's `glossary` map);
// - short references <a class="source-link" data-source> → the full citation (the detail's `bibliography` map);
// - footnote numbers <sup class="fn-ref"><a href="#…"> → the footnote's text (from the same page);
// - other entries <a class="entry-link" data-entry="type/slug"> → name, subtitle, the text's opening and the main image,
//   like Wikipedia's page previews (the detail's `entries` map).
// Popovers open on hover or keyboard focus; on touch the first tap opens one, the second follows the link.
// A term or entry that doesn't exist yet (class "missing") becomes plain, slightly dimmed text instead of a dead link;
// a click on a link to another entry (a.entry-link) is an ordinary link the router follows.
import { html, thumb, trusted, TYPE_LABEL, type Html } from './html';
import { ROUTE_EVENT } from './router';
import type { EntryHint, GlossaryHint, SourceHint } from './types';

let popover: HTMLElement | null = null;
let current: HTMLAnchorElement | null = null;
let hideTimer: number | undefined;

// Focus opens a popover only when it comes from the keyboard (Tab …): a map popup moves focus to its first link when a
// click opens it, and that mustn't open a preview on top. Keyboard focus always follows a key press.
let lastKey = 0;
document.addEventListener('keydown', () => (lastKey = Date.now()), true);
/** The current focus change was made with the keyboard. */
export const byKeyboard = () => Date.now() - lastKey < 1000;

/** The link whose popover is open, if any. */
export const openFor = () => (popover ? current : null);

/** Keeps the popover open while the pointer moves into it (previews.ts opens its own after a delay). */
export const keepOpen = () => clearTimeout(hideTimer);

function hide() {
  clearTimeout(hideTimer);
  popover?.remove();
  popover = null;
  current?.removeAttribute('aria-describedby');
  current = null;
}

export const hideSoon = () => {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hide, 180); // time to move the pointer into the popover
};

export function show(a: HTMLAnchorElement, content: Html, kind: string) {
  if (current === a && popover) return;
  hide();
  current = a;
  popover = document.createElement('div');
  popover.className = `glossary-popover popover-${kind}`;
  popover.id = 'text-popover';
  popover.setAttribute('role', 'tooltip');
  popover.innerHTML = content.value;
  // a preview image that doesn't load: the text alone
  popover.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => {
    img.closest('.popover-image')?.remove();
    popover?.classList.remove('has-image');
  }));
  popover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  popover.addEventListener('mouseleave', hideSoon);
  document.body.append(popover);
  a.setAttribute('aria-describedby', 'text-popover');
  // below the link, kept on screen
  const r = a.getBoundingClientRect();
  const w = popover.offsetWidth;
  const left = Math.min(Math.max(8, r.left + window.scrollX), window.scrollX + document.documentElement.clientWidth - w - 8);
  popover.style.left = `${left}px`;
  popover.style.top = `${r.bottom + window.scrollY + 6}px`;
}

/** Hover / focus / first tap shows `content`; a second tap (touch) or a click (mouse) follows the link. */
function attach(a: HTMLAnchorElement, content: () => Html, kind: string) {
  // A tap also fires (emulated) hover and focus, which open the popover before the click arrives; so whether this
  // tap is the first one is decided when the finger touches down.
  let touch = false;
  let openAtTouch = false;
  a.addEventListener('pointerdown', (e) => {
    touch = e.pointerType !== 'mouse';
    openAtTouch = current === a && !!popover;
  });
  a.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(hideTimer);
    show(a, content(), kind);
  });
  a.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hideSoon());
  a.addEventListener('focus', () => byKeyboard() && show(a, content(), kind));
  a.addEventListener('blur', hideSoon);
  a.addEventListener('click', (e) => {
    if (touch && !openAtTouch) {
      e.preventDefault();
      show(a, content(), kind);
    }
    touch = false;
  });
}

/** A linked entry's preview: the text on the left, the main image on the right (above it on narrow screens). */
export function entryPreview(e: EntryHint, href: string) {
  return html`<div class="popover-text">
      <div class="glossary-popover-head"><strong>${e.name}</strong> <span class="tag">${TYPE_LABEL[e.type]}</span></div>
      ${e.subtitle ? html`<div class="popover-subtitle">${e.subtitle}</div>` : ''}
      ${e.excerpt ? html`<p>${e.excerpt}</p>` : ''}
      <a href="${href}">Open →</a>
    </div>
    ${e.image_url ? html`<div class="popover-image"><img src="${thumb(e.image_url, 330)}" alt="" decoding="async"></div>` : ''}`;
}

/** Wires the links inside `root`'s texts: popovers for terms, entries, sources and footnotes; plain text for missing ones. */
export function wireTextLinks(root: Element, terms: Record<string, GlossaryHint> | undefined, sources?: Record<string, SourceHint>,
  entries?: Record<string, EntryHint>) {
  root.querySelectorAll<HTMLAnchorElement>('a.glossary-link.missing, a.entry-link.missing').forEach((a) => {
    const term = a.classList.contains('glossary-link');
    const span = document.createElement('span');
    span.className = term ? 'glossary-missing' : 'entry-missing';
    span.title = term ? 'Not in the glossary yet' : 'Not on this site yet';
    span.textContent = a.textContent;
    a.replaceWith(span);
  });
  root.querySelectorAll<HTMLAnchorElement>('a.glossary-link').forEach((a) => {
    const hint = terms?.[a.dataset.term ?? ''];
    if (!hint) return; // a plain link to the term page still works
    attach(a, () => html`<div class="glossary-popover-head"><strong>${hint.name}</strong> <span class="tag">${hint.category}</span></div>
      ${hint.definition ? html`<p>${hint.definition}</p>` : ''}
      <a href="${a.getAttribute('href')!}">Read more in the glossary →</a>`, 'term');
  });
  root.querySelectorAll<HTMLAnchorElement>('a.entry-link').forEach((a) => {
    const hint = entries?.[a.dataset.entry ?? ''];
    if (!hint) return;
    attach(a, () => entryPreview(hint, a.getAttribute('href')!), hint.image_url ? 'entry has-image' : 'entry');
  });
  // short references ("Busch 1993", "Ebd."): the full citation (HTML with italic titles, escaped by the API)
  root.querySelectorAll<HTMLAnchorElement>('a.source-link').forEach((a) => {
    const s = sources?.[a.dataset.source ?? ''];
    if (!s) return;
    attach(a, () => html`<div class="glossary-popover-head"><strong>${s.siglum}</strong></div>
      <p class="citation">${trusted(s.citation)}</p>
      <a href="${a.getAttribute('href')!}">In the bibliography →</a>`, 'source');
  });
  // footnote numbers: the footnote's text, so readers needn't jump down and back
  root.querySelectorAll<HTMLAnchorElement>('sup.fn-ref > a[href^="#"]').forEach((a) => {
    const note = root.querySelector(`[id="${CSS.escape(a.getAttribute('href')!.slice(1))}"]`);
    if (!note) return;
    attach(a, () => {
      const copy = note.cloneNode(true) as Element;
      copy.querySelectorAll('a.fn-back').forEach((b) => b.remove());
      // the note was rendered from the API's sanitized HTML on this page, so reusing its markup is safe
      return html`<div class="glossary-popover-head"><strong>Note ${a.textContent ?? ''}</strong></div><p>${trusted(copy.innerHTML)}</p>`;
    }, 'note');
  });
}

document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
document.addEventListener('click', (e) => {
  if (popover && !popover.contains(e.target as Node) && e.target !== current) hide();
});
window.addEventListener('scroll', () => popover && hideSoon(), { passive: true });
window.addEventListener(ROUTE_EVENT, hide);
