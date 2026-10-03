// Tiny HTML templating: interpolated values are escaped unless they are already Html (from html`` or trusted()).
import { PLURAL } from './api';
import type { Country, DateRange, EntityType, Image, Plural, PolityLink } from './types';

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
    <img src="${small}" alt="${img.caption ?? alt}" loading="lazy" decoding="async" data-full="${img.url}"
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

/** Click an image in a figure to see it large (with its credit); click, × or Esc closes it. */
export function wireLightbox(root: Element) {
  root.querySelectorAll<HTMLImageElement>('.figure img[data-full]').forEach((img) => {
    img.addEventListener('click', () => {
      const dialog = document.createElement('dialog');
      dialog.className = 'lightbox';
      const caption = img.closest('figure')?.querySelector('figcaption')?.innerHTML ?? '';
      // the caption was built by figure() above from escaped values, so reusing its markup is safe
      dialog.innerHTML = `<button type="button" class="lightbox-close" aria-label="Close">×</button>
        <figure><img src="${escape(img.dataset.full!)}" alt="${escape(img.alt)}"><figcaption>${caption}</figcaption></figure>`;
      dialog.addEventListener('click', (e) => {
        if (!(e.target as Element).closest('figcaption a')) dialog.close();
      });
      dialog.addEventListener('close', () => dialog.remove());
      document.body.append(dialog);
      dialog.showModal();
    });
  });
}

export const TYPE_LABEL: Record<EntityType, string> = {
  artist: 'Artist', artwork: 'Artwork', place: 'Place',
  movement: 'Movement', institution: 'Institution', patron: 'Patron', polity: 'Polity',
};

export const PLURAL_LABEL: Record<Plural, string> = {
  artists: 'Artists', artworks: 'Artworks', places: 'Places',
  movements: 'Movements', institutions: 'Institutions', patrons: 'Patrons', polities: 'Polities',
};

// ---- countries and polities ----------------------------------------------------------------------

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();
/** "JP" → "Japan" (the browser's English region names). */
export const countryName = (code: string | null | undefined) => (code ? regionNames?.of(code.toUpperCase()) ?? code : null);

/** Today's country as text: the name of its place entry, else the region name for the code. */
export const countryText = (c: Country | null | undefined) => (c ? c.name ?? countryName(c.code) : null);

/** Today's country, linked to its place entry when there is one. */
export const countryLink = (c: Country | null | undefined) =>
  c ? (c.slug ? link('place', c.slug, countryText(c)!) : html`${countryText(c)}`) : null;

/**
 * A polity together with today's country, as the API docs ask: "Soviet Union (today Ukraine)".
 * The "today" part is left out when the polity's name already says it ("Kingdom of the Netherlands").
 */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const todayPart = (p: PolityLink, today: Country | null | undefined) => {
  const now = countryText(today);
  return now && !fold(p.name).includes(fold(now)) ? now : null;
};

export function polityWithToday(p: PolityLink, today: Country | null | undefined, withPeriod = true) {
  const now = todayPart(p, today);
  return html`${link('polity', p.slug, p.name)}${withPeriod && p.period ? html` <span class="muted">${p.period.label}</span>` : ''}${now ? html` <span class="today">(today ${countryLink(today)})</span>` : ''}`;
}

/** Plain-text version for search and sort headings. */
export const polityText = (p: PolityLink, today: Country | null | undefined) => {
  const now = todayPart(p, today);
  return now ? `${p.name} (today ${now})` : p.name;
};
