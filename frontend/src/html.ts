// Tiny HTML templating: interpolated values are escaped unless they are already Html (from html`` or trusted()).
// Images load with crossorigin="anonymous": Wikimedia then neither receives nor sets cookies (the site stays cookie-free).
import { fold } from './fold';
import { zoomable } from './zoom';
import { BASE as API_BASE, PLURAL, publicIdOf } from './api';
import type { Country, CreatorRef, DateRange, EndBasis, EntityType, Image, NameEntry, NameKind, Plural, PolityLink, Ref, TranslationStatus } from './types';

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

/** An entry's address: /<plural>/<number>/<slug> once its public number is known (API 085), else /<plural>/<slug>. */
export const href = (type: EntityType | Plural, slug?: string) => {
  const plural = (type in PLURAL ? PLURAL[type as EntityType] : type) as Plural;
  if (!slug) return `/${plural}`;
  const id = publicIdOf(plural, slug);
  return id ? `/${plural}/${id}/${encodeURIComponent(slug)}` : `/${plural}/${encodeURIComponent(slug)}`;
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
// The widths the API's thumbnail service makes (backend/src/routes/thumbs.js WIDTHS) — Wikimedia's standard ones too.
const THUMB_WIDTHS = [120, 250, 330, 500, 800];
/**
 * An image at about this width: a Wikimedia thumbnail at that width (an original on upload.wikimedia.org as its
 * thumbnail — lists loaded the full file), any other image (a museum's own server) through the API's thumbnail service:
 * a small WebP, and the visitor's browser never contacts that server — some refuse anonymous (CORS) loading anyway.
 */
export const thumb = (url: string, width = 500) => {
  if (url.includes('/thumb/')) return url.replace(/\/\d+px-/, `/${width}px-`);
  const commons = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[a-z]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+\.(?:jpe?g|png|gif|webp))$/i.exec(url);
  if (commons) return `${commons[1]}/thumb/${commons[2]}/${commons[3]}/${width}px-${commons[3]}`;
  if (/^https:\/\/[^/]*wikimedia\.org\//.test(url) || !/^https:\/\//.test(url)) return url;
  const w = THUMB_WIDTHS.find((x) => x >= width) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
  return `${API_BASE}/thumb?${new URLSearchParams({ src: url, w: String(w) })}`;
};

/** An image with the credit and licence the image licences require wherever it is shown. */
export function figure(img: Image, alt: string, width = 500) {
  const small = thumb(img.url, width);
  const credit = [img.credit, img.license].filter(Boolean).join(' · ');
  return html`<figure class="figure">
    <span class="figure-frame"><img src="${small}" alt="${img.caption ?? alt}" loading="lazy" decoding="async" crossorigin="anonymous" data-full="${img.url}"
      ${small !== img.url ? html`data-fallback="${img.url}"` : ''}></span>
    <figcaption>
      ${img.caption ? html`<span class="caption">${img.caption}</span>` : ''}
      <span class="credit">${img.source_url ? html`<a href="${img.source_url}" target="_blank" rel="noopener">${credit || 'Source'}</a>` : credit}</span>
    </figcaption>
  </figure>`;
}

/**
 * An image that fails: a thumbnail that doesn't exist at the requested width falls back to the original URL; an image
 * server that doesn't allow anonymous (CORS) loading — e.g. a museum's own collection server — gets the image once
 * more as a plain request, still without our address as referrer (privacy page: "Images").
 */
export function retryImage(img: HTMLImageElement) {
  img.addEventListener('error', () => {
    const original = img.dataset.fallback;
    if (original && img.src !== original) { img.src = original; return; }
    if (img.hasAttribute('crossorigin')) {
      img.removeAttribute('crossorigin');
      img.referrerPolicy = 'no-referrer';
      const src = img.src;
      img.src = '';
      img.src = src;
    }
  });
}
export function wireImageFallbacks(root: Element) {
  root.querySelectorAll<HTMLImageElement>('img[crossorigin], img[data-fallback]').forEach(retryImage);
}
/**
 * Pictures of unusual shape (roadmap 2026-10-26: Monet's Water Lilies, 17 m wide): an entry's figure says, once its
 * image is loaded, whether it is very wide (more than 2.5 × as wide as high: shown at a readable height, scrolled
 * sideways) or very tall (a hanging scroll: allowed more height). Once for the whole site (main.ts), as below.
 */
export const WIDE = 2.5;
export const TALL = 0.45;
export function watchImageShapes() {
  const shape = (img: HTMLImageElement) => {
    if (img.classList.contains('wide-overview-img')) return;
    const fig = img.closest<HTMLElement>('.figure');
    if (!fig || !img.naturalWidth) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    fig.classList.toggle('wide', ratio > WIDE);
    fig.classList.toggle('tall', ratio < TALL);
    const frame = img.parentElement!;
    fig.classList.toggle('scrolls', frame.scrollWidth > frame.clientWidth + 1);
    if (ratio > WIDE) widen(fig, frame, img, ratio);
  };
  document.addEventListener('load', (ev) => { if (ev.target instanceof HTMLImageElement) shape(ev.target); }, true);
  addEventListener('resize', () => document.querySelectorAll<HTMLImageElement>('.figure.wide .figure-frame > img').forEach(shape));
}

/**
 * A rendition sharp enough for a very wide picture shown `cssHeight` px high (2026-10-30: Monet's Two Willows came as
 * the 500 px thumbnail — 56 px high — stretched to 378). Wikimedia makes only its standard widths (1920 and 3840 work,
 * 2560 or 5000 are refused); other servers' pictures: the original (our /v1/thumb stops at 800).
 */
const COMMONS_WIDTHS = [960, 1280, 1920, 3840];
export function wideSource(url: string, ratio: number, cssHeight: number) {
  const need = Math.ceil(ratio * cssHeight * Math.min(devicePixelRatio || 1, 2));
  const isCommons = /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url);  // both hosts serve the standard widths
  if (!isCommons) return url;
  return thumb(url, COMMONS_WIDTHS.find((w) => w >= need) ?? COMMONS_WIDTHS[COMMONS_WIDTHS.length - 1]);
}

