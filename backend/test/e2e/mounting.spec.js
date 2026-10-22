// Further measurements by their glossary terms (migrations 133/134): a part written in any language the term knows is
// saved as the term's name, the API names the term (the site links it); a part that is no term stays as written.
const { test, expect, sql, settled, API } = require('./helpers');

const api = async (request, p) => (await request.get(`${API}${p}`, { headers: { Host: 'api.localhost' } })).json();
test.afterAll(() => sql("UPDATE artworks SET other_dimensions = '[]' WHERE slug = 'the-starry-night'"));

test('"Rahmenmass", "mit Rahmen", "Passepartout" are saved as frame and mount; the API names the terms', async ({ request }) => {
  // the trigger does it for every way of saving: the form, the import, Wikidata, a script
  sql(`UPDATE artworks SET other_dimensions = '[{"part": "Rahmenmass", "cm": [92, 111, 7]}, {"part": "mit Rahmen", "cm": [93, 112]},
       {"part": "Passepartout", "cm": [80, 100]}, {"part": "lid", "cm": [3]}]' WHERE slug = 'the-starry-night'`);
  expect(sql("SELECT string_agg(e->>'part', ', ' ORDER BY o) FROM artworks, jsonb_array_elements(other_dimensions) WITH ORDINALITY x(e, o) WHERE slug = 'the-starry-night'"))
    .toBe('frame, frame, mount, lid');
  await settled();
  const w = await api(request, '/artworks/the-starry-night');
  expect(w.other_dimensions.map((d) => [d.part, d.term && d.term.slug])).toEqual([['frame', 'frame'], ['frame', 'frame'], ['mount', 'mount'], ['lid', null]]);
});
