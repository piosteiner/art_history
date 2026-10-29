const express = require('express');
const { vocabulary } = require('../vocabulary');
const { apiPool } = require('../db');
const { router: entities, ENTITIES } = require('./entities');
const map = require('./map');
const graph = require('./graph');
const network = require('./network');
const periods = require('./periods');
const thumbs = require('./thumbs');
const { router: history } = require('./history');
const { renderMarkdown, linkNames } = require('../markdown');
const { badRequest, notFound } = require('../http');
const { fold } = require('../fold');
const { renderPage, pageHeadings, siteAddress, searchPage, splitChapters, words, chars } = require('../pages');
const { KINDS, STATUS, renderItems } = require('../changelog');

const router = express.Router();

// Content changes rarely (import / admin edits): let browsers and nginx reuse responses for a minute.
// Express adds a weak ETag, so revalidation after that is a cheap 304.
router.use((req, res, next) => {
  if (req.method === 'GET') res.set('Cache-Control', 'public, max-age=60');
  next();
});

router.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await apiPool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    console.error('health: db check failed:', err.message);
    res.status(503).json({ status: 'degraded', db: 'unavailable' });
  }
});

// The relationship vocabulary: labels, categories (map/graph layers), allowed entity types.
router.get('/vocabulary', async (req, res) => {
  const { rows } = await apiPool.query(`
    SELECT code, label, inverse_label, category, is_physical_presence, is_symmetric,
           subject_types::text[] AS subject_types, object_types::text[] AS object_types, description, derived
    FROM relationship_types ORDER BY sort_order`);
  res.json({ data: rows });
});

// What each hit is, in one line — an artwork with its artist and date ("Vincent van Gogh, January 1889 · oil painting"),
// a museum with its city — and its picture: the previews' (040), for the hits of one answer only. → (row) → {subtitle, image_url}
async function previewsOfHits(rows) {
  const { rows: pv } = rows.length ? await apiPool.query(`SELECT p.type::text AS type, p.slug, p.subtitle, p.image_url FROM entry_previews p
    WHERE (p.type, p.slug) IN (SELECT * FROM unnest($1::entity_type[], $2::text[]))`, [rows.map((r) => r.type), rows.map((r) => r.slug)]) : { rows: [] };
  const by = new Map(pv.map((p) => [`${p.type}/${p.slug}`, p]));
  return (r) => ({ subtitle: by.get(`${r.type}/${r.slug}`)?.subtitle || null, image_url: by.get(`${r.type}/${r.slug}`)?.image_url || null });
}

// One search box for everything: ?q=hokusai → best matches across all entity types.
router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q.length < 2) return res.json({ data: [] });
  const { rows } = await apiPool.query(`
    SELECT type, slug, public_id, name, kind, range_json(period, period_label) AS period, sort_key,
           round(greatest(word_similarity(f_unaccent($1), f_unaccent(name)),
                          0.9 * word_similarity(f_unaccent($1), f_unaccent(coalesce(alt_text, ''))))::numeric, 2) AS score
    FROM entity_index
    WHERE f_unaccent(name) ILIKE f_unaccent($2) OR f_unaccent($1) <% f_unaccent(name)
       OR f_unaccent(coalesce(alt_text, '')) ILIKE f_unaccent($2) OR f_unaccent($1) <% f_unaccent(coalesce(alt_text, ''))
    ORDER BY score DESC, sort_key COLLATE sort_natural
    LIMIT 20`, [q, `%${q.replace(/[\\%_]/g, '\\$&')}%`]);
  const preview = await previewsOfHits(rows);
  res.json({ data: rows.map((r) => ({ ...r, ...preview(r) })) });
});

