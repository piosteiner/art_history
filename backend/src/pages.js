// Pages written in the CMS (migration 114: the project documentation) → safe HTML and a table of contents.
// The Markdown comes from Obsidian, so its forms are understood besides the usual ones:
//   ![[Facharbeit-1790625525635.webp]]      an image of the page, by its file name (page_images)
//   ![[name.webp|400]] · ![[name.webp|Caption]]  a width in pixels, or a caption
//   ==highlighted== · ||spoiler|| · ++underline++ · - [x] tasks · > [!note] callouts   (src/md-extras.js)
//   # … ###### headings                      with ids (the table of contents links them)
//   [[#Vertrauliche Daten]] · [[#Vertrauliche Daten|die Zugangsdaten]]   a link to a heading of the same page, in
//                                            any chapter (a heading not found shows as marked text)
//   <span style="color:…">, <ruby>…<rt>…</rt></ruby>   allowed HTML; everything else sanitize-html removes
// Entity pages use src/markdown.js (raw HTML off); here HTML is on — the text is the owner's, written in the CMS — and
// sanitize-html is the fence: only the tags and attributes listed below survive, a colour only as a colour.
const MarkdownIt = require('markdown-it');
const sanitizeHtml = require('sanitize-html');
const { fold } = require('./fold');
const { extras } = require('./md-extras');

const IMAGE_NAME = /^[\w][\w .-]{0,150}\.(webp|png|jpe?g|gif|avif)$/i;

const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
// ==highlight==, ||spoiler||, ++underline++, - [x] tasks, > [!note] callouts (src/md-extras.js, shared with the entries' texts)
extras(md, { underline: true });

// ![[name|width or caption]] — before the standard image rule, so it is read first
md.inline.ruler.before('image', 'embed_image', (state, silent) => {
  if (!state.src.startsWith('![[', state.pos)) return false;
  const end = state.src.indexOf(']]', state.pos + 3);
  if (end < 0) return false;
  const [name, extra] = state.src.slice(state.pos + 3, end).split('|').map((s) => s.trim());
  if (!IMAGE_NAME.test(name)) return false;
  if (!silent) {
    const token = state.push('embed_image', 'img', 0);
    token.meta = { name, width: /^\d{1,4}$/.test(extra || '') ? Number(extra) : null, caption: extra && !/^\d{1,4}$/.test(extra) ? extra : null };
  }
  state.pos = end + 2;
  return true;
});
md.renderer.rules.embed_image = (tokens, i, opts, env) => {
  const { name, width, caption } = tokens[i].meta;
  env.images.add(name);
  const known = env.known ? env.known.has(name) : true;
  if (!known) return `<span class="page-image-missing" title="Image not uploaded yet">${md.utils.escapeHtml(name)}</span>`;
  const src = `${env.imageBase}${encodeURIComponent(name)}`;
  // its size (115), so the space is kept before it loads; a width asked for scales the height with it
  const dim = env.dims && env.dims.get(name);
  const w = width || (dim && dim.width);
  const h = dim && w ? Math.round((dim.height * w) / dim.width) : null;
  const img = `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(caption || '')}" loading="lazy"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}>`;
  return caption ? `<span class="page-figure">${img}<span class="page-caption">${md.utils.escapeHtml(caption)}</span></span>` : img;
};

