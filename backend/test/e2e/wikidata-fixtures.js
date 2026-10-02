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
      P18: [stmt('Claude Monet 1899 Nadar crop.jpg')],
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
      P195: [stmt(item('Q105'))], P217: [stmt('4014')], P18: [stmt('Monet - Impression, Sunrise.jpg')],
      P2048: [stmt({ amount: '+48', unit: 'http://www.wikidata.org/entity/Q174728' })],   // 48 cm
      P2049: [stmt({ amount: '+630', unit: 'http://www.wikidata.org/entity/Q174789' })],  // 630 mm = 63 cm
      P186: [stmt(item('Q106')), stmt(item('Q107'))] } },
  Q106: { id: 'Q106', labels: labels('oil paint'), descriptions: { en: { value: 'paint' } }, claims: {} },
  Q107: { id: 'Q107', labels: labels('canvas'), descriptions: { en: { value: 'fabric' } }, claims: {} },
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
  if (url.pathname === '/w/api.php' && p.get('action') === 'query') {  // Commons imageinfo
    return json({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/test/impression-sunrise.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Monet_-_Impression,_Sunrise.jpg',
      extmetadata: { LicenseShortName: { value: 'Public domain' }, Artist: { value: '<a href="#">Claude Monet</a>' } } }] } } } });
  }
  res.writeHead(404); res.end();
}

let server = null;
const PORT = 3007;
const start = () => new Promise((resolve) => { server = http.createServer(handle).listen(PORT, '127.0.0.1', resolve); });
const stop = () => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));

module.exports = { start, stop, BASE: `http://127.0.0.1:${PORT}` };
