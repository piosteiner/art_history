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
  const seen = new Map();
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
function renderPage(markdown, { imageBase, known = null, dims = null } = {}) {
  const env = { toc: [], images: new Set(), imageBase, known, dims };
  const raw = md.render(String(markdown || ''), env);
  const html = sanitizeHtml(raw, SANITIZE);
  return { html, toc: env.toc, images: [...env.images] };
}

module.exports = { renderPage, IMAGE_NAME };