// Full-text search (087): names AND texts — biographies, descriptions, definitions, provenance steps. Web-search
// syntax: "a phrase", -excluded, or. Stemmed in English, German and French ("paintings" finds "painted", "Gemälde"
// "Gemälden"), accents folded; names also by trigram similarity, so a typo ("Gaugin") still finds the name.
// ?in= / ?not_in= (113, may repeat): only artworks whose current collection — the institution's names or its city —
// has every word of the phrase ("kunsthaus zurich", "zurich") / leave those out (other types stay).
// One row per entry: matched_in name | text | provenance (the provenance steps that matched: provenance_ids),
// headline_html = the matching passage, the words in <mark>. ?type=artwork narrows, ?limit= (≤ 100) & ?offset= page.
const SEARCH_TYPES = ['artist', 'artwork', 'institution', 'person', 'movement', 'place', 'polity', 'term', 'source', 'event'];
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
router.get('/search/text', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : null;
  if (type && !SEARCH_TYPES.includes(type)) throw badRequest(`type is one of ${SEARCH_TYPES.join(', ')}`);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  if (q.length < 2) return res.json({ data: [], total: 0 });
  const phrases = (v) => (v === undefined ? null : [].concat(v).map((x) => fold(String(x)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).filter(Boolean).slice(0, 5));
  const [within, without] = [phrases(req.query.in), phrases(req.query.not_in)];
  // the artwork's current collection as folded text: the institution's names and its city
  const coll = `(SELECT lower(f_unaccent(concat_ws(' ', i.name, name_alt_text(i.name_ruby, i.names), pl.name))) FROM artworks w
    JOIN institutions i ON i.id = w.current_institution_id LEFT JOIN places pl ON pl.id = i.place_id WHERE w.id = e.id)`;
  const has = () => `coalesce((SELECT bool_and(strpos(coalesce(${coll}, ''), x) > 0) FROM regexp_split_to_table(ph, '\\s+') x), false)`;
  const { rows } = await apiPool.query(`
    WITH q AS (SELECT search_query($1) AS q),
    -- the documents that match: one per entry, one per provenance step (GIN indexes, 087)
    hits AS (
      SELECT d.type, d.id, d.part, d.provenance_id, d.body, ts_rank_cd(d.doc, q.q, 32) AS rank,
             ts_filter(d.doc, '{a,b}') @@ q.q AS in_name     -- the name or another name (weights A, B) matched
      FROM search_documents d, q WHERE d.doc @@ q.q AND ($2::entity_type IS NULL OR d.type = $2)),
    per_entry AS (
      SELECT type, id, sum(rank) AS rank, bool_or(in_name) AS in_name,
             (array_agg(part ORDER BY rank DESC))[1] AS part, (array_agg(body ORDER BY rank DESC))[1] AS body,
             array_agg(provenance_id ORDER BY rank DESC) FILTER (WHERE provenance_id IS NOT NULL) AS provenance_ids
      FROM hits GROUP BY type, id),
    -- names that are close without matching a word: typos, partial names (trigram, 080)
    near AS (
      SELECT type, id FROM entity_index
      WHERE ($2::entity_type IS NULL OR type = $2)
        AND (f_unaccent($1) <% f_unaccent(name) OR f_unaccent($1) <% f_unaccent(coalesce(alt_text, ''))))
    SELECT e.type, e.slug, e.public_id, e.name, e.kind, range_json(e.period, e.period_label) AS period,
           CASE WHEN p.id IS NULL OR p.in_name THEN 'name' WHEN p.part = 'entry' THEN 'text' ELSE 'provenance' END AS matched_in,
           coalesce(p.provenance_ids, '{}') AS provenance_ids,
           round((coalesce(p.rank, 0) + 0.5 * greatest(word_similarity(f_unaccent($1), f_unaccent(e.name)),
                                                      0.9 * word_similarity(f_unaccent($1), f_unaccent(coalesce(e.alt_text, '')))))::numeric, 3) AS score,
           search_headline(p.body, $1) AS headline,
           count(*) OVER () AS total
    FROM entity_index e
    LEFT JOIN per_entry p ON (p.type, p.id) = (e.type, e.id)
    WHERE (p.id IS NOT NULL OR (e.type, e.id) IN (SELECT type, id FROM near))
      AND ($5::text[] IS NULL OR (e.type = 'artwork' AND NOT EXISTS (SELECT 1 FROM unnest($5::text[]) ph WHERE NOT ${has()})))
      AND ($6::text[] IS NULL OR e.type <> 'artwork' OR NOT EXISTS (SELECT 1 FROM unnest($6::text[]) ph WHERE ${has()}))
    -- sources after every other entry (owner, 2026-10-28): the person Kleomenes before the lexicon article "Kleomenes"
    ORDER BY e.type = 'source', score DESC, e.sort_key COLLATE sort_natural
    LIMIT $3 OFFSET $4`, [q, type, limit, offset, within && within.length ? within : null, without && without.length ? without : null]);
  const plural = Object.fromEntries(Object.entries(ENTITIES).map(([k, v]) => [v.type, k]));
  const preview = await previewsOfHits(rows);
  res.json({
    total: rows.length ? Number(rows[0].total) : 0,
    data: rows.map(({ total, headline, public_id: pid, provenance_ids: ids, ...r }) => ({
      ...r, public_id: Number(pid), path: `/${plural[r.type]}/${pid}/${r.slug}`, score: Number(r.score),
      ...preview(r),
      provenance_ids: ids.map(Number),
      headline_html: headline ? escapeHtml(headline).replace(/\x01/g, '<mark>').replace(/\x02/g, '</mark>') : null,
    })),
  });
});

