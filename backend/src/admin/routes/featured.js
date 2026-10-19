// Admin panel — curated start views (migration 069): the views of the start map the public home page offers. A view
// is a URL query of the site: open the site, choose artists, window …, copy the address, paste it here. The query is
// checked (view featured_view_problems: keys, years, slugs) and follows renamed entries (the database does that).
// Mounted by src/admin/index.js before the entry pages (/featured is not a /:plural).
const express = require('express');
const { adminPool } = require('../../db');
const { html } = require('../html');
const { send, withTx, notFoundPage, friendly } = require('../core');

const router = express.Router();
const SITE = process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch';
const ENTITY_KEYS = ['artists', 'artworks', 'movements', 'polities', 'people'];

// A pasted address (or just its query) → the query as the site reads it, in a readable form: commas unencoded
// (URLSearchParams writes %2C), "patrons" as "people" (the site's old name), the site's own switches
// (featured, all) left out. Unknown keys stay — the check names them.
function normalizeQuery(input) {
  let text = String(input || '').trim();
  if (!text) return '';
  try { if (/^https?:\/\//i.test(text)) text = new URL(text).search; } catch { /* not an address: a query */ }
  const params = new URLSearchParams(text.replace(/^\?/, '').replace(/#.*$/, ''));
  const parts = [];
  for (const [k, v] of params) {
    const key = k === 'patrons' ? 'people' : k;
    if (['featured', 'all'].includes(key)) continue;
    const value = ENTITY_KEYS.includes(key) ? v.split(',').map((s) => s.trim()).filter(Boolean).join(',') : v.trim();
    parts.push(`${key}=${value}`);
  }
  return parts.join('&');
}

const slugify = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

async function problemsOf(db, id) {
  return (await db.query('SELECT problem FROM featured_view_problems WHERE id = $1', [id])).rows.map((r) => r.problem);
}
const preview = (query) => `${SITE}/?${query}`;
// The view as readers see it: a published one under its own address (the switcher shows it chosen, its intro above the
// map); the bare query would be the reader's own selection — the map only. A draft is not in /v1/featured yet.
const siteLink = (v) => (v.published ? `${SITE}/?featured=${encodeURIComponent(v.slug)}` : preview(v.query));

function form({ action, v = {}, problems = [], submit }) {
  const val = (k) => v[k] ?? '';
  return html`<form method="post" action="${action}" class="form featured-form">
    <div class="field"><label for="fv-url">Address of the view</label>
      <input id="fv-url" name="url" value="${val('query') ? preview(val('query')) : val('url')}" required
        placeholder="${SITE}/?artists=vincent-van-gogh,paul-gauguin&amp;from=1886&amp;to=1890">
      <div class="hint">Open the site, choose what the map shows (artists, works, the time window …), copy the address from
        the browser and paste it here — or just the part after “?”. Only what the start map reads counts:
        ${ENTITY_KEYS.join(', ')}, from, to.</div></div>
    ${problems.length ? html`<div class="flash error featured-problems"><b>To fix before publishing:</b><ul>${problems.map((p) => html`<li>${p}</li>`)}</ul></div>` : ''}
    ${val('query') ? html`<p class="small"><a href="${siteLink(v)}" target="_blank" rel="noopener">${v.published ? 'View on the site ↗' : 'Preview the map on the site ↗'}</a>${v.published ? '' : html` <span class="muted">(the title and introduction show once it is published)</span>`}
      <span class="muted">· stored: <code>${val('query')}</code></span></p>` : ''}
    <div class="field-pair"><div class="field"><label for="fv-title">Title</label><input id="fv-title" name="title" value="${val('title')}" required placeholder="e.g. Van Gogh and Gauguin in Arles"></div>
      <div class="field"><label for="fv-slug">Slug</label><input id="fv-slug" name="slug" value="${val('slug')}" placeholder="from the title" pattern="[a-z0-9]+(-[a-z0-9]+)*"
          autocapitalize="none" spellcheck="false" data-slug-field${action === '/featured' ? html` data-slug-from="fv-title"` : ''}>
        <div class="hint">The view's address on the site: /?featured=<i>slug</i> (the first view is the home page itself).</div></div></div>
    <div class="field"><label for="fv-intro">Introduction</label>
      <textarea id="fv-intro" name="intro_md" class="md" rows="6">${val('intro_md')}</textarea>
      <div class="hint">Markdown; [[type/slug]] links like in every text. Shown above the map.</div></div>
    <div class="field-pair"><div class="field"><label for="fv-order">Position</label><input id="fv-order" name="sort_order" type="number" value="${val('sort_order') === '' ? 0 : val('sort_order')}">
        <div class="hint">Lower first (or drag in the list). The first published view is the home page.</div></div>
      <div class="field"><label class="choice"><input type="checkbox" name="published" value="1"${v.published ? ' checked' : ''}> Published</label>
        <div class="hint">Only a view without problems can be published.</div></div></div>
    <div class="actions"><button>${submit}</button> <a class="button secondary" href="/featured">Cancel</a></div></form>`;
}

// form body → row values (throws a message for the form)
function fromBody(body) {
  const query = normalizeQuery(body.url);
  if (!query) throw new Error('Paste the address of a view of the site.');
  const title = String(body.title || '').trim();
  if (!title) throw new Error('Give the view a title.');
  const slug = String(body.slug || '').trim() || slugify(title);
  return { slug, title, query, intro_md: String(body.intro_md || '').trim() || null,
    sort_order: Number.parseInt(body.sort_order, 10) || 0, published: body.published === '1' };
}

// Save, then check (the checks are the database's view): problems → the view is kept unpublished and the form shows them.
async function save(user, id, values) {
  return withTx(user, async (db) => {
    const { rows: [row] } = id
      ? await db.query(`UPDATE featured_views SET slug = $2, title = $3, query = $4, intro_md = $5, sort_order = $6, published = $7
          WHERE id = $1 RETURNING *`, [id, values.slug, values.title, values.query, values.intro_md, values.sort_order, values.published])
      : await db.query(`INSERT INTO featured_views (slug, title, query, intro_md, sort_order, published) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *`, [values.slug, values.title, values.query, values.intro_md, values.sort_order, values.published]);
    const problems = await problemsOf(db, row.id);
    if (problems.length && row.published) await db.query('UPDATE featured_views SET published = false WHERE id = $1', [row.id]);
    return { row: { ...row, published: row.published && !problems.length }, problems };
  });
}
const saveError = (err) => (err.constraint === 'featured_views_slug_key' ? 'This slug is taken by another view.'
  : err.constraint === 'featured_views_slug_check' ? 'Slug: lowercase letters, digits and hyphens.' : err.message && !err.code ? err.message : friendly(err));

router.get('/featured', async (req, res) => {
  const { rows } = await adminPool.query(`
    SELECT f.*, (SELECT count(*)::int FROM featured_view_problems p WHERE p.id = f.id) AS problems
    FROM featured_views f ORDER BY f.sort_order, f.title COLLATE sort_natural, f.slug`);
  const firstPublished = rows.find((r) => r.published);
  send(req, res, { title: 'Start views', body: html`<h1>Start views</h1>
    <p class="muted">The curated views of the map on the public home page: the first published one is the home page, the others
      are offered beside it (/?featured=<i>slug</i>); “Explore everything” stays one click away.</p>
    <p class="actions"><a class="button" href="/featured/new">+ New view</a></p>
    ${rows.length ? html`<div class="table-wrap"><table data-sortable="/featured/order"><thead><tr><th></th><th>Title</th><th>Slug</th><th>Status</th><th></th></tr></thead>
      ${rows.map((r) => html`<tbody class="sort-item" data-sort-id="${r.id}"><tr>
        <td class="drag-cell">${rows.length > 1 ? html`<button type="button" class="drag-handle" title="Drag to reorder (or focus and use ↑ ↓)" aria-label="Move ${r.title}">⠿</button>` : ''}</td>
        <td><a href="/featured/${r.slug}/edit">${r.title}</a>${r === firstPublished ? html` <span class="tag ok">home page</span>` : ''}</td>
        <td class="muted">${r.slug}</td>
        <td>${r.published ? 'published' : html`<span class="muted">draft</span>`}${r.problems ? html` <span class="tag flagged">${r.problems} problem${r.problems === 1 ? '' : 's'}</span>` : ''}</td>
        <td><a href="${siteLink(r)}" target="_blank" rel="noopener">${r.published ? 'view' : 'preview'} ↗</a></td></tr></tbody>`)}
    </table></div>` : html`<p class="muted">No views yet — the home page shows everything.</p>`}` });
});

// drag order (editor/sortable.js): ids in the new order → sort_order 10, 20, 30 … (gaps for a typed position)
router.post('/featured/order', async (req, res) => {
  const ids = String(req.body.ids || '').split(',').filter((x) => /^\d+$/.test(x));
  await withTx(req.user, (db) => db.query(`UPDATE featured_views f SET sort_order = o.n * 10
    FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n) WHERE f.id = o.id`, [ids]));
  res.status(204).end();
});

router.get('/featured/new', (req, res) => {
  send(req, res, { title: 'New start view', body: html`<p class="muted"><a href="/featured">← Start views</a></p><h1>New start view</h1>
    ${form({ action: '/featured', submit: 'Create' })}` });
});

router.post('/featured', async (req, res) => {
  let result;
  try {
    result = await save(req.user, null, fromBody(req.body));
  } catch (err) {
    return send(req, res, { title: 'New start view', status: 422, flash: { kind: 'error', text: saveError(err) },
      body: html`<p class="muted"><a href="/featured">← Start views</a></p><h1>New start view</h1>${form({ action: '/featured', v: { ...req.body }, submit: 'Create' })}` });
  }
  res.redirect(303, `/featured/${result.row.slug}/edit?done=${result.problems.length ? 'featured-problems' : 'created'}`);
});

async function bySlug(slug) {
  return (await adminPool.query('SELECT * FROM featured_views WHERE slug = $1', [slug])).rows[0] || null;
}

router.get('/featured/:slug/edit', async (req, res) => {
  const v = await bySlug(req.params.slug);
  if (!v) return notFoundPage(req, res);
  send(req, res, { title: `Edit ${v.title}`, body: html`<p class="muted"><a href="/featured">← Start views</a></p><h1>${v.title}</h1>
    ${form({ action: `/featured/${v.slug}`, v, problems: await problemsOf(adminPool, v.id), submit: 'Save' })}
    <form method="post" action="/featured/${v.slug}/delete" class="actions" style="margin-top:1.5rem"><button class="danger">Delete this view</button></form>` });
});

router.post('/featured/:slug', async (req, res) => {
  const v = await bySlug(req.params.slug);
  if (!v) return notFoundPage(req, res);
  let result;
  try {
    result = await save(req.user, v.id, fromBody(req.body));
  } catch (err) {
    return send(req, res, { title: `Edit ${v.title}`, status: 422, flash: { kind: 'error', text: saveError(err) },
      body: html`<p class="muted"><a href="/featured">← Start views</a></p><h1>${v.title}</h1>${form({ action: `/featured/${v.slug}`, v: { ...v, ...req.body, query: '' }, submit: 'Save' })}` });
  }
  res.redirect(303, `/featured/${result.row.slug}/edit?done=${result.problems.length ? 'featured-problems' : 'saved'}`);
});

router.post('/featured/:slug/delete', async (req, res) => {
  const v = await bySlug(req.params.slug);
  if (!v) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM featured_views WHERE id = $1', [v.id]));
  res.redirect(303, '/featured?done=deleted');
});

module.exports = router;
module.exports.normalizeQuery = normalizeQuery;
