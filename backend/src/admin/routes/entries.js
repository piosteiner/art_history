// Admin panel — Entries: list, new, create, view, edit, save — relationships, images, provenance and parts added on the page.
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { keyExpr, sortKey } = require('../../sortkey');
const { adminPool } = require('../../db');
const { BY_TYPE, SLUG, REF_COLUMNS, toRow, readRelationships, readImages } = require('../../content');
const autocreate = require('../autocreate');
const names = require('../../names');
const dimensionsLib = require('../../dimensions');
const { parseFuzzyDate } = require('../../fuzzy-date');
const { renderMarkdown, linkNames } = require('../../markdown');
const { html, raw } = require('../html');
const drafts = require('../drafts');
const wikidata = require('../wikidata');
const quality = require('../quality');
const duplicates = require('../duplicates');
const crypto = require('crypto');
const images = require('../images');
const provenance = require('../provenance');
const numbers = require('../numbers');
const citations = require('../citations');
const identifiers = require('../identifiers');
const imagesearch = require('../imagesearch');
const placefinder = require('../placefinder');
const bibliography = require('../../bibliography');
const { thumbUrl } = require('../images');
const collab = require('../collab');
const { THRESHOLD, likeParam, scoreSql, altSql } = require('../match');
const { docToForm, formToDoc, entityForm, humanize, fieldLabel } = require('../forms');
const { PAGE, an, send, draftBanner, unpublishedBanner, unpublishedFields, restoredBanner, withTx, UserError, RULES, friendly, pager, pageParam, relationshipTypes, allEntities, relFromForm, relForm, anOf, typeWarning, CONVERTIBLE, stepFromBody, notFoundPage, formContext, findEntity, pluralParam } = require('../core');

const router = express.Router();
router.param('plural', pluralParam);

// ---------------------------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------------------------
// Patrons became people (migration 024): old admin links keep working.
router.get(/^\/patrons(\/.*)?$/, (req, res) => res.redirect(301, req.originalUrl.replace(/^\/patrons/, '/people')));

