// Find freely usable images for an entry without a Wikidata item: Wikimedia Commons and three museums whose open-access
// APIs need no key. Only results whose licence allows reuse are returned, each with what an image needs
// (url, source page, licence, credit), so one click can add it.
//
//   commons    Commons API: file search (namespace 6), licence and author from the file's metadata
//   met        Metropolitan Museum: search → objects; only isPublicDomain (CC0) with a primary image
//   aic        Art Institute of Chicago: search with is_public_domain; images through its IIIF server
//   cleveland  Cleveland Museum of Art: open-access API with cc0 and has_image
//   rijks      Rijksmuseum: search API → Linked Art object → visual item → digital object (IIIF), only "downloadbaar"
//   europeana  Europeana (museums and archives across Europe): reusability=open (CC0, PDM, CC BY, CC BY-SA)
//   smithsonian Smithsonian Open Access: CC0 images only
//   japan      Japan Search (national portal: ColBase, Ritsumeikan ARC …): public domain, CC0, CC BY, CC BY-SA only
//   smk        SMK – Statens Museum for Kunst, Copenhagen: open API, public-domain works with images (IIIF)
//   dimu       DigitaltMuseum (about 300 Norwegian and Swedish museums): only records with a free licence
//
// Europeana (a Project key), the Smithsonian and DigitaltMuseum need an API key of our own: EUROPEANA_KEY,
// SMITHSONIAN_KEY, DIMU_KEY in the server's env file — without one the source isn't offered.
// Base URLs are configurable (COMMONS_BASE, MET_BASE, AIC_BASE, CLEVELAND_BASE, RIJKS_BASE, EUROPEANA_BASE,
// SMITHSONIAN_BASE, JAPANSEARCH_BASE) so the end-to-end tests can serve fixtures. Why not the museum websites' images directly: in Switzerland even simple photos are protected (50 years),
// so only explicitly released photos (CC0 / public domain / free licence) are offered.
const COMMONS = process.env.COMMONS_BASE || 'https://commons.wikimedia.org';
const MET = process.env.MET_BASE || 'https://collectionapi.metmuseum.org';
const AIC = process.env.AIC_BASE || 'https://api.artic.edu';
const CLEVELAND = process.env.CLEVELAND_BASE || 'https://openaccess-api.clevelandart.org';
const RIJKS = process.env.RIJKS_BASE || 'https://data.rijksmuseum.nl';
const RIJKS_ID = process.env.RIJKS_ID_BASE || 'https://id.rijksmuseum.nl';
const EUROPEANA = process.env.EUROPEANA_BASE || 'https://api.europeana.eu';
const SMITHSONIAN = process.env.SMITHSONIAN_BASE || 'https://api.si.edu';
const JAPANSEARCH = process.env.JAPANSEARCH_BASE || 'https://jpsearch.go.jp';
const SMK = process.env.SMK_BASE || 'https://api.smk.dk';
const DIMU = process.env.DIMU_BASE || 'https://api.dimu.org';
const DIMU_MEDIA = process.env.DIMU_MEDIA_BASE || 'https://mm.dimu.org';
const UA = 'arthistory-admin/1.0 (https://arthistory.piogino.ch)';
const LIMIT = 16;

const SOURCES = {
  commons: { name: 'Wikimedia Commons', search: commons },
  met: { name: 'Metropolitan Museum', search: met },
  aic: { name: 'Art Institute of Chicago', search: aic },
  cleveland: { name: 'Cleveland Museum of Art', search: cleveland },
  rijks: { name: 'Rijksmuseum', search: rijks },
  europeana: { name: 'Europeana', search: europeana },
  smithsonian: { name: 'Smithsonian', search: smithsonian },
  japan: { name: 'Japan Search', search: japan },
  smk: { name: 'SMK (Copenhagen)', search: smk },
  dimu: { name: 'DigitaltMuseum', search: dimu },
};
// Sources with an API key are offered only with a key of our own: their demo keys are for testing, not for a live
// site — DigitaltMuseum gives keys only to museums/organisations with an agreement; Europeana's production use needs a
// (free) Project key, its Personal keys are for non-production use; api.data.gov's DEMO_KEY is for exploring.
for (const [source, key] of [['dimu', 'DIMU_KEY'], ['europeana', 'EUROPEANA_KEY'], ['smithsonian', 'SMITHSONIAN_KEY']]) {
  if (!process.env[key]) delete SOURCES[source];
}

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

