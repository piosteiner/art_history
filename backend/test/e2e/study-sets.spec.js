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

// 228: a link with given rights, joined by another account
const joinWith = async (owner, joiner, setId, rights) => {
  const { link } = await post(owner, `/${setId}/links`, { rights }, 201);
  await post(joiner, `/../shared/join/${link.code}`, {}, 201);
  return link;
};

test('a set shared with its members and in public: topic, creator, dates; public seen without a login, copied, studied — results stay the learner\'s', async ({ userA, userB, request }) => {
  const { set } = await post(userA, '', { name: 'Test set Shared', topic: 'Test topic Baroque' }, 201);
  expect(set).toEqual(expect.objectContaining({ topic: 'Test topic Baroque', visibility: 'private', code: null }));
  await post(userA, `/${set.id}/items`, { type: 'artwork', slug: 'test-study-work' });
  await post(userA, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' });

  // sharing shows a public name — never the login name, and not without one
  await post(userA, `/${set.id}/share`, { visibility: 'shared', public_name: '' }, 422);
  const shared = (await post(userA, `/${set.id}/share`, { visibility: 'shared', public_name: 'Test Teacher' })).set;
  expect(shared).toEqual(expect.objectContaining({ visibility: 'shared', code: null }));
  // shared: for its members only — not listed; public: listed with its topic and seen by anyone
  const listed = async () => (await (await request.get('/site/shared?topic=Test%20topic%20Baroque', { headers: H })).json()).sets;
  expect(await listed()).toEqual([]);
  const pub = (await post(userA, `/${set.id}/share`, { visibility: 'public' })).set;
  expect(pub.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect((await listed()).map((s) => s.name)).toEqual(['Test set Shared']);

  // anyone — no login: name, topic, creator, dates, entries, cards (without anyone's progress)
  const look = await (await request.get(`/site/shared/${pub.code}`, { headers: H })).json();
  expect(look.set).toEqual(expect.objectContaining({ name: 'Test set Shared', topic: 'Test topic Baroque', creator: 'Test Teacher', count: 2, mine: false }));
  expect(look.set.id).toBeUndefined();
  expect(look.set.created_at).toBeTruthy();
  expect(look.items.map((i) => i.slug)).toEqual(['test-study-work', 'test-study-term']);
  const { cards } = await (await request.get(`/site/shared/${pub.code}/cards`, { headers: H })).json();
  expect(cards.map((c) => c.name)).toEqual(['The Test of Memory', 'Testsfumato']);
  expect((await request.post(`/site/shared/${pub.code}/copy`, { headers: H })).status()).toBe(401);

  // another account studies it: its rounds and results are its own; it saves a copy
  await post(userB, `/../shared/${pub.code}/sessions`, { mode: 'choice', answered: '2', known: '1', seconds: '30' }, 201);
  await post(userB, `/../shared/${pub.code}/sessions`, { mode: 'choice', answered: '2', known: '2', seconds: '20' }, 201);
  const theirs = await (await userB.request.get(`/site/shared/${pub.code}/stats`, { headers: H })).json();
  expect(theirs.modes.choice).toEqual(expect.objectContaining({ rounds: 2, answered: 4, known: 3, best: 100, recent: [100, 50], seconds: 50 }));
  expect(theirs.boxes.forward).toEqual([2, 0, 0, 0, 0, 0]);
  expect((await get(userA, `/${set.id}/stats`)).modes).toEqual({});
  const copy = (await post(userB, `/../shared/${pub.code}/copy`, {}, 201)).set;
  const mine = await get(userB, `/${copy.id}`);
  expect(mine.set).toEqual(expect.objectContaining({ name: 'Test set Shared', topic: 'Test topic Baroque', visibility: 'private', count: 2 }));
  expect(mine.set.copied_from).toEqual({ name: 'Test set Shared', code: pub.code, creator: 'Test Teacher' });

  // the owner's own rounds; sharing is not a change of the set; no longer public, the address ends; public again, a new one
  await post(userA, `/${set.id}/sessions`, { mode: 'typed', answered: '2', known: '0' }, 201);
  await post(userA, `/${set.id}/sessions`, { mode: 'nonsense', answered: '2', known: '0' }, 422);
  expect((await get(userA, `/${set.id}/stats`)).modes.typed.rounds).toBe(1);
  expect(pub.updated_at).toBe(shared.updated_at);
  await post(userA, `/${set.id}/share`, { visibility: 'shared' });
  expect((await request.get(`/site/shared/${pub.code}`, { headers: H })).status()).toBe(404);
  expect(await listed()).toEqual([]);
  const again = (await post(userA, `/${set.id}/share`, { visibility: 'public' })).set;
  expect(again.code).not.toBe(pub.code);
  await post(userA, `/${set.id}/share`, { visibility: 'private' });
  expect((await request.get(`/site/shared/${again.code}`, { headers: H })).status()).toBe(404);
});

test('a description is previewed as it will be shown (Markdown, [[links]], no raw HTML)', async ({ userA }) => {
  const { html } = await post(userA, '/preview', { text: '## For the exam\n\n**Look** at [[term/test-study-term]] <script>alert(1)</script>' });
  expect(html).toContain('<h2');
  expect(html).toContain('<strong>Look</strong>');
  expect(html).toContain('Testsfumato');
  expect(html).not.toContain('<script>');
  expect((await post(userA, '/preview', { text: '' })).html).toBe('');
});

test('members: links with rights, joined, turned off; friends invited; a full editor changes it (who and when), conflicts, the owner\'s rights; exam dates plan the day\'s cards', async ({ userA, userB, request }) => {
  const { set } = await post(userA, '', { name: 'Test set Together', description: 'First text' }, 201);
  await post(userA, `/${set.id}/items`, { type: 'artwork', slug: 'test-study-work' });
  // a link needs the owner's public name (the members see it) and says which rights it gives; it makes the set shared
  sql("UPDATE admin_users SET public_name = NULL WHERE username IN ('tester', 'tester2')");
  await post(userA, `/${set.id}/links`, { rights: 'full' }, 422);
  await post(userA, `/${set.id}/links`, { rights: 'owner', public_name: 'Test Owner' }, 422);
  const viewLink = (await post(userA, `/${set.id}/links`, { rights: 'view', public_name: 'Test Owner' }, 201)).link;
  const { link } = await post(userA, `/${set.id}/links`, { rights: 'full' }, 201);
  expect(link).toEqual(expect.objectContaining({ rights: 'full', ended_at: null, joined: 0 }));
  expect(link.code).toMatch(/^[A-Za-z0-9_-]{16}$/);
  expect((await get(userA, `/${set.id}`)).set.visibility).toBe('shared');
  const sharing = await get(userA, `/${set.id}/sharing`);
  expect(sharing.links.map((l) => l.rights).sort()).toEqual(['full', 'view']);
  expect(sharing.settings).toEqual({ visibility: 'shared', vote_mode: 'advisory', vote_hours: 24, owner_veto: false });
  await get(userB, `/${set.id}/sharing`, 404);

  // anyone sees what the link is for and which rights it gives; joining needs a login and a public name
  const invite = await (await request.get(`/site/shared/join/${link.code}`, { headers: H })).json();
  expect(invite).toEqual(expect.objectContaining({ rights: 'full', role: null }));
  expect(invite.set).toEqual(expect.objectContaining({ name: 'Test set Together', creator: 'Test Owner', count: 1, members: 0 }));
  expect(invite.set.id).toBeUndefined();
  expect((await request.post(`/site/shared/join/${link.code}`, { headers: H })).status()).toBe(401);
  await post(userB, `/../shared/join/${link.code}`, {}, 422);
  expect((await post(userB, `/../shared/join/${link.code}`, { public_name: 'Test Helper' }, 201)).set.id).toBe(set.id);
  // joined once: the viewer link changes nothing for a member
  await post(userB, `/../shared/join/${viewLink.code}`, {}, 200);

  // the editor: in its list with its rights, changes the description and adds an entry — who did it is shown
  const listed = (await get(userB, '')).sets.find((s) => s.id === set.id);
  expect(listed).toEqual(expect.objectContaining({ role: 'editor', rights: 'full', creator: 'Test Owner' }));
  await post(userB, `/${set.id}`, { description: 'Second text', base_description: 'First text' });
  await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' });
  const seen = await get(userA, `/${set.id}`);
  expect(seen.set).toEqual(expect.objectContaining({ description: 'Second text', updated_by: 'Test Helper', role: 'owner', rights: 'owner' }));
  expect(seen.set.members).toEqual([expect.objectContaining({ name: 'Test Helper', me: false, rights: 'full', chat: false })]);
  expect(seen.items.find((i) => i.slug === 'test-study-term').added_by).toBe('Test Helper');
  expect((await get(userA, `/${set.id}/sharing`)).links.find((l) => l.id === link.id).joined).toBe(1);

  // the owner saves from the old text: a conflict — nothing saved, the set as it is now comes back
  const clash = await userA.request.post(`/site/sets/${set.id}`, { headers: H, form: { description: 'Owner text', base_description: 'First text' } });
  expect(clash.status()).toBe(409);
  expect((await clash.json()).set.description).toBe('Second text');
  await post(userA, `/${set.id}`, { description: 'Owner text', base_description: 'Second text' });

  // sharing, the members and deleting stay the owner's
  await post(userB, `/${set.id}/share`, { visibility: 'public' }, 403);
  await post(userB, `/${set.id}/delete`, {}, 403);
  await post(userB, `/${set.id}/links`, { rights: 'full' }, 403);
  await post(userB, `/${set.id}/settings`, { vote_mode: 'binding' }, 403);
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

  // the member leaves; joins again; the owner turns the link off (no one new joins) and removes the member
  await post(userB, `/${set.id}/leave`, {}, 204);
  await get(userB, `/${set.id}`, 404);
  await post(userB, `/../shared/join/${link.code}`, {}, 201);
  await post(userA, `/${set.id}/links/${link.id}/end`, {}, 204);
  await get(userB, `/${set.id}`);   // who joined stays
  const off = await request.get(`/site/shared/join/${link.code}`, { headers: H });
  expect(off.status()).toBe(410);
  expect((await off.json()).closed).toBe('off');
  const member = (await get(userA, `/${set.id}`)).set.members[0];
  await post(userA, `/${set.id}/members/${member.id}`, { action: 'remove' });
  await get(userB, `/${set.id}`, 404);
  await post(userB, `/../shared/join/${link.code}`, {}, 410);

  // a link with a limit (230): full after one join; one with an end date: expired after it — no one new joins
  await post(userA, `/${set.id}/links`, { rights: 'view', max_joins: '0' }, 422);
  await post(userA, `/${set.id}/links`, { rights: 'full', max_joins: '51' }, 422);
  await post(userA, `/${set.id}/links`, { rights: 'view', expires_on: '2001-01-01' }, 422);
  const once = (await post(userA, `/${set.id}/links`, { rights: 'view', max_joins: '1' }, 201)).link;
  expect(once).toEqual(expect.objectContaining({ max_joins: 1, joined: 0, closed: null }));
  await post(userB, `/../shared/join/${once.code}`, {}, 201);
  await post(userB, `/${set.id}/leave`, {}, 204);
  const full = await request.get(`/site/shared/join/${once.code}`, { headers: H });
  expect(full.status()).toBe(410);
  expect(await full.json()).toEqual(expect.objectContaining({ closed: 'full' }));
  const lastDay = sql("SELECT ((now() AT TIME ZONE 'Europe/Zurich')::date + 3)::text");
  const dated = (await post(userA, `/${set.id}/links`, { rights: 'view', expires_on: lastDay }, 201)).link;
  // valid until the end of that day in Zurich
  expect(sql(`SELECT (expires_at AT TIME ZONE 'Europe/Zurich')::text FROM study_set_links WHERE id = ${dated.id}`)).toBe(`${sql(`SELECT ('${lastDay}'::date + 1)::text`)} 00:00:00`);
  expect((await request.get(`/site/shared/join/${dated.code}`, { headers: H })).status()).toBe(200);
  sql(`UPDATE study_set_links SET expires_at = now() - interval '1 minute' WHERE id = ${dated.id}`);
  await post(userB, `/../shared/join/${dated.code}`, {}, 410);
  expect((await get(userA, `/${set.id}/sharing`)).links.filter((l) => l.closed).map((l) => l.closed).sort()).toEqual(['expired', 'full', 'off']);

  // friends are invited with rights: the invitation waits in their list until accepted or declined
  const [a, b] = ['tester', 'tester2'].map((u) => sql(`SELECT id FROM admin_users WHERE username = '${u}'`));
  await post(userA, `/${set.id}/invitations`, { account: b, rights: 'view' }, 422);   // not friends yet
  sql(`INSERT INTO friendships (low_id, high_id, requested_by, accepted_at) VALUES (least(${a}, ${b}), greatest(${a}, ${b}), ${a}, now()) ON CONFLICT DO NOTHING`);
  try {
    expect((await get(userA, `/${set.id}/sharing`)).friends.map((f) => f.name)).toContain('Test Helper');
    await post(userA, `/${set.id}/invitations`, { account: b, rights: 'view', chat: '1' }, 201);
    expect((await get(userB, '')).invitations).toEqual([expect.objectContaining({ set_id: set.id, name: 'Test set Together', creator: 'Test Owner', rights: 'view', chat: true })]);
    await post(userB, `/invitations/${set.id}`, { accept: '0' });
    expect((await get(userB, '')).invitations).toEqual([]);
    await post(userA, `/${set.id}/invitations`, { account: b, rights: 'view' }, 201);
    await post(userB, `/invitations/${set.id}`, { accept: '1' });
    expect((await get(userB, `/${set.id}`)).set).toEqual(expect.objectContaining({ role: 'viewer', rights: 'view', chat_allowed: false }));
    // an invitation to a set made private meanwhile: refused with a sentence that says why
    await post(userB, `/${set.id}/leave`, {}, 204);
    await post(userA, `/${set.id}/invitations`, { account: b, rights: 'view' }, 201);
    await post(userA, `/${set.id}/share`, { visibility: 'private' });
    const stale = await userB.request.post(`/site/sets/invitations/${set.id}`, { headers: H, form: { accept: '1' } });
    expect(stale.status()).toBe(404);
    expect((await stale.json()).error).toContain('no longer valid');
  } finally {
    sql(`DELETE FROM friendships WHERE (low_id, high_id) = (least(${a}, ${b}), greatest(${a}, ${b}))`);
  }
});

test('sets: not without a login, not from another site', async ({ userA, request }) => {
  expect((await request.get('/site/sets', { headers: H })).status()).toBe(401);
  const res = await userA.request.post('/site/sets', { headers: { Origin: 'https://evil.example' }, form: { name: 'Test set evil' } });
  expect(res.status()).toBe(403);
  expect(sql("SELECT count(*) FROM study_sets WHERE name = 'Test set evil'")).toBe('0');
});

// 228: a set's history, restored to a step; locked; public again with a new address; an admin rolls a member's set
// back in the CMS
test('a set\'s history and restore; locked; public address renewed; an admin rolls it back', async ({ userA, userB, request }) => {
  sql("UPDATE admin_users SET public_name = 'Test Owner' WHERE username = 'tester'; UPDATE admin_users SET public_name = 'Test Helper' WHERE username = 'tester2'");
  const { set } = await post(userA, '', { name: 'Test set History' }, 201);
  await post(userA, `/${set.id}/items`, { type: 'artwork', slug: 'test-study-work' });
  await joinWith(userA, userB, set.id, 'full');

  // the editor adds an entry and renames the set; the history names who did what
  await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' });
  await post(userB, `/${set.id}`, { name: 'Test set History flooded' });
  const { events } = await get(userB, `/${set.id}/history`);
  expect(events.map((e) => [e.action, e.by, e.field || (e.entry && e.entry.slug)])).toEqual(expect.arrayContaining([
    ['changed', 'Test Helper', 'name'], ['added', 'Test Helper', 'test-study-term'], ['added', 'Test Owner', 'test-study-work'], ['created', 'Test Owner', null]]));

  // the owner brings the set back to the step before the editor came: the name and the work back, the term gone
  const steps = (await get(userA, `/${set.id}/history`)).events;
  const before = steps.find((e) => e.action === 'added' && e.entry && e.entry.slug === 'test-study-work');
  await post(userB, `/${set.id}/restore`, { event: before.id }, 403);
  expect((await post(userA, `/${set.id}/restore`, { event: before.id })).restored).toEqual({ removed: 1, added: 0 });
  const back = await get(userA, `/${set.id}`);
  expect(back.set.name).toBe('Test set History');
  expect(back.items.map((i) => i.slug)).toEqual(['test-study-work']);
  expect((await get(userA, `/${set.id}/history`)).events[0].action).toBe('restored');
  await new Promise((r) => { setTimeout(r, 1100); });   // the CMS form below works to the second: the next steps in a later one

  // locked: the editor studies but changes nothing
  expect((await post(userA, `/${set.id}/lock`, { locked: '1' })).set.locked_at).toBeTruthy();
  await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' }, 423);
  await post(userB, `/${set.id}`, { name: 'Test set changed while locked' }, 423);
  await get(userB, `/${set.id}/cards`);
  await post(userA, `/${set.id}/lock`, { locked: '0' });
  await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' });

  // a public address ends for good when the set stops being public; public again it is a new one
  const first = (await post(userA, `/${set.id}/share`, { visibility: 'public' })).set.code;
  expect((await request.get(`/site/shared/${first}`, { headers: H })).status()).toBe(200);
  await post(userA, `/${set.id}/share`, { visibility: 'shared' });
  expect((await request.get(`/site/shared/${first}`, { headers: H })).status()).toBe(404);
  const second = (await post(userA, `/${set.id}/share`, { visibility: 'public' })).set.code;
  expect(second).not.toBe(first);
  await post(userA, `/${set.id}/share`, { visibility: 'shared' });

  // an admin (CMS → Accounts → the owner → the set) rolls it back to a moment: the history shows the step
  const owner = sql("SELECT id FROM admin_users WHERE username = 'tester'");
  await userA.goto(`/accounts/${owner}/sets/${set.id}`);
  await expect(userA.locator('.set-history')).toContainText('added');
  await Promise.all([userA.waitForURL(/\?at=/), userA.locator('.set-history tr', { hasText: 'restored the set to' }).locator('[data-fill-at]').click()]);
  await userA.fill('input[name="reason"]', 'test rollback');
  userA.once('dialog', (d) => d.accept());
  await Promise.all([userA.waitForURL(/ok=rolled_back/), userA.click('button:has-text("Roll back")')]);
  expect((await get(userA, `/${set.id}`)).items.map((i) => i.slug)).toEqual(['test-study-work']);
  await expect(userA.locator('.set-history tr').first()).toContainText('by an admin: test rollback');
});

// 228: members' rights — viewer, with approval, with votes (advisory, binding); proposals of every kind of change
test('rights in a set: a viewer reads; changes with approval wait for the owner; advisory votes; binding votes decide early, at the end, even → the owner; veto', async ({ userA, userB }) => {
  sql("UPDATE admin_users SET public_name = 'Test Owner' WHERE username = 'tester'; UPDATE admin_users SET public_name = 'Test Helper' WHERE username = 'tester2'");
  sql("DELETE FROM admin_users WHERE username = 'test-voter'; INSERT INTO admin_users (username, password_hash, public_name) VALUES ('test-voter', 'x', 'Test Voter')");
  try {
    const { set } = await post(userA, '', { name: 'Test set Rights', topic: 'Test topic Rights' }, 201);
    await post(userA, `/${set.id}/items`, { type: 'artwork', slug: 'test-study-work' });
    const B = sql("SELECT id FROM admin_users WHERE username = 'tester2'");
    const C = sql("SELECT id FROM admin_users WHERE username = 'test-voter'");
    const voteAsC = (pid, vote) => sql(`INSERT INTO study_set_votes (proposal_id, voter_id, vote) VALUES (${pid}, ${C}, '${vote}')
      ON CONFLICT (proposal_id, voter_id) DO UPDATE SET vote = EXCLUDED.vote`);
    const items = async () => (await get(userA, `/${set.id}`)).items.map((i) => i.slug).sort();

    // a viewer: reads and studies; changes nothing, sees no proposals, no history, no chat unless the owner allows it
    await joinWith(userA, userB, set.id, 'view');
    const asViewer = await get(userB, `/${set.id}`);
    expect(asViewer.set).toEqual(expect.objectContaining({ role: 'viewer', rights: 'view', chat_allowed: false }));
    expect(asViewer.proposals).toEqual([]);
    await get(userB, `/${set.id}/cards`);
    await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' }, 403);
    await post(userB, `/${set.id}`, { name: 'Test set by a viewer' }, 403);
    await get(userB, `/${set.id}/history`, 403);
    await post(userB, `/${set.id}/copy`, {}, 403);
    await post(userA, `/${set.id}/chat/switch`, { on: '1' });
    await get(userB, `/${set.id}/chat`, 403);
    await post(userA, `/${set.id}/members/${B}`, { action: 'chat', on: '1' });
    expect((await get(userB, `/${set.id}/chat`)).on).toBe(true);
    expect((await get(userB, '/of?type=term&slug=test-study-term')).sets.map((s) => s.id)).not.toContain(set.id);

    // with approval: every change is a proposal; the owner accepts or rejects — no votes
    await post(userA, `/${set.id}/members/${B}`, { action: 'rights', rights: 'approval' });
    const add = await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term', reason: 'Test: on the exam' }, 202);
    expect(add.proposal).toEqual(expect.objectContaining({ procedure: 'approval', outcome: null }));
    await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' }, 409);   // proposed already
    expect(await items()).toEqual(['test-study-work']);
    expect((await get(userA, '')).sets.find((s) => s.id === set.id)).toEqual(expect.objectContaining({ proposals: 1, to_decide: 1, to_vote: 0 }));
    await post(userB, `/${set.id}/proposals/${add.proposal.id}/vote`, { vote: 'yes' }, 422);
    await post(userB, `/${set.id}/proposals/${add.proposal.id}/decide`, { decision: 'accepted' }, 403);
    expect((await post(userA, `/${set.id}/proposals/${add.proposal.id}/decide`, { decision: 'accepted' })).outcome).toBe('accepted');
    const accepted = await get(userA, `/${set.id}`);
    expect(accepted.items.find((i) => i.slug === 'test-study-term').added_by).toBe('Test Helper');   // the proposer's change
    expect(accepted.decided[0]).toEqual(expect.objectContaining({ kind: 'add', slug: 'test-study-term', outcome: 'accepted', decided_by: 'Test Owner', proposed_by: 'Test Helper', reason: 'Test: on the exam' }));
    const rename = await post(userB, `/${set.id}`, { name: 'Test set Rights renamed', topic: 'Test topic Rights' }, 202);
    expect(rename.proposals).toHaveLength(1);
    await post(userA, `/${set.id}/proposals/${rename.proposals[0].id}/decide`, { decision: 'rejected' });
    expect((await get(userA, `/${set.id}`)).set.name).toBe('Test set Rights');
    // a field changed directly meanwhile: the proposal is outdated; the proposer withdraws their own
    const topic = (await post(userB, `/${set.id}/proposals`, { kind: 'field', field: 'topic', value: 'Test topic New' }, 202)).proposal;
    await post(userA, `/${set.id}`, { topic: 'Test topic Owner' });
    expect((await get(userA, `/${set.id}`)).decided[0]).toEqual(expect.objectContaining({ id: topic.id, outcome: 'outdated' }));
    const desc = (await post(userB, `/${set.id}/proposals`, { kind: 'field', field: 'description', value: 'Test text' }, 202)).proposal;
    await post(userA, `/${set.id}/proposals/${desc.id}/withdraw`, {}, 404);
    expect((await post(userB, `/${set.id}/proposals/${desc.id}/withdraw`)).proposals).toEqual([]);

    // with votes, advisory: the proposer votes yes; the others vote; the owner decides whenever, whatever the votes
    await post(userA, `/${set.id}/members/${B}`, { action: 'rights', rights: 'vote' });
    const adv = (await post(userB, `/${set.id}/items/remove`, { type: 'term', slug: 'test-study-term' }, 202)).proposal;
    expect(adv.procedure).toBe('advisory');
    expect((await get(userA, '')).sets.find((s) => s.id === set.id)).toEqual(expect.objectContaining({ to_vote: 1, to_decide: 1 }));
    const voted = (await post(userA, `/${set.id}/proposals/${adv.id}/vote`, { vote: 'no' })).proposals[0];
    expect(voted.votes.map((v) => [v.by, v.vote])).toEqual([['Test Helper', 'yes'], ['Test Owner', 'no']]);
    expect(voted.voters).toBe(2);
    await post(userA, `/${set.id}/proposals/${adv.id}/decide`, { decision: 'accepted' });
    expect(await items()).toEqual(['test-study-work']);

    // binding: only the owner and the proposer vote — no vote, accepted at once
    await post(userA, `/${set.id}/settings`, { vote_mode: 'binding', vote_hours: '25' }, 422);
    await post(userA, `/${set.id}/settings`, { vote_mode: 'binding', vote_hours: '2' });
    const two = (await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' }, 202)).proposal;
    expect(two).toEqual(expect.objectContaining({ procedure: 'binding', outcome: 'accepted' }));
    expect(await items()).toEqual(['test-study-term', 'test-study-work']);

    // three who vote: decided early once the missing vote can't change it
    sql(`INSERT INTO study_set_members (set_id, account_id, rights) VALUES (${set.id}, ${C}, 'vote')`);
    const early = (await post(userB, `/${set.id}/items/remove`, { type: 'term', slug: 'test-study-term' }, 202)).proposal;
    expect(early.outcome).toBeNull();
    const open = (await get(userA, `/${set.id}`)).proposals[0];
    expect(open).toEqual(expect.objectContaining({ procedure: 'binding', voters: 3, tie_at: null }));
    expect(new Date(open.closes_at) - new Date(open.created_at)).toBe(2 * 3600 * 1000);
    await post(userA, `/${set.id}/proposals/${early.id}/decide`, { decision: 'rejected' }, 422);   // no veto
    voteAsC(early.id, 'yes');
    expect((await get(userA, `/${set.id}`)).decided[0]).toEqual(expect.objectContaining({ id: early.id, outcome: 'accepted', by_vote: true, decided_by: null }));
    expect(await items()).toEqual(['test-study-work']);
    // rejected early: two no against one yes
    const no = (await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' }, 202)).proposal;
    await post(userA, `/${set.id}/proposals/${no.id}/vote`, { vote: 'no' });
    voteAsC(no.id, 'no');
    expect((await get(userA, `/${set.id}`)).decided[0]).toEqual(expect.objectContaining({ id: no.id, outcome: 'rejected', by_vote: true }));
    // the time is up: one yes, nobody else voted — accepted
    const late = (await post(userB, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' }, 202)).proposal;
    expect((await get(userA, `/${set.id}`)).proposals.map((p) => p.id)).toEqual([late.id]);
    sql(`UPDATE study_set_proposals SET closes_at = now() - interval '1 second' WHERE id = ${late.id}`);
    expect((await get(userB, '')).sets.find((s) => s.id === set.id).proposals).toBe(0);
    expect(await items()).toEqual(['test-study-term', 'test-study-work']);
    // even: one yes, one no, one abstains → the owner decides; nobody votes any more
    const tie = (await post(userB, `/${set.id}/items/remove`, { type: 'term', slug: 'test-study-term' }, 202)).proposal;
    await post(userA, `/${set.id}/proposals/${tie.id}/vote`, { vote: 'no' });
    voteAsC(tie.id, 'abstain');
    const even = (await get(userA, `/${set.id}`)).proposals[0];
    expect(even.tie_at).toBeTruthy();
    expect((await get(userA, '')).sets.find((s) => s.id === set.id).to_decide).toBe(1);
    await post(userB, `/${set.id}/proposals/${tie.id}/vote`, { vote: 'yes' }, 422);
    await post(userA, `/${set.id}/proposals/${tie.id}/decide`, { decision: 'rejected' });
    expect(await items()).toEqual(['test-study-term', 'test-study-work']);
    // the owner's veto (their choice): decides a running vote
    await post(userA, `/${set.id}/settings`, { owner_veto: '1' });
    const veto = (await post(userB, `/${set.id}/items/remove`, { type: 'term', slug: 'test-study-term' }, 202)).proposal;
    await post(userA, `/${set.id}/proposals/${veto.id}/decide`, { decision: 'rejected' });
    expect((await get(userA, `/${set.id}`)).decided[0]).toEqual(expect.objectContaining({ id: veto.id, outcome: 'rejected', by_vote: false, decided_by: 'Test Owner' }));

    // the set handed to a member: they own it, the old owner stays with full rights
    await post(userA, `/${set.id}/members/${B}`, { action: 'owner' });
    expect((await get(userB, `/${set.id}`)).set.role).toBe('owner');
    expect((await get(userA, `/${set.id}`)).set).toEqual(expect.objectContaining({ role: 'editor', rights: 'full' }));
    // private again: everyone else goes
    await post(userB, `/${set.id}/share`, { visibility: 'private' });
    await get(userA, `/${set.id}`, 404);
    expect(sql(`SELECT count(*) FROM study_set_members WHERE set_id = ${set.id}`)).toBe('0');
  } finally {
    sql("DELETE FROM study_sets WHERE name LIKE 'Test set Rights%'; DELETE FROM admin_users WHERE username = 'test-voter'");
  }
});

// 229: every round keeps the set as it was — results stay traceable when the set changes or is gone
test('results keep the set as it was: a snapshot per content, kept when the set is deleted; copied back; forgotten', async ({ userA, userB }) => {
  sql("UPDATE admin_users SET public_name = 'Test Owner' WHERE username = 'tester'");
  const { set } = await post(userA, '', { name: 'Test set Snap', topic: 'Test topic Snap', description: 'Old **text**' }, 201);
  await post(userA, `/${set.id}/items`, { type: 'artwork', slug: 'test-study-work' });
  const { code } = (await post(userA, `/${set.id}/share`, { visibility: 'public' })).set;
  // two rounds on the same content: one snapshot; the set changes: a second one
  await post(userB, `/../shared/${code}/sessions`, { mode: 'forward', answered: '1', known: '1' }, 201);
  await post(userB, `/../shared/${code}/sessions`, { mode: 'typed', answered: '1', known: '0' }, 201);
  await post(userA, `/${set.id}/items`, { type: 'term', slug: 'test-study-term' });
  await post(userA, `/${set.id}`, { name: 'Test set Snap renamed' });
  await post(userB, `/../shared/${code}/sessions`, { mode: 'choice', answered: '2', known: '2' }, 201);
  let mine = (await get(userB, '/results')).sets.find((s) => s.key === String(set.id));
  expect(mine).toEqual(expect.objectContaining({ name: 'Test set Snap renamed', access: 'public', code, id: null }));
  expect(mine.rounds.map((r) => [r.mode, r.snapshot.name, r.snapshot.item_count])).toEqual([
    ['choice', 'Test set Snap renamed', 2], ['typed', 'Test set Snap', 1], ['forward', 'Test set Snap', 1]]);
  expect(mine.rounds[1].snapshot.id).toBe(mine.rounds[2].snapshot.id);
  // the owner's own results are not mixed in; another account can't read the snapshot
  expect((await get(userA, '/results')).sets.find((s) => s.key === String(set.id))).toBeUndefined();
  await get(userA, `/results/snapshots/${mine.rounds[2].snapshot.id}`, 404);

  // the owner deletes the set: the rounds stay, with the set as it was
  await post(userA, `/${set.id}/delete`, {}, 204);
  mine = (await get(userB, '/results')).sets.find((s) => s.key === String(set.id));
  expect(mine).toEqual(expect.objectContaining({ name: 'Test set Snap renamed', access: null, code: null }));
  expect(mine.rounds).toHaveLength(3);
  const old = (await get(userB, `/results/snapshots/${mine.rounds[2].snapshot.id}`)).snapshot;
  expect(old).toEqual(expect.objectContaining({ name: 'Test set Snap', topic: 'Test topic Snap' }));
  expect(old.description_html).toContain('<strong>text</strong>');
  expect(old.items).toEqual([{ type: 'artwork', name: 'The Test of Memory', slug: 'test-study-work', now_name: 'The Test of Memory' }]);
  // saved again as an own set from the snapshot
  const back = (await post(userB, `/results/snapshots/${mine.rounds[0].snapshot.id}/copy`, {}, 201)).set;
  expect(back).toEqual(expect.objectContaining({ name: 'Test set Snap renamed', entries: 2, missing: 0 }));
  expect((await get(userB, `/${back.id}`)).items.map((i) => i.slug).sort()).toEqual(['test-study-term', 'test-study-work']);
  // forgotten: the rounds and their snapshots go
  expect((await post(userB, '/results/forget', { key: String(set.id) })).deleted).toBe(3);
  expect((await get(userB, '/results')).sets.find((s) => s.key === String(set.id))).toBeUndefined();
  expect(sql(`SELECT count(*) FROM study_set_snapshots WHERE origin_set_id = ${set.id}`)).toBe('0');
});