router.get('/:plural', async (req, res) => {
  const { t } = req;
  const q = String(req.query.q || '').trim();
  const page = pageParam(req);
  // With a query: typo-tolerant match on name, alternative names and slug, best first (src/admin/match.js).
  // Artworks also by their creators (main and co-creators, the same fuzzy match on the artist's names): the works
  // whose title matches come first, best first, then the other works of a matching artist in A–Z order.
  const params = q ? [q, likeParam(q)] : [];
  const score = q ? `greatest(${scoreSql(`t.${t.name}`, altSql(t, 't'))}, CASE WHEN t.slug ILIKE '%' || $2 || '%' THEN 1.0 ELSE 0 END)` : 'NULL';
  const byCreator = t.type === 'artwork';
  const creatorScore = q && byCreator ? `(SELECT max(${scoreSql('a.name', altSql(BY_TYPE.artist, 'a'))}) FROM artists a
      WHERE a.id = t.creator_id OR a.id IN (SELECT r.object_id FROM relationships r WHERE r.relationship_type = 'co_creator'
                                            AND r.subject_type = 'artwork' AND r.subject_id = t.id))` : 'NULL::numeric';
  const { rows } = await adminPool.query(`
    SELECT * FROM (
      SELECT t.slug, t.${t.name} AS name, t.updated_at, ${altSql(t, 't') || 'NULL'} AS alt, ${score} AS score, ${creatorScore} AS creator_score,
             ${byCreator ? `(SELECT string_agg(c ->> 'name', ', ') FROM jsonb_array_elements(artwork_creators(t.id)) c)` : 'NULL'} AS creators,
             ${keyExpr(t.type, 't', t.name)} AS sort_key,
             ${t.imageFk ? `(SELECT i.url FROM images i WHERE i.${t.imageFk} = t.id ORDER BY i.position, i.id LIMIT 1)` : 'NULL'} AS image_url,
             EXISTS (SELECT 1 FROM auto_created ac WHERE ac.entity_type = $${params.length + 1}::entity_type AND ac.entity_id = t.id) AS to_complete,
             ${t.type === 'source' ? 't.reading_status::text' : 'NULL'} AS status,
             (SELECT count(*)::int FROM relationships r WHERE (r.subject_type, r.subject_id) = ($${params.length + 1}::entity_type, t.id)
                                                           OR (r.object_type, r.object_id) = ($${params.length + 1}::entity_type, t.id)) AS rels
      FROM ${t.table} t) x
    ${q ? `WHERE score >= ${THRESHOLD} OR creator_score >= ${THRESHOLD}
           ORDER BY score >= ${THRESHOLD} DESC, CASE WHEN score >= ${THRESHOLD} THEN score END DESC NULLS LAST, sort_key COLLATE sort_natural`
      : 'ORDER BY sort_key COLLATE sort_natural'}
    LIMIT ${PAGE + 1} OFFSET ${(page - 1) * PAGE}`, [...params, t.type]);
  // the bibliography: short references and how much has been read
  const sources = t.type === 'source' ? await bibliography.loadCatalogue(adminPool) : null;
  const stats = sources ? (await adminPool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE reading_status = 'read')::int AS read, count(*) FILTER (WHERE reading_status = 'reading')::int AS reading,
      count(*) FILTER (WHERE reading_status = 'to_read')::int AS to_read FROM bibliography`)).rows[0] : null;
  send(req, res, {
    title: humanize(t.folder),
    body: html`<h1>${humanize(t.folder)}</h1>
      ${stats ? html`<p class="muted">${stats.total} sources — <b>${stats.read}</b> read · ${stats.reading} reading · ${stats.to_read} to read</p>` : ''}
      <form class="bar" method="get" data-live><input name="q" value="${q}" placeholder="${byCreator ? 'Search title, other titles, slug or artist (typos are fine)' : 'Search name, other names or slug (typos are fine)'}" class="grow" type="search" autocomplete="off">
        <button class="secondary">Search</button><a class="button" href="/${t.folder}/new">+ New ${t.type}</a>
        <a class="button secondary" href="/${t.folder}/new/wikidata">+ from Wikidata…</a>
        ${t.type === 'place' ? html`<a class="button secondary" href="/places/new/find">+ find a place…</a>` : ''}</form>
      <div data-live-results="list">${rows.length ? html`<div class="table-wrap"><table${t.imageFk ? html` class="with-thumbs thumbs-${t.type}"` : ''}><thead><tr>${t.imageFk ? html`<th></th>` : ''}<th>Name</th><th>Slug</th><th>Links</th><th>Updated</th></tr></thead><tbody>
        ${rows.slice(0, PAGE).map((r, i, shown) => html`${q && r.score < THRESHOLD && (i === 0 || shown[i - 1].score >= THRESHOLD)
          ? html`<tr class="list-group"><td colspan="${t.imageFk ? 5 : 4}">Works by a matching artist</td></tr>` : ''}<tr>${t.imageFk ? html`<td class="thumb">${r.image_url
          ? html`<a href="/${t.folder}/${r.slug}" tabindex="-1"><img src="${thumbUrl(r.image_url, 120)}" alt="" loading="lazy" decoding="async"></a>`
          : html`<span class="thumb-empty" title="no image"></span>`}</td>` : ''}<td><a href="/${t.folder}/${r.slug}">${r.name}</a>${r.to_complete ? html` <span class="tag warn" title="created automatically — fill in the details">to complete</span>` : ''}
          ${sources && sources.get(r.slug) ? html`<div class="small">${sources.get(r.slug).siglum}${r.status ? html` <span class="tag">${r.status.replace('_', ' ')}</span>` : ''}</div>` : ''}
          ${r.creators ? html`<div class="muted small">${r.creators}</div>` : ''}
          ${!/[A-Za-zÀ-ɏ]/.test(r.name) && r.sort_key !== r.name ? html`<div class="muted small">${r.sort_key}</div>` : q && r.alt ? html`<div class="muted small">${r.alt}</div>` : ''}</td><td class="muted">${r.slug}</td>
          <td>${r.rels}</td><td class="muted">${r.updated_at.toISOString().slice(0, 10)}</td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">Nothing found.</p>`}
      ${pager(`/${t.folder}${q ? `?q=${encodeURIComponent(q)}` : ''}`, page, rows.length > PAGE)}</div>`,
  });
});

// A new part of a series / album …: "+ New part" links to /artworks/new?part_of=<slug> — prefilled with the whole and
// its creator (the part may still differ).
async function newDocFrom(t, query) {
  if (t.type !== 'artwork' || !SLUG.test(String(query.part_of || ''))) return {};
  const w = await findEntity(t, String(query.part_of));
  return w ? { parent: w.slug, ...(w.doc.creator ? { creator: w.doc.creator } : {}) } : {};
}

router.get('/:plural/new', async (req, res) => {
  const { t } = req;
  const draft = await drafts.getDraft(adminPool, req.user.id, t.type, null);
  const useDraft = draft && req.query.draft === '1';
  const changed = draft ? Object.keys(draft.form).filter((k) => k.startsWith('f.') && draft.form[k].trim()).map((k) => humanize(k.slice(2).replace(/_(lon|lat|label)$/, ''))) : [];
  send(req, res, {
    title: `New ${t.type}`,
    page: { type: t.type, slug: null, mode: 'new' },
    body: html`<h1>New ${t.type}</h1>
      ${t.type === 'source' ? html`<form method="get" action="/bibliography/new/lookup" class="bar" id="lookup">
        <input name="id" class="grow" placeholder="ISBN or DOI — fills in the form (Open Library, Crossref)" aria-label="ISBN or DOI" required>
        <button class="secondary">Fill in</button></form>` : ''}
      ${useDraft ? restoredBanner({ draft, rb: { stale: false, merged: [], conflicts: [] }, t })
        : draftBanner({ draft, changed: [...new Set(changed)], restoreUrl: `/${t.folder}/new?draft=1`, t })}
      ${entityForm({ t, slug: useDraft ? draft.form.slug || '' : '', f: useDraft ? formFromBody(draft.form) : docToForm(await newDocFrom(t, req.query), t.fields),
        ctx: await formContext(t), action: `/${t.folder}`, errors: [], isNew: true,
        pendingImages: useDraft ? draft.form['wd.images'] : null, pendingCites: useDraft ? draft.form['wd.cite'] : null,
        pendingIds: useDraft ? draft.form['wd.ids'] : null })}`,
  });
});

// Throw away this user's draft for an entry (or for a new one of this type), then back to the form.
router.post('/drafts/discard', async (req, res) => {
  const t = BY_TYPE[req.body.type];
  if (!t) return notFoundPage(req, res);
  const slug = String(req.body.slug || '');
  const e = slug ? await findEntity(t, slug) : null;
  await drafts.deleteDraft(adminPool, req.user.id, t.type, e ? e.id : null);
  res.redirect(303, e ? `/${t.folder}/${e.slug}/edit` : `/${t.folder}/new`);
});

// Shared by create and update: validate, resolve slugs to ids, write. Returns the (possibly new) slug.
// A new entry is compared with the existing ones right after its INSERT, in the same transaction (duplicates.js,
// migration 044): likely duplicates roll it back and ask. probe: the same path for the live box while typing — no
// creating of other entries, no city lookup, unknown references left out, and always rolled back → { probe: [...] }.
// A word that can be a term: short, no list or phrase (commas, "on", "and", "auf", "und" …)
const termLike = (v) => /^[^,;/()]{1,40}$/.test(v) && v.trim().split(/\s+/).length <= 4 && !/\b(on|and|with|over|auf|und|mit|über)\b/i.test(v);
async function newTerms(db, doc) {
  const wanted = [[doc.kind, 'object type', "kind_categories()"], ...(doc.materials || []).map((m) => [m, 'material', "ARRAY['material']::term_category[]"])];
  const creates = [];
  for (const [value, category, cats] of wanted) {
    const v = String(value || '').trim();
    if (!v || !termLike(v) || creates.some((c) => c.name.toLowerCase() === v.toLowerCase() && c.extra.category === category)) continue;
    if ((await db.query(`SELECT term_by_name($1, ${cats}) AS id`, [v])).rows[0].id) continue;
    creates.push({ key: `term:${v}`, type: 'term', name: v, extra: { category } });
  }
  await autocreate.create(db, creates);  // the artwork's own save then links them (trigger artworks_link_terms)
  return creates;
}

async function saveEntity(user, t, body, existing, { probe = false } = {}) {
  const slug = probe ? `dup-probe-${crypto.randomBytes(6).toString('hex')}` : String(body.slug || '').trim();
  const { doc, errors } = formToDoc(body, t.fields);
  if (!SLUG.test(slug)) errors.push('slug: lowercase letters, digits and single hyphens only');
  if (!doc[t.name]) errors.push(`${t.name}: required`);
  // A creator / institution typed as a new name becomes a new (flagged) entry — src/admin/autocreate.js
  const auto = probe ? { creates: [], errors: [], confirm: {} } : await autocreate.resolveRefs(adminPool, t, doc, body);
  errors.push(...auto.errors);
  // The city of an exact location, so it needn't be entered by hand (placefinder.cityAt): an institution with a point
  // but no place gets its city; a work that doesn't move gets "created in" that city. Ours if we have it, else created.
  const city = errors.length || probe ? null : await cityFor(t, doc, existing);
  if (city && city.slug && t.type === 'institution') doc.place = city.slug;
  const row = toRow(doc, t.fields);
  errors.push(...row.errors);
  if (probe && errors.length) return { probe: [] };  // half-typed (a date like "18…"): nothing to compare yet
  if (errors.length) return { errors, confirm: auto.confirm };
  // a new entry with a Wikidata item of another kind (a human as an institution, 055): asked once — "type.ok" confirms
  if (!existing && !probe && doc.wikidata_id && body['type.ok'] !== '1') {
    const types = await wikidata.typesOf(doc.wikidata_id).catch(() => null);
    if (types && !types.includes(t.type)) {
      return { errors: [`Wikidata says ${doc.wikidata_id} is ${types.filter((x) => BY_TYPE[x]).map(anOf).join(' or ')}, not ${anOf(t.type)} — see the box above the form.`],
        typeCheck: { qid: doc.wikidata_id, types } };
    }
  }

  let created = [];
  try {
    await withTx(user, async (db) => {
      const idOf = async (type, s) => (await db.query('SELECT entity_id($1, $2) AS id', [type, s])).rows[0].id;
      const newSlugs = await autocreate.create(db, auto.creates);
      for (const [key, s] of newSlugs) {
        if (key === 'parent') row.parent = s; else row.refs.find((r) => r.col === REF_COLUMNS[key]).slug = s;
      }
      created = auto.creates;
      if (t.fields.parent) {
        const id = row.parent === null ? null : await idOf(t.type, row.parent);
        if (row.parent !== null && id === null && !probe) throw new UserError(`parent ${t.type} "${row.parent}" does not exist.`);
        if (existing && id === existing.id) throw new UserError('An entity cannot be its own parent.');
        row.cols.parent_id = ['$', id];
      }
      // An artwork's type or material typed as a new word becomes a glossary term (071; translations then on its page,
      // so it is flagged "to complete"). Only single terms: a phrase ("oil paint on canvas", "Pastell, Papier") stays
      // as typed and is sorted out on /quality/batch/terms.
      if (t.type === 'artwork' && !probe) created = [...created, ...await newTerms(db, doc)];
      if (city && city.draft) {  // a new city (and its region, from Natural Earth, if we don't have that either)
        const parentSlugs = await autocreate.create(db, city.creates);
        if (parentSlugs.has('parent')) city.doc.parent = parentSlugs.get('parent');
        city.slug = await wikidata.createEntry(db, 'place', city.doc, null, user.id, city.doc.wikidata_id || null, false);
        city.created = 1 + city.creates.length;
        if (t.type === 'institution') row.refs.find((r) => r.col === 'place_id').slug = city.slug;
      }
      for (const r of row.refs) {
        const id = r.slug === null ? null : await idOf(r.type, r.slug);
        if (r.slug !== null && id === null && !probe) throw new UserError(`${r.type} "${r.slug}" does not exist.`);
        row.cols[r.col] = ['$', id];
      }
      const names = Object.keys(row.cols);
      const values = [slug];
      const exprs = names.map((c) => { values.push(row.cols[c][1]); return row.cols[c][0].replace('$', () => `$${values.length}`); });
      // an artwork that doesn't move: "created in" its city, dated like the work (unless it has a place of creation)
      const createdIn = async (id) => {
        if (!city || !city.slug || t.type !== 'artwork') return;
        await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label)
          SELECT 'artwork', w.id, 'created_in', 'place', entity_id('place', $2), w.created, w.created_label FROM artworks w
          WHERE w.id = $1 AND NOT EXISTS (SELECT 1 FROM relationships r WHERE r.subject_type = 'artwork' AND r.subject_id = w.id
                                           AND r.relationship_type = 'created_in' AND r.object_type = 'place')`, [id, city.slug]);
      };
      if (!existing) {
        const { rows } = await db.query(`INSERT INTO ${t.table} (slug, ${names.join(', ')}) VALUES ($1, ${exprs.join(', ')}) RETURNING id`, values);
        await duplicates.checkNew(db, t, rows[0].id, body, user.id, { probe });
        await citations.settle(db, t.type, rows[0].id, body, user.id);
        // reference records picked in the Wikidata review of this new entry (wd.ids, 053) — a number another entry
        // has already makes this a certain duplicate (unique violation → duplicates.fromUniqueViolation)
        let pendingIds = [];
        try { pendingIds = JSON.parse(String(body['wd.ids'] || '[]')); } catch { pendingIds = []; }
        for (const x of Array.isArray(pendingIds) ? pendingIds.slice(0, 10) : []) {
          if (x && typeof x.authority === 'string' && typeof x.value === 'string') {
            await db.query('INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ($1, $2, $3, $4)', [t.type, rows[0].id, x.authority, x.value]);
          }
        }
        await createdIn(rows[0].id);
        // images picked in the Wikidata review of this new entry (wd.images): saved together with it
        for (const img of pendingImagesOf(t, body)) await images.add(db, t.type, rows[0].id, img);
        for (const c of created) await autocreate.flag(db, c.type, c.id, { type: t.type, id: rows[0].id }, user.id);
        return;
      }
      for (const c of created) await autocreate.flag(db, c.type, c.id, { type: t.type, id: existing.id }, user.id);
      await autocreate.unflag(db, t.type, existing.id);  // published by someone: no longer "to complete"
      // Optimistic locking: only if nobody saved this row since the form was opened.
      values.push(existing.id, String(body.version || ''));
      const { rowCount } = await db.query(`
        UPDATE ${t.table} SET slug = $1, ${names.map((c, i) => `${c} = ${exprs[i]}`).join(', ')}
        WHERE id = $${values.length - 1} AND updated_at::text = $${values.length}`, values);
      if (!rowCount) throw new UserError('Someone saved this record while you were editing. Open it again to see their changes, then redo yours.');
      await citations.settle(db, t.type, existing.id, body, user.id);
      await createdIn(existing.id);
    });
  } catch (err) {
    if (err instanceof duplicates.Probe) return { probe: err.candidates };
    if (err instanceof duplicates.Found) {
      return { errors: ['This may already exist — see the box above the form.'], duplicates: err.candidates };
    }
    // the same Wikidata item, inventory number or outline: certainly the same → shown like a duplicate
    const same = !existing && await duplicates.fromUniqueViolation(adminPool, t, err, doc).catch(() => null);
    if (probe) return { probe: same ? [same] : [] };
    if (same) return { errors: ['This already exists — see the box above the form.'], duplicates: [same] };
    return { errors: [friendly(err)] };
  }
  return { slug, created, city: city && city.slug ? { created: city.created || 0 } : null };
}

