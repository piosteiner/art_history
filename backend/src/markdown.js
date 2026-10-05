// *_md columns → safe HTML for the frontend. markdown-it already escapes raw HTML (html: false);
// sanitize-html is the second fence, so a mistake in one of them can't inject script into the site.
const MarkdownIt = require('markdown-it');
const sanitizeHtml = require('sanitize-html');

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// Glossary links (migration 027): [[contrapposto]] → the term's name, [[ukiyo-e|ukiyo-e prints]] → own words.
// An inline rule, so [[…]] inside `code` stays text. The link: <a class="glossary-link" data-term="slug"
// href="/glossary/slug"> (the website's address); a term that doesn't exist gets class "missing".
// env.terms: Map slug → name (the caller loads it — names are shown for [[slug]] without own words);
// env.used: a Set the slugs are collected in (the API returns their definitions for tooltips).
const GLOSSARY = /^\[\[([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|([^\]\n]+))?\]\]/;
md.inline.ruler.before('link', 'glossary', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;  // "[["
  const m = GLOSSARY.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) {
    const terms = (state.env && state.env.terms) || new Map();
    if (state.env && state.env.used) state.env.used.add(m[1]);
    const open = state.push('link_open', 'a', 1);
    open.attrs = [['href', `/glossary/${m[1]}`], ['class', terms.has(m[1]) ? 'glossary-link' : 'glossary-link missing'], ['data-term', m[1]]];
    const text = state.push('text', '', 0);
    text.content = m[2] ? m[2].trim() : terms.get(m[1]) || m[1];
    state.push('link_close', 'a', -1);
  }
  state.pos += m[0].length;
  return true;
});

const SANITIZE = {
  allowedTags: ['p', 'br', 'hr', 'em', 'strong', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
    'h2', 'h3', 'h4', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 's'],
  allowedAttributes: { a: ['href', 'title', 'class', 'data-term'], th: ['align'], td: ['align'] },
  allowedClasses: { a: ['glossary-link', 'missing'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener' }) },
};

const renderMarkdown = (text, env = {}) => (text ? sanitizeHtml(md.render(text, env), SANITIZE) : null);

// slug → name of every glossary term, for rendering [[slug]] (small table; loaded per request).
async function glossaryNames(db) {
  return new Map((await db.query('SELECT slug, name FROM glossary')).rows.map((r) => [r.slug, r.name]));
}

module.exports = { renderMarkdown, glossaryNames };
