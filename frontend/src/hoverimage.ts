// Hovering a list's small image shows the whole picture, larger (roadmap 2026-10-24: "Hover over für vollständiges und
// grösseres Bild in der Liste der (Such-) Ergebnisse"): the cards crop their image to a square; the preview shows it
// uncropped beside the pointer. Mouse only — on a touch screen the tap opens the entry.
import { thumb } from './html';

const SELECTOR = 'img.card-img[data-full], .parts-grid img[data-full]';
const DELAY = 250;

export function mountHoverImages() {
  const box = document.createElement('div');
  box.className = 'hover-image';
  box.setAttribute('aria-hidden', 'true');
  box.hidden = true;
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  box.append(img);
  document.body.append(box);
  let timer = 0;
  let current: HTMLImageElement | null = null;

  const place = (anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    const w = box.offsetWidth; const h = box.offsetHeight; const gap = 12;
    // right of the small image, else left of it; vertically centred on it, kept on screen
    const left = r.right + gap + w <= innerWidth ? r.right + gap : Math.max(gap, r.left - gap - w);
    const top = Math.min(Math.max(gap, r.top + r.height / 2 - h / 2), innerHeight - h - gap);
    box.style.left = `${left}px`;
    box.style.top = `${Math.max(gap, top)}px`;
  };
  const hide = () => { clearTimeout(timer); current = null; box.hidden = true; };
  const show = (small: HTMLImageElement) => {
    const full = small.dataset.full!;
    current = small;
    img.onload = () => { if (current === small) { box.hidden = false; place(small); } };
    img.onerror = () => { if (img.src !== full) img.src = full; else hide(); };
    img.src = thumb(full, 500);
    if (img.complete && img.naturalWidth) img.onload(new Event('load'));
  };

  document.addEventListener('pointerover', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const small = (ev.target as Element).closest<HTMLImageElement>(SELECTOR);
    if (!small || small === current) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => show(small), DELAY);
  });
  document.addEventListener('pointerout', (ev) => {
    const small = (ev.target as Element).closest(SELECTOR);
    if (small && !small.contains(ev.relatedTarget as Node | null)) hide();
  });
  addEventListener('scroll', hide, { passive: true });
  addEventListener('popstate', hide);
}