// Does this save need a city looked up, and which one? (see saveEntity) → null | { slug } | { draft …, doc, creates }
// Lookup failures (no network, open sea) only mean no city: the save goes on, the quality hint stays.
async function cityFor(t, doc, existing) {
  let at = null;
  // an institution's place is its city: none given, or only a country / region ("Norway" for the Munch Museum) →
  // the city at its point, which is created inside that country if we don't have it (Oslo → Norway)
  if (t.type === 'institution' && doc.location && (!doc.place
      || (await adminPool.query(`SELECT 1 FROM places WHERE slug = $1 AND kind IN ('country', 'region')`, [doc.place])).rows.length)) {
    at = doc.location;
  }
  if (t.type === 'artwork' && (doc.location || doc.area)) {
    const before = existing ? existing.doc : {};
    const moved = JSON.stringify([doc.location, doc.area]) !== JSON.stringify([before.location, before.area]);
    const hasPlace = existing && (await adminPool.query(`SELECT 1 FROM relationships WHERE subject_type = 'artwork' AND subject_id = $1
      AND relationship_type = 'created_in' AND object_type = 'place'`, [existing.id])).rows.length;
    if (moved && !hasPlace) {
      at = doc.location || (await adminPool.query(`SELECT array[ST_X(p), ST_Y(p)] AS xy
        FROM (SELECT ST_PointOnSurface(ST_GeomFromGeoJSON($1)) AS p) x`, [JSON.stringify(doc.area)])).rows[0].xy;
    }
  }
  if (!at) return null;
  let city;
  try { city = await placefinder.cityAt(adminPool, at, wikidata.coordsOf, wikidata.slugify); } catch { return null; }
  if (!city || city.slug) return city;
  // a new place: the place finder's draft as a doc; a parent region we don't have yet comes from Natural Earth
  const placeT = BY_TYPE.place;
  const { doc: placeDoc, errors } = formToDoc(city.draft.form, placeT.fields);
  if (errors.length) return null;
  const parent = await autocreate.resolveRefs(adminPool, placeT, placeDoc, {});
  if (parent.errors.length) delete placeDoc.parent;
  return { draft: city.draft, doc: placeDoc, creates: parent.errors.length ? [] : parent.creates };
}

// wd.images (JSON from the Wikidata review of a new entry) → value lists for images.add(); checked like the form.
function pendingImagesOf(t, body) {
  if (!t.imageFk || !body['wd.images']) return [];
  let list;
  try { list = JSON.parse(String(body['wd.images'])); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).flatMap((img) => {
    try { return [images.fromForm({ url: img.url, source_url: img.source_url, license: img.license, credit: img.credit })]; } catch { return []; }
  });
}

// Re-show a rejected form with exactly what was typed.
function formFromBody(body) {
  const f = {};
  for (const [k, v] of Object.entries(body)) if (k.startsWith('f.')) f[k.slice(2)] = v;
  return f;
}
// The fields a message is about: "birth: bad month" names its field; a database rule's message (RULES) doesn't — so
// which fields each rule concerns is said here, and those fields are marked in red too.
const RULE_FIELDS = {
  places_check: ['location', 'area', 'boundary_code'], places_check1: ['parent'], parent_cycle: ['parent'],
  artworks_parent_check: ['parent'], artworks_parts_count_check: ['parts_count'], artworks_web_url_check: ['web_url'],
  movements_check: ['parent'], artists_check: ['birth', 'death'], polities_check: ['parent'], events_check: ['parent'],
  artworks_inventory_needs_institution: ['inventory_number', 'institution'], artworks_loan_needs_institution: ['on_loan', 'institution'],
  artworks_loan_since_needs_loan: ['on_loan', 'on_loan_since'], polities_country_codes_check: ['country_codes'],
  artworks_dimensions_check: ['dimensions'],
};
const FIELDS_OF_MESSAGE = new Map(Object.entries(RULE_FIELDS).filter(([c]) => RULES[c]).map(([c, f]) => [RULES[c], f]));
function errorKeysOf(errors) {
  return new Set(errors.flatMap((e) => {
    const m = /^([a-z_]+):/.exec(e);
    return m ? [m[1]] : FIELDS_OF_MESSAGE.get(e) || [];
  }));
}