/**
 * A very wide picture: the sharp rendition in the strip, and above it the whole picture as a band with a frame round
 * the part in view — click or drag in the band to move there.
 */
function widen(fig: HTMLElement, frame: HTMLElement, img: HTMLImageElement, ratio: number) {
  if (!img.dataset.wideSrc && img.dataset.full) {
    // for the strip's full height (style.css: clamp(170px, 42vh, 380px)) — on its first load it may not have it yet
    const sharp = wideSource(img.dataset.full, ratio, Math.max(img.clientHeight, 380));
    img.dataset.wideSrc = sharp;
    if (sharp !== img.currentSrc && sharp !== img.src) {
      const small = img.src;
      img.addEventListener('error', () => { img.src = small; }, { once: true });  // the larger one refused: keep the small one
      img.src = sharp;
    }
  }
  let band = fig.querySelector<HTMLElement>('.wide-overview');
  if (!band) {
    band = document.createElement('span');
    band.className = 'wide-overview';
    band.setAttribute('aria-hidden', 'true');
    band.innerHTML = '<span class="wide-window"></span>';
    const mini = document.createElement('img');
    mini.className = 'wide-overview-img';
    mini.alt = '';
    mini.src = thumb(img.dataset.full ?? img.src, 960);
    if (img.hasAttribute('crossorigin')) mini.crossOrigin = 'anonymous';
    mini.addEventListener('error', () => { mini.src = img.src; }, { once: true });
    band.prepend(mini);
    frame.before(band);
    const win = band.querySelector<HTMLElement>('.wide-window')!;
    const sync = () => {
      const w = frame.scrollWidth || 1;
      win.style.left = `${(frame.scrollLeft / w) * 100}%`;
      win.style.width = `${Math.min(100, (frame.clientWidth / w) * 100)}%`;
    };
    const go = (ev: PointerEvent) => {
      const r = band!.getBoundingClientRect();
      frame.scrollLeft = ((ev.clientX - r.left) / r.width) * frame.scrollWidth - frame.clientWidth / 2;
    };
    frame.addEventListener('scroll', sync, { passive: true });
    addEventListener('resize', sync);
    img.addEventListener('load', sync);
    band.addEventListener('pointerdown', (ev) => {
      go(ev);
      band!.setPointerCapture(ev.pointerId);
      const move = (e: PointerEvent) => go(e);
      band!.addEventListener('pointermove', move);
      band!.addEventListener('pointerup', () => band!.removeEventListener('pointermove', move), { once: true });
    });
    sync();
  }
}

