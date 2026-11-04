// Study sets (migration 218, routes/site-sets.js, src/study.js): an account's own lists of entries of any type on the
// site — created, filled, renamed, emptied, deleted; private to the account; index cards for every type with the
// account's progress (a Leitner box per direction).
const { test, expect, sql } = require('./helpers');

const SITE = 'https://arthistory.piogino.ch';   // config.corsOrigin's default
const H = { Origin: SITE };
const get = async (user, path, status = 200) => {
  const res = await user.request.get(`/site/sets${path}`, { headers: H });
  expect(res.status()).toBe(status);
  return status === 200 ? res.json() : null;
};
const post = async (user, path, form, status = 200) => {
  const res = await user.request.post(`/site/sets${path}`, { headers: H, form });
  expect(res.status()).toBe(status);
  return status === 204 ? null : res.json();
};
const cleanup = () => sql(`DELETE FROM study_sets WHERE name LIKE 'Test set%'; UPDATE admin_users SET public_name = NULL WHERE public_name LIKE 'Test %'; DELETE FROM study_progress WHERE entity_type = 'artwork' AND entity_id IN (SELECT id FROM artworks WHERE slug LIKE 'test-study-%');
  DELETE FROM artworks WHERE slug LIKE 'test-study-%'; DELETE FROM artists WHERE slug LIKE 'test-study-%'; DELETE FROM glossary WHERE slug LIKE 'test-study-%'`);
test.beforeAll(() => {
  cleanup();
  sql(`INSERT INTO artists (slug, name, birth, birth_label, death, death_label) VALUES ('test-study-painter', 'Stella Studymaker', '[1801-01-01,1802-01-01)', '1801', '[1870-01-01,1871-01-01)', '1870');
       INSERT INTO artworks (slug, title, creator_id, created, created_label, kind, medium) VALUES
         ('test-study-work', 'The Test of Memory', entity_id('artist', 'test-study-painter'), '[1840-01-01,1841-01-01)', '1840', 'painting', 'Oil on canvas');
       INSERT INTO glossary (slug, name, category, definition) VALUES ('test-study-term', 'Testsfumato', 'technique', 'A soft blending of tones without lines, used in the tests.')`);
});
test.afterAll(cleanup);

test('a set: created, filled with entries of three types, renamed; the cards show what to learn; private to its account', async ({ userA, userB }) => {
  const { set } = await post(userA, '', { name: 'Test set Renaissance', description: 'For the exam' }, 201);
  expect(set.count).toBe(0);
  for (const [type, slug] of [['artwork', 'test-study-work'], ['artist', 'test-study-painter'], ['term', 'test-study-term']]) {
    await post(userA, `/${set.id}/items`, { type, slug });
  }
  expect((await post(userA, `/${set.id}/items`, { type: 'artwork', slug: 'test-study-work' })).count).toBe(3);   // twice = once
  await post(userA, `/${set.id}/items`, { type: 'artwork', slug: 'no-such-work' }, 422);

  const list = await get(userA, '');
  expect(list.sets.find((s) => s.id === set.id)).toEqual(expect.objectContaining({ name: 'Test set Renaissance', count: 3 }));
  const of = await get(userA, '/of?type=term&slug=test-study-term');
  expect(of.sets.find((s) => s.id === set.id).has).toBe(true);

  const { items } = await get(userA, `/${set.id}`);
  expect(items.map((i) => i.slug)).toEqual(['test-study-work', 'test-study-painter', 'test-study-term']);

  const { cards } = await get(userA, `/${set.id}/cards`);
  const work = cards.find((c) => c.type === 'artwork');
  expect(work.name).toBe('The Test of Memory');
  expect(work.facts).toEqual(expect.arrayContaining([{ label: 'Artist', value: 'Stella Studymaker' }, { label: 'Date', value: '1840' }, { label: 'Medium', value: 'Oil on canvas' }]));
  expect(cards.find((c) => c.type === 'artist').facts).toEqual(expect.arrayContaining([{ label: 'Lived', value: '1801 – 1870' }]));
  expect(cards.find((c) => c.type === 'term').text).toBe('A soft blending of tones without lines, used in the tests.');

  // the answers: known → a box up, not known → box 1
  expect((await post(userA, '/progress', { type: 'artwork', slug: 'test-study-work', direction: 'forward', known: '1' })).box).toBe(2);
  expect((await post(userA, '/progress', { type: 'artwork', slug: 'test-study-work', direction: 'forward', known: '1' })).box).toBe(3);
  expect((await post(userA, '/progress', { type: 'artwork', slug: 'test-study-work', direction: 'forward', known: '0' })).box).toBe(1);
  const again = await get(userA, `/${set.id}/cards`);
  expect(again.cards.find((c) => c.type === 'artwork').progress.forward).toEqual({ box: 1, seen: 3, known: 2 });

  // another account sees nothing of it and can change nothing
  await get(userB, `/${set.id}`, 404);
  await get(userB, `/${set.id}/cards`, 404);
  await post(userB, `/${set.id}/items`, { type: 'artist', slug: 'test-study-painter' }, 404);
  await post(userB, `/${set.id}/delete`, {}, 404);
  expect((await get(userB, '')).sets.find((s) => s.id === set.id)).toBeUndefined();

  // renamed, an entry removed, deleted
  expect((await post(userA, `/${set.id}`, { name: 'Test set Renaissance II' })).set.name).toBe('Test set Renaissance II');
  expect((await post(userA, `/${set.id}/items/remove`, { type: 'term', slug: 'test-study-term' })).count).toBe(2);
  await post(userA, `/${set.id}/delete`, {}, 204);
  await get(userA, `/${set.id}`, 404);
});