// "Did you mean …?" (113): each word of the query that is no word of any entry's names, replaced by the nearest that
// is (few edits — trigrams, Levenshtein, the same Double Metaphone sound): ?q=hokusia → {query: "Hokusai", words: […]}.
// query is null when every word is known. Only the words change: quotes, minus signs and the rest stay as typed.
router.get('/search/suggest', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  if (q.trim().length < 3) return res.json({ query: null, words: [] });
  const { rows } = await apiPool.query('SELECT word, suggestion, edits FROM search_suggest($1)', [q]);
  if (!rows.length) return res.json({ query: null, words: [] });
  const fix = new Map(rows.map((r) => [r.word, r.suggestion]));
  const query = q.replace(/\p{L}+/gu, (w) => fix.get(fold(w)) ?? w);
  res.json({ query, words: rows.map((r) => ({ from: r.word, to: r.suggestion, edits: r.edits })) });
});

// Pages written in the CMS (114): the project documentation, read chapter by chapter (116). Only published ones.
//   GET /v1/pages/<slug>                 {slug, title, lang, updated_at, words, chars, intro_html, chapters: [{id, title, words, chars}]}
//   GET /v1/pages/<slug>?chapter=<id>    … and chapter: {id, index, title, html, toc, prev, next}
//   GET /v1/pages/<slug>?full=1          … and html, toc: the whole text in one (for the prerendered page)
// Chapters are the text's top-level headings; the heading ids are those of the whole text (rendered in order).
// Images are served beside them by name (as Obsidian embeds them: ![[name]]), cached for a day and revalidated by their
// sha256 (a re-uploaded image of the same name shows at once).
router.get('/pages/:slug', async (req, res) => {
  const { rows: [p] } = await apiPool.query(`SELECT id, slug, title, lang, body_md, updated_at,
      (SELECT jsonb_agg(jsonb_build_object('name', name, 'width', width, 'height', height)) FROM page_images i WHERE i.page_id = p.id) AS images
    FROM pages p WHERE slug = $1 AND published`, [req.params.slug]);
  if (!p) throw notFound(`no page "${req.params.slug}"`);
  const imgs = p.images || [];
  const opts = { imageBase: `${req.protocol}://${req.get('host')}${req.baseUrl}/pages/${p.slug}/images/`,
    known: new Set(imgs.map((i) => i.name)), dims: new Map(imgs.filter((i) => i.width).map((i) => [i.name, i])), seen: new Map(),
    // [[#Heading]] links: to the heading's chapter on the site, wherever it is in the text
    headings: pageHeadings(p.body_md), linkBase: siteAddress(p.slug) };
  const { intro, chapters } = splitChapters(p.body_md);
  const introOut = renderPage(intro.md, opts);
  const rendered = chapters.map((c) => ({ ...c, ...renderPage(c.md, opts) }));
  const ref = (c) => (c ? { id: c.id, title: c.title } : null);
  const out = { slug: p.slug, title: p.title, lang: p.lang, updated_at: p.updated_at, words: words(p.body_md),
    chars: chars(p.body_md), intro_html: introOut.html,
    chapters: rendered.map((c) => ({ id: c.id, title: c.title, words: words(c.md), chars: chars(c.md) })) };
  if (req.query.chapter !== undefined) {
    const i = rendered.findIndex((c) => c.id === String(req.query.chapter));
    if (i < 0) throw notFound(`no chapter "${req.query.chapter}"`);
    const c = rendered[i];
    out.chapter = { id: c.id, index: c.index, title: c.title, html: c.html, toc: c.toc, prev: ref(rendered[i - 1]), next: ref(rendered[i + 1]) };
  }
  if (req.query.full === '1') {
    out.html = introOut.html + rendered.map((c) => c.html).join('\n');
    out.toc = [...introOut.toc, ...rendered.flatMap((c) => c.toc)];
  }
  res.json(out);
});
// GET /v1/stats — the project's numbers (migration 138, src/stats.js): {updated, metrics: {<metric>: {value, series:
// [[day, value], …]}}} — value = the latest day's; the series one value per day (entries.*, content.*, project.*,
// tests.*, documentation.words); small, read as it is, cached five minutes.
router.get('/stats', async (req, res) => {
  const { rows } = await apiPool.query(`SELECT metric, json_agg(json_build_array(to_char(day, 'YYYY-MM-DD'), value::float8) ORDER BY day) AS series,
      max(day)::text AS last FROM site_stats GROUP BY metric ORDER BY metric`);
  const metrics = Object.fromEntries(rows.map((r) => [r.metric, { value: r.series[r.series.length - 1][1], series: r.series }]));
  const updated = rows.reduce((d, r) => (!d || r.last > d ? r.last : d), null);
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ updated, metrics });
});

