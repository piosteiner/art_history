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
      P227: [stmt('118583123')], P245: [stmt('500018666')],  // GND, ULAN (053)
      P937: [stmt(item('Q90'), { P580: time('+1859-00-00T00:00:00Z', 9), P582: time('+1860-00-00T00:00:00Z', 9) })] } },
  Q90: { id: 'Q90', labels: labels('Paris'), descriptions: { en: { value: 'capital of France' } },
    claims: { P31: [stmt(item('Q515'))], P625: [stmt({ latitude: 48.8567, longitude: 2.3522, globe: 'http://www.wikidata.org/entity/Q2' })] } },
  Q101: { id: 'Q101', labels: labels('Giverny'), descriptions: { en: { value: 'commune in Eure, France' } },
    claims: { P31: [stmt(item('Q484170'))], P625: [stmt({ latitude: 49.0758, longitude: 1.5339, globe: 'http://www.wikidata.org/entity/Q2' })] } },
  Q102: { id: 'Q102', labels: labels('Impressionism'), descriptions: { en: { value: 'art movement' } }, claims: { P31: [stmt(item('Q968159'))] } },
  Q103: { id: 'Q103', labels: labels('Charles Gleyre'), descriptions: { en: { value: 'Swiss painter' } },
    claims: { P31: [stmt(item('Q5'))], P569: [stmt(time('+1806-05-02T00:00:00Z', 11))] } },
  // an altarpiece "commissioned by" (P88) a patron — the commission becomes the provenance's first step (063)
  Q130: { id: 'Q130', labels: labels('Test Altarpiece'), descriptions: { en: { value: 'painting' } },
    claims: { P31: [stmt(item('Q3305213'))], P571: [stmt(time('+1480-00-00T00:00:00Z', 9))], P88: [stmt(item('Q131'))] } },
  Q131: { id: 'Q131', labels: labels('Test Patron Portinari'), descriptions: { en: { value: 'merchant and banker' } },
    claims: { P31: [stmt(item('Q5'))] } },
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
    // P112: founded by (054)
    claims: { P31: [stmt(item('Q207694'))], P112: [stmt(item('Q100'))], P131: [stmt(item('Q111')), stmt(item('Q112'))],
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
  Q123: { id: 'Q123', labels: labels('Great Fire of Meireki', { ja: '明暦の大火' }), descriptions: { en: { value: 'fire in Edo, 1657' } },
    claims: { P31: [stmt(item('Q168983'))], P580: [stmt(time('+1657-03-02T00:00:00Z', 11))], P582: [stmt(time('+1657-03-04T00:00:00Z', 11))],
      P276: [stmt(item('Q124'))], P710: [stmt(item('Q100'))] } },
  Q124: { id: 'Q124', labels: labels('Edo'), descriptions: { en: { value: 'former name of Tokyo' } },
    claims: { P31: [stmt(item('Q515'))], P625: [stmt({ latitude: 35.6895, longitude: 139.6917, globe: 'http://www.wikidata.org/entity/Q2' })] } },
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
  // lobid.org: GND records (src/admin/gnd.js, 053) — Claude Monet's, shortened
  const gnd = /^\/gnd\/([0-9X-]+)\.json$/.exec(url.pathname);
  if (gnd) {
    if (gnd[1] !== '118583123') { res.writeHead(404); return res.end('{}'); }
    return json({ gndIdentifier: '118583123', preferredName: 'Monet, Claude', variantName: ['Monet, Oscar-Claude'],
      dateOfBirth: ['1840-11-14'], dateOfDeath: ['1926-12-05'],
      placeOfBirth: [{ id: 'https://d-nb.info/gnd/4044660-8', label: 'Paris' }], placeOfDeath: [{ id: 'https://d-nb.info/gnd/4021477-1', label: 'Giverny' }],
      professionOrOccupation: [{ id: 'https://d-nb.info/gnd/4037220-0', label: 'Maler' }],
      professionalRelationship: [{ id: 'https://d-nb.info/gnd/118583174', label: 'Gogh, Vincent van' },
        { id: 'https://d-nb.info/gnd/118695967', label: 'Gleyre, Charles' }] });  // (not one of ours: "new person")
  }
  // SIKART (src/admin/sikart.js, 057): Ferdinand Hodler's record, shortened; the search knows two Hodlers
  const hodler = { '@id': 'sik:person-4000055', 'sikapi:preferred_name': 'Hodler, Ferdinand',
    'sikapi:note_biographical_data': '∗ 14.3.1853 Bern,\n† 19.5.1918 Genf', 'sikapi:short_biography': 'Maler, Zeichner',
    'sikapi:has_hometown': 'sik:place-1', 'sikapi:has_citizenship': 'sik:place-2',
    'sikapi:same_as': ['http://d-nb.info/gnd/118551884', 'http://viaf.org/viaf/59113932'] };
  if (url.pathname.startsWith('/sik/sikapi:RetrievePerson/')) {
    if (!url.pathname.includes('sik:person-4000055/')) { res.writeHead(404); return res.end('{}'); }
    return json({ '@graph': [hodler, { '@id': 'sik:place-1', 'sikapi:label': 'Gurzelen (BE)' }, { '@id': 'sik:place-2', 'sikapi:label': 'Genf' }] });
  }
  if (url.pathname === '/sik/sikapi:SearchPersons/') {
    if (!/hodler/i.test(p.get('q') || '')) return json({ '@graph': [] });
    return json({ '@graph': [hodler, { '@id': 'sik:person-4000056', 'sikapi:preferred_name': 'Hodler, Hector',
      'sikapi:note_biographical_data': '∗ 1.12.1887 Genf,\n† 31.3.1920 Leysin', 'sikapi:short_biography': 'Maler' }] });
  }
  // Metagrid (src/admin/metagrid.js): two Hodlers — Ferdinand with his numbers (no GND: that one belongs to other tests)
  if (url.pathname === '/metagrid/search') {
    if (!/hodler/i.test(p.get('query') || '')) return json({ concordances: [] });
    const res = (slug, id, uri, b = '1853-03-14', d = '1918-05-19', first = 'Ferdinand') => ({ _type: 'person', identifier: id, provider: { slug },
      link: { rel: 'resource', uri }, metadata: { first_name: first, last_name: 'Hodler', birth_date: b, death_date: d } });
    return json({ concordances: [
      { id: 'mgHector', name: 'Hector Hodler 1887-12-01 1920-03-31', resources: [res('hls-dhs-dss', '009999', 'https://hls-dhs-dss.ch/de/articles/009999/', '1887-12-01', '1920-03-31', 'Hector')] },
      { id: 'mgFerdinand', name: 'Ferdinand Hodler 1853-03-14 1918-05-19', resources: [
        res('sikart', '4000055', 'http://www.sikart.ch/kuenstlerinnen.aspx?id=4000055'), res('loc', 'n50031263', 'http://id.loc.gov/authorities/names/n50031263'),
        res('hls-dhs-dss', '019084', 'https://hls-dhs-dss.ch/de/articles/019084/'), res('dodis', '13383', 'https://dodis.ch/P13383'),
        res('burgerbibliothek', '19590', 'https://archives-quickaccess.ch/bbb/person/19590')] }] });
  }
  // the Library of Congress (src/admin/lc.js): Hodler's record, shortened
  if (url.pathname === '/lc/authorities/names/n50031263.json') {
    const M = 'http://www.loc.gov/mads/rdf/v1#';
    return json([
      { '@id': 'http://id.loc.gov/authorities/names/n50031263', [`${M}authoritativeLabel`]: [{ '@value': 'Hodler, Ferdinand, 1853-1918' }],
        [`${M}hasCloseExternalAuthority`]: [{ '@id': 'http://viaf.org/viaf/41848532' }] },
      { '@id': 'http://id.loc.gov/rwo/agents/n50031263', [`${M}birthDate`]: [{ '@value': '1853-03-14' }], [`${M}deathDate`]: [{ '@value': '1918-05-19' }],
        [`${M}birthPlace`]: [{ '@id': 'http://id.loc.gov/rwo/agents/n79065374' }], [`${M}deathPlace`]: [{ '@id': 'http://id.loc.gov/rwo/agents/n81018331' }] },
      { '@id': 'http://id.loc.gov/rwo/agents/n79065374', [`${M}authoritativeLabel`]: [{ '@value': 'Bern (Switzerland)' }] },
      { '@id': 'http://id.loc.gov/rwo/agents/n81018331', [`${M}authoritativeLabel`]: [{ '@value': 'Geneva (Switzerland)' }] }]);
  }
  // the BnF (src/admin/bnf.js): the SPARQL answer for Hodler — only "the year" of death, as BnF sometimes has
  if (url.pathname === '/bnf/sparql') {
    if (!/cb119454480#about/.test(p.get('query') || '')) return json({ results: { bindings: [] } });
    const b = (pp, o) => ({ p: { value: pp }, o: { value: o } });
    return json({ results: { bindings: [b('http://xmlns.com/foaf/0.1/name', 'Ferdinand Hodler'), b('http://vocab.org/bio/0.1/birth', '1853-03-14'),
      b('http://vocab.org/bio/0.1/death', '1918'), b('http://rdvocab.info/ElementsGr2/placeOfBirth', 'Berne'),
      b('http://rdvocab.info/ElementsGr2/biographicalInformation', 'Peintre, dessinateur et sculpteur'),
      b('http://www.w3.org/2002/07/owl#sameAs', 'http://www.idref.fr/027405397/id')] } });
  }
  // RKD (src/admin/rkd.js): the person, its birth event, time-span and place (Bern, with its Wikidata item)
  if (url.pathname.startsWith('/rkd/')) {
    const R = 'http://127.0.0.1:3007/rkd';
    const C = 'http://www.cidoc-crm.org/cidoc-crm/';
    const nodes = {
      '/rkd/artists/38688': { [`${C}P98i_was_born`]: [{ '@id': `${R}/genid/born` }], 'http://www.w3.org/2000/01/rdf-schema#label': [{ '@value': 'Hodler, Ferdinand' }],
        'https://linked.art/ns/terms/equivalent': [{ '@id': 'http://viaf.org/viaf/41848532' }, { '@id': 'http://vocab.getty.edu/ulan/500027184' }] },
      '/rkd/genid/born': { [`${C}P4_has_time-span`]: [{ '@id': `${R}/genid/ts` }], [`${C}P7_took_place_at`]: [{ '@id': `${R}/thesaurus/355` }] },
      '/rkd/genid/ts': { [`${C}P82a_begin_of_the_begin`]: [{ '@value': '1853-03-14' }], [`${C}P82b_end_of_the_end`]: [{ '@value': '1853-03-14' }] },
      '/rkd/thesaurus/355': { 'http://www.w3.org/2004/02/skos/core#prefLabel': [{ '@value': 'Bern (city)', '@language': 'en' }],
        'http://www.w3.org/2004/02/skos/core#exactMatch': [{ '@id': 'https://www.wikidata.org/entity/Q70' }] },
    };
    const n = nodes[url.pathname];
    if (!n) { res.writeHead(404); return res.end('[]'); }
    return json([{ '@id': `${R}${url.pathname.slice(4)}`, ...n }]);
  }
  // Open Library and Crossref (src/admin/booklookup.js): a book by ISBN, an article by DOI
  if (url.pathname === '/openlibrary/api/books') {
    if (p.get('bibkeys') !== 'ISBN:9783775723107') return json({});
    return json({ 'ISBN:9783775723107': { title: 'Ferdinand Hodler', subtitle: 'Landschaften', authors: [{ name: 'Oskar Bätschmann' }, { name: 'Paul Müller' }],
      publishers: [{ name: 'Hatje Cantz' }], publish_places: [{ name: 'Ostfildern' }], publish_date: '2008', url: 'https://openlibrary.org/books/OL1M' } });
  }
  if (url.pathname.startsWith('/crossref/works/')) {
    if (decodeURIComponent(url.pathname.slice('/crossref/works/'.length)) !== '10.2307/3046992') { res.writeHead(404); return res.end('{}'); }
    return json({ message: { type: 'journal-article', title: ['The Sarcophagi of Ravenna'], author: [{ given: 'Marion', family: 'Lawrence' }],
      'container-title': ['The Art Bulletin'], volume: '27', issue: '2', page: '123-140', issued: { 'date-parts': [[1945, 6]] }, publisher: 'JSTOR' } });
  }
  // more image sources (src/admin/imagesearch.js): each with one free record and one that isn't (left out)
  if (url.pathname === '/rijks/search/collection') {
    return json({ orderedItems: [{ id: 'http://127.0.0.1:3007/rijksid/1' }, { id: 'http://127.0.0.1:3007/rijksid/2' }] });
  }
  if (url.pathname.startsWith('/rijksid/')) {
    const I = 'http://127.0.0.1:3007/rijksid';
    const nodes = {
      '/rijksid/1': { shows: [{ id: `${I}/v1` }], identified_by: [{ type: 'Identifier', content: 'RP-P-1956-741' }, { type: 'Name', content: 'Pruimenboomgaard te Kameido' }] },
      '/rijksid/v1': { digitally_shown_by: [{ id: `${I}/d1` }] },
      '/rijksid/d1': { referred_to_by: [{ content: 'downloadbaar' }], access_point: [{ id: 'https://iiif.micr.io/TEST/full/max/0/default.jpg' }] },
      '/rijksid/2': { shows: [{ id: `${I}/v2` }], identified_by: [{ type: 'Name', content: 'Not downloadable' }] },
      '/rijksid/v2': { digitally_shown_by: [{ id: `${I}/d2` }] },
      '/rijksid/d2': { referred_to_by: [{ content: 'zichtbaar' }], access_point: [{ id: 'https://iiif.micr.io/NOPE/full/max/0/default.jpg' }] },
    };
    return nodes[url.pathname] ? json(nodes[url.pathname]) : (res.writeHead(404), res.end('{}'));
  }
  if (url.pathname === '/europeana/record/v2/search.json') {
    return json({ items: [
      { title: ['Kameido plum garden'], rights: ['http://creativecommons.org/licenses/by-sa/4.0/'], edmIsShownBy: ['https://europeana.example/full.jpg'],
        edmPreview: ['https://api.europeana.eu/thumbnail/test.jpg'], edmIsShownAt: ['https://museum.example/object/1'], dataProvider: ['Museum für Asiatische Kunst'] },
      { title: ['In copyright'], rights: ['http://rightsstatements.org/vocab/InC/1.0/'], edmIsShownBy: ['https://europeana.example/nope.jpg'] }] });
  }
  if (url.pathname === '/si/openaccess/api/v1.0/search') {
    const row = (title, access) => ({ title, content: { descriptiveNonRepeating: { record_link: 'https://collections.si.edu/1', data_source: 'Freer Gallery of Art',
      online_media: { media: [{ type: 'Images', content: `https://ids.si.edu/${title.length}.jpg`, thumbnail: `https://ids.si.edu/${title.length}-t.jpg`, usage: { access } }] } } } });
    return json({ response: { rows: [row('Plum Estate, Kameido', 'CC0'), row('Restricted print', 'usage conditions apply')] } });
  }
  if (url.pathname === '/jps/api/item/search/jps-cross') {
    const item = (id, rights) => ({ id, common: { title: '名所江戸百景 亀戸梅屋舗', titleYomi: 'めいしょえどひゃっけい かめいどうめやしき', contentsRightsType: rights,
      contentsUrl: [`https://colbase.example/${id}.jpg`], thumbnailUrl: [`https://colbase.example/${id}-t.jpg`], linkUrl: `https://colbase.example/items/${id}`,
      provider: 'Tokyo National Museum', contributor: ['歌川広重'] } });
    return json({ hit: 2, list: [item('tnm-1', 'pdm'), item('tnm-2', 'ccbyncsa')] });
  }
  // KulturNav (src/admin/kulturnav.js): Edvard Munch, shortened
  if (url.pathname === '/kulturnav/fad5b908-b64d-4feb-ac06-c175ea1f5128.json') {
    const ev = (time, place) => [{ value: { properties: { 'event.time': [{ value: time }],
      'event.placeReference': [{ value: { properties: { 'placeReference.placeString': [{ value: { '*': place } }] } } }] } } }];
    return json({ caption: { '*': 'Munch, Edvard (1863 - 1944)' }, properties: { 'entity.name': [{ value: { '*': 'Munch, Edvard' } }],
      'person.birth': ev('18631212-D', 'Løten, Hedmark (Norge)'), 'person.death': ev('19440123-D', 'Oslo (fylke), Oslo (Norge)'),
      'entity.sameAs': [{ value: 'http://viaf.org/viaf/61624802' }, { value: 'http://vocab.getty.edu/ulan/500032949-agent' }, { value: 'http://id.loc.gov/authorities/names/n79006348' }] } });
  }
  // the National Library of Korea (src/admin/nlk.js): Kim Hong-do
  if (url.pathname === '/nlk/sparql') {
    if (!/KAC200207547/.test(p.get('query') || '')) return json({ results: { bindings: [] } });
    const b = (pp, o) => ({ p: { value: pp }, o: { value: o } });
    return json({ results: { bindings: [b('http://www.w3.org/2004/02/skos/core#prefLabel', '김홍도'), b('http://lod.nl.go.kr/ontology/birthYear', '1745'),
      b('http://schema.org/birthPlace', '경기도 안산'), b('http://www.w3.org/2004/02/skos/core#altLabel', '金弘道'), b('http://www.w3.org/2004/02/skos/core#altLabel', '檀園'),
      b('http://www.w3.org/2004/02/skos/core#altLabel', 'Kim, Hongdo'), b('http://schema.org/jobTitle', '화가(미술가)[畵家]'),
      b('http://www.w3.org/2002/07/owl#sameAs', 'http://viaf.org/viaf/122299485')] } });
  }
  // ArCo (src/admin/arco.js): Canova's works in the Italian catalogue
  if (url.pathname === '/arco/sparql') {
    const q = p.get('query') || '';
    if (!/Q5547>/.test(q)) return json({ results: { bindings: [] } });
    if (/COUNT\(/.test(q)) return json({ results: { bindings: [{ n: { value: '180' } }] } });
    const w = (id, l) => ({ w: { value: `https://w3id.org/arco/resource/HistoricOrArtisticProperty/${id}` }, l: { value: l } });
    return json({ results: { bindings: [w('0800404054', "Maria Luigia d'Asburgo in veste di Concordia (scultura) di Canova Antonio"),
      w('0800404054', "Maria Luigia d'Asburgo in veste di Concordia (scultura) by Canova Antonio"), w('0500073378-1', 'Felicità (rilievo) by Canova Antonio')] } });
  }
  // SMK and DigitaltMuseum (src/admin/imagesearch.js)
  if (url.pathname === '/smk/api/v1/art/search/') {
    return json({ found: 2, items: [
      { object_number: 'KMS3352', titles: [{ title: 'Ida in an Interior', language: 'engelsk' }], public_domain: true,
        image_iiif_id: 'https://iip.smk.dk/iiif/jp2/TEST.jp2', frontend_url: 'https://open.smk.dk/artwork/image/KMS3352',
        production: [{ creator: 'Hammershøi, Vilhelm' }], production_date: [{ period: '1907' }] },
      { object_number: 'KMS9999', titles: [{ title: 'Not free' }], public_domain: false, image_thumbnail: 'https://example.org/t.jpg' }] });
  }
  if (url.pathname === '/dimu/api/solr/select') {
    const doc = (id, lic, title) => ({ 'artifact.uniqueId': id, 'identifier.owner': 'MUH', 'artifact.ingress.title': title,
      'artifact.ingress.license': lic ? [lic] : undefined, 'artifact.defaultMediaIdentifier': `m${id}`, 'artifact.ingress.producer': 'Munch, Inger' });
    return json({ response: { numFound: 3, docs: [doc('1', 'CC by-sa', 'Bilde'), doc('2', 'CC by-nc-nd', 'Not free'), doc('3', null, 'No licence')] } });
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
  // a town named by an authority file (placefinder.settlementByName): "Genf" is Geneva; Giverny isn't found
  if (url.pathname === '/search' && p.get('featureType') === 'settlement') {
    if (p.get('q') !== 'Genf') return json([]);
    return json([{ lat: '46.2017', lon: '6.1469', category: 'boundary', type: 'administrative', addresstype: 'city', name: 'Genève',
      display_name: 'Geneva, Switzerland', address: { city: 'Geneva', 'ISO3166-2-lvl4': 'CH-GE', country_code: 'ch' },
      extratags: { wikidata: 'Q71' }, namedetails: { name: 'Genève', 'name:en': 'Geneva', 'name:de': 'Genf', 'name:fr': 'Genève' } }]);
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
