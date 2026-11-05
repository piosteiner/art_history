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
const cleanup = () => sql(`DELETE FROM study_sets WHERE name LIKE 'Test set%'; UPDATE admin_users SET public_name = NULL WHERE public_name LIKE 'Test %'; DELETE FROM study_progress WHERE (entity_type = 'artwork' AND entity_id IN (SELECT id FROM artworks WHERE slug LIKE 'test-study-%')) OR (entity_type = 'term' AND entity_id IN (SELECT id FROM glossary WHERE slug LIKE 'test-study-%'));
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
  expect(again.cards.find((c) => c.type === 'artwork').progress.forward).toEqual({ box: 1, seen: 3, known: 2, due: false });   // box 1: tomorrow again

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

test('a description is previewed as it will be shown (Markdown, [[links]], no raw HTML)', async ({ userA }) => {
  const { html } = await post(userA, '/preview', { text: '## For the exam\n\n**Look** at [[term/test-study-term]] <script>alert(1)</script>' });
  expect(html).toContain('<h2');
  expect(html).toContain('<strong>Look</strong>');
  expect(html).toContain('Testsfumato');
  expect(html).not.toContain('<script>');
  expect((await post(userA, '/preview', { text: '' })).html).toBe('');
});

test('a set edited together: invitation link, joined, changed by an editor (who and when), conflicts, the owner\'s rights; exam dates plan the day\'s cards', async ({ userA, userB, request }) => {
  const { set } = await post(userA, '', { name: 'Test set Together', description: 'First text' }, 201);
  await post(userA, `/${set.id}/items`, { type: 'artwork', slug: 'test-study-work' });
  // an invitation needs the owner's public name (the editors see it); a new link ends the old one
  sql("UPDATE admin_users SET public_name = NULL WHERE username IN ('tester', 'tester2')");
  await post(userA, `/${set.id}/editors`, { action: 'invite' }, 422);
  const first = (await post(userA, `/${set.id}/editors`, { action: 'invite', public_name: 'Test Owner' })).set.edit_code;
  expect(first).toMatch(/^[A-Za-z0-9_-]{16}$/);
  const code = (await post(userA, `/${set.id}/editors`, { action: 'invite' })).set.edit_code;
  expect(code).not.toBe(first);
  expect((await request.get(`/site/shared/join/${first}`, { headers: H })).status()).toBe(404);

  // anyone sees what the invitation is for; joining needs a login and a public name
  const invite = await (await request.get(`/site/shared/join/${code}`, { headers: H })).json();
  expect(invite.set).toEqual(expect.objectContaining({ name: 'Test set Together', creator: 'Test Owner', count: 1, editors: 0 }));
  expect(invite.set.id).toBeUndefined();
  expect((await request.post(`/site/shared/join/${code}`, { headers: H })).status()).toBe(401);
  await post(userB, `/../shared/join/${code}`, {}, 422);
  expect((await post(userB, `/../shared/join/${code}`, { public_name: 'Test Helper' }, 201)).set.id).toBe(set.id);

  // the editor: in its list, changes the description and adds an entry — who did it is shown
  const listed = (await get(userB, '')).sets.find((s) => s.id === set.id);
  expect(listed).toEqual(expect.objectContaining({ role: 'editor', creator: 'Test Owner' }));
  await post(userB, `/${set.id}`, { description: 'Second text', base_description: 'First text' });
  await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' });
  const seen = await get(userA, `/${set.id}`);
  expect(seen.set).toEqual(expect.objectContaining({ description: 'Second text', updated_by: 'Test Helper', role: 'owner' }));
  expect(seen.set.editors).toEqual([expect.objectContaining({ name: 'Test Helper', me: false })]);
  expect(seen.items.find((i) => i.slug === 'test-study-term').added_by).toBe('Test Helper');

  // the owner saves from the old text: a conflict — nothing saved, the set as it is now comes back
  const clash = await userA.request.post(`/site/sets/${set.id}`, { headers: H, form: { description: 'Owner text', base_description: 'First text' } });
  expect(clash.status()).toBe(409);
  expect((await clash.json()).set.description).toBe('Second text');
  await post(userA, `/${set.id}`, { description: 'Owner text', base_description: 'Second text' });

  // sharing, the editors and deleting stay the owner's
  await post(userB, `/${set.id}/share`, { visibility: 'public' }, 403);
  await post(userB, `/${set.id}/delete`, {}, 403);
  await post(userB, `/${set.id}/editors`, { action: 'stop' }, 403);
  await post(userA, `/${set.id}/leave`, {}, 422);

  // exam dates are each account's own: the plan counts the days and the day's cards
  await post(userB, `/${set.id}/plan`, { exam_on: '2001-01-01' }, 422);
  const exam = sql("SELECT ((now() AT TIME ZONE 'Europe/Zurich')::date + 11)::text");
  const { plan } = await post(userB, `/${set.id}/plan`, { exam_on: exam });
  expect(plan).toEqual(expect.objectContaining({ exam_on: exam, days_left: 11 }));
  // two new cards in each direction, spread over the ten days before the exam: one today
  expect(plan.directions.forward).toEqual({ due: 0, new: 2, new_left_today: 1, new_today: 0 });
  expect((await get(userA, `/${set.id}/stats`)).plan.exam_on).toBeNull();
  await post(userB, '/progress', { type: 'term', slug: 'test-study-term', direction: 'forward', known: '1' });
  const after = (await get(userB, `/${set.id}/stats`)).plan.directions.forward;
  expect(after).toEqual({ due: 0, new: 1, new_left_today: 0, new_today: 1 });
  // a card asked 6 days ago in box 5: due again before the exam (16 days shortened to 5) — not without the exam
  sql(`UPDATE study_progress SET box = 5, last_seen_at = now() - interval '6 days' WHERE entity_type = 'term' AND direction = 'forward'
         AND owner_id = (SELECT id FROM admin_users WHERE username = 'tester2')`);
  expect((await get(userB, `/${set.id}/cards`)).cards.find((c) => c.type === 'term').progress.forward.due).toBe(true);
  await post(userB, `/${set.id}/plan`, { exam_on: '' });
  expect((await get(userB, `/${set.id}/cards`)).cards.find((c) => c.type === 'term').progress.forward.due).toBe(false);

  // the editor leaves; or is removed by the owner; no more invitations
  await post(userB, `/${set.id}/leave`, {}, 204);
  await get(userB, `/${set.id}`, 404);
  await post(userB, `/../shared/join/${code}`, {}, 201);
  const editor = (await get(userA, `/${set.id}`)).set.editors[0];
  await post(userA, `/${set.id}/editors`, { action: 'remove', account: editor.id });
  await post(userA, `/${set.id}/editors`, { action: 'stop' });
  await get(userB, `/${set.id}`, 404);
  expect((await request.get(`/site/shared/join/${code}`, { headers: H })).status()).toBe(404);
});

test('sets: not without a login, not from another site', async ({ userA, request }) => {
  expect((await request.get('/site/sets', { headers: H })).status()).toBe(401);
  const res = await userA.request.post('/site/sets', { headers: { Origin: 'https://evil.example' }, form: { name: 'Test set evil' } });
  expect(res.status()).toBe(403);
  expect(sql("SELECT count(*) FROM study_sets WHERE name = 'Test set evil'")).toBe('0');
});