// GET /v1/stats/vocabulary — every kind of relationship and every provenance option, with how often each is used
// (src/vocabulary.js), for the statistics page: {relationships: [...], names: {roles, kinds}, provenance: {methods, roles, certainty, records,
// status, numbers, currencies}}
router.get('/stats/vocabulary', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await vocabulary(apiPool));
});

// GET /v1/pages/<slug>/search?q=… — the page searched paragraph by paragraph (src/pages.js searchPage): {q, terms, total,
// hits: [{chapter: {id, title, index} | null (introduction), heading: {id, text} | null, passage_html, matches}]}
router.get('/pages/:slug/search', async (req, res) => {
  const { rows: [p] } = await apiPool.query('SELECT body_md FROM pages WHERE slug = $1 AND published', [req.params.slug]);
  if (!p) throw notFound(`no page "${req.params.slug}"`);
  const q = String(req.query.q || '').slice(0, 200);
  res.json({ q, ...searchPage(p.body_md, q) });
});
router.get('/pages/:slug/images/:name', async (req, res) => {
  const { rows: [img] } = await apiPool.query(`SELECT i.content_type, i.bytes, i.sha256 FROM page_images i JOIN pages p ON p.id = i.page_id
    WHERE p.slug = $1 AND p.published AND i.name = $2`, [req.params.slug, req.params.name]);
  if (!img) throw notFound('no such image');
  res.set({ 'Cache-Control': 'public, max-age=86400', ETag: `"${img.sha256}"`, 'Content-Type': img.content_type, 'X-Content-Type-Options': 'nosniff' });
  if (req.get('if-none-match') === `"${img.sha256}"`) return res.status(304).end();
  res.send(img.bytes);
});