// [[#Heading]] / [[#Heading|own words]] — a heading of this page, as Obsidian links them ([[#A#B]]: the last one, B).
// Resolved through env.headings (pageHeadings: the whole text's headings → their id and chapter); env.linkBase is the
// page's address on the site, so a link into another chapter opens it there at the heading.
md.inline.ruler.before('link', 'heading_link', (state, silent) => {
  if (!state.src.startsWith('[[#', state.pos)) return false;
  const end = state.src.indexOf(']]', state.pos + 3);
  if (end < 0) return false;
  const inner = state.src.slice(state.pos + 3, end);
  if (/[\[\n]/.test(inner)) return false;
  const bar = inner.indexOf('|');
  const path = (bar < 0 ? inner : inner.slice(0, bar)).split('#').map((x) => x.trim()).filter(Boolean);
  const target = path[path.length - 1];
  if (!target) return false;
  const label = bar < 0 ? target : inner.slice(bar + 1).trim();
  if (!silent) state.push('heading_link', 'a', 0).meta = { path, target, label: label || target };
  state.pos = end + 2;
  return true;
});
const headingKey = (t) => fold(String(t).replace(/[*_`=]/g, '')).replace(/\s+/g, ' ').trim();
md.renderer.rules.heading_link = (tokens, i, opts, env) => {
  const { path, target, label } = tokens[i].meta;
  // [[#Grosse Erweiterungen#Preise]]: the "Preise" under that heading — of two of the same name, the one meant
  const keys = path.map(headingKey);
  const h = env.headings && (keys.length > 1
    ? (env.headings.all || []).find((x) => x.key === keys[keys.length - 1] && keys.slice(0, -1).every((k) => x.parents.includes(k)))
    : env.headings.get(keys[0]));
  const text = md.utils.escapeHtml(label);
  if (!h) return `<span class="page-link-missing" title="${md.utils.escapeHtml(`No heading “${target}” in this page`)}">${text}</span>`;
  const href = `${env.linkBase || ''}${h.chapter ? `/${encodeURIComponent(h.chapter)}` : ''}#${encodeURIComponent(h.id)}`;
  return `<a href="${md.utils.escapeHtml(href)}">${text}</a>`;
};

// headings: ids from their text ("Räumliche Nähe" → "raumliche-nahe"), each once
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'abschnitt';
md.core.ruler.push('heading_ids', (state) => {
  // env.seen: shared by the chapters of one page, rendered one after the other, so their ids are those of the whole text
  const seen = state.env.seen || new Map();
  for (let i = 0; i < state.tokens.length; i++) {
    const t = state.tokens[i];
    if (t.type !== 'heading_open') continue;
    const text = state.tokens[i + 1].children.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('');
    let id = slug(text);
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    t.attrSet('id', id);
    state.env.toc.push({ level: Number(t.tag.slice(1)), id, text: text.trim() });
  }
});

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i, /^[a-z]{3,20}$/i];
const SANITIZE = {
  allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'em', 'strong', 'b', 'i', 'u', 's', 'del', 'mark', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'span', 'ruby', 'rt', 'rp', 'kbd'],
  allowedAttributes: {
    a: ['href', 'title'], img: ['src', 'alt', 'width', 'height', 'loading', 'title'], span: ['class', 'style', 'title', 'aria-label', 'tabindex'],
    li: ['class'], th: ['style'], td: ['style'], ol: ['start'], blockquote: ['class'], p: ['class'],
    h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'], code: ['class'],
  },
  allowedStyles: { span: { color: COLOR }, th: { 'text-align': [/^(left|right|center)$/] }, td: { 'text-align': [/^(left|right|center)$/] } },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowedSchemesByTag: { img: ['https', 'http'] },
  transformTags: { a: (tag, attribs) => ({ tagName: 'a', attribs: /^https?:/i.test(attribs.href || '') ? { ...attribs, rel: 'noopener', target: '_blank' } : attribs }) },
};
SANITIZE.allowedAttributes.a.push('rel', 'target');

/**
 * Markdown → { html, toc, images }. imageBase: the address the page's images are served under ("…/v1/pages/<slug>/images/");
 * known: the names uploaded (a Set) — an embed of another name shows as a marked file name; dims: name → {width, height}
 * (115); images: every name embedded.
 */
function renderPage(markdown, { imageBase, known = null, dims = null, seen = null, lang = 'de', headings = null, linkBase = '' } = {}) {
  const env = { toc: [], images: new Set(), imageBase, known, dims, seen, lang, headings, linkBase };
  const raw = md.render(String(markdown || ''), env);
  const html = sanitizeHtml(raw, SANITIZE);
  return { html, toc: env.toc, images: [...env.images] };
}

// ---- chapters --------------------------------------------------------------------------------------------------
// A long page is read and edited chapter by chapter: the chapters are its top-level headings (the highest level the
// text uses — "#" in the documentation), the text before the first is the introduction. Headings inside code fences
// don't count. The text stays one: chapters are positions in it, so a chapter edited alone goes back into its place.
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
function splitChapters(markdown) {
  const text = String(markdown || '');
  const lines = text.split('\n');
  const heads = [];
  let fence = null;
  let pos = 0;
  for (const line of lines) {
    const f = /^(```|~~~)/.exec(line);
    if (f) fence = fence === f[1] ? null : fence || f[1];
    else if (!fence) {
      const m = HEADING.exec(line);
      if (m) heads.push({ level: m[1].length, title: m[2].replace(/[*_`=]/g, '').trim(), start: pos });
    }
    pos += line.length + 1;
  }
  const top = Math.min(...heads.map((h) => h.level), 7);
  const starts = heads.filter((h) => h.level === top);
  const ids = new Map();
  const chapters = starts.map((h, i) => {
    let id = slug(h.title);
    const n = (ids.get(id) || 0) + 1;
    ids.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    const end = i + 1 < starts.length ? starts[i + 1].start : text.length;
    return { index: i + 1, id, title: h.title, start: h.start, end, md: text.slice(h.start, end) };
  });
  const introEnd = chapters.length ? chapters[0].start : text.length;
  return { intro: { index: 0, start: 0, end: introEnd, md: text.slice(0, introEnd) }, chapters, level: top };
}

