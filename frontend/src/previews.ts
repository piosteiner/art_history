// Previews on every internal link (/artists/…, /places/…, /glossary/… — fields, relationship lists, map popups),
// with the same popover as the [[links]] in texts (glossary.ts). The page's links are collected as views render
// (a MutationObserver on the page area: views and map popups render asynchronously) and their previews fetched in one
// call per 100 (GET /v1/previews); a link hovered before that asks for itself. Links without a preview stay plain.
// Not on: the header, breadcrumbs, previous/next, buttons, list cards and the explore pickers (they show the same
// already, and a popover would cover the next rows), the page itself,
// and links that have their own popover ([[links]], citations, footnotes).
// Mouse: opens after a short pause, so moving across a list doesn't flash popovers. Keyboard: on focus. Touch, on an
// entry's page only: the first tap opens the preview, the second follows the link (lists and maps: one tap navigates).
import { getPreviews, PLURAL } from './api';
import { entryPreview, hideSoon, keepOpen, openFor, show } from './glossary';
import type { EntityType, EntryHint } from './types';

const TYPE_OF = Object.fromEntries(Object.entries(PLURAL).map(([type, plural]) => [plural, type])) as Record<string, EntityType>;
const PATH = new RegExp(`^/(${Object.values(PLURAL).join('|')})/([^/]+)/?$`);
const NOT_HERE = 'header, footer, .crumbs, .part-nav, .button-link, .card-link, .pick-panel, .glossary-popover, .hover-tip, sup.fn-ref';
const OWN_POPOVER = '.glossary-link, .entry-link, .source-link, .fn-back';
const OPEN_DELAY = 250;
const BATCH = 100;

const known = new Map<string, EntryHint | null>(); // null: no such entry (no preview)
const pending = new Map<string, Promise<void>>();

/** Previews the page already has (a detail's `entries`), so they aren't asked for again. */
export function knownPreviews(entries: Record<string, EntryHint> | undefined) {
  for (const [ref, hint] of Object.entries(entries ?? {})) known.set(ref, hint);
}

/** "artist/paul-gauguin" for a link that should get a preview, else null. */
function refOf(a: Element | null): string | null {
  if (!(a instanceof HTMLAnchorElement) || a.matches(OWN_POPOVER) || a.closest(NOT_HERE) || a.target) return null;
  const raw = a.getAttribute('href');
  if (!raw?.startsWith('/') || raw.startsWith('//')) return null;
  const url = new URL(raw, location.origin);
  const m = PATH.exec(url.pathname);
  if (!m || url.pathname === location.pathname) return null;
  try { return `${TYPE_OF[m[1]]}/${decodeURIComponent(m[2])}`; } catch { return null; }
}

/** Fetches the previews not known yet, 100 refs per request. */
function load(refs: Iterable<string>): Promise<void> {
  const missing = [...new Set(refs)].filter((r) => !known.has(r) && !pending.has(r)).sort();
  const waits = [...new Set(refs)].map((r) => pending.get(r)).filter(Boolean) as Promise<void>[];
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const p = getPreviews(batch)
      .then((data) => { for (const r of batch) known.set(r, data[r] ?? null); })
      .catch(() => {}) // no previews then; the links still work
      .finally(() => batch.forEach((r) => pending.delete(r)));
    batch.forEach((r) => pending.set(r, p));
    waits.push(p);
  }
  return Promise.all(waits).then(() => {});
}

function open(a: HTMLAnchorElement, ref: string) {
  const hint = known.get(ref);
  if (hint) show(a, entryPreview(hint, a.getAttribute('href')!), hint.image_url ? 'entry has-image' : 'entry');
}

// ---- hover, focus, tap ---------------------------------------------------------------------------------------------
let hovered: HTMLAnchorElement | null = null;
let openTimer: number | undefined;
let lastTouch = 0;

document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const a = (e.target as Element).closest('a');
  if (a === hovered) return;
  clearTimeout(openTimer);
  hovered = null;
  const ref = refOf(a);
  if (!ref || !a) return;
  hovered = a;
  if (openFor() === a) { keepOpen(); return; }
  const wait = new Promise((r) => { openTimer = window.setTimeout(r, OPEN_DELAY); });
  Promise.all([wait, load([ref])]).then(() => hovered === a && open(a, ref));
});
document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse' || !hovered) return;
  if (hovered.contains(e.relatedTarget as Node)) return; // still inside the link (its <em>, ruby …)
  if (openFor() === hovered) hideSoon();
  clearTimeout(openTimer);
  hovered = null;
});
document.addEventListener('focusin', (e) => {
  if (Date.now() - lastTouch < 800) return; // a tap focuses too; the click decides
  const a = e.target as HTMLAnchorElement;
  const ref = refOf(a);
  if (ref) load([ref]).then(() => document.activeElement === a && open(a, ref));
});
document.addEventListener('focusout', (e) => { if (openFor() === e.target) hideSoon(); });
document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') lastTouch = Date.now(); }, true);
// capture phase: before the router's click handler, which leaves prevented clicks alone
document.addEventListener('click', (e) => {
  if (Date.now() - lastTouch > 800) return;
  const a = (e.target as Element).closest('a');
  const ref = refOf(a);
  if (!ref || !a || !a.closest('.detail-main') || openFor() === a || !known.get(ref)) return;
  e.preventDefault();
  open(a, ref);
}, true);

// ---- prefetch: the links a view renders ----------------------------------------------------------------------------
let scanTimer: number | undefined;
/** Watches `root` (the page area) and fetches previews for the internal links that appear in it. */
export function watchLinks(root: Element) {
  const scan = () => {
    const refs = [...root.querySelectorAll('a[href]')].map(refOf).filter((r): r is string => !!r);
    if (refs.length) void load(refs);
  };
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 150);
  }).observe(root, { childList: true, subtree: true });
}