// The live duplicate box of the new-entry form (editor/duplicates.js): the form as typed, compared and rolled back.
router.post('/:plural/new/duplicates', async (req, res) => {
  const result = await saveEntity(req.user, req.t, req.body, null, { probe: true });
  // and whether the name fits the type (055): "Henry Clay Frick" as an institution
  const name = String(req.body[`f.${req.t.name}`] || '').trim();
  const doubt = name ? (await adminPool.query('SELECT type_doubt($1, $2) AS d', [req.t.type, name])).rows[0].d : null;
  res.type('html').send(String(html`${doubt ? html`<div class="flash warn type-warning">“${name}”: ${doubt}</div>` : ''}${duplicates.liveBox(req.t, result.probe || [])}`));
});

router.post('/:plural', async (req, res) => {
  const { t } = req;
  const result = await saveEntity(req.user, t, req.body, null);
  if (result.errors) {
    const ctx = await formContext(t);
    ctx.errorKeys = errorKeysOf(result.errors);
    ctx.confirmNew = result.confirm || {};
    ctx.duplicates = result.duplicates || null;
    ctx.typeCheck = result.typeCheck ? html`${typeWarning(t, result.typeCheck.types, result.typeCheck.qid, null)}
      <label class="choice"><input type="checkbox" name="type.ok" value="1"> it really is ${anOf(t.type)} — create it</label>` : null;
    return send(req, res, {
      title: `New ${t.type}`, status: 422,
      page: { type: t.type, slug: null, mode: 'new' },
      body: html`<h1>New ${t.type}</h1>${entityForm({ t, slug: req.body.slug, f: formFromBody(req.body), ctx, action: `/${t.folder}`,
        errors: result.errors, isNew: true, pendingImages: req.body['wd.images'], pendingCites: req.body['wd.cite'], pendingIds: req.body['wd.ids'] })}`,
    });
  }
  await drafts.deleteDraft(adminPool, req.user.id, t.type, null);
  res.redirect(303, `/${t.folder}/${result.slug}?done=created${result.created.length ? `&auto=${result.created.length}` : ''}${result.city ? `&city=1${result.city.created ? `&places=${result.city.created}` : ''}` : ''}`);
});

// Display of one field's value on the view page.
// links: "type/slug" → name, for [[links]] in Markdown (loaded by the page, linkNames)
function showValue(t, key, kind, doc, links = new Map()) {
  const v = doc[key];
  if (kind === 'md') return v ? html`<div class="md">${raw(renderMarkdown(v, { names: links }))}</div>` : null;
  if (kind === 'date' || kind === 'period') {
    if (v === undefined) return doc[`${key}_label`] || null;
    const generated = parseFuzzyDate(v, { openEnd: kind === 'period' }).label;
    return html`${doc[`${key}_label`] || generated} <span class="muted">(${v})</span>`;
  }
  if (v === undefined) return null;
  if (kind === 'text[]') return v.join(' · ');
  if (kind === 'dimsets') return html`<ul class="names-list">${v.map((s) => html`<li><b>${s.part}</b>: ${dimensionsLib.label(s.cm)}</li>`)}</ul>`;
  if (kind === 'names') {
    return html`<ul class="names-list">${v.map((n) => (typeof n === 'string' ? { text: n, role: 'alternative' } : n)).map((n) => html`<li>
      <span${n.lang ? html` lang="${n.lang}"` : ''}>${names.hasRuby(n.text) ? raw(names.rubyHtml(n.text)) : n.text}</span>
      ${n.lang ? html`<span class="tag">${n.lang}</span>` : ''} <span class="muted small">${n.role === 'translation' ? `${n.status === 'own' ? 'own' : n.status || 'common'} translation` : n.role}</span></li>`)}</ul>`;
  }
  if (key === 'title_status') return `${v === 'own' ? 'own' : v} translation${v === 'own' ? ' — shown in [square brackets]' : ''}`;
  if (kind === 'dimensions') return `${v.join(' × ')} cm${v.length === 1 ? ' (height)' : ''}${doc.dimensions_note ? ` (${doc.dimensions_note})` : ''}`;
  if (kind === 'point') return html`${v[1]}, ${v[0]} <a href="https://www.openstreetmap.org/?mlat=${v[1]}&mlon=${v[0]}#map=12/${v[1]}/${v[0]}" rel="noopener" target="_blank">map ↗</a>`;
  if (kind === 'json' || kind === 'area') return html`<pre>${JSON.stringify(v, null, 2)}</pre>`;
  if (kind === 'parent') return html`<a href="/${t.folder}/${v}">${v}</a>`;
  if (kind.startsWith('ref:')) return html`<a href="/${BY_TYPE[kind.slice(4)].folder}/${v}">${v}</a>`;
  if (/_url$/.test(key)) return html`<a href="${v}" rel="noopener" target="_blank">${v}</a>`;
  return v;
}

// An artwork's creators in one place: the creator field (main creator) and the co_creator relationships
// (migration 028) — each with its part, certainty and an edit link — plus a short form to add one.
function creatorsRow(e, main, coCreators, marker = '') {
  if (!main && !coCreators.length) return '';
  return html`<dt id="creators">Creator${coCreators.length ? 's' : ''}</dt><dd class="creators">
    ${main ? html`<a href="/artists/${main.slug}">${main.name}</a> ${marker}` : html`<span class="muted">no main creator</span>`}
    ${coCreators.map(({ id, to_name: toName, rel }) => html`<div>+ <a href="/artists/${rel.to.split('/')[1]}">${toName}</a>
      <span class="muted">${[rel.label, rel.certainty !== 'attested' && rel.certainty].filter(Boolean).join(' · ')}</span>
      <a class="small" href="/relationships/${id}/edit">edit</a></div>`)}
    <details class="add-co-creator"><summary class="small">+ Add co-creator</summary>
      <form method="post" action="/artworks/${e.slug}/relationships?from=creators" class="form">
        <select id="cc-type" name="type" hidden><option value="co_creator" data-object-types="artist" selected>co-creator</option></select>
        <div class="row">
          <div class="field"><label for="cc-to">Artist</label>
            <input id="cc-to" name="to" required placeholder="start typing a name" autocomplete="off" data-lookup-from="cc-type"></div>
          <div class="field"><label for="cc-label">Part</label><input id="cc-label" name="label" placeholder="optional, e.g. landscape, figures"></div>
          <div class="field"><label for="cc-cert">Certainty</label><select id="cc-cert" name="certainty">
            ${['attested', 'probable', 'possible', 'disputed'].map((c) => html`<option>${c}</option>`)}</select></div>
        </div>
        <div class="hint">Period, notes and sources: <i>edit</i> after adding. The main creator is the Creator field (Edit).</div>
        <div class="actions"><button>Add</button></div>
      </form></details></dd>`;
}