/**
 * The same for every image of the site, once (main.ts): an image's "error" doesn't bubble, but it passes the document
 * in the capture phase — lists, parts grids, popovers and whatever comes later are covered without wiring each.
 */
export function wireImageFallbacksEverywhere() {
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.retried) return;
    const original = img.dataset.fallback;
    if (original && img.src !== original) { img.src = original; return; }
    if (img.hasAttribute('crossorigin')) {
      img.dataset.retried = '1';
      img.removeAttribute('crossorigin');
      img.referrerPolicy = 'no-referrer';
      const src = img.src;
      img.src = '';
      img.src = src;
    }
  }, true);
}

/**
 * Several images of an entry: the first large, the others as thumbnails under it — a click (or Enter) shows that one
 * large, with its own credit. All figures are in the page; only the chosen one is visible (the others load when shown).
 */
export function gallery(images: Image[], alt: string) {
  if (images.length < 2) return html`<div class="gallery">${images.map((img) => figure(img, alt))}</div>`;
  return html`<div class="gallery gallery-multi">
    ${images.map((img, i) => html`<div class="gallery-item"${i ? ' hidden' : ''}>${figure(img, alt)}</div>`)}
    <div class="gallery-thumbs" role="group" aria-label="Images">
      ${images.map((img, i) => html`<button type="button" class="gallery-thumb${i ? '' : ' current'}" data-image="${String(i)}"
        aria-label="Image ${String(i + 1)} of ${String(images.length)}"${i ? '' : ' aria-current="true"'}>
        <img src="${thumb(img.url, 120)}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" ${thumb(img.url, 120) !== img.url ? html`data-fallback="${img.url}"` : ''}></button>`)}
    </div></div>`;
}
export function wireGalleries(root: Element) {
  root.querySelectorAll<HTMLElement>('.gallery-multi').forEach((g) => {
    g.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('.gallery-thumb');
      if (!b) return;
      const n = Number(b.dataset.image);
      g.querySelectorAll<HTMLElement>('.gallery-item').forEach((item, i) => { item.hidden = i !== n; });
      g.querySelectorAll<HTMLButtonElement>('.gallery-thumb').forEach((t, i) => {
        t.classList.toggle('current', i === n);
        if (i === n) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
      });
    });
  });
}