test('a set shared by link and in public: topic, creator, dates; seen without a login, copied, studied — results stay the learner\'s', async ({ userA, userB, request }) => {
  const { set } = await post(userA, '', { name: 'Test set Shared', topic: 'Test topic Baroque' }, 201);
  expect(set).toEqual(expect.objectContaining({ topic: 'Test topic Baroque', visibility: 'private', code: null }));
  await post(userA, `/${set.id}/items`, { type: 'artwork', slug: 'test-study-work' });
  await post(userA, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' });

  // sharing shows a public name — never the login name, and not without one
  await post(userA, `/${set.id}/share`, { visibility: 'link', public_name: '' }, 422);
  const shared = (await post(userA, `/${set.id}/share`, { visibility: 'link', public_name: 'Test Teacher' })).set;
  expect(shared.visibility).toBe('link');
  expect(shared.code).toMatch(/^[A-Za-z0-9_-]{12}$/);

  // anyone with the link — no login: name, topic, creator, dates, entries, cards (without anyone's progress)
  const look = await (await request.get(`/site/shared/${shared.code}`, { headers: H })).json();
  expect(look.set).toEqual(expect.objectContaining({ name: 'Test set Shared', topic: 'Test topic Baroque', creator: 'Test Teacher', count: 2, mine: false }));
  expect(look.set.id).toBeUndefined();
  expect(look.set.created_at).toBeTruthy();
  expect(look.items.map((i) => i.slug)).toEqual(['test-study-work', 'test-study-term']);
  const { cards } = await (await request.get(`/site/shared/${shared.code}/cards`, { headers: H })).json();
  expect(cards.map((c) => c.name)).toEqual(['The Test of Memory', 'Testsfumato']);
  expect((await request.post(`/site/shared/${shared.code}/copy`, { headers: H })).status()).toBe(401);
  // by link only: not in the public list; in public: listed with its topic
  const listed = async () => (await (await request.get('/site/shared?topic=Test%20topic%20Baroque', { headers: H })).json()).sets;
  expect(await listed()).toEqual([]);
  await post(userA, `/${set.id}/share`, { visibility: 'public' });
  expect((await listed()).map((s) => s.name)).toEqual(['Test set Shared']);

  // another account studies it: its rounds and results are its own; it saves a copy
  await post(userB, `/../shared/${shared.code}/sessions`, { mode: 'choice', answered: '2', known: '1', seconds: '30' }, 201);
  await post(userB, `/../shared/${shared.code}/sessions`, { mode: 'choice', answered: '2', known: '2', seconds: '20' }, 201);
  const theirs = await (await userB.request.get(`/site/shared/${shared.code}/stats`, { headers: H })).json();
  expect(theirs.modes.choice).toEqual(expect.objectContaining({ rounds: 2, answered: 4, known: 3, best: 100, recent: [100, 50], seconds: 50 }));
  expect(theirs.boxes.forward).toEqual([2, 0, 0, 0, 0, 0]);
  expect((await get(userA, `/${set.id}/stats`)).modes).toEqual({});
  const copy = (await post(userB, `/../shared/${shared.code}/copy`, {}, 201)).set;
  const mine = await get(userB, `/${copy.id}`);
  expect(mine.set).toEqual(expect.objectContaining({ name: 'Test set Shared', topic: 'Test topic Baroque', visibility: 'private', count: 2 }));
  expect(mine.set.copied_from).toEqual({ name: 'Test set Shared', code: shared.code, creator: 'Test Teacher' });

  // the owner's own rounds; sharing is not a change of the set, a new link ends the old one, private ends both
  await post(userA, `/${set.id}/sessions`, { mode: 'typed', answered: '2', known: '0' }, 201);
  await post(userA, `/${set.id}/sessions`, { mode: 'nonsense', answered: '2', known: '0' }, 422);
  expect((await get(userA, `/${set.id}/stats`)).modes.typed.rounds).toBe(1);
  const renewed = (await post(userA, `/${set.id}/share`, { new_link: '1' })).set;
  expect(renewed.code).not.toBe(shared.code);
  expect(renewed.updated_at).toBe(shared.updated_at);
  expect((await request.get(`/site/shared/${shared.code}`, { headers: H })).status()).toBe(404);
  await post(userA, `/${set.id}/share`, { visibility: 'private' });
  expect((await request.get(`/site/shared/${renewed.code}`, { headers: H })).status()).toBe(404);
  expect(await listed()).toEqual([]);
});

test('sets: not without a login, not from another site', async ({ userA, request }) => {
  expect((await request.get('/site/sets', { headers: H })).status()).toBe(401);
  const res = await userA.request.post('/site/sets', { headers: { Origin: 'https://evil.example' }, form: { name: 'Test set evil' } });
  expect(res.status()).toBe(403);
  expect(sql("SELECT count(*) FROM study_sets WHERE name = 'Test set evil'")).toBe('0');
});
