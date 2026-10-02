// Image URLs at the size a page needs. Wikimedia Commons serves thumbnails in standard widths (120, 250, 330, 500,
// 960, 1280 … px) — a list needs 120 px (~6 KB) rather than the stored 1280 px (~250 KB). Other hosts: unchanged.
//   …/commons/thumb/b/b5/Name.jpg/1280px-Name.jpg  → …/250px-Name.jpg
//   …/commons/b/b5/Name.jpg (original)             → …/commons/thumb/b/b5/Name.jpg/250px-Name.jpg
const WIKIMEDIA = /^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/(commons|[a-z]+)\//;

function thumbUrl(url, width) {
  if (!url || !WIKIMEDIA.test(url)) return url || null;
  if (/\/thumb\//.test(url) && /\/\d+px-[^/]+$/.test(url)) return url.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
  const m = /^(https:\/\/[^/]+\/wikipedia\/[a-z]+)\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+\.(?:jpe?g|png|gif|webp))$/i.exec(url);
  return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/${width}px-${m[4]}` : url;
}

// ---------------------------------------------------------------------------------------------------------------
// Several images per artwork / artist / institution (table images, migration 017). position orders them; the first
// is the main image (list thumbnail, preview, the API's image_url). Changes are saved immediately, like relationships.
// ---------------------------------------------------------------------------------------------------------------
const { html } = require('./html');
const { BY_TYPE, IMAGE_FK } = require('../content');

class ImageError extends Error {}
const FIELDS = ['url', 'source_url', 'license', 'credit', 'caption'];

// Form body → values for INSERT/UPDATE, in FIELDS order. Throws ImageError with a message for the form.
function fromForm(body) {
  const v = Object.fromEntries(FIELDS.map((k) => [k, String(body[k] ?? '').trim()]));
  if (!/^https:\/\/\S+$/.test(v.url)) throw new ImageError('Image address: an https:// link to the image file is needed.');
  if (v.source_url && !/^https:\/\/\S+$/.test(v.source_url)) throw new ImageError('Source page: must be an https:// link (or empty).');
  for (const k of FIELDS) if (v[k].length > (k.endsWith('url') ? 2000 : 500)) throw new ImageError(`${k.replace('_', ' ')}: too long.`);
  return FIELDS.map((k) => v[k] || null);
}

// The image with the entity it belongs to (for the edit page and the redirect back).
async function byId(db, id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query(`
    SELECT i.*, e.type::text AS type, e.slug, e.name FROM images i
    JOIN entity_index e ON (e.type, e.id) = (CASE WHEN i.artwork_id IS NOT NULL THEN 'artwork'
                                                  WHEN i.artist_id IS NOT NULL THEN 'artist' ELSE 'institution' END::entity_type,
                                             coalesce(i.artwork_id, i.artist_id, i.institution_id))
    WHERE i.id = $1`, [id]);
  if (!rows.length) return null;
  return { ...rows[0], entityUrl: `/${BY_TYPE[rows[0].type].folder}/${rows[0].slug}` };
}

async function add(db, type, entityId, values) {
  const fk = IMAGE_FK[type];
  // appended at the end; the first image added becomes the main image
  await db.query(`INSERT INTO images (${fk}, position, ${FIELDS.join(', ')})
    VALUES ($1, (SELECT coalesce(max(position) + 1, 0) FROM images WHERE ${fk} = $1), $2, $3, $4, $5, $6)`, [entityId, ...values]);
}

async function update(db, id, values) {
  await db.query(`UPDATE images SET ${FIELDS.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...values]);
}

// dir: up | down | first. Renumbers the entity's images 0, 1, 2 … in the new order (only changed rows are written,
// so the history shows exactly which positions moved).
async function move(db, img, dir) {
  const fk = IMAGE_FK[img.type];
  const { rows } = await db.query(`SELECT id, position FROM images WHERE ${fk} = $1 ORDER BY position, id FOR UPDATE`, [img[fk]]);
  const ids = rows.map((r) => r.id);
  const at = ids.indexOf(img.id);
  const to = dir === 'first' ? 0 : dir === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length || to === at) return;
  ids.splice(to, 0, ...ids.splice(at, 1));
  for (const [pos, id] of ids.entries()) {
    if (rows.find((r) => r.id === id).position !== pos) await db.query('UPDATE images SET position = $2 WHERE id = $1', [id, pos]);
  }
}

async function licenses(db) {
  return (await db.query('SELECT DISTINCT license FROM images WHERE license IS NOT NULL ORDER BY 1')).rows.map((r) => r.license);
}

function form({ action, img = {}, submit, licenseList = [] }) {
  const input = (k, label, extra = '') => html`<div class="field"><label for="img-${k}">${label}</label>
    <input id="img-${k}" name="${k}" value="${img[k] || ''}"${k === 'license' ? html` list="img-license-list" autocomplete="off"` : ''}${extra}></div>`;
  return html`<form method="post" action="${action}" class="form image-form">
    ${input('url', 'Image address (https://…, the file itself)', ' required')}
    ${input('source_url', 'Source page (e.g. the Commons file page)')}
    ${input('caption', 'Caption (e.g. "Back view", "Detail: signature")')}
    <div class="row">${input('credit', 'Credit (author / photographer)')}${input('license', 'License')}</div>
    <datalist id="img-license-list">${licenseList.map((v) => html`<option value="${v}">`)}</datalist>
    <div class="actions"><button>${submit}</button></div></form>`;
}

// The "Images" section of an entry's page: all images in order, the first marked as main; reorder, edit, add.
function section({ t, e, images, licenseList }) {
  const base = `/${t.folder}/${e.slug}`;
  const moveBtn = (img, dir, label, title) => html`<form method="post" action="/images/${img.id}/move" class="inline">
    <input type="hidden" name="dir" value="${dir}"><button class="link" title="${title}">${label}</button></form>`;
  return html`<h2 id="images">Images</h2>
    ${images.length ? html`<div class="image-list">${images.map((img, i) => html`<figure class="image-item${i === 0 ? ' main' : ''}">
      <a href="${img.source_url || img.url}" target="_blank" rel="noopener"><img src="${thumbUrl(img.url, 250)}" alt="${img.caption || ''}" loading="lazy" decoding="async"></a>
      <figcaption>${i === 0 ? html`<span class="tag">main image</span> ` : ''}${img.caption || ''}
        <div class="muted small">${[img.credit, img.license].filter(Boolean).join(' · ') || 'no credit / license yet'}</div>
        <div class="image-actions">${i > 0 ? moveBtn(img, 'up', '↑', 'Move earlier') : ''}${i < images.length - 1 ? moveBtn(img, 'down', '↓', 'Move later') : ''}
          ${i > 0 ? moveBtn(img, 'first', 'make main', 'Make this the main image') : ''}<a href="/images/${img.id}/edit">edit</a></div></figcaption>
    </figure>`)}</div>` : html`<p class="muted">None yet.</p>`}
    <details><summary><b>+ Add image</b></summary>${form({ action: `${base}/images`, submit: 'Add', licenseList })}
      <p class="muted small">Tip: "Wikidata…" offers an item's Commons images with license and credit filled in.</p></details>`;
}

module.exports = { thumbUrl, ImageError, fromForm, byId, add, update, move, licenses, form, section };
