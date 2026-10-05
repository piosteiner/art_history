// After `vite build`: one static page per entry so links have their own title, description and preview image
// (chat apps and many crawlers don't run JavaScript), plus sitemap.xml, robots.txt and 404.html (the app shell, for
// addresses without a page, e.g. entries added since the last build or network views). The app starts on top of
// every page as usual. Run by the Pages workflow (also daily, so new content gets its page within a day).
//   node scripts/prerender.mjs            (reads dist/index.html, writes into dist/)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://arthistory.piogino.ch';
const API = process.env.API_BASE ?? 'https://api.arthistory.piogino.ch/v1';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PLURALS = ['artists', 'artworks', 'movements', 'polities', 'institutions', 'people', 'places', 'glossary'];
const TYPE_LABEL = { artists: 'Artist', artworks: 'Artwork', movements: 'Movement', polities: 'Polity', institutions: 'Institution', people: 'Person', places: 'Place', glossary: 'Term' };
const LIST_LABEL = { artists: 'Artists', artworks: 'Artworks', movements: 'Movements', polities: 'Polities', institutions: 'Institutions', people: 'People', places: 'Places', glossary: 'Glossary' };
const SITE_DESCRIPTION = 'Artists, artworks, movements and museums on a map, a timeline and an influence graph.';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// block tags become spaces, inline tags (<em>) just disappear: "Mount Fuji</em>." stays "Mount Fuji."
const text = (html) => (html ?? '').replace(/<\/?(p|br|li|ul|ol|h\d|div|blockquote)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const clip = (s, n = 200) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1) > 80 ? s.lastIndexOf(' ', n - 1) : n - 1)}…`);
const thumb = (url, w = 1200) => (url && url.includes('/thumb/') ? url.replace(/\/\d+px-/, `/${w}px-`) : url);

async function get(path, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(API + path, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${path}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function listAll(plural) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const page = await get(`/${plural}?limit=500&offset=${offset}`);
    out.push(...page.data);
    if (out.length >= page.total || !page.data.length) return out;
  }
}

/** Runs `fn` over `items`, `n` at a time (be gentle with the API). */
async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

// names in several languages: lang="…" on names, the original as a second line (ruby_html is escaped by the API)
const langOf = (lang) => (lang ? ` lang="${esc(lang)}"` : '');
const originalOf = (e) => {
  const o = e.names?.find((n) => n.role === 'original');
  return o ? `<p class="original-name"${langOf(o.lang)}>${o.ruby_html ?? esc(o.text)}</p>` : '';
};

const dateSpan = (a, b) => (a || b ? `${a?.label ?? '?'} – ${b?.label ?? '?'}` : '');

/** Title, one-line summary and image for an entry (from its detail). */
function describe(plural, e) {
  const name = e.name ?? e.title;
  const country = e.country?.name ?? null;
  const facts = {
    artists: [dateSpan(e.birth, e.death), e.birth_place ? `born in ${e.birth_place.name}${country && country !== e.birth_place.name ? `, ${country}` : ''}` : ''],
    artworks: [e.creator?.name ?? e.attribution_label, e.created?.label, e.kind, e.institution ? e.institution.name : ''],
    movements: [e.kind, e.period?.label],
    polities: [e.kind, e.period?.label],
    institutions: [e.kind, e.place?.name && country ? `${e.place.name}, ${country}` : e.place?.name, e.founded ? `founded ${e.founded.label}` : ''],
    people: [e.birth || e.death ? dateSpan(e.birth, e.death) : e.active ? `active ${e.active.label}` : '', (e.occupations ?? []).join(', '), (e.roles ?? []).join(', ')],
    places: [e.kind, e.ancestors?.length ? e.ancestors.map((a) => a.name).reverse().join(', ') : ''],
    glossary: [e.category],
  }[plural].filter(Boolean);
  const long = [e.definition, text(e.biography_html ?? e.description_html ?? e.notes_html)].filter(Boolean).join(' ');
  const summary = `${TYPE_LABEL[plural]}${facts.length ? ` · ${facts.join(' · ')}` : ''}`;
  return { name, summary, description: clip(long ? `${summary}. ${long}` : summary), long, image: e.images?.[0] ?? null };
}

function jsonLd(plural, e, d, url) {
  const base = { '@context': 'https://schema.org', name: d.name, url, description: d.description };
  if (d.image) base.image = thumb(d.image.url);
  if (plural === 'artists') return { ...base, '@type': 'Person', birthDate: e.birth?.from ?? undefined, deathDate: e.death?.to ?? undefined, birthPlace: e.birth_place?.name };
  if (plural === 'artworks') return { ...base, '@type': 'VisualArtwork', creator: e.creator ? { '@type': 'Person', name: e.creator.name, url: `${SITE}/artists/${e.creator.slug}/` } : undefined, dateCreated: e.created?.label, artMedium: e.medium ?? undefined, artform: e.kind ?? undefined };
  if (plural === 'places') return { ...base, '@type': 'Place', geo: e.location ? { '@type': 'GeoCoordinates', longitude: e.location.coordinates[0], latitude: e.location.coordinates[1] } : undefined };
  if (plural === 'institutions') return { ...base, '@type': e.kind === 'museum' ? 'Museum' : 'Organization', foundingDate: e.founded?.label };
  return null;
}

/** The built index.html with this page's head tags and a readable body for crawlers. */
function page(template, { title, description, url, image, imageAlt, type = 'website', body = '', ld = null, noindex = false }) {
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:site_name" content="Art History">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    url ? `<meta property="og:url" content="${esc(url)}">` : '',
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    image && imageAlt ? `<meta property="og:image:alt" content="${esc(imageAlt)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n    ');
  return template
    .replace(/<title>[^<]*<\/title>\s*/, '')
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace('</head>', `    ${head}\n  </head>`)
    .replace('<main id="app"></main>', `<main id="app">${body}</main>`);
}

