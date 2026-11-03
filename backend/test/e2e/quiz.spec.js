// The site's quiz (src/routes/quiz.js): rounds drawn at random with their answers — a picture to name; an artist and
// eight works, theirs and look-alikes; a movement and its works, or three works and their movement; glossary terms.
// Wrong options never belong: not the artist's, not in the movement (view movement_works), definitions without their term.
// Logged in on the site (admin host /site/quiz/…), works with only the account's private images count as pictured too.
const { test, expect, sql, API } = require('./helpers');

const get = async (request, path) => {
  const res = await request.get(`${API}/quiz/${path}`, { headers: { Host: 'api.localhost' } });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  return (await res.json()).data;
};
const cleanup = () => sql(`DELETE FROM artworks WHERE slug LIKE 'test-quiz-%'; DELETE FROM artists WHERE slug LIKE 'test-quiz-%'; DELETE FROM places WHERE slug LIKE 'test-quiz-%';
  DELETE FROM movements WHERE slug LIKE 'test-quiz-%'; DELETE FROM glossary WHERE slug = 'test-quiz-term'`);
const SITE = 'https://arthistory.piogino.ch';   // config.corsOrigin's default
const mine = async (user, path) => {
  const res = await user.request.get(`/site/quiz/${path}`, { headers: { Origin: SITE } });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  return (await res.json()).data;
};
test.beforeAll(() => {
  cleanup();
  sql(`INSERT INTO artists (slug, name) VALUES ('test-quiz-painter', 'Quentin Quizmaker'), ('test-quiz-friend', 'Fiona Friend'), ('test-quiz-stranger', 'Sam Stranger'), ('test-quiz-bookonly', 'Bea Bookonly');
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
         ('test-quiz-f', 'Quiz F', entity_id('artist', 'test-quiz-friend'), '[1903-01-01,1904-01-01)', '1903', '[]'),
         ('test-quiz-e', 'Quiz E', entity_id('artist', 'test-quiz-stranger'), '[1900-01-01,1901-01-01)', '1900', '[]'),
         ('test-quiz-p1', 'Book Only 1', entity_id('artist', 'test-quiz-bookonly'), NULL, NULL, '[]'),
         ('test-quiz-p2', 'Book Only 2', entity_id('artist', 'test-quiz-bookonly'), NULL, NULL, '[]'),
         ('test-quiz-p3', 'Book Only 3', entity_id('artist', 'test-quiz-bookonly'), NULL, NULL, '[]');
       INSERT INTO images (artwork_id, position, url, license, credit)
         SELECT id, 0, 'https://example.org/' || slug || '.jpg', 'Public domain', 'test' FROM artworks WHERE slug LIKE 'test-quiz-%' AND slug NOT LIKE 'test-quiz-p%';
       -- the Book Only works have a private reference image of the account "tester" only
       INSERT INTO private_images (artwork_id, owner_id, locator, bytes, width, height, original_bytes)
         SELECT a.id, u.id, 'fig. 1', '\\x00'::bytea, 40, 30, 1 FROM artworks a, admin_users u WHERE a.slug LIKE 'test-quiz-p%' AND u.username = 'tester';
       INSERT INTO glossary (slug, name, category, definition) VALUES ('test-quiz-term', 'quizprint', 'technique',
         'A Quizprint is printed from a quiz block; quizprints are rare, and no other technique is quite like it.')`);
  // the games read a stored basis (202), refreshed with the worker's global part: brought up to date here at once
  sql('UPDATE quality_refresh SET quiz_at = NULL; SELECT refresh_quality_global()');
});
test.afterAll(cleanup);