// Rijksmuseum: the search gives object ids; each object → its visual item → its digital object (three requests each,
// so only the first eight). The IIIF address is resized for the page (1200 px) and the thumbnail (400 px).
async function rijks(q) {
  const ld = (id) => getJson(id, { Accept: 'application/ld+json' });
  let found = await getJson(`${RIJKS}/search/collection?${new URLSearchParams({ title: q, imageAvailable: 'true' })}`, { Accept: 'application/ld+json' });
  if (!(found.orderedItems || []).length) found = await getJson(`${RIJKS}/search/collection?${new URLSearchParams({ creator: q, imageAvailable: 'true' })}`, { Accept: 'application/ld+json' });
  const ids = (found.orderedItems || []).map((x) => x.id).filter((id) => String(id).startsWith(`${RIJKS_ID}/`)).slice(0, 8);
  const one = async (id) => {
    const o = await ld(id);
    const visual = ((o.shows || [])[0] || {}).id;
    if (!visual || !visual.startsWith(`${RIJKS_ID}/`)) return null;
    const digital = (((await ld(visual)).digitally_shown_by || [])[0] || {}).id;
    if (!digital || !digital.startsWith(`${RIJKS_ID}/`)) return null;
    const d = await ld(digital);
    const free = (d.referred_to_by || []).some((x) => x.content === 'downloadbaar');
    const iiif = ((d.access_point || [])[0] || {}).id;
    if (!free || !iiif) return null;
    const names = (o.identified_by || []).filter((x) => x.type === 'Name');
    const number = ((o.identified_by || []).find((x) => x.type === 'Identifier') || {}).content;
    const title = (names.find((x) => (x.language || []).some((l) => /english|300388277/i.test(`${l._label || ''} ${l.id || ''}`))) || names[1] || names[0] || {}).content;
    return { url: iiif.replace('/full/max/', '/full/1200,/'), thumb: iiif.replace('/full/max/', '/full/400,/'),
      source_url: number ? `https://www.rijksmuseum.nl/en/collection/${number}` : id, license: 'Public domain (Rijksmuseum)', credit: 'Rijksmuseum, Amsterdam',
      title: title || number || '', by: null };
  };
  return (await Promise.all(ids.map((id) => one(id).catch(() => null)))).filter(Boolean);
}

// Europeana: only reusable rights (reusability=open), the full image (edmIsShownBy) or else the preview
const RIGHTS = [[/publicdomain\/mark/, 'Public domain (PDM)'], [/publicdomain\/zero/, 'CC0'], [/licenses\/by-sa\/([\d.]+)/, 'CC BY-SA $1'], [/licenses\/by\/([\d.]+)/, 'CC BY $1']];
const rightsLabel = (uri) => { for (const [re, label] of RIGHTS) { const m = re.exec(uri || ''); if (m) return label.replace('$1', m[1] || ''); } return null; };
async function europeana(q) {
  const data = await getJson(`${EUROPEANA}/record/v2/search.json?${new URLSearchParams({ wskey: process.env.EUROPEANA_KEY, query: q,
    reusability: 'open', media: 'true', qf: 'TYPE:IMAGE', rows: String(LIMIT), profile: 'rich' })}`);
  return (data.items || []).flatMap((it) => {
    const license = rightsLabel((it.rights || [])[0]);
    const url = (it.edmIsShownBy || [])[0] || (it.edmPreview || [])[0];
    if (!license || !url) return [];
    return [{ url, thumb: (it.edmPreview || [])[0] || url, source_url: (it.edmIsShownAt || [])[0] || it.guid, license,
      credit: (it.dataProvider || [])[0] || 'Europeana', title: (it.title || [])[0] || '', by: [(it.dcCreator || [])[0], (it.year || [])[0]].filter(Boolean).join(', ') || null }];
  });
}

// Smithsonian Open Access: CC0 media of the objects found
async function smithsonian(q) {
  const data = await getJson(`${SMITHSONIAN}/openaccess/api/v1.0/search?${new URLSearchParams({ q: `${q} AND online_media_type:"Images"`, rows: String(LIMIT),
    api_key: process.env.SMITHSONIAN_KEY })}`);
  return (((data.response || {}).rows) || []).flatMap((r) => {
    const c = r.content || {};
    const dnr = c.descriptiveNonRepeating || {};
    const media = (((dnr.online_media || {}).media) || []).find((m) => m.type === 'Images' && (m.usage || {}).access === 'CC0');
    if (!media || !media.content) return [];
    const name = ((c.freetext || {}).name || [])[0];
    return [{ url: media.content, thumb: media.thumbnail || media.content, source_url: dnr.record_link || dnr.guid, license: 'Public domain (CC0)',
      credit: dnr.data_source || 'Smithsonian Institution', title: r.title || (dnr.title || {}).content || '', by: name ? name.content : null }];
  });
}