/** Click an image in a figure to see it large (with its credit); click, × or Esc closes it. */
export function wireLightbox(root: Element) {
  root.querySelectorAll<HTMLImageElement>('.figure img[data-full]').forEach((img) => {
    img.addEventListener('click', () => {
      const dialog = document.createElement('dialog');
      // a very wide picture (watchImageShapes, owner 2026-10-30): opens whole like any other; zoomed in, it reaches the
      // height it has in the strip (a double click goes there), moves sideways, and zooms on as close as the others —
      // shown first in the strip's sharp rendition, the original once it has loaded
      const ratio = img.naturalWidth / img.naturalHeight;
      const wide = !!img.closest('.figure.wide') && ratio > 0;
      const stripH = Math.min(innerHeight * 0.8, 900);
      const fitH = (innerWidth * 0.96) / ratio;   // style.css: .lightbox-wide img 96vw wide
      const near = wide ? Math.max(2.5, stripH / fitH) : 2.5;
      dialog.className = wide ? 'lightbox lightbox-wide' : 'lightbox';   // a frame the screen's height to grow into
      const caption = img.closest('figure')?.querySelector('figcaption')?.innerHTML ?? '';
      // the caption was built by figure() above from escaped values, so reusing its markup is safe
      dialog.innerHTML = `<button type="button" class="lightbox-close" aria-label="Close">×</button>
        <figure><div class="lightbox-stage"><img src="${escape(wide ? wideSource(img.dataset.full!, ratio, stripH) : img.dataset.full!)}" alt="${escape(img.alt)}"${img.hasAttribute('crossorigin') ? ' crossorigin="anonymous"' : ' referrerpolicy="no-referrer"'} draggable="false"></div>
        <figcaption>${caption}<span class="lightbox-hint">Scroll or pinch to zoom · drag to move${wide ? ' · Shift + scroll: sideways' : ''} · double-click: fit / zoom</span></figcaption></figure>`;
      // the image zooms and pans (zoom.ts); a click beside it closes, as does Escape or ×
      const large = dialog.querySelector('img')!;
      retryImage(large);
      // (not when what we have is itself a Wikimedia thumbnail: the 3840 rendition is sharper than a stored 1280 one)
      if (wide && large.getAttribute('src') !== img.dataset.full && !/\/thumb\//.test(img.dataset.full!)) {
        const original = new Image();
        if (img.hasAttribute('crossorigin')) original.crossOrigin = 'anonymous';
        else original.referrerPolicy = 'no-referrer';
        original.addEventListener('load', () => { if (dialog.open) large.src = original.src; }, { once: true });
        original.src = img.dataset.full!;
      }
      const unzoom = zoomable(dialog.querySelector<HTMLElement>('.lightbox-stage')!, large, { near });
      dialog.addEventListener('click', (e) => {
        if (!(e.target as Element).closest('figcaption a, .lightbox-stage')) dialog.close();
      });
      dialog.addEventListener('close', () => {
        unzoom();
        dialog.remove();
      });
      document.body.append(dialog);
      dialog.showModal();
    });
  });
}

export const TYPE_LABEL: Record<EntityType, string> = {
  artist: 'Artist', artwork: 'Artwork', place: 'Place',
  movement: 'Movement', institution: 'Institution', person: 'Person', polity: 'Polity', event: 'Event', term: 'Term', source: 'Source',
};

export const PLURAL_LABEL: Record<Plural, string> = {
  artists: 'Artists', artworks: 'Artworks', places: 'Places',
  movements: 'Movements', institutions: 'Institutions', people: 'People', polities: 'Polities', events: 'Events', glossary: 'Glossary', bibliography: 'Bibliography',
};

// ---- creators and provenance ---------------------------------------------------------------------

/** All of an artwork's makers, the main creator first (`creator` alone where `creators` isn't sent). */
export const creatorsOf = (a: { creator?: Ref | null; creators?: CreatorRef[] }): CreatorRef[] =>
  a.creators ?? (a.creator ? [{ ...a.creator, main: true, role: null, certainty: null }] : []);

/** "Rubens, Jan Brueghel the Elder" — for cards and subtitles. */
export const creatorNames = (a: { creator?: Ref | null; creators?: CreatorRef[] }) =>
  creatorsOf(a).map((c) => c.name).join(', ');

/** A period whose end is only implied by the next owner's acquisition: say so next to the dates. */
export const impliedEnd = (basis: EndBasis | null | undefined) =>
  basis === 'implied' ? html`<span class="tag tag-implied" title="Not recorded: the end is implied by the next owner's acquisition">end implied</span>` : '';

// ---- people -------------------------------------------------------------------------------------

