// Data quality (the checks themselves are the SQL view quality_issues, migration 013).
// This module: what each check means and how to fix it, the /quality page, the box on entity pages, acknowledgements.
const { html } = require('./html');
const { BY_TYPE } = require('../content');

const CHECKS = {
  presence_outside_lifespan: { title: 'Presence outside the lifespan', fix: 'Correct the period of the relationship, or the birth/death date.' },
  birth_death_mismatch: { title: '"Born in" / "died in" dated differently', fix: 'The period of "born in"/"died in" should match the birth/death date.' },
  inventory_without_institution: { title: 'Inventory number without institution', fix: 'Set the institution whose collection numbered it — or clear the number (it can go into a "housed at" relationship\'s label for a former holder).' },
  outside_polity_period: { title: 'Linked to a polity outside its existence', fix: 'Check the period of the relationship, or the polity\'s dates (e.g. USSR only 1922–1991).' },
  artwork_outside_creator_life: { title: 'Artwork dated outside its creator\'s life', fix: 'Check the date and the creator — or mark as OK (e.g. a posthumous cast).' },
  never_alive_together: { title: 'Linked people who never lived at the same time', fix: 'Probably "influenced by" was meant, or a date is wrong.' },
  overlapping_residences: { title: 'Two residences at the same time', fix: 'Correct a period — or mark as OK if both are right (e.g. a summer house).' },
  held_before_founded: { title: 'Held before the institution was founded', fix: 'Check the period of "housed at" and the founding date.' },
  outside_parent_area: { title: 'Place outside its parent region', fix: 'Check the coordinates, the parent, or the parent\'s outline.' },
  possible_duplicate: { title: 'Possible duplicates', fix: 'Weighed by names and evidence (creator, dates, dimensions, places, identifiers). The same thing: Merge… into the better entry. Two things: Not the same — remembered for good.' },
  broken_link: { title: 'Link to a missing entry', fix: 'Correct the [[type/slug]] link in the text (type [[ and a name to pick one) — the entry may have been renamed or deleted.' },
  broken_glossary_link: { title: 'Link to a missing glossary term', fix: 'Create the term in the Glossary (with this slug) — or correct the [[link]] in the text.' },
  artwork_without_creator: { title: 'Artwork without creator', fix: 'Add the creator — or an attribution such as "Workshop of …" / "Anonymous".' },
  image_without_license: { title: 'Image without license or credit', fix: 'Add license and credit (e.g. via Wikidata/Commons) before the image is shown publicly.' },
  no_relationships: { title: 'Not connected to anything', fix: 'Add relationships — unconnected entries don\'t appear on the map or in the graph.' },
  artist_missing_dates: { title: 'Artist without birth or death date', fix: 'Add the dates (fuzzy dates are fine) — the timeline needs them.' },
  presence_without_period: { title: 'Presence without a date', fix: 'Add a period so it appears on the timeline and the travel route.' },
  place_without_parent: { title: 'Place without parent', fix: 'Set the region/country it belongs to.' },
  missing_description: { title: 'No description', fix: 'Write a short description or biography.' },
  parent_suggestion: { title: 'Parent suggested from the map', fix: 'The place lies inside the outline of another place — set it as the parent.' },
  boundary_available: { title: 'Outline available', fix: 'Set the boundary code (ISO, e.g. JP or JP-13) — the outline and marker then come from Natural Earth.' },
  institution_without_place: { title: 'Institution without its city', fix: 'Set the place (the city) — a nearby one is suggested when the institution has an exact location.' },
  missing_romanization: { title: 'Name without romanization', fix: 'Add one under "Other names" (e.g. Kanagawa-oki nami ura | ja-Latn | romanization) — it is used for sorting, search and the slug.' },
  event_without_place: { title: 'Event without a place', fix: 'Set its place (the city), or an exact spot or area — otherwise it can\'t appear on the map.' },
  type_doubtful: { title: 'Perhaps the wrong kind of entry', fix: 'If it is: “Change type…” on its page moves it (a person entered as an institution) — with its relationships, images and sources. Otherwise: Mark as OK.' },
  title_translation: { title: 'Title is not an official translation', fix: 'Look up the title the holding institution uses (its online collection); if it has one, use it, set “official translation” and cite the page with the marker.' },
  loan_owner: { title: 'On loan — but who lent it?', fix: 'Add the owner (the lender) as the last step of the provenance — the institution where it is now only holds it.' },
  citation_outdated: { title: 'Changed since cited', fix: 'The value changed after the source was cited: check the source still says so — remove the citation, or cite the source of the new value.' },
  weakly_sourced: { title: 'Facts without a good source', fix: 'Cite the museum, a catalogue raisonné or the literature for these fields (the W / ? markers on the entry’s page). Wikidata is a start, not a source.' },
  no_wikidata_id: { title: 'No Wikidata id', fix: 'Use "Wikidata…" on the entry to find and link it.' },
};
const SEVERITIES = ['error', 'warning', 'info'];
const SEVERITY_TEXT = { error: 'Errors — contradictions', warning: 'Warnings — probably a problem', info: 'Info — incomplete' };

