// Feedback (API 141): an "F" fixed at the bottom right that widens to "Feedback" on hover or focus. Its panel takes a
// kind (bug, idea, content, other), a message, optionally elements of the page — "Pick on the page": hovered ones are
// outlined, a click adds one (Esc or "Done" ends) — and optionally an address for an answer. Each element is sent
// described in words (what it is, the heading it is under, its text) and with a CSS selector, so that the CMS can open
// the page with the elements outlined: #fb=<JSON list of selectors> (highlightFeedback below).
import { ApiError, sendFeedback, type FeedbackElement, type FeedbackInput } from './api';
import { html, render } from './html';
import { ROUTE_EVENT } from './router';

const KINDS: [FeedbackInput['kind'], string][] = [['bug', 'Bug'], ['idea', 'Idea'], ['content', 'Content'], ['other', 'Other']];
const MAX_ELEMENTS = 20;

/** What an element is, in words. */
function label(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.closest('.maplibregl-map, .map')) return 'map';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  return ({ img: 'image', figure: 'image', a: 'link', button: 'button', li: 'list item', p: 'paragraph', table: 'table', tr: 'table row',
    td: 'table cell', th: 'table cell', svg: 'graphic', section: 'section', nav: 'navigation', input: 'field', select: 'field',
    blockquote: 'quotation', dl: 'details', dd: 'detail', dt: 'detail', ul: 'list', ol: 'list', details: 'section' } as Record<string, string>)[tag]
    ?? (el.classList.contains('card') ? 'card' : 'part of the page');
}

/** The heading it stands under: the closest heading before it in the page. */
function headingOf(el: Element): string {
  const own = /^H[1-6]$/.test(el.tagName) ? el : null;
  if (own) return '';
  const all = [...document.querySelectorAll('#app h1, #app h2, #app h3, #app h4')];
  let found = '';
  for (const h of all) {
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) found = (h.textContent ?? '').trim();
    else break;
  }
  return found.slice(0, 200);
}

/** A selector that finds the element again: from the closest ancestor with an id, tag:nth-of-type steps down. */
export function selectorOf(el: Element): string {
  const steps: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && steps.length < 14) {
    if (cur.id && document.querySelectorAll(`#${CSS.escape(cur.id)}`).length === 1) { steps.unshift(`#${CSS.escape(cur.id)}`); break; }
    const tag = cur.tagName.toLowerCase();
    const same = cur.parentElement ? [...cur.parentElement.children].filter((c) => c.tagName === cur!.tagName) : [];
    steps.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
    cur = cur.parentElement;
  }
  return steps.join(' > ');
}

/** The element worth naming under the pointer: text-less bits (an icon, a span in a link) count as their container. */
function pickable(target: Element): Element | null {
  if (target.closest('.fb-root')) return null;
  const map = target.closest('.maplibregl-map');
  if (map) return map;
  let el: Element | null = target;
  while (el && el !== document.body && !(el as HTMLElement).innerText?.trim() && el.tagName !== 'IMG' && el.tagName !== 'svg') el = el.parentElement;
  if (el && ['SPAN', 'B', 'I', 'EM', 'STRONG', 'MARK', 'SMALL', 'CODE'].includes(el.tagName)) el = el.parentElement;
  return el && el !== document.body && el.id !== 'app' ? el : null;
}

function describe(el: Element): FeedbackElement {
  const text = el.tagName === 'IMG' ? (el as HTMLImageElement).alt : (el as HTMLElement).innerText ?? el.textContent ?? '';
  return { label: label(el), heading: headingOf(el), text: text.replace(/\s+/g, ' ').trim().slice(0, 150), selector: selectorOf(el) };
}