// 191: the world regions — worked out from where the artists worked (places with their country), stored in
// entry_regions (refreshed with the derived data; here by hand): a chosen region keeps the game in it, and without one
// an artist's round shows no works of another region
test('regions: a game of one region; an artist’s look-alikes from their region only', async ({ request, userA }) => {
  sql(`INSERT INTO places (slug, name, kind, country_code, location) VALUES ('test-quiz-zurich', 'Quiz Zürich', 'settlement', 'CH', 'SRID=4326;POINT(8.54 47.37)'),
         ('test-quiz-kyoto', 'Quiz Kyoto', 'settlement', 'JP', 'SRID=4326;POINT(135.77 35.01)');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES
         ('artist', entity_id('artist', 'test-quiz-painter'), 'worked_in', 'place', entity_id('place', 'test-quiz-zurich')),
         ('artist', entity_id('artist', 'test-quiz-friend'), 'worked_in', 'place', entity_id('place', 'test-quiz-zurich')),
         ('artist', entity_id('artist', 'test-quiz-stranger'), 'worked_in', 'place', entity_id('place', 'test-quiz-kyoto'));
       UPDATE quality_refresh SET quiz_at = NULL; SELECT refresh_quality_global()`);
  expect(sql(`SELECT string_agg(a.slug || ' ' || er.region || ' ' || er.basis, ', ' ORDER BY a.slug) FROM entry_regions er JOIN artworks a ON a.id = er.entity_id
              WHERE er.entity_type = 'artwork' AND a.slug IN ('test-quiz-a', 'test-quiz-e')`)).toBe('test-quiz-a europe artist, test-quiz-e east_asia artist');
  const regions = await get(request, 'regions');
  expect(regions.find((r) => r.region === 'europe')).toEqual(expect.objectContaining({ name: 'Europe', works: expect.any(Number) }));
  expect(regions.find((r) => r.region === 'europe').works).toBeGreaterThanOrEqual(4);
  // a chosen region: only its works
  const asia = await get(request, 'image?n=20&region=east_asia');
  expect(asia.map((r) => r.slug)).toContain('test-quiz-e');
  expect(asia.some((r) => r.slug.startsWith('test-quiz-') && r.slug !== 'test-quiz-e')).toBe(false);
  expect((await get(request, 'artist?for=test-quiz-painter&region=east_asia'))).toEqual([]);   // no three works there
  // no region chosen: the painter's round never shows the Kyoto work
  for (let i = 0; i < 3; i++) {
    const [round] = await get(request, 'artist?for=test-quiz-painter');
    expect(round.options.map((o) => o.slug)).not.toContain('test-quiz-e');
  }
  // the CMS names the worked-out region in the empty choice
  await userA.goto('/artists/test-quiz-painter/edit');
  await expect(userA.locator('#f-region option[value=""]')).toHaveText('worked out: Europe — from where they worked');
});

// a copy after a work of another region counts in that region too, and is the first trap among an artist's look-alikes
// (owner 2026-11-03: Van Gogh's Bridge in the Rain after Hiroshige in Hokusai's round)
test('regions: a copy after a work of another region plays in both, as the closest look-alike', async ({ request }) => {
  sql(`INSERT INTO artists (slug, name, region) VALUES ('test-quiz-ukiyo', 'Uki Yoshi', 'east_asia'), ('test-quiz-copyist', 'Cora Copyist', 'europe');
       INSERT INTO artworks (slug, title, creator_id, created, created_label, region) VALUES
         ('test-quiz-u1', 'Quiz Print 1', entity_id('artist', 'test-quiz-ukiyo'), '[1857-01-01,1858-01-01)', '1857', NULL),
         ('test-quiz-u2', 'Quiz Print 2', entity_id('artist', 'test-quiz-ukiyo'), '[1857-01-01,1858-01-01)', '1857', NULL),
         ('test-quiz-u3', 'Quiz Print 3', entity_id('artist', 'test-quiz-ukiyo'), '[1858-01-01,1859-01-01)', '1858', NULL),
         ('test-quiz-copy', 'Quiz Bridge after Uki', entity_id('artist', 'test-quiz-copyist'), '[1887-01-01,1888-01-01)', '1887', 'europe');
       INSERT INTO images (artwork_id, position, url, license, credit)
         SELECT id, 0, 'https://example.org/' || slug || '.jpg', 'Public domain', 'test' FROM artworks WHERE slug IN ('test-quiz-u1', 'test-quiz-u2', 'test-quiz-u3', 'test-quiz-copy');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES
         ('artwork', entity_id('artwork', 'test-quiz-copy'), 'copy_after', 'artwork', entity_id('artwork', 'test-quiz-u1')),
         ('artist', entity_id('artist', 'test-quiz-ukiyo'), 'associated_with', 'movement', entity_id('movement', 'test-quiz-other')),
         -- a movement of its own, as Van Gogh's copies have Japonisme (wrong options in the movement game need one)
         ('artwork', entity_id('artwork', 'test-quiz-copy'), 'associated_with', 'movement', entity_id('movement', 'test-quiz-style'));
       UPDATE quality_refresh SET quiz_at = NULL; SELECT refresh_quality_global()`);
  // its own region stays Europe; in the games it counts in East Asia as well
  expect(sql(`SELECT region FROM entry_regions WHERE entity_type = 'artwork' AND entity_id = entity_id('artwork', 'test-quiz-copy')`)).toBe('europe');
  expect((await get(request, 'image?n=20&region=east_asia')).map((r) => r.slug)).toContain('test-quiz-copy');
  expect((await get(request, 'image?n=20&region=europe')).map((r) => r.slug)).toContain('test-quiz-copy');
  // the print artist's round: the copy after their print is always among the wrong options, never a right one
  for (let i = 0; i < 3; i++) {
    const [round] = await get(request, 'artist?for=test-quiz-ukiyo');
    expect(round.options.find((o) => o.slug === 'test-quiz-copy')).toEqual(expect.objectContaining({ correct: false }));
  }
  // the movement game: a copy after one of its works is the first trap too
  const [pick] = await get(request, 'movement?for=test-quiz-other&mode=pick');
  expect(pick.options.find((o) => o.slug === 'test-quiz-copy')).toEqual(expect.objectContaining({ correct: false }));
});

