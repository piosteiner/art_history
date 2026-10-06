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
    'h2', 'h3', 'h4', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 's', 'i', 'span', 'section'],
  allowedAttributes: { a: ['href', 'title', 'class', 'data-term', 'data-entry', 'data-source', 'id'], th: ['align'], td: ['align'],
    li: ['id'], sup: ['id', 'class'], section: ['class'], span: ['class'], ol: ['class'], ul: ['class'] },
  allowedClasses: { a: ['glossary-link', 'entry-link', 'missing', 'source-link', 'fn-back'], sup: ['fn-ref'],
    section: ['footnotes', 'bibliography'], span: ['siglum', 'missing'], ol: ['footnote-list'], ul: ['source-list'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener' }) },
};

// ── Citations and footnotes (migration 036; the KHIST guide, src/bibliography.js) ─────────────────────────────────
//   … in his seventies [[source/clark-2017|45]].        a citation in the text → a footnote "Clark 2017, S. 45."
//   … [[source/busch-1993|55]] [[source/dittscheid-1987|205]]   adjacent ones → one footnote: "Busch 1993, S. 55, und
//                                                                Dittscheid 1987, S. 205." (never two markers in a row)
//   … ^[Vgl. hierzu [[source/busch-1993|bes. S. 55]].]   an own footnote (Pandoc's inline-note syntax), citations in it
// The same source as at the end of the previous footnote → "Ebd." / "ebd.". After the text: the footnotes and the
// full entries of everything cited ("Literatur"; primary sources apart as "Quellen").
// Done as a pass over the Markdown before markdown-it: notes are cut out and replaced by markers (private-use
// characters, which Markdown leaves alone), rendered on their own, and put back as numbered references.
const crypto = require('crypto');
const bibliography = require('./bibliography');

const CITE = /\[\[source\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|([^\]\n]*))?\]\]/y;
const CITE_RUN = /\[\[source\/[^\]\n]*\]\](?:[ \t]*[,;]?[ \t]*\[\[source\/[^\]\n]*\]\])*/y;
const NOTE = (n) => `\uE000${n}\uE001`;
const CITE_MARK = (k) => `\uE002${k}\uE003`;

function citesIn(s) {
  const out = [];
  for (const m of s.matchAll(new RegExp(CITE.source, 'g'))) out.push({ slug: m[1], loc: (m[2] || '').trim() });
  return out;
}

// text → { body (with note markers), notes: [{ inline: text } | { cites: [...] }] }
function extractNotes(text) {
  const notes = [];
  let body = '';
  let i = 0;
  while (i < text.length) {
    const nextNote = text.indexOf('^[', i);
    const nextCite = text.indexOf('[[source/', i);
    const at = [nextNote, nextCite].filter((x) => x >= 0).sort((a, b) => a - b)[0];
    if (at === undefined) { body += text.slice(i); break; }
    body += text.slice(i, at);
    if (at === nextNote) {
      let depth = 0;
      let end = -1;
      for (let j = at + 1; j < text.length; j += 1) {
        if (text[j] === '[') depth += 1;
        else if (text[j] === ']') { depth -= 1; if (depth === 0) { end = j; break; } }
      }
      if (end < 0) { body += text.slice(at); break; }  // unbalanced: left as written
      notes.push({ inline: text.slice(at + 2, end) });
      body += NOTE(notes.length);
      i = end + 1;
    } else {
      CITE_RUN.lastIndex = at;
      const m = CITE_RUN.exec(text);
      if (!m) { body += text.slice(at, at + 2); i = at + 2; continue; }
      notes.push({ cites: citesIn(m[0]) });
      body += NOTE(notes.length);
      i = at + m[0].length;
    }
  }
  return { body, notes };
}