router.get('/:plural/:slug', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const [outgoing, incoming, types, entities] = await Promise.all([
    readRelationships(adminPool, t.type, e.id),
    // links towards this entry, plus the derived ones from it (view edges, 031: provenance, the creator field) —
    // except an artwork's own derived edges, which its creator row and Provenance section show
    adminPool.query(`
      SELECT r.id, r.source, r.provenance_id, s.type::text AS type, s.slug, s.name,
             CASE WHEN (r.object_type, r.object_id) = ($1::entity_type, $2) THEN rt.inverse_label ELSE rt.label END AS inverse_label,
             r.period_label, r.label, r.end_basis
      FROM edges r JOIN relationship_types rt ON rt.code = r.relationship_type
      JOIN entity_index s ON (s.type, s.id) = (CASE WHEN (r.object_type, r.object_id) = ($1::entity_type, $2) THEN r.subject_type ELSE r.object_type END,
                                               CASE WHEN (r.object_type, r.object_id) = ($1::entity_type, $2) THEN r.subject_id ELSE r.object_id END)
      WHERE (r.object_type = $1 AND r.object_id = $2)
         OR (r.subject_type = $1 AND r.subject_id = $2 AND r.source <> 'relationship' AND r.subject_type <> 'artwork')
      ORDER BY rt.sort_order, lower(r.period) NULLS FIRST`, [t.type, e.id]),
    relationshipTypes(adminPool, t.type, { reverse: true }),
    allEntities(adminPool),
  ]);
  const labels = Object.fromEntries(types.map((x) => [x.code, x.label]));
  // an artwork's further creators are shown with the creator (creatorsRow), not among the relationships
  const coCreators = outgoing.filter((o) => o.rel.type === 'co_creator');
  const otherRels = outgoing.filter((o) => o.rel.type !== 'co_creator');
  const mainCreator = t.type === 'artwork' && e.doc.creator
    ? (await adminPool.query('SELECT slug, name FROM artists WHERE slug = $1', [e.doc.creator])).rows[0] : null;
  const name = e.name;
  // the stored result — or, right after a change not in it yet, this entry's checks computed now (no waiting)
  const qa = await quality.issues(adminPool, { entity: { type: t.type, id: e.id }, live: !(await quality.isFresh(adminPool)) });
  const pending = await collab.unpublished(t, e.id);
  const imgs = t.imageFk ? await readImages(adminPool, t.type, e.id) : [];
  const autoFlag = await autocreate.flagOf(adminPool, t.type, e.id);
  const provSteps = t.type === 'artwork' ? await provenance.read(adminPool, e.id) : [];
  const nums = t.type === 'artwork' ? await numbers.list(adminPool, e.id) : [];
  const cites = await citations.forEntity(adminPool, t.type, e.id);
  const citable = (await citations.citableFields(adminPool))[t.type] || {};
  const here = `/${t.folder}/${e.slug}`;
  const recent = await citations.recentSources(adminPool, req.user.id, t.type, e.id);
  const mark = (key) => (key in citable ? citations.marker(cites[key], { type: t.type, id: e.id, field: key, label: `“${fieldLabel(t.type, key)}”` }, here, { recent }) : '');
  // type and materials as glossary terms (071): links to their pages, a mark where a value is no term yet
  const termLinks = t.type === 'artwork' ? (await adminPool.query(`
    SELECT (SELECT jsonb_build_object('slug', g.slug, 'name', g.name) FROM glossary g WHERE g.id = w.kind_term_id) AS kind,
           (SELECT coalesce(jsonb_object_agg(g.name, g.slug), '{}') FROM artwork_materials am JOIN glossary g ON g.id = am.term_id
             WHERE am.artwork_id = w.id) AS materials
    FROM artworks w WHERE w.id = $1`, [e.id])).rows[0] : null;
  const termValue = (key) => {
    const noTerm = (v) => html`${v} <a class="tag" href="/quality/batch/terms" title="Not a glossary term yet — sort it out">no term</a>`;
    if (key === 'kind') return termLinks.kind ? html`<a href="/glossary/${termLinks.kind.slug}">${e.doc.kind}</a>` : noTerm(e.doc.kind);
    return html`${e.doc.materials.map((m, i) => html`${i ? ' · ' : ''}${termLinks.materials[m] ? html`<a href="/glossary/${termLinks.materials[m]}">${m}</a>` : noTerm(m)}`)}`;
  };
  const webAccessed = t.type === 'artwork' && e.doc.web_url
    ? (await adminPool.query("SELECT to_char(web_url_accessed, 'FMDD FMMonth YYYY') AS d FROM artworks WHERE id = $1", [e.id])).rows[0].d : null;
  const boundary = t.type === 'place' && e.doc.boundary_code
    ? (await adminPool.query('SELECT code, name FROM boundaries WHERE code = $1', [e.doc.boundary_code])).rows[0] : null;
  // series and other wholes (migration 037)
  const series = t.type === 'artwork' ? await seriesOf(e) : null;
  const citation = t.type === 'source' ? (await bibliography.loadCatalogue(adminPool)).get(e.slug) : null;
  const linkMap = await linkNames(adminPool, [...Object.entries(t.fields).filter(([, k]) => k === 'md').map(([key]) => e.doc[key]),
    ...provSteps.map((p) => p.notes_md)]);
  // the entries whose texts [[link]] this one (view content_links, migration 030) — for a term: where it is used
  const usedIn = (await adminPool.query(`
    SELECT DISTINCT e.type::text AS type, e.slug, e.name, e.sort_key COLLATE sort_natural AS sort_key FROM content_links l JOIN entity_index e ON (e.type, e.id) = (l.entity_type, l.entity_id)
    WHERE l.target_type = $1 AND l.target_slug = $2 AND NOT (e.type = $1::entity_type AND e.id = $3) ORDER BY sort_key`, [t.type, e.slug, e.id])).rows;
  const main = imgs[0];
  send(req, res, {
    title: name, page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<p class="muted"><a href="/${t.folder}">${humanize(t.folder)}</a> / ${e.slug}</p>
      <div class="bar"><h1 class="grow">${name}</h1>
        <a class="button" href="/${t.folder}/${e.slug}/edit">Edit</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/enrich" title="Wikidata, the GND and SIKART on one page">Enrich…</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/wikidata">Wikidata…</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/history">History</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/merge">Merge…</a>
        ${CONVERTIBLE.includes(t.type) ? html`<a class="button secondary" href="/${t.folder}/${e.slug}/convert">Change type…</a>` : ''}
        <a class="button secondary" href="/${t.folder}/${e.slug}/delete">Delete</a></div>
      ${pending ? unpublishedBanner(t, e, { ...pending, fields: await unpublishedFields(t, e) }, false) : ''}
      ${autoFlag ? html`<div class="flash warn auto-banner"><b>To complete:</b> created automatically
        ${autoFlag.from ? html`while adding <a href="/${BY_TYPE[autoFlag.from.type].folder}/${autoFlag.from.slug}">${autoFlag.from.name}</a>` : ''}
        on ${autoFlag.created_at.toISOString().slice(0, 10)} — it has little more than a name.
        <a class="button" href="/${t.folder}/${e.slug}/edit">Fill in the details</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/enrich">Enrich…</a>
        <form method="post" action="/${t.folder}/${e.slug}/auto-done" class="inline"><button class="link">it's complete — remove the mark</button></form>
        <div class="muted small">The mark goes away by itself when the entry is next published.</div></div>` : ''}
      ${req.query.queue ? quality.queueBar(t, e, req.query.queue, qa) : ''}
      ${quality.entityBox(qa, req.query.queue ? req.originalUrl : `/${t.folder}/${e.slug}`)}
      ${citation ? html`<p class="citation"><b>${citation.siglum}:</b> ${raw(citation.full)}</p>` : ''}
      ${series && series.whole ? html`<p class="part-of">${series.number ? html`<b>${/^\d+$/.test(series.number) ? `No. ${series.number}` : series.number}</b>
        ${series.whole.parts_count && /^\d+$/.test(series.number) ? `of ${series.whole.parts_count} ` : ''}in ` : 'Part of '}<a href="/artworks/${series.whole.slug}">${series.whole.title}</a>
        ${series.prev ? html` · <a href="/artworks/${series.prev.slug}">← ${series.prev.title}</a>` : ''}${series.next ? html` · <a href="/artworks/${series.next.slug}">${series.next.title} →</a>` : ''}</p>` : ''}
      ${main ? html`<figure class="image-preview"><a href="${main.source_url || main.url}" target="_blank" rel="noopener">
        <img src="${thumbUrl(main.url, 500)}" alt="${name}"></a>
        <figcaption class="muted small">${[main.caption, main.credit, main.license].filter(Boolean).join(' · ') || 'no credit / license yet'}
          ${imgs.length > 1 ? html` · <a href="#images">${imgs.length} images</a>` : ''}</figcaption></figure>` : ''}
      ${names.hasRuby(e.doc[t.name]) || e.doc[`${t.name}_lang`] ? html`<p class="main-name"${e.doc[`${t.name}_lang`] ? html` lang="${e.doc[`${t.name}_lang`]}"` : ''}>
        ${names.hasRuby(e.doc[t.name]) ? raw(names.rubyHtml(e.doc[t.name])) : name}
        ${e.doc[`${t.name}_lang`] ? html` <span class="tag" lang="en">${e.doc[`${t.name}_lang`]}</span>` : ''}</p>` : ''}
      <dl class="fields">${Object.entries(t.fields).filter(([k]) => k !== t.name && !(k === 'dimensions_note' && e.doc.dimensions)).map(([key, kind]) => {
        if (t.type === 'artwork' && key === 'creator') return creatorsRow(e, mainCreator, coCreators, mark('creator'));
        const shown = key === 'boundary_code' && boundary
          ? html`${boundary.code} — ${boundary.name} <span class="muted">(outline and marker from Natural Earth)</span>`
          : termLinks && ((key === 'kind' && e.doc.kind) || (key === 'materials' && (e.doc.materials || []).length)) ? termValue(key)
            : showValue(t, key, kind, e.doc, linkMap);
        // the web page with the day the link was added (set by the database, migration 039)
        if (key === 'web_url' && shown !== null && webAccessed) return html`<dt>${fieldLabel(t.type, key)}</dt><dd>${shown} <span class="muted small">· added ${webAccessed}</span></dd>`;
        if (shown === null) return '';
        // dates and dimensions are shown under their own key; the label column belongs to the value before it
        return html`<dt>${fieldLabel(t.type, key)}</dt><dd>${shown} ${mark(key)}</dd>`;
      })}</dl>
      ${Object.keys(citable).length ? html`<p class="cite-legend muted small">Sources: click a marker —
        <span class="cite-badge cite-none">+</span> none yet · <span class="cite-badge cite-database">W</span> Wikidata ·
        <span class="cite-badge cite-institution">M</span> museum / institution · <span class="cite-badge cite-scholarly">L</span> literature ·
        <span class="cite-badge cite-primary">P</span> primary source · <span class="cite-badge cite-text">T</span> a note in words ·
        <span class="cite-badge cite-outdated">!</span> changed since cited ·
        <span class="cite-badge cite-database cite-pending">W</span> dotted: not published yet</p>` : ''}
      ${t.type === 'term' || usedIn.length ? html`<h2 id="used-in">${t.type === 'term' ? 'Used in' : 'Mentioned in'}</h2>${usedIn.length ? html`<ul>${usedIn.map((u) => html`<li><a href="/${BY_TYPE[u.type].folder}/${u.slug}">${u.name}</a> <span class="tag">${u.type}</span></li>`)}</ul>`
        : html`<p class="muted">No text links it yet — write <code>[[${e.slug}]]</code> in a description.</p>`}` : ''}
      ${series && (series.parts.length || series.isWhole) ? html`<h2 id="parts">Parts</h2>
        <p class="muted">${series.parts.length}${e.doc.parts_count ? ` of ${e.doc.parts_count}` : ''} entered${series.missing.length ? ` — missing numbers: ${series.missing.join(', ')}` : ''}</p>
        <div class="image-list parts-list">${series.parts.map((p) => html`<figure class="image-item"><a href="/artworks/${p.slug}">${p.image_url
          ? html`<img src="${thumbUrl(p.image_url, 250)}" alt="" loading="lazy">` : html`<span class="thumb-empty"></span>`}</a>
          <figcaption>${p.part_number ? html`<b>${p.part_number}</b> · ` : ''}<a href="/artworks/${p.slug}">${p.title}</a></figcaption></figure>`)}</div>` : ''}
      ${t.type === 'artwork' ? html`<details${series && series.isWhole ? ' open' : ''}><summary><b>+ Add a part</b> <span class="muted small">(for a series, album, triptych …)</span></summary>
        <form method="post" action="/artworks/${e.slug}/parts" class="form bar">
          <input name="part" placeholder="an existing artwork (slug)" list="part-candidates" class="grow" aria-label="artwork" data-lookup="artwork" autocomplete="off">
          <input name="part_number" placeholder="number, e.g. 21" aria-label="number" class="short">
          <button>Add</button> <a class="button secondary" href="/artworks/new?part_of=${e.slug}">+ New part</a></form></details>` : ''}
      ${await (async () => {
        const ids = await identifiers.list(adminPool, t.type, e.id);
        const available = identifiers.forType(await identifiers.authorities(adminPool), t.type).filter((a) => !ids.some((x) => x.code === a.code));
        return identifiers.forType(await identifiers.authorities(adminPool), t.type).length ? identifiers.section({ t, e, ids }) : '';
      })()}
      ${t.imageFk ? images.section({ t, e, images: imgs, licenseList: await images.licenses(adminPool) }) : ''}
      ${t.type === 'artwork' ? numbers.listSection({ e, numbers: nums, cites: await citations.forNumbers(adminPool, nums.map((n) => n.id)), recent }) : ''}
      ${t.type === 'artwork' ? provenance.section({ e, steps: provSteps, names: linkMap, gaps: await provenance.coverage(adminPool, e.id),
        cites: await citations.forProvenance(adminPool, provSteps.filter((s) => s.id).map((s) => s.id)),
        marker: (c, target, back) => citations.marker(c, target, back, { recent }), back: `${here}#provenance` }) : ''}
      <h2 id="relationships">Relationships</h2>
      ${await (async () => {
        const relCites = await citations.forRelationships(adminPool, [...otherRels.map((x) => x.id), ...incoming.rows.filter((r) => r.source === 'relationship').map((r) => r.id)]);
        return html`${otherRels.length ? html`<div class="table-wrap"><table><tbody>${otherRels.map(({ id, to_name: toName, rel }) => {
        const [type, slug] = rel.to.split('/');
        return html`<tr><td>${labels[rel.type] || rel.type}</td>
          <td><a href="/${BY_TYPE[type].folder}/${slug}">${toName}</a> <span class="tag">${type}</span></td>
          <td>${rel.period_label || (rel.period ? parseFuzzyDate(String(rel.period), { openEnd: true }).label : '')}</td>
          <td class="muted">${[rel.label, rel.certainty].filter(Boolean).join(' · ')}</td>
          <td>${citations.marker(relCites[id], { relationship: id, label: `“${labels[rel.type] || rel.type} ${toName}”` }, `${here}#relationships`, { recent })}</td>
          <td><a href="/relationships/${id}/edit">edit</a></td></tr>`;
      })}</tbody></table></div>` : html`<p class="muted">None yet.</p>`}
      ${incoming.rows.length ? html`<h3>Linked from</h3><div class="table-wrap"><table><tbody>${incoming.rows.map((r) => html`<tr>
          <td>${r.inverse_label}</td><td><a href="/${BY_TYPE[r.type].folder}/${r.slug}">${r.name}</a> <span class="tag">${r.type}</span></td>
          <td>${r.period_label || ''}${r.end_basis === 'implied' ? html` <span class="tag implied">end implied</span>` : ''}</td><td class="muted">${r.label || ''}</td>
          <td>${r.source === 'relationship' ? citations.marker(relCites[r.id], { relationship: r.id, label: `“${r.inverse_label} ${r.name}”` }, `${here}#relationships`, { recent }) : ''}</td>
          <td>${r.source === 'provenance' ? html`<a href="/provenance/${r.provenance_id}/edit" title="from the provenance">provenance</a>`
            : r.source === 'creator' ? html`<a href="/artworks/${r.slug}/edit" title="the artwork's creator field">creator field</a>`
            : html`<a href="/relationships/${r.id}/edit">edit</a>`}</td></tr>`)}</tbody></table></div>` : ''}`;
      })()}
      <details><summary><b>+ Add relationship</b></summary>
        ${types.length ? relForm({ action: `/${t.folder}/${e.slug}/relationships`, types, entities, submit: 'Add', entityType: t.type })
          : html`<p class="muted">No relationship types start from ${an(t.type)}; link to it from the other entity.</p>`}
      </details>`,
  });
});

router.post('/:plural/:slug/relationships', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => {
      const p = await relFromForm(db, req.body, { type: t.type, id: e.id }, {}, { reverse: true });
      const { rows } = await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period,
        period_label, label, certainty, notes_md, metadata) VALUES ($1, $2, $3, $4, $5, $6::daterange, $7, $8, $9, $10, $11::jsonb) RETURNING id`, [...p]);
      await citations.syncText(db, { relationship: rows[0].id }, p.sources);
    });
  } catch (err) {
    const [types, entities] = await Promise.all([relationshipTypes(adminPool, t.type, { reverse: true }), allEntities(adminPool)]);
    return send(req, res, {
      title: 'Add relationship', status: 422, flash: { kind: 'error', text: friendly(err) },
      body: html`<h1>Add relationship</h1><p><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>
        ${relForm({ action: `/${t.folder}/${e.slug}/relationships`, types, entities, rel: { ...req.body, sources: String(req.body.sources || '').split('\n') }, submit: 'Add', entityType: t.type })}`,
    });
  }
  res.redirect(303, `/${t.folder}/${e.slug}?done=rel-added#${req.query.from === 'creators' ? 'creators' : 'relationships'}`);  // back to where it was added
});

// The published values as form keys — the edit page refetches them when someone else publishes or reverts.
router.get('/:plural/:slug/published.json', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return res.status(404).json({ error: 'not_found' });
  res.json(drafts.formKeys(e.doc, t, e.slug));
});

router.post('/:plural/:slug/auto-done', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  await autocreate.unflag(adminPool, t.type, e.id);
  res.redirect(303, `/${t.folder}/${e.slug}?done=auto-done`);
});

// Series and other wholes (migration 037): what an artwork is part of, its neighbours, its parts; numbers 1…parts_count
// that no part has yet.
async function seriesOf(e) {
  const { rows: parts } = await adminPool.query(`
    SELECT a.slug, a.title, a.part_number, a.part_sort,
           (SELECT i.url FROM images i WHERE i.artwork_id = a.id ORDER BY i.position, i.id LIMIT 1) AS image_url
    FROM artworks a WHERE a.parent_id = $1 ORDER BY a.part_sort NULLS LAST, a.part_number, ${sortKey('artwork', 'a', 'title')}`, [e.id]);
  const { rows: [me] } = await adminPool.query(`
    SELECT w.slug, w.title, w.parts_count, a.part_number FROM artworks a LEFT JOIN artworks w ON w.id = a.parent_id WHERE a.id = $1`, [e.id]);
  let prev = null;
  let next = null;
  if (me.slug) {
    const { rows: sib } = await adminPool.query(`
      SELECT a.slug, a.title FROM artworks a WHERE a.parent_id = (SELECT parent_id FROM artworks WHERE id = $1)
      ORDER BY a.part_sort NULLS LAST, a.part_number, ${sortKey('artwork', 'a', 'title')}`, [e.id]);
    const at = sib.findIndex((s) => s.slug === e.slug);
    prev = sib[at - 1] || null;
    next = sib[at + 1] || null;
  }
  const have = new Set(parts.map((p) => Number(p.part_sort)).filter(Number.isFinite));
  const count = Number(e.doc.parts_count) || 0;
  const missing = count && count <= 500 ? [...Array(count).keys()].map((n) => n + 1).filter((n) => !have.has(n)) : [];
  return { parts, isWhole: !!count || /^(series|album|diptych|triptych|polyptych|altarpiece|set)$/.test(e.doc.kind || ''),
    whole: me.slug ? { slug: me.slug, title: me.title, parts_count: me.parts_count } : null, number: me.part_number, prev, next,
    missing: missing.length > 30 ? [...missing.slice(0, 30), '…'] : missing };
}

// An existing artwork becomes a part of this one (with its number); audited like any change.
router.post('/artworks/:slug/parts', async (req, res) => {
  const t = BY_TYPE.artwork;
  const e = await findEntity(t, req.params.slug);
  const part = await findEntity(t, String(req.body.part || '').trim());
  if (!e) return notFoundPage(req, res);
  if (!part) {
    return send(req, res, { title: 'Add a part', status: 422, flash: { kind: 'error', text: 'Pick an existing artwork (its slug) — or use “+ New part”.' },
      body: html`<p><a href="/artworks/${e.slug}#parts">← ${e.name}</a></p>` });
  }
  try {
    await withTx(req.user, (db) => db.query('UPDATE artworks SET parent_id = $1, part_number = $2 WHERE id = $3',
      [e.id, String(req.body.part_number || '').trim() || null, part.id]));
  } catch (err) {
    return send(req, res, { title: 'Add a part', status: 422, flash: { kind: 'error', text: friendly(err) },
      body: html`<p><a href="/artworks/${e.slug}#parts">← ${e.name}</a></p>` });
  }
  await collab.changedElsewhere(t, part.id);  // its working copy, if open, takes the new values
  res.redirect(303, `/artworks/${e.slug}?done=saved#parts`);
});

// Images: added here, edited / removed / reordered under /images/<id> (src/admin/images.js). Saved immediately and
// audited, like relationships.
router.post('/:plural/:slug/images', async (req, res) => {
  const { t } = req;
  const e = t.imageFk && await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    const values = images.fromForm(req.body);
    await withTx(req.user, (db) => images.add(db, t.type, e.id, values));
  } catch (err) {
    return send(req, res, {
      title: 'Add image', status: 422, flash: { kind: 'error', text: err instanceof images.ImageError ? err.message : friendly(err) },
      body: html`<h1>Add image</h1><p><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>
        ${images.form({ action: `/${t.folder}/${e.slug}/images`, img: req.body, submit: 'Add', licenseList: await images.licenses(adminPool) })}`,
    });
  }
  // from the image search: back to the results (only that page of this entry — never an arbitrary address)
  const back = String(req.body.back || '');
  if (back.startsWith(`/${t.folder}/${e.slug}/images/find?`)) return res.redirect(303, `${back}&done=img-added`);
  // from the batch page (routes/queue.js): back there, at the row (only that page — never an arbitrary address)
  if (/^\/quality\/batch\/images\?p=\d+$/.test(back)) return res.redirect(303, `${back}&done=img-added#${t.type}-${e.slug}`);
  res.redirect(303, `/${t.folder}/${e.slug}?done=img-added#images`);
});

