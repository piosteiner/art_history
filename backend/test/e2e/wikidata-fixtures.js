// A stand-in for Wikidata and Wikimedia Commons during the end-to-end tests (port 3007): answers the three API calls
// src/admin/wikidata.js makes (wbgetentities, wbsearchentities, Commons imageinfo) from the data below, so the tests
// are independent of the internet and of edits on Wikidata. The test server points WIKIDATA_BASE/COMMONS_BASE here.
const http = require('http');

const G = 'http://www.wikidata.org/entity/Q1985727';
const time = (t, precision) => ({ time: t, precision, calendarmodel: G });
const item = (id) => ({ 'entity-type': 'item', id });
const stmt = (value, qualifiers = {}) => ({ rank: 'normal', mainsnak: { datavalue: { value } },
  qualifiers: Object.fromEntries(Object.entries(qualifiers).map(([p, v]) => [p, [{ datavalue: { value: v } }]])) });
const labels = (en, extra = {}) => Object.fromEntries(Object.entries({ en, ...extra }).map(([language, value]) => [language, { language, value }]));

const ENTITIES = {
  Q100: { id: 'Q100', labels: labels('Claude Monet', { ja: 'クロード・モネ', ru: 'Клод Моне' }),
    aliases: { en: [{ value: 'Oscar-Claude Monet' }] }, descriptions: { en: { value: 'French painter (1840–1926)' } },
    claims: { P31: [stmt(item('Q5'))], P569: [stmt(time('+1840-11-14T00:00:00Z', 11))], P570: [stmt(time('+1926-12-05T00:00:00Z', 11))],
      P19: [stmt(item('Q90'))], P20: [stmt(item('Q101'))], P135: [stmt(item('Q102'))], P1066: [stmt(item('Q103'))],
      P18: [stmt('Claude Monet 1899 Nadar crop.jpg')], P27: [stmt(item('Q108'))],
      P937: [stmt(item('Q90'), { P580: time('+1859-00-00T00:00:00Z', 9), P582: time('+1860-00-00T00:00:00Z', 9) })] } },
  Q90: { id: 'Q90', labels: labels('Paris'), descriptions: { en: { value: 'capital of France' } },
    claims: { P31: [stmt(item('Q515'))], P625: [stmt({ latitude: 48.8567, longitude: 2.3522, globe: 'http://www.wikidata.org/entity/Q2' })] } },
  Q101: { id: 'Q101', labels: labels('Giverny'), descriptions: { en: { value: 'commune in Eure, France' } },
    claims: { P31: [stmt(item('Q484170'))], P625: [stmt({ latitude: 49.0758, longitude: 1.5339, globe: 'http://www.wikidata.org/entity/Q2' })] } },
  Q102: { id: 'Q102', labels: labels('Impressionism'), descriptions: { en: { value: 'art movement' } }, claims: { P31: [stmt(item('Q968159'))] } },
  Q103: { id: 'Q103', labels: labels('Charles Gleyre'), descriptions: { en: { value: 'Swiss painter' } },
    claims: { P31: [stmt(item('Q5'))], P569: [stmt(time('+1806-05-02T00:00:00Z', 11))] } },
  Q104: { id: 'Q104', labels: labels('Impression, Sunrise'), descriptions: { en: { value: 'painting by Claude Monet' } },
    claims: { P31: [stmt(item('Q3305213'))], P170: [stmt(item('Q100'))], P571: [stmt(time('+1872-00-00T00:00:00Z', 9))],
      P1476: [stmt({ text: 'Impression, soleil levant', language: 'fr' })],
      P195: [stmt(item('Q105'))], P217: [stmt('4014', { P195: item('Q105') })], P18: [stmt('Monet - Impression, Sunrise.jpg'), stmt('Impression Sunrise back.jpg')],
      P2048: [stmt({ amount: '+48', unit: 'http://www.wikidata.org/entity/Q174728' })],   // 48 cm
      P2049: [stmt({ amount: '+630', unit: 'http://www.wikidata.org/entity/Q174789' })],  // 630 mm = 63 cm
      P186: [stmt(item('Q106')), stmt(item('Q107'))] } },
  Q108: { id: 'Q108', labels: labels('France'), descriptions: { en: { value: 'country in Western Europe' } },
    claims: { P31: [stmt(item('Q6256'))], P297: [stmt('FR')], P571: [stmt(time('+1792-09-21T00:00:00Z', 11))] } },
  Q109: { id: 'Q109', labels: labels('The Great Wave', { ja: '神奈川沖浪裏' }), descriptions: { en: { value: 'woodblock print' } },
    claims: { P31: [stmt(item('Q3305213'))], P1476: [stmt({ text: '神奈川沖浪裏', language: 'ja' })], P2125: [stmt('Kanagawa-oki nami ura')],
      P179: [stmt(item('Q121'), { P1545: '1' })] } },
  Q121: { id: 'Q121', labels: labels('Thirty-six Views of Mount Fuji'), descriptions: { en: { value: 'series of prints by Hokusai' } },
    claims: { P31: [stmt(item('Q15709879'))] } },
  Q34600: { id: 'Q34600', labels: labels('Kyoto'), descriptions: { en: { value: 'city in Japan' } },
    claims: { P31: [stmt(item('Q515'))], P625: [stmt({ latitude: 35.0117, longitude: 135.7683, globe: 'http://www.wikidata.org/entity/Q2' })] } },
  Q106: { id: 'Q106', labels: labels('oil paint'), descriptions: { en: { value: 'paint' } }, claims: {} },
  Q107: { id: 'Q107', labels: labels('canvas'), descriptions: { en: { value: 'fabric' } }, claims: {} },
  // exact places (institutions): P131 names a city district and the city; P625 + P6375 give the building
  Q110: { id: 'Q110', labels: labels('Kunsthaus Test'), descriptions: { en: { value: 'art museum in Zurich' } },
    claims: { P31: [stmt(item('Q207694'))], P131: [stmt(item('Q111')), stmt(item('Q112'))],
      P625: [stmt({ latitude: 47.37028, longitude: 8.54806, globe: 'http://www.wikidata.org/entity/Q2' })], P6375: [stmt({ text: 'Heimplatz 1, 8001 Zürich', language: 'de' })] } },
  Q111: { id: 'Q111', labels: labels('Kreis 1'), descriptions: { en: { value: 'district of Zurich' } },
    claims: { P31: [stmt(item('Q19644586'))], P131: [stmt(item('Q112'))], P625: [stmt({ latitude: 47.37, longitude: 8.54, globe: 'http://www.wikidata.org/entity/Q2' })] } },
  Q112: { id: 'Q112', labels: labels('Zurich'), descriptions: { en: { value: 'city in Switzerland' } },
    claims: { P31: [stmt(item('Q515'))], P625: [stmt({ latitude: 47.37444, longitude: 8.54111, globe: 'http://www.wikidata.org/entity/Q2' })] } },
  Q113: { id: 'Q113', labels: labels('District Gallery Test'), descriptions: { en: { value: 'gallery' } },  // no coordinates: the settlement
    claims: { P31: [stmt(item('Q1007870'))], P131: [stmt(item('Q111'))] } },
  Q114: { id: 'Q114', labels: labels('Kunsthaus Library Test'), descriptions: { en: { value: 'library in the Kunsthaus' } },  // same building, 30 m
    claims: { P31: [stmt(item('Q7075'))], P131: [stmt(item('Q111'))],
      P625: [stmt({ latitude: 47.37050, longitude: 8.54830, globe: 'http://www.wikidata.org/entity/Q2' })] } },
  Q122: { id: 'Q122', labels: labels('Hans Wendland Test'), descriptions: { en: { value: 'German art dealer' } },  // a person (not an artist)
    claims: { P31: [stmt(item('Q5'))], P569: [stmt(time('+1880-01-01T00:00:00Z', 9))], P18: [stmt('Hans Adolf Wendland.jpg')] } },
  Q105: { id: 'Q105', labels: labels('Musée Marmottan Monet'), descriptions: { en: { value: 'art museum in Paris' } }, claims: { P31: [stmt(item('Q207694'))] } },
};

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.searchParams;
  const json = (data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/w/api.php' && p.get('action') === 'wbgetentities') {
    const light = (p.get('props') || '').indexOf('claims') === -1;
    return json({ entities: Object.fromEntries(p.get('ids').split('|').map((id) => {
      const e = ENTITIES[id];
      if (!e) return [id, { id, missing: '' }];
      return [id, light ? { id, labels: { en: e.labels.en }, descriptions: e.descriptions } : e];
    })) });
  }
  if (url.pathname === '/w/api.php' && p.get('action') === 'wbsearchentities') {
    const q = (p.get('search') || '').toLowerCase();
    return json({ search: Object.values(ENTITIES).filter((e) => e.labels.en.value.toLowerCase().includes(q))
      .map((e) => ({ id: e.id, label: e.labels.en.value, description: e.descriptions.en.value })) });
  }
  // image search (src/admin/imagesearch.js): Commons file search, the Met, Art Institute of Chicago, Cleveland
  if (url.pathname === '/w/api.php' && p.get('generator') === 'search') {
    const meta = (lic, artist) => ({ LicenseShortName: { value: lic }, Artist: { value: artist }, ObjectName: { value: 'Plum Park in Kameido' } });
    return json({ query: { pages: {
      1: { index: 1, title: 'File:Hiroshige plum park.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/test/plum-park.jpg?utm=x',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Hiroshige_plum_park.jpg', extmetadata: meta('Public domain', '<a>Hiroshige</a>') }] },
      2: { index: 2, title: 'File:No licence.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/test/nolicence.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:No_licence.jpg', extmetadata: {} }] } } } });  // left out: no licence
  }
  // Nominatim reverse (placefinder.cityAt): like Manhattan for the Guggenheim, the object at city zoom is a district
  // (Yukinoshita) and only the address names the city (Kamakura); far north: nothing there
  if (url.pathname === '/reverse') {
    if (Number(p.get('lat')) > 80) return json({ error: 'Unable to geocode' });
    return json({ lat: '35.326', lon: '139.556', category: 'boundary', type: 'administrative', addresstype: 'suburb', name: 'Yukinoshita',
      display_name: 'Yukinoshita, Kamakura, Kanagawa Prefecture, Japan',
      address: { suburb: 'Yukinoshita', city: 'Kamakura', 'ISO3166-2-lvl4': 'JP-14', country_code: 'jp' }, extratags: {}, namedetails: { name: '雪ノ下' } });
  }
  // the city searched by name and country (placefinder.cityAt)
  if (url.pathname === '/search' && p.get('city')) {
    if (p.get('city') !== 'Kamakura' || p.get('countrycodes') !== 'jp') return json([]);
    return json([{ lat: '35.3192', lon: '139.5467', category: 'boundary', type: 'administrative', addresstype: 'city', name: 'Kamakura',
      display_name: 'Kamakura, Kanagawa Prefecture, Japan', address: { city: 'Kamakura', 'ISO3166-2-lvl4': 'JP-14', country_code: 'jp' },
      extratags: { wikidata: 'Q200250' }, namedetails: { name: '鎌倉市', 'name:en': 'Kamakura', 'name:ja': '鎌倉市' } }]);
  }
  // Nominatim (src/admin/placefinder.js): a city and a prefecture in Japan
  if (url.pathname === '/search') {
    const kyoto = { lat: '35.0116', lon: '135.7681', category: 'boundary', type: 'administrative', addresstype: 'city', name: 'Kyoto',
      display_name: 'Kyoto, Kyoto Prefecture, Japan', address: { city: 'Kyoto', 'ISO3166-2-lvl4': 'JP-26', country_code: 'jp' },
      extratags: { wikidata: 'Q34600' }, namedetails: { name: '京都市', 'name:en': 'Kyoto', 'name:ja': '京都市', 'name:fr': 'Kyōto' } };
    const pref = { lat: '35.25', lon: '135.44', category: 'boundary', type: 'administrative', addresstype: 'province', name: 'Kyoto Prefecture',
      display_name: 'Kyoto Prefecture, Japan', address: { province: 'Kyoto Prefecture', 'ISO3166-2-lvl4': 'JP-26', country_code: 'jp' },
      extratags: {}, namedetails: { name: '京都府', 'name:en': 'Kyoto Prefecture', 'name:ja': '京都府' } };
    return json(/prefecture/i.test(p.get('q') || '') ? [pref] : [kyoto, pref]);
  }
  if (url.pathname === '/public/collection/v1.1/search') return json({ total: 2, objectIDs: [1, 2] });
  if (url.pathname.startsWith('/public/collection/v1/objects/')) {
    const id = Number(url.pathname.split('/').pop());
    return json(id === 1
      ? { objectID: 1, isPublicDomain: true, primaryImage: 'https://images.metmuseum.org/test/original.jpg', primaryImageSmall: 'https://images.metmuseum.org/test/web-large.jpg',
        objectURL: 'https://www.metmuseum.org/art/collection/search/1', title: 'Plum Garden at Kameido', artistDisplayName: 'Utagawa Hiroshige', objectDate: '1857' }
      : { objectID: 2, isPublicDomain: false, primaryImage: 'https://images.metmuseum.org/test/restricted.jpg', title: 'Not free' });  // left out
  }
  if (url.pathname === '/api/v1/artworks/search') {
    return json({ config: { iiif_url: 'https://www.artic.edu/iiif/2' }, data: [{ id: 7, title: 'Plum Estate, Kameido', artist_display: 'Utagawa Hiroshige\nJapanese', date_display: '1857', image_id: 'abc', is_public_domain: true }] });
  }
  if (url.pathname === '/api/artworks/') {
    return json({ data: [{ title: 'Kameido Plum', url: 'https://clevelandart.org/art/1', share_license_status: 'CC0', creation_date: '1857',
      creators: [{ description: 'Hiroshige (Japanese)' }], images: { web: { url: 'https://openaccess-cdn.clevelandart.org/test/web.jpg' } } }] });
  }
  if (url.pathname === '/w/api.php' && p.get('action') === 'query') {  // Commons imageinfo, per file
    const file = p.get('titles').replace(/^File:/, '').replace(/ /g, '_');
    return json({ query: { pages: { 1: { imageinfo: [{ thumburl: `https://upload.wikimedia.org/test/${encodeURIComponent(file)}`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
      extmetadata: { LicenseShortName: { value: 'Public domain' }, Artist: { value: '<a href="#">Claude Monet</a>' } } }] } } } });
  }
  res.writeHead(404); res.end();
}

let server = null;
const PORT = 3007;
const start = () => new Promise((resolve) => { server = http.createServer(handle).listen(PORT, '127.0.0.1', resolve); });
const stop = () => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));

module.exports = { start, stop, BASE: `http://127.0.0.1:${PORT}` };