function renderWithNotes(text, env) {
  const { T, esc, locator } = bibliography;
  const { body, notes } = extractNotes(text);
  if (!notes.length) return md.render(text, env);
  const sources = (env.names && env.names.sources) || new Map();
  const p = `n${crypto.createHash('sha1').update(text).digest('hex').slice(0, 6)}`;
  const cited = new Map();
  const cite = (c, ibid, capital) => {
    const s = sources.get(c.slug);
    const loc = locator(c.loc, s && s.kind);
    if (!s) return `<span class="missing">${esc(c.slug)}</span>${loc ? `, ${esc(loc)}` : ''}`;
    cited.set(c.slug, s);
    if (env.cited) env.cited.add(c.slug);
    const label = ibid ? (capital ? T.ibid[0].toUpperCase() + T.ibid.slice(1) : T.ibid) : s.siglum;
    return `<a href="/bibliography/${c.slug}" class="source-link" data-source="${c.slug}">${esc(label)}</a>${loc ? `, ${esc(loc)}` : ''}`;
  };
  const end = (h) => (/[.!?]\s*$/.test(h.replace(/<[^>]+>/g, '')) ? h : `${h}.`);
  let prev = null;  // the source cited last in the previous footnote
  const items = notes.map((n, idx) => {
    let html;
    let last = null;
    if (n.cites) {
      const parts = n.cites.map((c, k) => cite(c, k === 0 && c.slug === prev, k === 0));
      html = parts.length === 1 ? parts[0] : parts.length === 2 ? `${parts[0]}, ${T.and} ${parts[1]}`
        : `${parts.slice(0, -1).join('; ')}; ${T.and} ${parts[parts.length - 1]}`;
      last = n.cites[n.cites.length - 1].slug;
    } else {
      const cs = citesIn(n.inline);
      let k = 0;
      const src = n.inline.replace(new RegExp(CITE.source, 'g'), () => CITE_MARK(k++));
      const atStart = /^\s*\uE002/.test(src);
      html = md.renderInline(src.trim(), env).replace(/\uE002(\d+)\uE003/g, (_, j) => cite(cs[+j], +j === 0 && cs[0].slug === prev, +j === 0 && atStart));
      last = cs.length ? cs[cs.length - 1].slug : null;
    }
    prev = last;
    html = html.replace(/^(\s*)([a-zà-ÿ])/, (_, sp, c) => sp + c.toUpperCase());  // "Jede Anmerkung beginnt mit einem Grossbuchstaben"
    return `<li id="${p}-n${idx + 1}">${end(html)} <a href="#${p}-r${idx + 1}" class="fn-back" title="back to the text">↩</a></li>`;
  });
  const main = md.render(body, env).replace(/\uE000(\d+)\uE001/g, (_, n) => `<sup class="fn-ref" id="${p}-r${n}"><a href="#${p}-n${n}">${n}</a></sup>`);
  const list = (entries, title) => (entries.length ? `<h4>${title}</h4><ul class="source-list">${entries
    .sort(([, a], [, b]) => a.siglum.localeCompare(b.siglum, bibliography.LANG))
    .map(([slug, s]) => `<li id="${p}-s-${slug}"><span class="siglum">${esc(s.siglum)}:</span> ${s.full}</li>`).join('')}</ul>` : '');
  const all = [...cited];
  return `${main}<section class="footnotes"><ol class="footnote-list">${items.join('')}</ol></section>`
    + (all.length ? `<section class="bibliography">${list(all.filter(([, s]) => s.primary), T.sources)}${list(all.filter(([, s]) => !s.primary), T.literature)}</section>` : '');
}

const renderMarkdown = (text, env = {}) => (text
  ? sanitizeHtml(/\^\[|\[\[source\//.test(text) ? renderWithNotes(text, env) : md.render(text, env), SANITIZE) : null);

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
  const names = new Map(rows.map((r) => [r.ref, r.name]));
  // citations: the whole bibliography (sigla are disambiguated across it — "Jacobsen 1992a"; it is small)
  if ([...refs].some((r) => r.startsWith('source/'))) names.sources = await bibliography.loadCatalogue(db);
  return names;
}

module.exports = { renderMarkdown, linkNames };