// Every heading of a page → Map(folded text → {id, chapter, text}): the ids as the rendered chapters have them (one
// shared count, as the API renders them one after the other), chapter null for the introduction. The first of two
// headings of the same text wins, as in Obsidian. Parsed, not rendered — md.parse runs the heading_ids rule.
function pageHeadings(markdown) {
  const { intro, chapters } = splitChapters(markdown);
  const seen = new Map();
  const out = new Map();
  out.all = [];          // every heading in order, with the headings above it ([[#A#B]])
  const stack = [];      // the current heading of each level above
  for (const part of [{ id: null, md: intro.md }, ...chapters]) {
    const env = { toc: [], images: new Set(), seen };
    md.parse(part.md, env);
    for (const t of env.toc) {
      const key = headingKey(t.text);
      while (stack.length && stack[stack.length - 1].level >= t.level) stack.pop();
      const h = { key, id: t.id, chapter: part.id, text: t.text, level: t.level, parents: stack.map((x) => x.key), above: stack.length ? stack[stack.length - 1].text : null };
      stack.push(h);
      out.all.push(h);
      if (!out.has(key)) out.set(key, h);
    }
  }
  return out;
}

// The chapters in a new order (the CMS outline, dragged): order = their indices as they are now (1 …), in the order
// they should follow; the introduction stays first. Each chapter ends with one blank line, the text with a newline —
// a chapter moved from the end gets the blank line it lacked. null when order is not every chapter once.
function reorderChapters(markdown, order) {
  const { intro, chapters } = splitChapters(markdown);
  const ok = order.length === chapters.length && new Set(order).size === order.length && order.every((n) => Number.isInteger(n) && chapters[n - 1]);
  if (!ok) return null;
  return intro.md + order.map((n) => chapters[n - 1].md.replace(/\s+$/, '')).join('\n\n') + '\n';
}

// a chapter's part of the text replaced by its edited version (the rest exactly as it was)
function replaceChapter(markdown, index, edited) {
  const { intro, chapters } = splitChapters(markdown);
  const part = index === 0 ? intro : chapters.find((c) => c.index === index);
  if (!part) return null;
  let next = String(edited || '').replace(/\r\n/g, '\n');
  // a chapter ends with its blank line, so the next heading stays a heading
  if (part.end < String(markdown).length && !next.endsWith('\n')) next += '\n';
  return String(markdown).slice(0, part.start) + next + String(markdown).slice(part.end);
}

// The text as it reads, one line per block: no Markdown, no link targets, no images, no task boxes
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const BLOCK = /<\/?(?:p|h[1-6]|li|ul|ol|blockquote|div|table|thead|tbody|tr|td|th|pre|figure|figcaption|hr|br)\b[^>]*>/gi;
function readLines(mdText) {
  return renderPage(String(mdText), { imageBase: '' }).html
    .replace(/\n/g, ' ')
    .replace(/<span class="task-box"[^>]*>[^<]*<\/span>/g, '')
    .replace(BLOCK, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m))
    .split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const words = (mdText) => (readLines(mdText).join(' ').match(/[\p{L}\p{N}]+/gu) || []).length;