export function mountFeedback() {
  const root = document.createElement('div');
  root.className = 'fb-root';
  document.body.append(root);
  let open = false;
  let picking = false;
  let kind: FeedbackInput['kind'] = 'other';
  let chosen: { el: Element; d: FeedbackElement }[] = [];
  let status = '';
  let sending = false;
  let message = '';     // kept here, not only in the field: the panel isn't drawn while picking
  let email = '';
  const box = document.createElement('div');                 // the outline that follows the pointer while picking
  box.className = 'fb-hover';
  box.hidden = true;
  document.body.append(box);

  const draw = () => {
    render(root, html`${picking ? html`<div class="fb-pickbar" role="status">
        <span>Click the parts of the page your feedback is about · <b>${String(chosen.length)}</b> chosen</span>
        <button type="button" class="fb-done">Done</button></div>`
      : open ? html`<section class="fb-panel" role="dialog" aria-labelledby="fb-title">
        <header><h2 id="fb-title">Feedback</h2><button type="button" class="fb-close" aria-label="Close">×</button></header>
        <p class="muted small">What could be better? Bugs, ideas, content — all of it helps.</p>
        <div class="fb-kinds" role="radiogroup" aria-label="Kind">${KINDS.map(([k, l]) => html`<button type="button" role="radio" aria-checked="${String(kind === k)}" class="chip${kind === k ? ' active' : ''}" data-kind="${k}">${l}</button>`)}</div>
        <label class="fb-label" for="fb-message">Your feedback</label>
        <textarea id="fb-message" rows="5" maxlength="5000" placeholder="What did you notice, what would you change?"></textarea>
        <div class="fb-elements">
          <button type="button" class="fb-pick">${chosen.length ? '+ Pick more on the page' : 'About something specific? Pick it on the page'}</button>
          ${chosen.length ? html`<ul>${chosen.map((c, i) => html`<li><span><b>${c.d.label}</b>${c.d.heading ? html` <span class="muted">in “${c.d.heading}”</span>` : ''}${c.d.text ? html` — ${c.d.text.slice(0, 70)}${c.d.text.length > 70 ? '…' : ''}` : ''}</span>
            <button type="button" class="fb-remove" data-i="${String(i)}" aria-label="Remove">×</button></li>`)}</ul>` : ''}
        </div>
        <label class="fb-label" for="fb-email">Your email <span class="muted">(optional — only if you'd like an answer)</span></label>
        <input id="fb-email" type="email" maxlength="200" autocomplete="email">
        <input class="fb-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="fb-send"><button type="button" class="fb-submit"${sending ? ' disabled' : ''}>${sending ? 'Sending…' : 'Send'}</button>
          <span class="small muted" role="status">${status}</span></div>
        <p class="muted small">Sent with the page you are on. <a href="/privacy">Privacy</a></p>
      </section>`
      : ''}
      <button type="button" class="fb-fab" aria-label="Feedback" aria-expanded="${String(open)}"${picking ? ' hidden' : ''}><span class="fb-f">F</span><span class="fb-rest">eedback</span></button>`);
    const ta = root.querySelector<HTMLTextAreaElement>('#fb-message');
    if (ta) ta.value = message;
    const em = root.querySelector<HTMLInputElement>('#fb-email');
    if (em) em.value = email;
  };

  // picking: the outline follows the pointer; a click adds (or removes) the element — the page's own click is held back
  const onMove = (e: PointerEvent) => {
    const el = pickable(e.target as Element);
    if (!el) { box.hidden = true; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    box.hidden = false;
  };
  const onClick = (e: MouseEvent) => {
    const el = pickable(e.target as Element);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const at = chosen.findIndex((c) => c.el === el);
    if (at >= 0) { chosen[at].el.classList.remove('fb-chosen'); chosen.splice(at, 1); }
    else if (chosen.length < MAX_ELEMENTS) { el.classList.add('fb-chosen'); chosen.push({ el, d: describe(el) }); }
    draw();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stopPicking(); };
  function startPicking() {
    picking = true;
    document.body.classList.add('fb-picking');
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    draw();
  }
  function stopPicking() {
    picking = false;
    box.hidden = true;
    document.body.classList.remove('fb-picking');
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    draw();
    root.querySelector<HTMLElement>('.fb-pick')?.focus();
  }
  const clearChosen = () => { chosen.forEach((c) => c.el.classList.remove('fb-chosen')); chosen = []; };

  async function submit() {
    message = message.trim();
    if (!message) { status = 'Please write a few words first.'; draw(); root.querySelector<HTMLElement>('#fb-message')?.focus(); return; }
    sending = true; status = ''; draw();
    try {
      await sendFeedback({ kind, message, page_url: location.pathname + location.search + (location.hash.startsWith('#fb=') ? '' : location.hash),
        page_title: document.title, elements: chosen.map((c) => c.d), email: email.trim(),
        viewport: `${window.innerWidth}x${window.innerHeight}`, website: root.querySelector<HTMLInputElement>('.fb-hp')!.value });
      sending = false;
      clearChosen();
      kind = 'other';
      message = '';
      email = '';
      render(root.querySelector('.fb-panel')!, html`<header><h2 id="fb-title">Thank you!</h2><button type="button" class="fb-close" aria-label="Close">×</button></header>
        <p>Your feedback has arrived. It helps to make the site better.</p>`);
      root.querySelector<HTMLTextAreaElement>('#fb-message')?.remove();
    } catch (err) {
      sending = false;
      status = err instanceof ApiError && err.status === 429 ? 'Too much at once — please try again in a few minutes.'
        : err instanceof ApiError && err.status === 400 ? err.message : 'It could not be sent — please try again later.';
      draw();
    }
  }

  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('.fb-fab')) { open = !open; status = ''; draw(); if (open) root.querySelector<HTMLElement>('#fb-message')?.focus(); return; }
    if (t.closest('.fb-close')) { open = false; draw(); root.querySelector<HTMLElement>('.fb-fab')?.focus(); return; }
    const k = t.closest<HTMLElement>('[data-kind]');
    if (k) { kind = k.dataset.kind as FeedbackInput['kind']; draw(); return; }
    if (t.closest('.fb-pick')) { startPicking(); return; }
    if (t.closest('.fb-done')) { stopPicking(); return; }
    const rm = t.closest<HTMLElement>('.fb-remove');
    if (rm) { const [c] = chosen.splice(Number(rm.dataset.i), 1); c?.el.classList.remove('fb-chosen'); draw(); return; }
    if (t.closest('.fb-submit')) void submit();
  });
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'fb-message') message = t.value;
    if (t.id === 'fb-email') email = t.value;
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !picking) { open = false; draw(); } });
  // another page: the elements picked belong to the last one; the message stays
  window.addEventListener(ROUTE_EVENT, () => { if (picking) stopPicking(); clearChosen(); if (open) draw(); highlightFeedback(); });
  window.addEventListener('hashchange', highlightFeedback);   // only the anchor changed: #fb=… on the same page
  draw();
  highlightFeedback();
}

/** #fb=<JSON list of selectors> (the CMS's "Open on the site"): those elements outlined once the view has drawn them
 *  (it may still be loading — tried for 8 s), the first scrolled into view. */
export function highlightFeedback() {
  document.querySelectorAll('.fb-target').forEach((el) => el.classList.remove('fb-target'));
  if (!location.hash.startsWith('#fb=')) return;
  let selectors: string[] = [];
  try { selectors = JSON.parse(decodeURIComponent(location.hash.slice(4))); } catch { return; }
  if (!Array.isArray(selectors)) return;
  const started = Date.now();
  const tryNow = () => {
    const found = selectors.map((s) => { try { return document.querySelector(s); } catch { return null; } });
    if (found.some((f) => !f) && Date.now() - started < 8000) { setTimeout(tryNow, 300); return; }
    found.forEach((el) => el?.classList.add('fb-target'));
    found.find(Boolean)?.scrollIntoView({ block: 'center' });
  };
  tryNow();
}