router.post('/:plural/:slug/provenance', async (req, res) => {
  const { t } = req;
  const e = t.type === 'artwork' && await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => {
      const values = await provenance.fromForm(db, req.body);
      await citations.syncText(db, { provenance: await provenance.add(db, e.id, values) }, values.sources);
    });
  } catch (err) {
    return send(req, res, {
      title: 'Add provenance step', status: 422,
      flash: { kind: 'error', text: err instanceof provenance.ProvenanceError ? err.message : friendly(err) },
      body: html`<h1>Add provenance step</h1><p><a href="/${t.folder}/${e.slug}#provenance">← ${e.name}</a></p>
        ${provenance.form({ action: `/${t.folder}/${e.slug}/provenance`, step: stepFromBody(req.body), submit: 'Add' })}`,
    });
  }
  res.redirect(303, `/${t.folder}/${e.slug}?done=prov-added#provenance`);
});

// Find freely licensed images (Wikimedia Commons, Met, Art Institute of Chicago, Cleveland — src/admin/imagesearch.js).
router.get('/:plural/:slug/images/find', async (req, res) => {
  const { t } = req;
  const e = t.imageFk && await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const source = imagesearch.SOURCES[req.query.source] ? req.query.source : 'commons';
  // default search: the name, for an artwork with its creator ("The Great Wave off Kanagawa Hokusai")
  let q = String(req.query.q ?? '').trim().slice(0, 200);
  if (!req.query.q) {
    const creator = t.type === 'artwork' && e.doc.creator
      ? (await adminPool.query('SELECT name FROM artists WHERE slug = $1', [e.doc.creator])).rows[0] : null;
    q = [e.name, creator && creator.name].filter(Boolean).join(' ');
  }
  const { results, error } = await imagesearch.find(source, q);
  const have = new Set((await readImages(adminPool, t.type, e.id)).map((i) => i.url));
  const self = `/${t.folder}/${e.slug}/images/find?${new URLSearchParams({ source, q })}`;
  send(req, res, {
    title: `Find images · ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<p class="muted"><a href="/${t.folder}/${e.slug}#images">← ${e.name}</a></p><h1>Find images</h1>
      <p class="muted">Only freely usable images are shown — public domain / CC0, or with a free licence on Commons.
        Licence, credit and source are added with the image.</p>
      <form method="get" action="/${t.folder}/${e.slug}/images/find" class="bar" data-live="change">
        <input type="search" name="q" value="${q}" class="grow" aria-label="search">
        <select name="source" aria-label="where">${Object.entries(imagesearch.SOURCES).map(([k, s]) => html`<option value="${k}"${k === source ? ' selected' : ''}>${s.name}</option>`)}</select>
        <button>Search</button></form>
      <div data-live-results="images">      <p class="source-tabs">${Object.entries(imagesearch.SOURCES).map(([k, s]) => (k === source ? html`<b>${s.name}</b>`
        : html`<a href="/${t.folder}/${e.slug}/images/find?${new URLSearchParams({ source: k, q })}">${s.name}</a>`))}</p>
      ${error ? html`<p class="flash error">${error}</p>` : ''}
      ${!error && !results.length ? html`<p class="muted">Nothing found here — try another source or fewer words (e.g. only the artist).</p>` : ''}
      <div class="find-results">${results.map((r) => html`<figure class="image-item find-item">
        <a href="${r.source_url || r.url}" target="_blank" rel="noopener"><img src="${r.thumb}" alt="" loading="lazy" decoding="async"></a>
        <figcaption><b>${r.title || ''}</b>${r.by ? html`<div class="small">${r.by}</div>` : ''}
          <div class="muted small">${[r.credit, r.license].filter(Boolean).join(' · ')}</div>
          ${have.has(r.url) ? html`<div class="tag">added ✓</div>` : html`<form method="post" action="/${t.folder}/${e.slug}/images">
            <input type="hidden" name="url" value="${r.url}"><input type="hidden" name="source_url" value="${r.source_url || ''}">
            <input type="hidden" name="license" value="${r.license || ''}"><input type="hidden" name="credit" value="${r.credit || ''}">
            <input type="hidden" name="back" value="${self}"><button class="small">Add</button></form>`}
        </figcaption></figure>`)}</div></div>`,
  });
});

