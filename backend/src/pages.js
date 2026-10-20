// Pages written in the CMS (migration 114: the project documentation) → safe HTML and a table of contents.
// The Markdown comes from Obsidian, so its forms are understood besides the usual ones:
//   ![[Facharbeit-1790625525635.webp]]      an image of the page, by its file name (page_images)
//   ![[name.webp|400]] · ![[name.webp|Caption]]  a width in pixels, or a caption
//   ==highlighted==                          <mark>
//   - [x] done · - [ ] open                  task lists (☑ / ☐)
//   # … ###### headings                      with ids (the table of contents links them)
//   <span style="color:…">, <ruby>…<rt>…</rt></ruby>   allowed HTML; everything else sanitize-html removes
// Entity pages use src/markdown.js (raw HTML off); here HTML is on — the text is the owner's, written in the CMS — and
// sanitize-html is the fence: only the tags and attributes listed below survive, a colour only as a colour.
const MarkdownIt = require('markdown-it');
const sanitizeHtml = require('sanitize-html');
const { fold } = require('./fold');

const IMAGE_NAME = /^[\w][\w .-]{0,150}\.(webp|png|jpe?g|gif|avif)$/i;

const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });

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

// ==highlight==
md.inline.ruler.before('emphasis', 'mark', (state, silent) => {
  if (!state.src.startsWith('==', state.pos) || state.src.charCodeAt(state.pos + 2) === 0x3d) return false;
  const end = state.src.indexOf('==', state.pos + 2);
  if (end < 0 || end === state.pos + 2) return false;
  if (!silent) {
    state.push('mark_open', 'mark', 1);
    const old = [state.pos, state.posMax];
    state.pos = state.pos + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    [state.pos, state.posMax] = old;
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
});

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

// task lists: a list item starting with [ ] or [x]
md.core.ruler.push('task_lists', (state) => {
  for (let i = 2; i < state.tokens.length; i++) {
    const t = state.tokens[i];
    if (t.type !== 'inline' || state.tokens[i - 1].type !== 'paragraph_open' || state.tokens[i - 2].type !== 'list_item_open') continue;
    const m = /^\[([ xX])\]\s+/.exec(t.content);
    if (!m) continue;
    const done = m[1] !== ' ';
    const first = t.children[0];
    if (first && first.type === 'text') first.content = first.content.replace(/^\[[ xX]\]\s+/, '');
    const box = new state.Token('html_inline', '', 0);
    box.content = `<span class="task-box" aria-label="${done ? 'done' : 'open'}">${done ? '☑' : '☐'}</span> `;
    t.children.unshift(box);
    state.tokens[i - 2].attrJoin('class', done ? 'task task-done' : 'task');
  }
});

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i, /^[a-z]{3,20}$/i];
const SANITIZE = {
  allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'em', 'strong', 'b', 'i', 'u', 's', 'del', 'mark', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'span', 'ruby', 'rt', 'rp', 'kbd'],
  allowedAttributes: {
    a: ['href', 'title'], img: ['src', 'alt', 'width', 'height', 'loading', 'title'], span: ['class', 'style', 'title', 'aria-label'],
    li: ['class'], th: ['style'], td: ['style'], ol: ['start'],
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
function renderPage(markdown, { imageBase, known = null, dims = null, seen = null } = {}) {
  const env = { toc: [], images: new Set(), imageBase, known, dims, seen };
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

const words = (mdText) => (String(mdText).replace(/!\[\[[^\]]*\]\]|<[^>]+>|[#*_=`>|-]/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;

module.exports = { renderPage, splitChapters, replaceChapter, words, IMAGE_NAME };