// Findings with names, filtered; acknowledged ones only when asked for.
async function issues(db, { severity, check, type, entity, acked = false } = {}) {
  const where = ['true'];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (severity) where.push(`q.severity = ${p(severity)}`);
  if (check) where.push(`q.check_id = ${p(check)}`);
  if (type) where.push(`q.entity_type = ${p(type)}::entity_type`);
  if (entity) where.push(`q.entity_type = ${p(entity.type)}::entity_type AND q.entity_id = ${p(entity.id)}`);
  where.push(acked ? 'a.check_id IS NOT NULL' : 'a.check_id IS NULL');
  const { rows } = await db.query(`
    SELECT q.check_id, q.severity, q.entity_type::text AS type, q.issue_key, q.detail, e.slug, e.name,
           a.note, a.acked_at, u.username AS acked_by
    FROM quality_issues q
    JOIN entity_index e ON e.type = q.entity_type AND e.id = q.entity_id
    LEFT JOIN quality_acks a ON a.check_id = q.check_id AND a.issue_key = q.issue_key
    LEFT JOIN admin_users u ON u.id = a.acked_by
    WHERE ${where.join(' AND ')}
    ORDER BY array_position(ARRAY['error', 'warning', 'info'], q.severity), q.check_id, e.name`, params);
  return rows;
}

async function counts(db) {
  const { rows } = await db.query(`
    SELECT q.severity, q.check_id, count(*)::int AS n FROM quality_issues q
    LEFT JOIN quality_acks a ON a.check_id = q.check_id AND a.issue_key = q.issue_key
    WHERE a.check_id IS NULL GROUP BY 1, 2`);
  return rows;
}

const link = (r) => `/${BY_TYPE[r.type].folder}/${r.slug}`;

function ackForm(r, back, acked) {
  return acked
    ? html`<form method="post" action="/quality/unack" class="inline"><input type="hidden" name="check_id" value="${r.check_id}">
        <input type="hidden" name="issue_key" value="${r.issue_key}"><input type="hidden" name="back" value="${back}">
        <button class="link">undo “${r.check_id === 'possible_duplicate' ? 'not the same' : 'OK'}”</button></form>`
    // a duplicate pair: "not the same" (the same acknowledgement — duplicate_candidates() leaves the pair out) or merge
    : r.check_id === 'possible_duplicate'
      ? html`<a class="button secondary" href="/${BY_TYPE[r.type].folder}/${r.slug}/merge?pair=${r.issue_key}">Merge…</a>
        <form method="post" action="/quality/ack" class="inline qa-ack"><input type="hidden" name="check_id" value="${r.check_id}">
        <input type="hidden" name="issue_key" value="${r.issue_key}"><input type="hidden" name="back" value="${back}">
        <input type="hidden" name="note" value="not the same"><button class="secondary">Not the same</button></form>`
    : html`<form method="post" action="/quality/ack" class="inline qa-ack"><input type="hidden" name="check_id" value="${r.check_id}">
        <input type="hidden" name="issue_key" value="${r.issue_key}"><input type="hidden" name="back" value="${back}">
        <input name="note" placeholder="why it is right (optional)" aria-label="note"><button class="secondary">Mark as OK</button></form>`;
}