// Japan Search: the national portal; only records whose content is public domain or under CC0 / CC BY / CC BY-SA
const JP_RIGHTS = { pdm: 'Public domain (PDM)', cc0: 'CC0', ccby: 'CC BY', ccbysa: 'CC BY-SA' };
async function japan(q) {
  const data = await getJson(`${JAPANSEARCH}/api/item/search/jps-cross?${new URLSearchParams({ keyword: q, size: String(LIMIT * 2), 'f-contents': 'thumb' })}`);
  return (data.list || []).flatMap((it) => {
    const c = it.common || {};
    const license = JP_RIGHTS[c.contentsRightsType];
    const url = (c.contentsUrl || [])[0] || (c.thumbnailUrl || [])[0];
    if (!license || !url) return [];
    return [{ url, thumb: (c.thumbnailUrl || [])[0] || url, source_url: c.linkUrl || `https://jpsearch.go.jp/item/${it.id}`, license,
      credit: require('./japansearch').holder(c.provider) || 'Japan Search',
      title: [c.title, c.titleYomi && `(${c.titleYomi})`].filter(Boolean).join(' '), by: [(c.contributor || [])[0], (c.temporal || [])[0]].filter(Boolean).join(', ') || null }];
  }).slice(0, LIMIT);
}

// SMK: public-domain works with an image; the IIIF server's 1200 px version, else its own thumbnail
async function smk(q) {
  const data = await getJson(`${SMK}/api/v1/art/search/?${new URLSearchParams({ keys: q, offset: '0', rows: String(LIMIT),
    filters: '[has_image:true],[public_domain:true]' })}`);
  return (data.items || []).filter((it) => it.public_domain && (it.image_iiif_id || it.image_thumbnail)).map((it) => {
    const p = (it.production || [])[0] || {};
    const title = ((it.titles || []).find((x) => /engelsk|english/i.test(x.language || '')) || (it.titles || [])[0] || {}).title;
    return { url: it.image_iiif_id ? `${it.image_iiif_id}/full/1200,/0/default.jpg` : it.image_thumbnail,
      thumb: it.image_iiif_id ? `${it.image_iiif_id}/full/400,/0/default.jpg` : it.image_thumbnail,
      source_url: it.frontend_url || `https://open.smk.dk/artwork/image/${it.object_number}`, license: 'Public domain (PDM)', credit: 'SMK – Statens Museum for Kunst',
      title: title || it.object_number, by: [p.creator, ((it.production_date || [])[0] || {}).period].filter(Boolean).join(', ') || null };
  });
}

// DigitaltMuseum: the licence is part of each search hit ("CC by-sa", "CC pdm", "CC CC0 1.0" …) — only free ones;
// images from its media server. Needs DIMU_KEY (see SOURCES).
const DIMU_LICENSES = { 'CC pdm': 'Public domain (PDM)', 'CC CC0 1.0': 'CC0', 'CC by': 'CC BY', 'CC by-sa': 'CC BY-SA' };
const DIMU_OWNERS = { 'NMK-B': 'Nasjonalmuseet', 'NMK-A': 'Nasjonalmuseet', 'NMK-D': 'Nasjonalmuseet', 'NF': 'Norsk Folkemuseum', 'MUH': 'Munchmuseet',
  'OB': 'Oslo Museum', 'NM': 'Nationalmuseum, Stockholm', 'S-NM': 'Nationalmuseum, Stockholm' };
async function dimu(q) {
  const data = await getJson(`${DIMU}/api/solr/select?${new URLSearchParams([['q', q], ['wt', 'json'], ['rows', String(LIMIT * 3)],
    ['api.key', process.env.DIMU_KEY], ['fq', 'artifact.hasPictures:true'], ['fq', 'artifact.type:(Thing OR Fineart OR Photograph)']])}`);
  return (((data.response || {}).docs) || []).flatMap((d) => {
    const license = DIMU_LICENSES[(d['artifact.ingress.license'] || [])[0]];
    const media = d['artifact.defaultMediaIdentifier'];
    if (!license || !media) return [];
    const owner = d['identifier.owner'] || '';
    return [{ url: `${DIMU_MEDIA}/image/${media}?dimension=1200x1200`, thumb: `${DIMU_MEDIA}/image/${media}?dimension=400x400`,
      source_url: `https://digitaltmuseum.no/${d['artifact.uniqueId']}`, license, credit: DIMU_OWNERS[owner] || owner || 'DigitaltMuseum',
      title: d['artifact.ingress.title'] || '', by: [d['artifact.ingress.producer'], d['artifact.ingress.production.fromYear']].filter(Boolean).join(', ') || null }];
  }).slice(0, LIMIT);
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