export const ROLE_LABEL: Record<string, string> = { patron: 'patron', owner: 'owner of artworks', depicted: 'depicted in artworks' };

/** "30 March 1853 – 29 July 1890", else "active 1880–1890" (groups, or lifespan unknown). */
export const personDates = (p: { birth: DateRange | null; death: DateRange | null; active: DateRange | null }) =>
  p.birth || p.death ? spanLabel(p.birth, p.death) : p.active ? `active ${p.active.label}` : '';

/** "poet, diplomat · patron" — occupations and the roles derived from relationships. */
export const personWhat = (p: { kind: string | null; occupations: string[]; roles: string[] }) =>
  [p.occupations.join(', '), p.roles.map((r) => ROLE_LABEL[r] ?? r).join(', '), p.kind && p.kind !== 'person' ? p.kind : '']
    .filter(Boolean).join(' · ');

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

// ---- names in several languages (API: "Names in several languages") ------------------------------

type Nameable = {
  name?: string; title?: string;
  title_status?: TranslationStatus | null;
  name_lang?: string | null; title_lang?: string | null;
  name_ruby_html?: string | null; title_ruby_html?: string | null;
  names?: NameEntry[];
};

/** lang="…" for an element showing a name; nothing when the language is unknown. */
export const langAttr = (lang: string | null | undefined) => (lang ? html` lang="${lang}"` : '');

/** An own translation in [square brackets] (the art-history convention); official and common ones as they are. */
export const translated = (text: string, status: TranslationStatus | null | undefined) => (status === 'own' ? `[${text}]` : text);

/**
 * The official translation to show instead of an artwork's title, when the title is itself a common or own translation
 * and an official one exists in the same language (migration 052). A title in its original language stays.
 */
function officialInstead(e: Nameable): NameEntry | null {
  if (!e.title || !e.title_status || e.title_status === 'official') return null;
  return e.names?.find((n) => n.role === 'translation' && n.status === 'official' && (n.lang ?? null) === (e.title_lang ?? null)) ?? null;
}

/**
 * The display name (title for artworks): text, language and furigana (safe HTML from the API) if any; an official
 * translation preferred to a common or own one, an own one in [brackets]. `status`: the shown title's, if a translation.
 */
export function displayName(e: Nameable) {
  const official = officialInstead(e);
  if (official) return { text: official.text, lang: official.lang, ruby: null, status: 'official' as TranslationStatus, swapped: true };
  const status = e.title ? e.title_status ?? null : null;
  const ruby = e.title_ruby_html ?? e.name_ruby_html ?? null;
  return {
    text: translated((e.title ?? e.name) as string, status),
    lang: e.title_lang ?? e.name_lang ?? null,
    ruby: ruby && status === 'own' ? `[${ruby}]` : ruby,
    status, swapped: false,
  };
}

const STATUS_HINT: Record<TranslationStatus, string> = {
  official: 'official translation (the holding institution or a publisher)', common: 'translation in common use', own: 'own translation',
};

/** A name inside its own element with lang, with furigana when the API sends them. */
export const nameSpan = (text: string, lang: string | null | undefined, ruby?: string | null, cls = '') =>
  html`<span${cls ? html` class="${cls}"` : ''}${langAttr(lang)}>${ruby ? trusted(ruby) : text}</span>`;

/** The original-language name as a second line ("神奈川沖浪裏" with furigana), with its romanization next to it. */
export function originalLine(e: Nameable) {
  const original = e.names?.find((n) => n.role === 'original');
  if (!original) return null;
  const roman = e.names?.find((n) => n.role === 'romanization');
  return html`<p class="original-name">${nameSpan(original.text, original.lang, original.ruby_html)}${roman
    ? html` <span class="romanization"${langAttr(roman.lang?.includes('-') ? roman.lang : roman.lang ? `${roman.lang}-Latn` : null)}>${roman.text}</span>` : ''}</p>`;
}