function page({ rows, allCounts, filter, back }) {
  const total = (s) => allCounts.filter((c) => c.severity === s).reduce((n, c) => n + c.n, 0);
  const q = (params) => `/quality?${new URLSearchParams(Object.entries({ ...filter, ...params }).filter(([, v]) => v)).toString()}`;
  const groups = {};
  for (const r of rows) (groups[r.check_id] ||= []).push(r);
  return html`<h1>Data quality</h1>
    <div class="cards" data-live-results="cards">${SEVERITIES.map((s) => html`<a class="card qa-${s}${filter.severity === s ? ' active' : ''}" href="${q({ severity: filter.severity === s ? '' : s, check: '' })}">
      <b>${total(s)}</b>${SEVERITY_TEXT[s]}</a>`)}</div>
    <form class="bar" method="get" action="/quality" data-live>
      <select name="severity"><option value="">all levels</option>${SEVERITIES.map((s) => html`<option${filter.severity === s ? ' selected' : ''}>${s}</option>`)}</select>
      <select name="check"><option value="">all checks</option>${Object.entries(CHECKS).map(([id, c]) => html`<option value="${id}"${filter.check === id ? ' selected' : ''}>${c.title}</option>`)}</select>
      <select name="type"><option value="">all types</option>${Object.keys(BY_TYPE).map((t) => html`<option${filter.type === t ? ' selected' : ''}>${t}</option>`)}</select>
      <label class="choice"><input type="checkbox" name="acked" value="1"${filter.acked ? ' checked' : ''}> show only entries marked OK</label>
      <button class="secondary">Filter</button></form>
    <div data-live-results="quality">${!rows.length ? html`<p class="flash ok">${filter.acked ? 'Nothing marked as OK here.' : 'Nothing found — all clear for this filter.'}</p>` : ''}
    ${Object.entries(groups).map(([id, list]) => html`<section class="qa-group">
      <h2><span class="tag qa-${list[0].severity}">${list[0].severity}</span> ${CHECKS[id] ? CHECKS[id].title : id} <span class="muted">(${list.length})</span></h2>
      ${CHECKS[id] ? html`<p class="muted small">${CHECKS[id].fix}</p>` : ''}
      <div class="table-wrap"><table><tbody>${list.map((r) => html`<tr>
        <td><a href="${link(r)}">${r.name}</a> <span class="tag">${r.type}</span></td><td>${r.detail}
          ${r.acked_at ? html`<div class="muted small">OK’d by ${r.acked_by || '?'} on ${r.acked_at.toISOString().slice(0, 10)}${r.note ? ` — ${r.note}` : ''}</div>` : ''}</td>
        <td class="qa-actions">${ackForm(r, back, !!r.acked_at)}</td></tr>`)}</tbody></table></div></section>`)}</div>`;
}

// Box on an entity page: its errors and warnings (info only as a count).
function entityBox(rows, back) {
  const serious = rows.filter((r) => r.severity !== 'info');
  const infos = rows.length - serious.length;
  if (!rows.length) return '';
  return html`<div class="qa-box${serious.some((r) => r.severity === 'error') ? ' has-error' : ''}">
    <b>Data quality:</b> ${serious.length ? '' : html`<span class="muted">no problems.</span>`}
    ${serious.length ? html`<ul>${serious.map((r) => html`<li><span class="tag qa-${r.severity}">${r.severity}</span>
      ${CHECKS[r.check_id] ? CHECKS[r.check_id].title : r.check_id}: ${r.detail} ${ackForm(r, back, false)}</li>`)}</ul>` : ''}
    ${infos ? html`<span class="muted small">${infos} hint${infos === 1 ? '' : 's'} on completeness (${rows.filter((r) => r.severity === 'info').map((r) => (CHECKS[r.check_id] || {}).title || r.check_id).join(', ')}).</span>` : ''}
  </div>`;
}

async function ack(db, { check_id: checkId, issue_key: issueKey, note }, userId) {
  if (!CHECKS[checkId] || !issueKey) return;
  await db.query(`INSERT INTO quality_acks (check_id, issue_key, note, acked_by) VALUES ($1, $2, $3, $4)
    ON CONFLICT (check_id, issue_key) DO UPDATE SET note = EXCLUDED.note, acked_by = EXCLUDED.acked_by, acked_at = now()`,
  [checkId, String(issueKey).slice(0, 200), String(note || '').trim().slice(0, 500) || null, userId]);
}

async function unack(db, { check_id: checkId, issue_key: issueKey }) {
  await db.query('DELETE FROM quality_acks WHERE check_id = $1 AND issue_key = $2', [checkId, issueKey]);
}

module.exports = { CHECKS, SEVERITIES, issues, counts, page, entityBox, ack, unack };