router.get('/:plural/:slug/edit', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  // The shared working copy (collab.js): the page shows it even before scripts connect, then stays bound to it.
  const { form: working, epoch, state } = await collab.currentForm(t, e.id);
  const pending = await collab.unpublished(t, e.id);
  const banner = pending ? unpublishedBanner(t, e, { ...pending, fields: await unpublishedFields(t, e) }, true) : '';
  // published: the public values, so the browser can mark every field the working copy changes (editor/unpublished.js)
  const ctx = await formContext(t, e.id);
  // further numbers (numbers.js): under the inventory number, saved at once through forms of their own after this one
  ctx.afterField = {};
  if (t.type === 'artwork') {
    const nums = await numbers.list(adminPool, e.id);
    ctx.afterField.inventory_number = numbers.section({ e, numbers: nums, cites: await citations.forNumbers(adminPool, nums.map((n) => n.id)) });
  }
  // reference records (identifiers.js) the same way, under the Wikidata id
  const authorityList = identifiers.forType(await identifiers.authorities(adminPool), t.type);
  if (authorityList.length) {
    const ids = await identifiers.list(adminPool, t.type, e.id);
    ctx.afterField.wikidata_id = identifiers.editSection({ t, e, ids, available: authorityList.filter((a) => !ids.some((x) => x.code === a.code)) });
  }
  const form = entityForm({ t, slug: working.slug || e.slug, f: formFromBody(working), ctx,
    action: `/${t.folder}/${e.slug}`, errors: [], version: working.version,
    collab: { key: `${t.type}:${e.id}:${epoch}`, state, published: drafts.formKeys(e.doc, t, e.slug) } });
  send(req, res, { title: `Edit ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'edit' },
    body: html`<h1>Edit ${e.name}</h1>${banner}${form}${t.type === 'artwork' ? numbers.formsAfter(e) : ''}${authorityList.length ? identifiers.formsAfter(t, e) : ''}${await citeDialogs(t, e, req.user)}` });
});

// The sources of the fields on the edit page: one dialog per citable field, after the form (forms can't nest);
// editor/sortable.js shows each one's badges next to the field's label.
async function citeDialogs(t, e, user) {
  const citable = (await citations.citableFields(adminPool))[t.type] || {};
  if (!Object.keys(citable).length) return '';
  const cites = await citations.forEntity(adminPool, t.type, e.id);
  const recent = await citations.recentSources(adminPool, user.id, t.type, e.id);
  const back = `/${t.folder}/${e.slug}/edit`;
  // further numbers (081): their dialogs too — the buttons with their badges stand in the numbers' table
  const nums = t.type === 'artwork' ? await numbers.list(adminPool, e.id) : [];
  return html`<div class="cite-dialogs">${Object.keys(citable).map((field) => citations.marker(cites[field],
    { type: t.type, id: e.id, field, label: `“${fieldLabel(t.type, field)}”` }, back, { edit: true, recent }))}${numbers.dialogs(e, nums, await citations.forNumbers(adminPool, nums.map((n) => n.id)), recent)}</div>`;
}

router.post('/:plural/:slug', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const result = await saveEntity(req.user, t, req.body, e);
  if (result.errors) {
    // Refused (validation, or the entry changed elsewhere meanwhile): the working copy is rebased if needed and shown
    // again with the messages — nothing typed is lost, it is all in the shared copy.
    await collab.changedElsewhere(t, e.id);
    const { form: working, epoch, state } = await collab.currentForm(t, e.id);
    const ctx = await formContext(t, e.id);
    ctx.errorKeys = errorKeysOf(result.errors);
    ctx.confirmNew = result.confirm || {};
    const published = drafts.formKeys((await findEntity(t, e.slug) || e).doc, t, e.slug);
    const form = entityForm({ t, slug: working.slug || e.slug, f: formFromBody(working), ctx,
      action: `/${t.folder}/${e.slug}`, errors: result.errors, version: working.version, collab: { key: `${t.type}:${e.id}:${epoch}`, state, published } });
    return send(req, res, { title: `Edit ${e.name}`, status: 422, page: { type: t.type, slug: e.slug, mode: 'edit' },
      body: html`<h1>Edit ${e.name}</h1>${form}` });
  }
  await drafts.deleteDraft(adminPool, req.user.id, t.type, e.id);  // step-1 draft, if any from before
  await collab.publishedNow(t, e.id, req.user.username);
  res.redirect(303, `/${t.folder}/${result.slug}?done=published${result.created.length ? `&auto=${result.created.length}` : ''}${result.city ? `&city=1${result.city.created ? `&places=${result.city.created}` : ''}` : ''}`);
});

module.exports = router;
