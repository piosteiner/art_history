// The site's quiz (src/routes/quiz.js): rounds drawn at random with their answers — a picture to name; an artist and
// eight works, theirs and look-alikes; a movement and its works, or three works and their movement; glossary terms.
// Wrong options never belong: not the artist's, not in the movement (view movement_works), definitions without their term.
const { test, expect, sql, API } = require('./helpers');

const get = async (request, path) => {
  const res = await request.get(`${API}/quiz/${path}`, { headers: { Host: 'api.localhost' } });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  return (await res.json()).data;
};
const cleanup = () => sql(`DELETE FROM artworks WHERE slug LIKE 'test-quiz-%'; DELETE FROM artists WHERE slug LIKE 'test-quiz-%';
  DELETE FROM movements WHERE slug LIKE 'test-quiz-%'; DELETE FROM glossary WHERE slug = 'test-quiz-term'`);
test.beforeAll(() => {
  cleanup();
  sql(`INSERT INTO artists (slug, name) VALUES ('test-quiz-painter', 'Quentin Quizmaker'), ('test-quiz-friend', 'Fiona Friend'), ('test-quiz-stranger', 'Sam Stranger');
       INSERT INTO movements (slug, name, kind) VALUES ('test-quiz-style', 'Quizism', 'style'), ('test-quiz-other', 'Otherism', 'style');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES
         ('artist', entity_id('artist', 'test-quiz-painter'), 'associated_with', 'movement', entity_id('movement', 'test-quiz-style')),
         ('artist', entity_id('artist', 'test-quiz-friend'), 'associated_with', 'movement', entity_id('movement', 'test-quiz-style')),
         ('artist', entity_id('artist', 'test-quiz-stranger'), 'associated_with', 'movement', entity_id('movement', 'test-quiz-other'));
       INSERT INTO artworks (slug, title, creator_id, created, created_label, names) VALUES
         ('test-quiz-a', 'Quiz A', entity_id('artist', 'test-quiz-painter'), '[1900-01-01,1901-01-01)', '1900', '[{"role": "translation", "lang": "de", "text": "Rätsel A"}]'),
         ('test-quiz-b', 'Quiz B', entity_id('artist', 'test-quiz-painter'), '[1901-01-01,1902-01-01)', '1901', '[]'),
         ('test-quiz-c', 'Quiz C', entity_id('artist', 'test-quiz-painter'), '[1902-01-01,1903-01-01)', '1902', '[]'),
         ('test-quiz-d', 'Quiz D', entity_id('artist', 'test-quiz-friend'), '[1900-01-01,1901-01-01)', '1900', '[]'),
         ('test-quiz-e', 'Quiz E', entity_id('artist', 'test-quiz-stranger'), '[1900-01-01,1901-01-01)', '1900', '[]');
       INSERT INTO images (artwork_id, position, url, license, credit)
         SELECT id, 0, 'https://example.org/' || slug || '.jpg', 'Public domain', 'test' FROM artworks WHERE slug LIKE 'test-quiz-%';
       INSERT INTO glossary (slug, name, category, definition) VALUES ('test-quiz-term', 'quizprint', 'technique',
         'A Quizprint is printed from a quiz block; quizprints are rare, and no other technique is quite like it.')`);
});
test.afterAll(cleanup);

test('a picture with every name, the artists, the date and the movements to guess', async ({ request }) => {
  const rounds = await get(request, 'image?works=test-quiz-a,test-quiz-b');
  expect(rounds.map((r) => r.slug)).toEqual(['test-quiz-a', 'test-quiz-b']);   // in the order asked
  const a = rounds[0];
  expect(a.image_url).toBe('https://example.org/test-quiz-a.jpg');
  expect(a.titles).toEqual(['Quiz A', 'Rätsel A']);
  expect(a.creators).toEqual([expect.objectContaining({ slug: 'test-quiz-painter', name: 'Quentin Quizmaker', main: true })]);
  expect(a.created).toEqual(expect.objectContaining({ from_year: 1900, to_year: 1900, label: '1900' }));
  expect(a.movements.map((m) => m.slug)).toEqual(['test-quiz-style']);
  expect((await get(request, 'image?n=3')).length).toBeLessThanOrEqual(3);
});

test('an artist: their works and look-alikes from the same movement', async ({ request }) => {
  const [round] = await get(request, 'artist?for=test-quiz-painter');
  expect(round.artist).toEqual(expect.objectContaining({ slug: 'test-quiz-painter', name: 'Quentin Quizmaker' }));
  const right = round.options.filter((o) => o.correct).map((o) => o.slug);
  expect(right.length).toBeGreaterThanOrEqual(2);
  expect(right.every((s) => ['test-quiz-a', 'test-quiz-b', 'test-quiz-c'].includes(s))).toBe(true);
  const wrong = round.options.filter((o) => !o.correct);
  expect(wrong.some((o) => o.creator === 'Quentin Quizmaker')).toBe(false);
  // the friend's work shares the movement: the closest look-alike, always among them
  expect(wrong.map((o) => o.slug)).toContain('test-quiz-d');
  expect(round.options.length).toBeLessThanOrEqual(8);
});

test('a movement: its works among others, or the movement of three works', async ({ request }) => {
  const [pick] = await get(request, 'movement?for=test-quiz-style&mode=pick');
  expect(pick.kind).toBe('pick');
  expect(pick.movement.slug).toBe('test-quiz-style');
  const inIt = sql(`SELECT string_agg(a.slug, ',') FROM movement_works mw JOIN artworks a ON a.id = mw.artwork_id
    WHERE mw.movement_id = entity_id('movement', 'test-quiz-style')`).split(',');
  for (const o of pick.options) expect(inIt.includes(o.slug)).toBe(o.correct);
  expect(pick.options.filter((o) => !o.correct).length).toBeGreaterThan(0);

  const [name] = await get(request, 'movement?for=test-quiz-style&mode=name');
  expect(name.works).toHaveLength(3);
  expect(name.answer).toBe('test-quiz-style');
  expect(name.options.map((o) => o.slug)).toContain('test-quiz-style');
  expect(name.options.length).toBe(4);
  // no other option holds one of the shown works
  const others = name.options.filter((o) => o.slug !== 'test-quiz-style').map((o) => `'${o.slug}'`).join(',');
  expect(sql(`SELECT count(*) FROM movement_works mw JOIN movements m ON m.id = mw.movement_id JOIN artworks a ON a.id = mw.artwork_id
    WHERE m.slug IN (${others}) AND a.slug IN (${name.works.map((w) => `'${w.slug}'`).join(',')})`)).toBe('0');
});

test('glossary: definitions without their own term, four options', async ({ request }) => {
  const [term] = await get(request, 'glossary?for=test-quiz-term&mode=term');
  expect(term.kind).toBe('term');
  expect(term.term.definition).toBe('A … is printed from a quiz block; … are rare, and no other technique is quite like it.');
  expect(term.options.map((o) => o.slug)).toContain('test-quiz-term');
  expect(term.options.length).toBe(4);
  const [describe] = await get(request, 'glossary?for=test-quiz-term&mode=describe');
  expect(describe).toEqual({ kind: 'describe', term: expect.objectContaining({ name: 'quizprint', definition: expect.stringContaining('Quizprint') }) });
});
