// ---------------------------------------------------------------------------------------------------------------
// Further numbers of an artwork (table artwork_numbers, migration 048): the owner's inventory number when the work
// is on loan elsewhere (the Bührle Foundation's "99" for Kunsthaus "BU 0099"), former inventory numbers, catalogue
// raisonné numbers (a source of the bibliography). The main inventory number stays a field of the artwork — the
// number of the institution where it is now. An institution gives each number once, across both (a trigger).
// Saved immediately, like images and provenance steps — but entered on the edit page, under the inventory number: the
// inputs sit inside the entry's form yet belong to two small forms after it (the HTML form="…" attribute; forms can't
// nest), so the shared working copy (collab.js, form.elements) never sees them. The artwork's page lists them.
// ---------------------------------------------------------------------------------------------------------------
const { html } = require('./html');

class NumberError extends Error {}

async function list(db, artworkId) {
  const { rows } = await db.query(`
    SELECT n.id, n.number, n.label, i.slug AS institution_slug, i.name AS institution_name, b.slug AS source_slug, b.name AS source_name
    FROM artwork_numbers n LEFT JOIN institutions i ON i.id = n.institution_id LEFT JOIN bibliography b ON b.id = n.source_id
    WHERE n.artwork_id = $1 ORDER BY n.position, n.id`, [artworkId]);
  return rows;
}

async function byId(db, id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query(`SELECT n.*, w.slug AS artwork_slug FROM artwork_numbers n JOIN artworks w ON w.id = n.artwork_id
    WHERE n.id = $1`, [id]);
  return rows[0] || null;
}

// Form → row; institution and source are slugs (pickers). Throws NumberError.
async function add(db, artworkId, body) {
  const text = (k) => String(body[k] ?? '').trim() || null;
  const number = text('number');
  if (!number) throw new NumberError('Number: required.');
  const [inst, src, label] = [text('institution'), text('source'), text('label')];
  if (inst && src) throw new NumberError('A number belongs either to an institution or to a catalogue — not both.');
  if (!inst && !src && !label) throw new NumberError('Say whose number it is: an institution, a catalogue (source), or a label such as “Lugt”.');
  const idOf = async (type, slug) => {
    const { rows } = await db.query('SELECT entity_id($1, $2) AS id', [type, slug]);
    if (rows[0].id === null) throw new NumberError(`${type === 'institution' ? 'Institution' : 'Source'} “${slug}” does not exist — pick one from the suggestions.`);
    return rows[0].id;
  };
  const institutionId = inst ? await idOf('institution', inst) : null;
  const sourceId = src ? await idOf('source', src) : null;
  await db.query(`INSERT INTO artwork_numbers (artwork_id, number, institution_id, source_id, label, position)
    VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(position) + 1, 0) FROM artwork_numbers WHERE artwork_id = $1))`,
  [artworkId, number, institutionId, sourceId, label]);
}

async function remove(db, id) {
  await db.query('DELETE FROM artwork_numbers WHERE id = $1', [id]);
}

// Postgres errors of this table → a sentence (null: not ours)
function errorText(err) {
  if (err instanceof NumberError) return err.message;
  if (err.constraint === 'institution_number_unique') return `This number is taken: ${err.message.replace(/^number /, '')}. The same work entered twice? (Merge… on its page)`;
  if (err.constraint === 'artwork_numbers_source_unique') return 'This catalogue already has that number for another work — the same work entered twice? (Merge… on its page)';
  return null;
}

const whose = (n) => (n.institution_slug ? html`<a href="/institutions/${n.institution_slug}">${n.institution_name}</a>`
  : n.source_slug ? html`<a href="/bibliography/${n.source_slug}">${n.source_name}</a> <span class="tag">catalogue</span>` : html`<span class="muted">—</span>`);

// The artwork's page: the list, to change on the edit page.
function listSection({ e, numbers }) {
  return html`<section id="numbers"><h2>Further numbers</h2>
    ${numbers.length ? html`<div class="table-wrap"><table><thead><tr><th>Number</th><th>Whose</th><th>Note</th></tr></thead><tbody>
      ${numbers.map((n) => html`<tr><td><b>${n.number}</b></td><td>${whose(n)}</td><td>${n.label || ''}</td></tr>`)}
      </tbody></table></div>` : html`<p class="muted small">None.</p>`}
    <p class="small"><a href="/artworks/${e.slug}/edit#numbers">Add or remove numbers on the edit page →</a></p></section>`;
}

// The edit page (inside the entry's form, so every control names its own form: formsAfter() renders those) — or, with
// standalone, a page of its own (a refused number, shown again with what was typed).
function section({ e, numbers, values = {}, standalone = false }) {
  const v = (k) => values[k] || '';
  const own = standalone ? '' : html` form="numbers-add"`;
  const back = standalone ? '' : '?back=edit';
  const fields = html`<div class="field-pair"><div class="field"><label for="n-number">Number</label><input id="n-number" name="number" value="${v('number')}" required placeholder="e.g. 99 · 204 · 1923/5"${own}></div>
          <div class="field"><label for="n-label">Note</label><input id="n-label" name="label" value="${v('label')}" placeholder="e.g. former inventory number · Lugt"${own}></div></div>
        <div class="field-pair"><div class="field"><label for="n-institution">Institution (its inventory number)</label>
            <input id="n-institution" name="institution" value="${v('institution')}" data-lookup="institution" autocomplete="off" placeholder="the owner, a former holder"${own}></div>
          <div class="field"><label for="n-source">or catalogue (a source)</label>
            <input id="n-source" name="source" value="${v('source')}" data-lookup="source" autocomplete="off" placeholder="the catalogue raisonné"${own}></div></div>
        <div class="actions"><button${own}>Add</button></div>`;
  return html`<div id="numbers" class="numbers-edit"><h3>Further numbers</h3>
    <p class="muted small">Besides the main inventory number (the institution where it is now): the owner's number when it is
      on loan, former inventory numbers, the number in a catalogue raisonné. Saved at once, not with Publish.</p>
    ${numbers.length ? html`<div class="table-wrap"><table><thead><tr><th>Number</th><th>Whose</th><th>Note</th><th></th></tr></thead><tbody>
      ${numbers.map((n) => html`<tr><td><b>${n.number}</b></td><td>${whose(n)}</td><td>${n.label || ''}</td>
        <td>${standalone ? '' : html`<button class="link" form="numbers-delete" formaction="/numbers/${n.id}/delete${back}">remove</button>`}</td></tr>`)}
      </tbody></table></div>` : ''}
    <details${values.number ? ' open' : ''}><summary class="button secondary">+ Add a number</summary>
      ${standalone ? html`<form method="post" action="/artworks/${e.slug}/numbers?back=edit" class="form">${fields}</form>` : html`<div class="form">${fields}</div>`}
    </details></div>`;
}

// The two forms the edit page's number controls belong to — after the entry's form.
const formsAfter = (e) => html`<form id="numbers-add" method="post" action="/artworks/${e.slug}/numbers?back=edit" hidden></form>
  <form id="numbers-delete" method="post" hidden></form>`;

module.exports = { NumberError, list, byId, add, remove, errorText, section, listSection, formsAfter };
