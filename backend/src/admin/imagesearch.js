// Find freely usable images for an entry without a Wikidata item: Wikimedia Commons and three museums whose open-access
// APIs need no key. Only results whose licence allows reuse are returned, each with what an image needs
// (url, source page, licence, credit), so one click can add it.
//
//   commons    Commons API: file search (namespace 6), licence and author from the file's metadata
//   met        Metropolitan Museum: search → objects; only isPublicDomain (CC0) with a primary image
//   aic        Art Institute of Chicago: search with is_public_domain; images through its IIIF server
//   cleveland  Cleveland Museum of Art: open-access API with cc0 and has_image
//
// Base URLs are configurable (COMMONS_BASE, MET_BASE, AIC_BASE, CLEVELAND_BASE) so the end-to-end tests can serve
// fixtures. Why not the museum websites' images directly: in Switzerland even simple photos are protected (50 years),
// so only explicitly released photos (CC0 / public domain / free licence) are offered.
const COMMONS = process.env.COMMONS_BASE || 'https://commons.wikimedia.org';
const MET = process.env.MET_BASE || 'https://collectionapi.metmuseum.org';
const AIC = process.env.AIC_BASE || 'https://api.artic.edu';
const CLEVELAND = process.env.CLEVELAND_BASE || 'https://openaccess-api.clevelandart.org';
const UA = 'arthistory-admin/1.0 (https://arthistory.piogino.ch)';
const LIMIT = 16;

const SOURCES = {
  commons: { name: 'Wikimedia Commons', search: commons },
  met: { name: 'Metropolitan Museum', search: met },
  aic: { name: 'Art Institute of Chicago', search: aic },
  cleveland: { name: 'Cleveland Museum of Art', search: cleveland },
};

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const clean = (u) => (u ? u.split('?')[0] : u);

// → [{ url, thumb, source_url, license, credit, title, by }]
async function commons(q) {
  const data = await getJson(`${COMMONS}/w/api.php?${new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: q, gsrnamespace: '6', gsrlimit: String(LIMIT),
    prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '1200', format: 'json' })}`);
  return Object.values((data.query && data.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).flatMap((p) => {
    const info = p.imageinfo && p.imageinfo[0];
    if (!info || !/^image\//.test(info.mime || 'image/')) return [];
    const m = info.extmetadata || {};
    const license = stripTags(m.LicenseShortName && m.LicenseShortName.value);
    if (!license) return [];  // no licence statement: not offered
    return [{ url: clean(info.thumburl || info.url), thumb: clean(info.thumburl || info.url), source_url: info.descriptionurl,
      license, credit: stripTags(m.Artist && m.Artist.value) || null,
      title: stripTags(m.ObjectName && m.ObjectName.value) || String(p.title || '').replace(/^File:/, ''), by: null }];
  });
}

async function met(q) {
  // v1.1 (Elastic, paged) since the Met retired /v1/search on 2026-10-01; objects are still /v1/objects/<id>
  const found = await getJson(`${MET}/public/collection/v1.1/search?${new URLSearchParams({ hasImages: 'true', q, limit: String(LIMIT) })}`);
  const ids = (found.objectIDs || []).slice(0, LIMIT);
  const objects = await Promise.all(ids.map((id) => getJson(`${MET}/public/collection/v1/objects/${id}`).catch(() => null)));
  // the "web-large" version (~1000–1300 px) rather than the original (often several MB)
  return objects.filter((o) => o && o.isPublicDomain && o.primaryImage).map((o) => ({
    url: o.primaryImageSmall || o.primaryImage, thumb: o.primaryImageSmall || o.primaryImage, source_url: o.objectURL,
    license: 'Public domain (CC0)', credit: 'The Metropolitan Museum of Art',
    title: o.title, by: [o.artistDisplayName, o.objectDate].filter(Boolean).join(', ') || null }));
}

async function aic(q) {
  const data = await getJson(`${AIC}/api/v1/artworks/search?${new URLSearchParams({
    q, 'query[term][is_public_domain]': 'true', limit: String(LIMIT),
    fields: 'id,title,artist_display,date_display,image_id,is_public_domain' })}`,
  { 'AIC-User-Agent': UA });  // the AIC asks API users to identify themselves this way
  const iiif = (data.config && data.config.iiif_url) || 'https://www.artic.edu/iiif/2';
  return (data.data || []).filter((a) => a.image_id && a.is_public_domain).map((a) => ({
    url: `${iiif}/${a.image_id}/full/1200,/0/default.jpg`, thumb: `${iiif}/${a.image_id}/full/400,/0/default.jpg`,
    source_url: `https://www.artic.edu/artworks/${a.id}`, license: 'Public domain (CC0)', credit: 'Art Institute of Chicago',
    title: a.title, by: [String(a.artist_display || '').split('\n')[0], a.date_display].filter(Boolean).join(', ') || null }));
}

async function cleveland(q) {
  const data = await getJson(`${CLEVELAND}/api/artworks/?${new URLSearchParams({ q, cc0: '1', has_image: '1', limit: String(LIMIT) })}`);
  return (data.data || []).filter((a) => a.images && a.images.web && a.share_license_status === 'CC0').map((a) => ({
    url: a.images.web.url, thumb: a.images.web.url, source_url: a.url, license: 'Public domain (CC0)',
    credit: 'Cleveland Museum of Art', title: a.title,
    by: [a.creators && a.creators[0] && a.creators[0].description, a.creation_date].filter(Boolean).join(', ') || null }));
}

// https only (images must be https, migration 017); never throws — an unreachable source is an error message
async function find(source, q) {
  const s = SOURCES[source];
  if (!s || !q) return { results: [], error: null };
  try {
    return { results: (await s.search(q)).filter((r) => /^https:\/\//.test(r.url) && (!r.source_url || /^https?:\/\//.test(r.source_url))), error: null };
  } catch (err) {
    return { results: [], error: `${s.name}: ${err.message}` };
  }
}

module.exports = { SOURCES, find };