// The public changelog and roadmap (118), German (de-CH). Only published entries / items.
//   GET /v1/changelog[?kind=neu|verbessert|behoben|inhalt|technik&topic=<name>&limit=20&offset=0]   (+ topics: those in use, 137)
//       → {total, data: [{id, day, title, items: [{kind, label, html, roadmap: {id, title} | null}]}]}, newest first;
//         with ?kind= only entries with such bullets, and only those bullets
//   GET /v1/changelog/feed.xml   RSS 2.0, the last 30 entries
//   GET /v1/roadmap              → {done_days, columns: [{status, label, items: [{id, title, area, area_color, notes_html, added_on, done_on}]}]}
//                                  done items only for `done_days` after their done date (site_settings, 136)
//                                   (Erledigt: the last 30, newest first)
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch';
// kind and topic (137) filter the bullets — and the entries to those with such bullets
async function changelogEntries({ kind = null, topic = null, limit = 20, offset = 0 } = {}) {
  const { rows } = await apiPool.query(`
    SELECT e.id, e.day::text AS day, e.title, count(*) OVER () AS total,
           (SELECT jsonb_agg(jsonb_build_object('kind', i.kind, 'area', i.area, 'area_color', a.color, 'text', i.text_md, 'roadmap',
                     CASE WHEN r.id IS NOT NULL AND r.published THEN jsonb_build_object('id', r.id, 'title', r.title) END) ORDER BY i.position)
              FROM changelog_items i LEFT JOIN roadmap_items r ON r.id = i.roadmap_item_id LEFT JOIN roadmap_areas a ON a.name = i.area
             WHERE i.entry_id = e.id AND ($1::text IS NULL OR i.kind = $1) AND ($4::text IS NULL OR i.area = $4)) AS items
    FROM changelog_entries e
    WHERE e.published AND (($1::text IS NULL AND $4::text IS NULL) OR EXISTS (SELECT 1 FROM changelog_items i WHERE i.entry_id = e.id
      AND ($1::text IS NULL OR i.kind = $1) AND ($4::text IS NULL OR i.area = $4)))
    ORDER BY e.day DESC, e.id DESC
    LIMIT $2 OFFSET $3`, [kind, limit, offset, topic]);
  const texts = rows.flatMap((r) => (r.items || []).map((i) => i.text));
  const html = await renderItems(apiPool, texts);
  let n = 0;
  return { total: rows.length ? Number(rows[0].total) : 0,
    data: rows.map(({ total, items, ...e }) => ({ ...e, id: Number(e.id),
      items: (items || []).map(({ text, ...i }) => ({ ...i, label: KINDS[i.kind], html: html[n++] })) })) };
}
router.get('/changelog', async (req, res) => {
  const kind = typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : null;
  if (kind && !KINDS[kind]) throw badRequest(`kind is one of ${Object.keys(KINDS).join(', ')}`);
  const topic = typeof req.query.topic === 'string' && req.query.topic.trim() ? req.query.topic.trim() : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  // the topics of published bullets, for the site's chips (name, colour, how many bullets)
  const { rows: topics } = await apiPool.query(`SELECT a.name, a.color, count(*)::int AS n
    FROM changelog_items i JOIN changelog_entries e ON e.id = i.entry_id AND e.published JOIN roadmap_areas a ON a.name = i.area
    GROUP BY a.name, a.color ORDER BY a.name COLLATE sort_natural`);
  res.json({ ...await changelogEntries({ kind, topic, limit, offset }), topics });
});
router.get('/changelog/feed.xml', async (req, res) => {
  const { data } = await changelogEntries({ limit: 30 });
  const x = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const date = (d) => new Date(`${d}T12:00:00Z`).toUTCString();
  const de = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Art History · Changelog</title><link>${SITE_URL}/changelog</link><language>de-CH</language>
<description>Was sich an arthistory.piogino.ch geändert hat.</description>
${data.map((e) => `<item><title>${x(e.title || de.format(new Date(`${e.day}T12:00:00Z`)))}</title><link>${SITE_URL}/changelog#eintrag-${e.id}</link><guid isPermaLink="false">arthistory-changelog-${e.id}</guid><pubDate>${date(e.day)}</pubDate>
<description>${x(`<ul>${e.items.map((i) => `<li><b>${i.label}</b> ${i.html}</li>`).join('')}</ul>`)}</description></item>`).join('\n')}
</channel></rss>`);
});
router.get('/roadmap', async (req, res) => {
  const { rows: [setting] } = await apiPool.query(`SELECT (value #>> '{}')::int AS days FROM site_settings WHERE key = 'roadmap_done_days'`);
  const doneDays = setting ? setting.days : 30;
  const { rows } = await apiPool.query(`
    SELECT r.id, r.title, r.area, a.color AS area_color, r.notes_md, r.status, r.added_on::text AS added_on, r.done_on::text AS done_on, r.position
    FROM roadmap_items r LEFT JOIN roadmap_areas a ON a.name = r.area
    WHERE r.published AND (r.status <> 'erledigt' OR r.done_on >= (now() AT TIME ZONE 'Europe/Zurich')::date - $1::int)
    ORDER BY CASE r.status WHEN 'jetzt' THEN 1 WHEN 'naechstes' THEN 2 WHEN 'spaeter' THEN 3 ELSE 4 END,
             CASE WHEN r.status = 'erledigt' THEN NULL ELSE r.position END, r.done_on DESC NULLS LAST, r.id`, [doneDays]);
  const withNotes = rows.filter((r) => r.notes_md);
  const notes = new Map((await renderItems(apiPool, withNotes.map((r) => r.notes_md))).map((h, i) => [withNotes[i], h]));
  res.json({ done_days: doneDays, columns: Object.entries(STATUS).map(([status, label]) => ({ status, label,
    items: rows.map((r) => ({ ...r, notes_html: notes.get(r) || null })).filter((r) => r.status === status)
      .map(({ status: _s, position: _p, notes_md: _m, ...r }) => ({ ...r, id: Number(r.id) })) })) });
});

// Curated start views (migration 069): published ones, in their order. The query read through
// current_featured_query(), so a view follows renamed and merged entries even before it is saved again.
router.get('/featured', async (req, res) => {
  const { rows } = await apiPool.query(`
    SELECT slug, title, intro_md, current_featured_query(query) AS query
    FROM featured_views WHERE published ORDER BY sort_order, title COLLATE sort_natural, slug`);
  const env = { names: await linkNames(apiPool, rows.map((r) => r.intro_md)), used: new Set(), cited: new Set() };
  res.json({ data: rows.map(({ intro_md: md, ...v }) => ({ ...v, intro_html: md ? renderMarkdown(md, env) : null })) });
});

// Short addresses for long selections on the start map (migration 072): the site stores its query once it gets long
// and shows /?v=<code>. The code comes from the query's hash: the same selection, the same code. The API's role is
// read-only by default (setup-roles.sql); storing opens its transaction READ WRITE — the role may insert only here.
const MAX_QUERY = 20000;
// ip → [timestamps]: at most 60 new links per 10 minutes and address. Addresses are forgotten 10 minutes after their
// last link (the sweep below) — the privacy page says so; nothing else about the visitor is kept.
const RATE_WINDOW = 600000;
const recent = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  list.push(now);
  recent.set(ip, list);
  return list.length > 60;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of recent) if (now - list[list.length - 1] >= RATE_WINDOW) recent.delete(ip);
}, 60000).unref();  // unref: doesn't keep the process (or a test) alive
// The query in one form: the site's own switches out, keys sorted (so the same view gives the same code), values
// limited to what the site writes (slugs, commas, numbers, none / by-artists).
function canonicalQuery(text) {
  const params = new URLSearchParams(String(text || '').trim().replace(/^\?/, ''));
  const parts = [];
  for (const [k, v] of params) {
    if (['v', 'featured', 'all'].includes(k)) continue;
    if (!/^[a-z_]{1,24}$/.test(k) || !/^[a-z0-9,._:-]*$/i.test(v)) throw badRequest(`not a query of the site: "${k}"`);
    parts.push(`${k}=${v}`);
  }
  const q = parts.sort().join('&');
  if (!q) throw badRequest('an empty query needs no short address');
  if (q.length > MAX_QUERY) throw badRequest('query too long');
  return q;
}
router.post('/views', express.text({ type: '*/*', limit: '24kb' }), async (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'too_many', message: 'too many new links — try again in a few minutes' });
  const q = canonicalQuery(req.body);
  const client = await apiPool.connect();
  try {
    await client.query('BEGIN READ WRITE');
    const { rows: [r] } = await client.query('SELECT save_shared_view($1) AS id', [q]);
    await client.query('COMMIT');
    res.status(201).json({ id: r.id, query: q });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});
