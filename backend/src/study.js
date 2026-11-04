// Study sets (migration 218, owner 2026-11-04): what an index card of an entry shows. One card per entry, built here
// for every type; the site turns it into the two directions (frontend src/views/sets.ts):
//   forward  the entry (its name — an artwork: its picture) → what it is (the facts: artist, date …)
//   reverse  what it is (the facts, its text with the name blanked out) → the entry
// A card: { type, slug, name, facts: [{label, value}], text, image, own }
//   facts  the few things one learns about it, in the order a card shows them (empty ones left out)
//   text   a short plain text: a term's definition, else the first sentences of its description
//   image  its first public picture; an artwork without one: the account's own reference image (own: true)
const { catalogue } = require('./bibliography');

const EXCERPT = 360;
/** The first sentences of a text, up to about EXCERPT characters. */
function excerpt(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= EXCERPT) return t;
  const cut = t.slice(0, EXCERPT);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > EXCERPT / 3 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')} …`;
}
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const lived = (b, d, a) => (b || d ? [b || '?', d || '?'].join(' – ') : a ? `active ${a}` : null);

// per type: the columns of its card, for the entries `ids` (bigint[]) — $2 is the account (its reference images)
const PLACE = (col) => `(SELECT p.name FROM places p WHERE p.id = ${col})`;
const REL_PLACE = (type, rel) => `(SELECT p.name FROM relationships r JOIN places p ON p.id = r.object_id
  WHERE r.subject_type = '${type}' AND r.subject_id = t.id AND r.relationship_type = '${rel}' AND r.object_type = 'place' ORDER BY r.id LIMIT 1)`;
const IMG = (fk) => `(SELECT i.url FROM images i WHERE i.${fk} = t.id ORDER BY i.position, i.id LIMIT 1)`;
const QUERIES = {
  artwork: `SELECT t.id, t.slug, t.title AS name, md_plain(t.description_md) AS text, ${IMG('artwork_id')} AS image,
              (SELECT p.id FROM private_images p WHERE p.artwork_id = t.id AND p.owner_id = $2 ORDER BY p.position, p.id LIMIT 1) AS own_image,
              coalesce(t.attribution_label, (SELECT string_agg(c ->> 'name', ', ') FROM jsonb_array_elements(artwork_creators(t.id)) c)) AS artist,
              t.created_label AS date, t.kind, t.medium,
              (SELECT i.name FROM institutions i WHERE i.id = t.current_institution_id) AS collection
            FROM artworks t WHERE t.id = ANY ($1)`,
  artist: `SELECT t.id, t.slug, t.name, md_plain(t.biography_md) AS text, ${IMG('artist_id')} AS image,
             t.birth_label, t.death_label, t.active_label, ${REL_PLACE('artist', 'born_in')} AS born_in, ${REL_PLACE('artist', 'died_in')} AS died_in
           FROM artists t WHERE t.id = ANY ($1)`,
  person: `SELECT t.id, t.slug, t.name, md_plain(t.description_md) AS text, ${IMG('person_id')} AS image, t.kind,
             t.birth_label, t.death_label, t.active_label, ${REL_PLACE('person', 'born_in')} AS born_in, ${REL_PLACE('person', 'died_in')} AS died_in
           FROM people t WHERE t.id = ANY ($1)`,
  institution: `SELECT t.id, t.slug, t.name, md_plain(t.description_md) AS text, ${IMG('institution_id')} AS image, t.kind,
                  ${PLACE('t.place_id')} AS place, t.founded_label, t.dissolved_label FROM institutions t WHERE t.id = ANY ($1)`,
  event: `SELECT t.id, t.slug, t.name, md_plain(t.description_md) AS text, ${IMG('event_id')} AS image, t.kind, t.period_label,
            ${PLACE('t.place_id')} AS place FROM events t WHERE t.id = ANY ($1)`,
  movement: `SELECT t.id, t.slug, t.name, md_plain(t.description_md) AS text, NULL AS image, t.kind, t.period_label,
               (SELECT p.name FROM movements p WHERE p.id = t.parent_id) AS part_of FROM movements t WHERE t.id = ANY ($1)`,
  polity: `SELECT t.id, t.slug, t.name, md_plain(t.description_md) AS text, NULL AS image, t.kind, t.period_label,
             (SELECT p.name FROM polities p WHERE p.id = t.parent_id) AS part_of FROM polities t WHERE t.id = ANY ($1)`,
  place: `SELECT t.id, t.slug, t.name, md_plain(t.description_md) AS text, NULL AS image, coalesce(t.designation, t.kind::text) AS kind,
            ${PLACE('t.parent_id')} AS part_of, t.country_code, t.existed_label FROM places t WHERE t.id = ANY ($1)`,
  literature: `SELECT t.id, t.slug, t.name, md_plain(t.description_md) AS text, NULL AS image, t.kind, t.written_label,
                 (SELECT p.name FROM literary_works p WHERE p.id = t.parent_id) AS part_of,
                 (SELECT string_agg(e.name, ', ' ORDER BY e.name) FROM relationships r JOIN entity_index e ON (e.type, e.id) = (r.object_type, r.object_id)
                   WHERE r.subject_type = 'literature' AND r.subject_id IN (t.id, coalesce(t.parent_id, t.id)) AND r.relationship_type = 'written_by') AS author
               FROM literary_works t WHERE t.id = ANY ($1)`,
  term: `SELECT t.id, t.slug, t.name, coalesce(t.definition, md_plain(t.description_md)) AS text, ${IMG('glossary_id')} AS image, t.category::text AS category,
           (SELECT p.name FROM glossary p WHERE p.id = t.parent_id) AS part_of FROM glossary t WHERE t.id = ANY ($1)`,
  source: `SELECT t.id, t.slug, t.name, NULL AS text, NULL AS image FROM bibliography t WHERE t.id = ANY ($1)`,
};

