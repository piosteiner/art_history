// Glossary links inside the API's texts (*_html): <a href="/glossary/<slug>" class="glossary-link" data-term="<slug>">.
// A real term gets a popover with its name, category and short definition (from the detail's `glossary` map, so no
// further request): on hover or keyboard focus; on touch the first tap opens it and the link inside navigates.
// A term that doesn't exist yet (class "missing") becomes plain, slightly dimmed text instead of a dead link.
// Links to other entries (<a href="/artists/<slug>" class="entry-link" data-entry="artist/<slug>">) are ordinary
// links the router follows; a missing entry becomes dimmed text the same way.
import { html } from './html';
import { ROUTE_EVENT } from './router';
import type { GlossaryHint } from './types';

let popover: HTMLElement | null = null;
let current: HTMLAnchorElement | null = null;
let hideTimer: number | undefined;

function hide() {
  clearTimeout(hideTimer);
  popover?.remove();
  popover = null;
  current?.removeAttribute('aria-describedby');
  current = null;
}

const hideSoon = () => {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hide, 180); // time to move the pointer into the popover
};

function show(a: HTMLAnchorElement, hint: GlossaryHint) {
  if (current === a && popover) return;
  hide();
  current = a;
  popover = document.createElement('div');
  popover.className = 'glossary-popover';
  popover.id = 'glossary-popover';
  popover.setAttribute('role', 'tooltip');
  popover.innerHTML = html`<div class="glossary-popover-head"><strong>${hint.name}</strong> <span class="tag">${hint.category}</span></div>
    ${hint.definition ? html`<p>${hint.definition}</p>` : ''}
    <a href="${a.getAttribute('href')!}">Read more in the glossary →</a>`.value;
  popover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  popover.addEventListener('mouseleave', hideSoon);
  document.body.append(popover);
  a.setAttribute('aria-describedby', 'glossary-popover');
  // below the link, kept on screen
  const r = a.getBoundingClientRect();
  const w = popover.offsetWidth;
  const left = Math.min(Math.max(8, r.left + window.scrollX), window.scrollX + document.documentElement.clientWidth - w - 8);
  popover.style.left = `${left}px`;
  popover.style.top = `${r.bottom + window.scrollY + 6}px`;
}

/** Turns the links inside `root`'s texts into popovers (glossary terms) or plain text (missing terms and entries). */
export function wireTextLinks(root: Element, terms: Record<string, GlossaryHint> | undefined) {
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
      show(a, hint);
    });
    a.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hideSoon());
    a.addEventListener('focus', () => show(a, hint));
    a.addEventListener('blur', hideSoon);
    a.addEventListener('click', (e) => {
      // touch: the first tap shows the definition; the "Read more" link in the popover navigates
      if (touch && !openAtTouch) {
        e.preventDefault();
        show(a, hint);
      }
      touch = false;
    });
  });
}

document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
document.addEventListener('click', (e) => {
  if (popover && !popover.contains(e.target as Node) && e.target !== current) hide();
});
window.addEventListener('scroll', () => popover && hideSoon(), { passive: true });
window.addEventListener(ROUTE_EVENT, hide);
