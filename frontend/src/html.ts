// Tiny HTML templating: interpolated values are escaped unless they are already Html (from html`` or trusted()).
import { PLURAL } from './api';
import type { DateRange, EntityType, Image, Plural } from './types';

export class Html {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

type Value = Html | string | number | null | undefined | false | Value[];

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function str(v: Value): string {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(str).join('');
  if (v instanceof Html) return v.value;
  return escape(String(v));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  let out = strings[0];
  values.forEach((v, i) => (out += str(v) + strings[i + 1]));
  return new Html(out);
}

/** For the API's `*_html` fields, which are sanitized server-side. Never use it for anything else. */
export const trusted = (s: string | null | undefined) => new Html(s ?? '');

export function render(el: Element, content: Html) {
  el.innerHTML = content.value;
}

// ---- shared bits ---------------------------------------------------------------------------------

export const href = (type: EntityType | Plural, slug?: string) => {
  const plural = (type in PLURAL ? PLURAL[type as EntityType] : type) as Plural;
  return slug ? `#/${plural}/${encodeURIComponent(slug)}` : `#/${plural}`;
};

export const link = (type: EntityType | Plural, slug: string, name: string) =>
  html`<a href="${href(type, slug)}">${name}</a>`;

export const dateLabel = (d: DateRange | null | undefined) => d?.label ?? '';

/** Lifespan label from two dates, e.g. "1853–1890"; open ends stay visible ("1760–?"). */
export function spanLabel(from: DateRange | null, to: DateRange | null) {
  if (!from && !to) return '';
  return `${from?.label ?? '?'} – ${to?.label ?? '?'}`;
}

/** Smaller Wikimedia Commons thumbnail: /1280px-… → /500px-…; other URLs stay as they are. */
export const thumb = (url: string, width = 500) =>
  url.includes('/thumb/') ? url.replace(/\/\d+px-/, `/${width}px-`) : url;

/** An image with the credit and licence the image licences require wherever it is shown. */
export function figure(img: Image, alt: string, width = 500) {
  const small = thumb(img.url, width);
  const credit = [img.credit, img.license].filter(Boolean).join(' · ');
  return html`<figure class="figure">
    <img src="${small}" alt="${img.caption ?? alt}" loading="lazy" decoding="async"
      ${small !== img.url ? html`data-fallback="${img.url}"` : ''}>
    <figcaption>
      ${img.caption ? html`<span class="caption">${img.caption}</span>` : ''}
      <span class="credit">${img.source_url ? html`<a href="${img.source_url}" target="_blank" rel="noopener">${credit || 'Source'}</a>` : credit}</span>
    </figcaption>
  </figure>`;
}

/** Thumbnails that don't exist at the requested width fall back to the original URL. */
export function wireImageFallbacks(root: Element) {
  root.querySelectorAll<HTMLImageElement>('img[data-fallback]').forEach((img) => {
    img.addEventListener('error', () => {
      const original = img.dataset.fallback;
      if (original && img.src !== original) img.src = original;
    }, { once: true });
  });
}

export const TYPE_LABEL: Record<EntityType, string> = {
  artist: 'Artist', artwork: 'Artwork', place: 'Place',
  movement: 'Movement', institution: 'Institution', patron: 'Patron',
};

export const PLURAL_LABEL: Record<Plural, string> = {
  artists: 'Artists', artworks: 'Artworks', places: 'Places',
  movements: 'Movements', institutions: 'Institutions', patrons: 'Patrons',
};