/** Translations and other names (not the original or its romanization, shown above), each with its lang. */
// Own translations in [brackets], official ones marked, former names marked (API 139); when an official translation is
// shown as the title, the stored title is listed here instead. Their context (API 152): when in use, a note, and — with
// `marks` — their sources' markers.
// `keep`: which of them (the "Born as" row takes the birth names, "Also known as" the rest — API 153).
export function otherNames(e: Nameable, marks: (n: NameEntry) => Html | string = () => '', keep: (n: Partial<NameEntry>) => boolean = () => true) {
  const official = officialInstead(e);
  const rest: (Pick<NameEntry, 'text' | 'lang' | 'ruby_html' | 'status'> & { role?: NameEntry['role'] })[] = [
    ...(official ? [{ text: e.title!, lang: e.title_lang ?? null, ruby_html: e.title_ruby_html ?? null, status: e.title_status ?? null }] : []),
    ...(e.names ?? []).filter((n) => n.role !== 'original' && n.role !== 'romanization' && n !== official),
  ].filter((n) => keep(n as Partial<NameEntry>));
  return rest.length ? html`${rest.map((n, i) => html`${i ? ' · ' : ''}${n.status ? html`<span title="${STATUS_HINT[n.status]}">${
    nameSpan(translated(n.text, n.status), n.lang, n.ruby_html && n.status === 'own' ? `[${n.ruby_html}]` : n.ruby_html)}</span>` : nameSpan(n.text, n.lang, n.ruby_html)}${
    n.status === 'official' ? html` <span class="tag">official</span>` : ''}${kindTag(n as Partial<NameEntry>)}${context(n as Partial<NameEntry>, marks)}`)}` : null;
}

const KIND_LABEL: Record<NameKind, string> = { birth: 'birth name', married: 'married name', pseudonym: 'pseudonym', art_name: 'art name',
  religious: 'religious name', nickname: 'nickname', abbreviation: 'abbreviation' };
/** What kind of name it is (API 153) — else "former" for a name it had before (139); a birth name says so in its row. */
const kindTag = (n: Partial<NameEntry>) => (n.kind && n.kind !== 'birth' ? html` <span class="tag">${KIND_LABEL[n.kind]}</span>`
  : n.role === 'former' && !n.kind ? html` <span class="tag" title="A name it had before">former</span>` : '');

/** A name's context (API 152): when it was in use, its sources' markers (stored names only, not the title), a note. */
const context = (n: Partial<NameEntry>, marks: (n: NameEntry) => Html | string) => html`${
  n.period ? html` <span class="muted name-period">${n.period.label}</span>` : ''}${n.role ? marks(n as NameEntry) : ''}${
  n.note ? html` <span class="muted name-note">— ${n.note}</span>` : ''}`;

/** "Official English title" / "Own translation" under an artwork's heading, when the title is a translation (not "common"). */
export function titleStatusLine(e: Nameable) {
  const d = displayName(e);
  if (d.status !== 'official' && d.status !== 'own') return null;
  let language = '';
  try { language = d.lang ? new Intl.DisplayNames(['en'], { type: 'language' }).of(d.lang.split('-')[0]) ?? '' : ''; } catch { /* unknown code */ }
  return d.status === 'official' ? `Official ${language ? `${language} ` : ''}title` : `Own ${language ? `${language} ` : ''}translation of the title`;
}

/**
 * Links inside written texts (the changelog's points, the roadmap's notes, the documentation) open in a new tab, so
 * the text stays where the reader was. Set at the moment of the click — on texts loaded later too — before the
 * router's own handling (it leaves links with a target alone). `keep`: links that stay in the tab (the
 * documentation's links to its own headings).
 */
export function linksInNewTab(root: Element, within: string, keep: (href: string) => boolean = () => false) {
  root.addEventListener('click', (e) => {
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || !a.closest(within) || a.hasAttribute('target')) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#') || keep(href)) return;
    a.target = '_blank';
    a.rel = 'noopener';
  }, true);
}