async function write(path, content) {
  const file = join(DIST, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const template = await readFile(join(DIST, 'index.html'), 'utf8');
if (!template.includes('<main id="app"></main>')) throw new Error('dist/index.html has no empty <main id="app"> to fill');
const urls = [`${SITE}/`];
let pages = 0;

for (const plural of PLURALS) {
  const items = await listAll(plural);
  const details = await pool(items, 6, (it) => get(`/${plural}/${encodeURIComponent(it.slug)}`));
  for (const e of details) {
    const url = `${SITE}/${plural}/${e.slug}/`;
    const d = describe(plural, e);
    await write(`${plural}/${e.slug}/index.html`, page(template, {
      title: `${d.name} · Art History`, description: d.description, url, type: 'article',
      image: d.image ? thumb(d.image.url) : null, imageAlt: d.image?.caption ?? d.name,
      ld: jsonLd(plural, e, d, url),
      body: `<article class="page"><p class="crumbs"><a href="/${plural}">${esc(LIST_LABEL[plural])}</a></p><h1${langOf(e.title_lang ?? e.name_lang)}>${esc(d.name)}</h1>${originalOf(e)}<p class="subtitle">${esc(d.summary)}</p>${d.long ? `<p>${esc(d.long)}</p>` : ''}</article>`,
    }));
    urls.push(url);
    pages++;
  }
  const listUrl = `${SITE}/${plural}/`;
  await write(`${plural}/index.html`, page(template, {
    title: `${LIST_LABEL[plural]} · Art History`, url: listUrl,
    description: `${LIST_LABEL[plural]} in the Art History collection: ${items.slice(0, 8).map((i) => i.name ?? i.title).join(', ')}${items.length > 8 ? ' …' : ''}`,
    body: `<section class="page"><h1>${esc(LIST_LABEL[plural])}</h1><ul>${items.map((i) => `<li><a href="/${plural}/${esc(i.slug)}">${esc(i.name ?? i.title)}</a></li>`).join('')}</ul></section>`,
  }));
  urls.push(listUrl);
  console.log(`${plural}: ${items.length} pages`);
}

await write('privacy/index.html', page(template, {
  title: 'Privacy · Art History', url: `${SITE}/privacy/`,
  description: 'Privacy statement of Art History: no cookies, no analytics, no tracking; which services see your IP address and what is stored in your browser.',
  body: '<article class="page"><h1>Privacy</h1><p>No cookies, no analytics, no advertising, no tracking. The full statement loads with the page.</p></article>',
}));
urls.push(`${SITE}/privacy/`);

// the start page gets the site description and preview tags; 404.html is the app shell for everything else
await write('index.html', page(template, { title: 'Art History', description: SITE_DESCRIPTION, url: `${SITE}/` }));
await write('404.html', page(template, { title: 'Art History', description: SITE_DESCRIPTION, noindex: true }));
await write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /graph/\n\nSitemap: ${SITE}/sitemap.xml\n`);
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`prerendered ${pages} entry pages, ${PLURALS.length} lists, sitemap with ${urls.length} addresses`);