// characters with spaces (line breaks not counted)
const chars = (mdText) => readLines(mdText).reduce((n, line) => n + [...line].length, 0);

// ---- search ----------------------------------------------------------------------------------------------------
// The documentation searched paragraph by paragraph (API /v1/pages/<slug>/search, the site's search field): every word
// of the query must begin a word of the paragraph — accents, ß/ss and case alike (fold) —, the chapter's text read as
// it reads (Markdown, links and images gone). A hit: its chapter, the heading above it (to link to), a passage around
// the first match with the matched words in <mark> (as written), and how often they occur in it.
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const plainText = (h) => h.replace(/<[^>]+>/g, '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' && e !== '#39'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()] ?? m)).replace(/\s+/g, ' ').trim();
const escapeHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
const PASSAGE = 90;   // characters of context on each side of the first match

function searchPage(markdown, q, { limit = 100 } = {}) {
  const terms = [...new Set(fold(String(q || '')).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2))];
  if (!terms.length) return { terms, total: 0, hits: [] };
  const { intro, chapters } = splitChapters(markdown);
  const seen = new Map();   // heading ids as the rendered chapters have them
  const hits = [];
  let total = 0;
  for (const part of [{ id: null, title: null, index: 0, md: intro.md }, ...chapters]) {
    const env = { toc: [], images: new Set(), seen, imageBase: '', known: new Set() };
    const tokens = md.parse(part.md, env);
    let heading = null;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'heading_open') {
        heading = { id: t.attrGet('id'), text: plainText(md.renderer.renderInline(tokens[i + 1].children, md.options, env)) };
        i += 1;
        continue;
      }
      if (t.type !== 'inline') continue;
      const text = plainText(md.renderer.renderInline(t.children, md.options, env));
      if (!text) continue;
      // the paragraph's words that some term begins; every term must be found
      const words = [...text.matchAll(WORD_RE)].map((m) => ({ at: m.index, end: m.index + m[0].length, f: fold(m[0]) }));
      const found = new Set();
      const marked = words.filter((w) => {
        const hit = terms.filter((term) => w.f.startsWith(term));
        hit.forEach((term) => found.add(term));
        return hit.length > 0;
      });
      if (found.size < terms.length) continue;
      total += 1;
      if (hits.length >= limit) continue;
      // the passage: around the first match, cut at word boundaries
      const first = marked[0];
      let from = Math.max(0, first.at - PASSAGE);
      let to = Math.min(text.length, first.end + PASSAGE * 2);
      if (from > 0) from = text.indexOf(' ', from) + 1 || from;
      if (to < text.length) { const sp = text.lastIndexOf(' ', to); if (sp > first.end) to = sp; }
      let out = '';
      let at = from;
      for (const w of marked.filter((x) => x.at >= from && x.end <= to)) {
        out += `${escapeHtml(text.slice(at, w.at))}<mark>${escapeHtml(text.slice(w.at, w.end))}</mark>`;
        at = w.end;
      }
      out += escapeHtml(text.slice(at, to));
      hits.push({
        chapter: part.id ? { id: part.id, title: part.title, index: part.index } : null,
        heading: heading && heading.id ? heading : null,
        passage_html: `${from > 0 ? '… ' : ''}${out}${to < text.length ? ' …' : ''}`,
        matches: marked.length,
      });
    }
  }
  return { terms, total, hits };
}

// a page's address on the site (frontend: src/views/page.ts) — heading links point there
const SITE_ADDRESS = { 'projekt-dokumentation': '/dokumentation', privacy: '/privacy' };
const siteAddress = (slug) => SITE_ADDRESS[slug] || `/pages/${slug}`;

module.exports = { renderPage, pageHeadings, siteAddress, reorderChapters, searchPage, splitChapters, replaceChapter, words, chars, IMAGE_NAME };