// the facts of a card, by type, from its row
const FACTS = {
  artwork: (r) => [['Artist', r.artist], ['Date', r.date], ['Type', r.kind], ['Medium', r.medium], ['Collection', r.collection]],
  artist: (r) => [['Lived', lived(r.birth_label, r.death_label, r.active_label)], ['Born in', r.born_in], ['Died in', r.died_in]],
  person: (r) => [['Kind', r.kind && r.kind !== 'person' ? r.kind : null], ['Lived', lived(r.birth_label, r.death_label, r.active_label)], ['Born in', r.born_in], ['Died in', r.died_in]],
  institution: (r) => [['Kind', r.kind], ['Place', r.place], ['Founded', r.founded_label], ['Closed', r.dissolved_label]],
  event: (r) => [['Kind', r.kind], ['Date', r.period_label], ['Place', r.place]],
  movement: (r) => [['Kind', r.kind], ['Period', r.period_label], ['Part of', r.part_of]],
  polity: (r) => [['Kind', r.kind], ['Period', r.period_label], ['Part of', r.part_of]],
  place: (r) => [['Kind', r.kind], ['In', r.part_of], ['Country', r.country_code], ['Existed', r.existed_label]],
  literature: (r) => [['Kind', r.kind], ['Author', r.author], ['Written', r.written_label], ['Part of', r.part_of]],
  term: (r) => [['Category', r.category], ['Broader term', r.part_of]],
  source: () => [],
};

/**
 * The cards of these entries ([{type, id}], in this order) for the account `owner`; `origin` = the admin host's
 * address (the reference images' links). Entries that no longer exist are left out.
 */
async function cards(db, entries, owner, origin) {
  const byType = new Map();
  for (const e of entries) {
    if (!QUERIES[e.type]) continue;
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type).push(String(e.id));
  }
  const found = new Map();   // 'type:id' → card
  let sources = null;
  for (const [type, ids] of byType) {
    const { rows } = await db.query(QUERIES[type], type === 'artwork' ? [ids, owner] : [ids]);
    if (type === 'source') sources = sources || await sourceCatalogue(db);
    for (const r of rows) {
      const card = { type, slug: r.slug, name: r.name, facts: [], text: excerpt(r.text), image: r.image || null, own: false };
      card.facts = FACTS[type](r).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '').map(([label, value]) => ({ label, value: String(value) }));
      if (type === 'artwork' && !card.image && r.own_image) Object.assign(card, { image: `${origin}/private-images/${r.own_image}?w=500`, own: true });
      // a source: learnt by its short reference ("Busch 1993") and its full entry, as the bibliography cites it
      if (type === 'source') {
        const c = sources.get(r.slug);
        if (c) Object.assign(card, { name: c.siglum, facts: [{ label: 'Full reference', value: stripTags(c.full) }], text: '' });
      }
      found.set(`${type}:${r.id}`, card);
    }
  }
  // key: 'type:id' of the entry (the caller matches its own data to the card; not for the browser)
  return entries.map((e) => { const c = found.get(`${e.type}:${e.id}`); return c ? { ...c, key: `${e.type}:${e.id}` } : null; }).filter(Boolean);
}
async function sourceCatalogue(db) {
  const { rows } = await db.query('SELECT * FROM bibliography');
  return catalogue(rows);
}

module.exports = { cards, excerpt };