test('a picture with every name, the artists, the date and the movements to guess', async ({ request, userA }) => {
  const pub = await get(request, 'image?n=20');
  expect(pub.length).toBeGreaterThan(0);
  expect(pub.every((r) => r.image_url.startsWith('https://') && !r.own)).toBe(true);
  // the account's own images: only those (?mine=only), with the private image, marked own, no public credit
  const own = await mine(userA, 'image?n=20&mine=only');
  const p1 = own.find((r) => r.slug === 'test-quiz-p1');
  expect(p1).toEqual(expect.objectContaining({ own: true, credit: null, license: null }));
  expect(p1.image_url).toMatch(/\/private-images\/\d+$/);
  expect(own.every((r) => r.own)).toBe(true);
  // a work with a public image, all its names
  const [a] = await get(request, 'image?for=test-quiz-a');
  expect(a.image_url).toBe('https://example.org/test-quiz-a.jpg');
  expect(a.titles).toEqual(['Quiz A', 'Rätsel A']);
  expect(a.creators).toEqual([expect.objectContaining({ slug: 'test-quiz-painter', name: 'Quentin Quizmaker', main: true })]);
  expect(a.created).toEqual(expect.objectContaining({ from_year: 1900, to_year: 1900, label: '1900' }));
  expect(a.movements.map((m) => m.slug)).toEqual(['test-quiz-style']);
  expect((await get(request, 'image?n=3')).length).toBeLessThanOrEqual(3);
});

test('works with only a private image: in the quiz of their account, not for visitors or others', async ({ request, userA, userB }) => {
  expect(await get(request, 'artist?for=test-quiz-bookonly')).toEqual([]);          // no public pictures: no round
  expect(await mine(userB, 'artist?for=test-quiz-bookonly')).toEqual([]);           // another account's images
  const [round] = await mine(userA, 'artist?for=test-quiz-bookonly');
  const right = round.options.filter((o) => o.correct);
  expect(right.length).toBeGreaterThanOrEqual(2);
  expect(right.every((o) => o.own && /\/private-images\/\d+$/.test(o.image_url))).toBe(true);
  expect((await request.get('/site/quiz/artist', { headers: { Origin: 'https://arthistory.piogino.ch' } })).status()).toBe(401);
  expect((await userA.request.get('/site/quiz/nothing', { headers: { Origin: 'https://arthistory.piogino.ch' } })).status()).toBe(404);
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