// Feedback from visitors (migration 141): POST /v1/feedback {kind, message, page_url, page_title, elements, email,
// viewport, website} → 201 {id}. Written through submit_feedback() — the API can't read feedback. `website` is a field
// people don't see: filled in, it was a bot (answered 201 all the same, nothing stored). At most 10 per 10 minutes and
// address; the address is only held in memory, like the short links' (the privacy page says so).
const FEEDBACK_KINDS = ['bug', 'idea', 'content', 'other'];
const feedbackRecent = new Map();
function tooMuchFeedback(ip) {
  const now = Date.now();
  const list = (feedbackRecent.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  list.push(now);
  feedbackRecent.set(ip, list);
  return list.length > 10;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of feedbackRecent) if (now - list[list.length - 1] >= RATE_WINDOW) feedbackRecent.delete(ip);
}, 60000).unref();
const short = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
router.post('/feedback', express.json({ limit: '32kb' }), async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (tooMuchFeedback(req.ip)) return res.status(429).json({ error: 'too_many', message: 'too much feedback at once — try again in a few minutes' });
  if (short(b.website, 10)) return res.status(201).json({ id: null });
  const message = short(b.message, 5000);
  if (!message) throw badRequest('a message is needed');
  const page = short(b.page_url, 2000);
  if (!page.startsWith('/')) throw badRequest('page_url: the path on the site');
  const email = short(b.email, 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('email: an address like name@example.org, or none');
  const elements = (Array.isArray(b.elements) ? b.elements : []).slice(0, 20).map((e) => ({
    label: short(e && e.label, 100), heading: short(e && e.heading, 200), text: short(e && e.text, 300), selector: short(e && e.selector, 500) }));
  const viewport = /^\d{2,5}x\d{2,5}$/.test(String(b.viewport || '')) ? b.viewport : null;
  const client = await apiPool.connect();
  try {
    await client.query('BEGIN READ WRITE');
    const { rows: [r] } = await client.query('SELECT submit_feedback($1, $2, $3, $4, $5, $6, $7) AS id',
      [FEEDBACK_KINDS.includes(b.kind) ? b.kind : 'other', message, page, short(b.page_title, 300), JSON.stringify(elements), email || null, viewport]);
    await client.query('COMMIT');
    res.status(201).json({ id: Number(r.id) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

router.get('/views/:id', async (req, res) => {
  if (!/^[0-9a-f]{8,64}$/.test(req.params.id)) throw notFound('no such view');
  const { rows: [v] } = await apiPool.query('SELECT id, current_featured_query(query) AS query, last_used < current_date AS stale FROM shared_views WHERE id = $1', [req.params.id]);
  if (!v) throw notFound('no such view');
  if (v.stale) {  // remember that it is still used (once a day)
    apiPool.connect().then(async (c) => {
      try { await c.query('BEGIN READ WRITE'); await c.query('UPDATE shared_views SET last_used = current_date WHERE id = $1', [v.id]); await c.query('COMMIT'); } catch { await c.query('ROLLBACK').catch(() => {}); } finally { c.release(); }
    }).catch(() => {});
  }
  res.json({ id: v.id, query: v.query });
});

// An entry by its public number (085), whatever its type: { type, plural, slug, public_id, path } — a merged or
// converted entry's old number answers with the entry it is now (moved: true).
router.get('/entries/:number', async (req, res) => {
  if (!/^\d{1,15}$/.test(req.params.number)) return res.status(404).json({ error: 'not_found', message: 'a public number, e.g. 100586' });
  const { rows: [hit] } = await apiPool.query('SELECT type::text AS type, slug, public_id, moved FROM entry_by_public_id($1)', [req.params.number]);
  if (!hit || !hit.type) return res.status(404).json({ error: 'not_found', message: `no entry no. ${req.params.number}` });
  const plural = Object.keys(ENTITIES).find((k) => ENTITIES[k].type === hit.type);
  res.json({ type: hit.type, plural, slug: hit.slug, public_id: Number(hit.public_id), path: `/${plural}/${hit.public_id}/${hit.slug}`, moved: hit.moved });
});

// Provenance numbers (077): which artworks' provenance records this number (a lot, ERR, Munich, Linz, "Entartete
// Kunst" … and, 104, the inventory numbers of the steps' records) — exact matches only, any kind, or ?kind=munich.
router.get('/provenance-numbers', async (req, res) => {
  const number = typeof req.query.number === 'string' ? req.query.number.trim().slice(0, 60) : '';
  if (!number) return res.json({ data: [] });
  const kind = typeof req.query.kind === 'string' && /^[a-z_]+$/.test(req.query.kind) ? req.query.kind : null;
  // ?of=n<id> (a step's number) / r<id> (a record's number): only that number's series — the step or record and those
  // sharing it within its reach (113) — not every "244" of every inventory
  const of = /^([nr])(\d{1,15})$/.exec(String(req.query.of || ''));
  const { rows } = await apiPool.query(`
    SELECT n.kind, k.label AS kind_label, n.number, jsonb_build_object('slug', w.slug, 'title', w.title) AS artwork,
           pp."position", pp.owner_name, range_json(pp.period, pp.period_label) AS period,
           n.certainty, n.date_label AS recorded, n.document               -- 104: an inventory number of a record
    FROM provenance_numbers_all n JOIN provenance_number_kinds k ON k.code = n.kind
    JOIN provenance_periods pp ON pp.id = n.provenance_id JOIN artworks w ON w.id = pp.artwork_id
    WHERE lower(n.number) = lower($1) AND ($2::text IS NULL OR n.kind = $2)
      AND ($3::text IS NULL OR ($3 = 'n' AND n.record_id IS NULL AND n.provenance_id IN (
             SELECT provenance_id FROM provenance_numbers WHERE id = $4 UNION SELECT provenance_id FROM provenance_number_peers($4)))
        OR ($3 = 'r' AND n.record_id IN (SELECT $4 UNION SELECT record_id FROM provenance_record_peers($4))))
    ORDER BY k.position, w.title COLLATE sort_natural`, [number, kind, of ? of[1] : null, of ? of[2] : null]);
  res.json({ data: rows });
});

// Patrons became people (migration 024): old URLs keep working — /v1/patrons…, /v1/map/patrons/…, /v1/graph/patrons/…
router.use((req, res, next) => {
  const m = /^(\/(?:map\/|graph\/)?)patrons(\/.*)?$/.exec(req.path);
  if (!m) return next();
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  return res.redirect(301, `${req.baseUrl}${m[1]}people${m[2] || ''}${query}`);
});

router.use('/map', map);
router.use('/graph', graph);
router.use('/network', network);
router.use('/periods', periods);
router.use('/thumb', thumbs.router);  // small WebPs of museum-hosted images (thumbs.js)
router.use('/history', history);
router.use(entities);

module.exports = router;
