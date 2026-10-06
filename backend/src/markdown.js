// *_md columns → safe HTML for the frontend. markdown-it already escapes raw HTML (html: false);
// sanitize-html is the second fence, so a mistake in one of them can't inject script into the site.
const MarkdownIt = require('markdown-it');
const sanitizeHtml = require('sanitize-html');
const { TYPES } = require('./content');

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// Links to entries (migrations 027, 030), Obsidian-style:
//   [[contrapposto]]                    → a glossary term (no type = the glossary, as before 030)
//   [[artist/katsushika-hokusai]]       → any entry, by type/slug (the same form as relationship targets)
//   [[artwork/the-great-wave|the Wave]] → own words after |
// An inline rule, so [[…]] inside `code` stays text. The link goes to the website's address (/glossary/slug,
// /artists/slug …): <a class="glossary-link" data-term="slug"> for terms (popovers), <a class="entry-link"
// data-entry="type/slug"> for everything else; a target that doesn't exist also gets class "missing".
// env.names: Map "type/slug" → name (linkNames() loads it — shown when there are no own words);
// env.used: a Set the term slugs are collected in (the API returns their definitions for tooltips).
const LINK = /^\[\[(?:([a-z]+)\/)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|([^\]\n]+))?\]\]/;
const LINK_ALL = new RegExp(LINK.source.slice(1), 'g');  // the same pattern anywhere in a text (linkNames)
const FOLDER = Object.fromEntries(TYPES.map((t) => [t.type, t.folder]));
md.inline.ruler.before('link', 'entry_link', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;  // "[["
  const m = LINK.exec(state.src.slice(state.pos));
  if (!m) return false;
  const type = m[1] || 'term';
  if (!FOLDER[type]) return false;  // [[foo/bar]]: not a type — stays text (the quality check reports it)
  if (!silent) {
    const ref = `${type}/${m[2]}`;
    const names = (state.env && state.env.names) || new Map();
    if (type === 'term' && state.env && state.env.used) state.env.used.add(m[2]);
    const base = type === 'term' ? 'glossary-link' : 'entry-link';
    const open = state.push('link_open', 'a', 1);
    open.attrs = [['href', `/${FOLDER[type]}/${m[2]}`], ['class', names.has(ref) ? base : `${base} missing`],
      type === 'term' ? ['data-term', m[2]] : ['data-entry', ref]];
    const text = state.push('text', '', 0);
    text.content = m[3] ? m[3].trim() : names.get(ref) || m[2];
    state.push('link_close', 'a', -1);
  }
  state.pos += m[0].length;
  return true;
});

const SANITIZE = {
  allowedTags: ['p', 'br', 'hr', 'em', 'strong', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
    'h2', 'h3', 'h4', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 's'],
  allowedAttributes: { a: ['href', 'title', 'class', 'data-term', 'data-entry'], th: ['align'], td: ['align'] },
  allowedClasses: { a: ['glossary-link', 'entry-link', 'missing'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener' }) },
};

const renderMarkdown = (text, env = {}) => (text ? sanitizeHtml(md.render(text, env), SANITIZE) : null);

// The names of the entries some texts link to: Map "type/slug" → name (only those, looked up in one query).
async function linkNames(db, texts) {
  const refs = new Set();
  for (const text of texts) {
    if (typeof text !== 'string' || !text.includes('[[')) continue;
    for (const m of text.matchAll(LINK_ALL)) refs.add(`${m[1] || 'term'}/${m[2]}`);
  }
  if (!refs.size) return new Map();
  const { rows } = await db.query(`
    SELECT type::text || '/' || slug AS ref, name FROM entity_index
    WHERE type::text || '/' || slug = ANY ($1)`, [[...refs]]);
  return new Map(rows.map((r) => [r.ref, r.name]));
}

module.exports = { renderMarkdown, linkNames };
