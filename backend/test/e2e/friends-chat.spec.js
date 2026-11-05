// Friends and chat (224) and a set's chat (225): requests by list and by friend link, accept, chat only between
// friends and seen by no one else, read receipts, deleting, blocking, reports in the CMS; the set chat — switched on by
// the owner, written by editors whether friends or not, a message deleted by the owner, a member removed, reports;
// editors copy a set they edit.
const { test, expect, sql } = require('./helpers');

const SITE = 'https://arthistory.piogino.ch';
const H = { Origin: SITE };
const call = async (user, method, path, form, status) => {
  const res = await user.request[method](`/site${path}`, { headers: H, ...(form ? { form } : {}) });
  if (status !== undefined) expect(res.status()).toBe(status);
  return res.status() === 204 ? null : res.json().catch(() => null);
};
const cleanup = () => sql(`DELETE FROM friendships; DELETE FROM account_blocks; DELETE FROM chat_messages; DELETE FROM chat_reports;
  DELETE FROM study_sets WHERE name LIKE 'Test set chat%'; UPDATE admin_users SET public_name = NULL WHERE username IN ('tester', 'tester2')`);
test.beforeAll(() => { cleanup(); sql("UPDATE admin_users SET public_name = 'Test Ann' WHERE username = 'tester'; UPDATE admin_users SET public_name = 'Test Bo' WHERE username = 'tester2'"); });
test.afterAll(cleanup);

test('friends: a request by friend link, accepted; a chat only the two see; read, deleted, blocked, reported', async ({ userA, userB, request }) => {
  const a = sql("SELECT id FROM admin_users WHERE username = 'tester'");
  const b = sql("SELECT id FROM admin_users WHERE username = 'tester2'");
  const { me } = await call(userA, 'get', '/friends', null, 200);
  expect(me.friend_code).toMatch(/^[A-Za-z0-9_-]{12}$/);
  // not yet friends: no chat
  await call(userB, 'post', `/friends/chat/${a}`, { body: 'hi' }, 404);
  expect((await call(userB, 'get', `/friends/link/${me.friend_code}`, null, 200))).toEqual({ name: 'Test Ann', status: 'none' });
  expect((await call(userB, 'post', '/friends/request', { code: me.friend_code }, 201)).status).toBe('sent');
  const seenByA = (await call(userA, 'get', '/friends', null, 200)).people.find((p) => p.id === b);
  expect(seenByA).toEqual(expect.objectContaining({ name: 'Test Bo', status: 'received' }));
  await call(userA, 'post', '/friends/accept', { account: b }, 204);
  expect((await call(userB, 'get', '/friends', null, 200)).people.find((p) => p.id === a).status).toBe('friend');

  // the chat: written, unread for the other, read on opening; no one else can open it
  const { message } = await call(userB, 'post', `/friends/chat/${a}`, { body: 'Hello Ann — the Fuji set?' }, 201);
  expect((await call(userA, 'get', '/friends', null, 200)).unread).toBe(1);
  const chat = await call(userA, 'get', `/friends/chat/${b}`, null, 200);
  expect(chat.messages.map((m) => [m.body, m.mine])).toEqual([['Hello Ann — the Fuji set?', false]]);
  expect((await call(userA, 'get', '/friends', null, 200)).unread).toBe(0);
  expect((await call(userB, 'get', `/friends/chat/${a}`, null, 200)).messages[0].read).toBe(true);
  expect((await request.get(`/site/friends/chat/${b}`, { headers: H })).status()).toBe(401);
  // a report: a copy for the admins, seen in the CMS
  await call(userA, 'post', `/friends/chat/${b}/report`, { note: 'test report' }, 201);
  await userA.goto('/accounts/reports');
  await expect(userA.locator('main')).toContainText('Test Ann reported Test Bo');
  await userA.locator('summary', { hasText: 'The conversation' }).first().click();
  await expect(userA.locator('.report-messages')).toContainText('Hello Ann — the Fuji set?');
  // the sender deletes their message: gone for both; the conversation deleted by one stays with the other
  await call(userB, 'post', `/friends/chat/${a}/delete`, { message: message.id }, 204);
  expect((await call(userA, 'get', `/friends/chat/${b}`, null, 200)).messages).toEqual([]);
  await call(userA, 'post', `/friends/chat/${b}`, { body: 'Yes!' }, 201);
  await call(userA, 'post', `/friends/chat/${b}/delete`, { all: '1' }, 204);
  expect((await call(userA, 'get', `/friends/chat/${b}`, null, 200)).messages).toEqual([]);
  expect((await call(userB, 'get', `/friends/chat/${a}`, null, 200)).messages.map((m) => m.body)).toEqual(['Yes!']);
  // a block ends the friendship; no request, no message either way
  await call(userA, 'post', '/friends/block', { account: b }, 204);
  await call(userB, 'post', `/friends/chat/${a}`, { body: 'still there?' }, 404);
  await call(userB, 'post', '/friends/request', { account: a }, 403);
  expect((await call(userA, 'get', '/friends', null, 200)).people.find((p) => p.id === b).status).toBe('blocked');
  await call(userA, 'post', '/friends/unblock', { account: b }, 204);
});

test('a set\'s chat: the owner switches it on, an editor writes without being a friend; the owner deletes and removes; reports; editors copy the set', async ({ userA, userB }) => {
  const b = sql("SELECT id FROM admin_users WHERE username = 'tester2'");
  const { set } = await call(userA, 'post', '/sets', { name: 'Test set chat' }, 201);
  const { code } = (await call(userA, 'post', `/sets/${set.id}/links`, { rights: 'full' }, 201)).link;
  await call(userB, 'post', `/shared/join/${code}`, {}, 201);

  // off: nobody writes; the owner switches it on
  await call(userB, 'post', `/sets/${set.id}/chat`, { body: 'hello' }, 422);
  await call(userB, 'post', `/sets/${set.id}/chat/switch`, { on: '1' }, 403);
  await call(userA, 'post', `/sets/${set.id}/chat/switch`, { on: '1' }, 200);
  const { id: mid } = await call(userB, 'post', `/sets/${set.id}/chat`, { body: 'Shall we add Hiroshige?' }, 201);
  await call(userA, 'post', `/sets/${set.id}/chat`, { body: 'Yes' }, 201);
  expect((await call(userA, 'get', '/sets', null, 200)).sets.find((s) => s.id === set.id).chat_unread).toBe(1);
  const seen = await call(userB, 'get', `/sets/${set.id}/chat`, null, 200);
  expect(seen.messages.map((m) => [m.by, m.body])).toEqual([['Test Bo', 'Shall we add Hiroshige?'], ['Test Ann', 'Yes']]);
  expect(seen.members.map((m) => m.name)).toEqual(['Test Ann', 'Test Bo']);

  // reports of a message and of a member's name
  await call(userA, 'post', `/sets/${set.id}/chat/report`, { message: mid, note: 'test' }, 201);
  await call(userA, 'post', `/sets/${set.id}/chat/report`, { account: b, note: 'test name' }, 201);
  expect(sql("SELECT string_agg(kind, ',' ORDER BY id) FROM chat_reports WHERE set_name = 'Test set chat'")).toBe('set_message,set_user');

  // the owner deletes the editor's message: the others see that the owner deleted it; an editor can't delete the owner's
  const owners = (await call(userB, 'get', `/sets/${set.id}/chat`, null, 200)).messages.find((m) => m.body === 'Yes').id;
  await call(userB, 'post', `/sets/${set.id}/chat/delete`, { message: owners }, 403);
  await call(userA, 'post', `/sets/${set.id}/chat/delete`, { message: mid }, 204);
  expect((await call(userB, 'get', `/sets/${set.id}/chat`, null, 200)).messages[0]).toEqual(expect.objectContaining({ body: null, deleted: 'owner' }));

  // removed from the chat: a line for everyone; they no longer read or write it — still an editor of the set
  await call(userA, 'post', `/sets/${set.id}/chat/remove`, { account: b }, 204);
  expect((await call(userA, 'get', `/sets/${set.id}/chat`, null, 200)).messages.at(-1)).toEqual(expect.objectContaining({ kind: 'system', body: 'Test Bo removed' }));
  expect((await call(userB, 'get', `/sets/${set.id}/chat`, null, 200))).toEqual(expect.objectContaining({ removed: true, messages: [] }));
  await call(userB, 'post', `/sets/${set.id}/chat`, { body: 'hm' }, 403);
  await call(userB, 'get', `/sets/${set.id}`, null, 200);
  await call(userA, 'post', `/sets/${set.id}/chat/readmit`, { account: b }, 204);
  await call(userB, 'post', `/sets/${set.id}/chat`, { body: 'Back' }, 201);

  // an editor makes their own copy, shared or not
  await call(userA, 'post', `/sets/${set.id}/items`, { type: 'artwork', slug: 'the-great-wave-off-kanagawa' }, 200);
  const copy = (await call(userB, 'post', `/sets/${set.id}/copy`, {}, 201)).set;
  const mine = await call(userB, 'get', `/sets/${copy.id}`, null, 200);
  expect(mine.set).toEqual(expect.objectContaining({ role: 'owner', name: 'Test set chat', count: 1 }));
  sql(`DELETE FROM study_sets WHERE id = ${copy.id}`);
});

test('a message arrives live: the event stream of the recipient gets it as it is sent', async ({ userA, userB }) => {
  const a = sql("SELECT id FROM admin_users WHERE username = 'tester'");
  const b = sql("SELECT id FROM admin_users WHERE username = 'tester2'");
  sql(`INSERT INTO friendships (low_id, high_id, requested_by, accepted_at) VALUES (least(${a}, ${b}), greatest(${a}, ${b}), ${a}, now()) ON CONFLICT (low_id, high_id) DO UPDATE SET accepted_at = now()`);
  await userA.goto('/');
  const got = userA.evaluate(() => new Promise((resolve, reject) => {
    const es = new EventSource('/site/friends/events');
    es.addEventListener('message', (e) => { es.close(); resolve(JSON.parse(e.data)); });
    setTimeout(() => { es.close(); reject(new Error('no event within 8 s')); }, 8000);
  }));
  await new Promise((r) => { setTimeout(r, 800); });   // the stream open and listening
  const { message } = await call(userB, 'post', `/friends/chat/${a}`, { body: 'live?' }, 201);
  expect(await got).toEqual({ from: b, id: message.id });
});

test('a set\'s members; hiding someone in the set\'s chat: their messages stay as hidden lines for the hider only, no one is told', async ({ userA, userB }) => {
  const a = sql("SELECT id FROM admin_users WHERE username = 'tester'");
  const b = sql("SELECT id FROM admin_users WHERE username = 'tester2'");
  const { set } = await call(userA, 'post', '/sets', { name: 'Test set chat hide' }, 201);
  const { code } = (await call(userA, 'post', `/sets/${set.id}/links`, { rights: 'full' }, 201)).link;
  await call(userB, 'post', `/shared/join/${code}`, {}, 201);
  await call(userA, 'post', `/sets/${set.id}/items`, { type: 'artwork', slug: 'the-great-wave-off-kanagawa' }, 200);
  await call(userA, 'post', `/sets/${set.id}/chat/switch`, { on: '1' }, 200);

  // the members: owner and editor, since when, entries added — for both
  const list = (await call(userB, 'get', `/sets/${set.id}/members`, null, 200)).members;
  expect(list.map((m) => [m.name, m.role, m.added, m.me])).toEqual([['Test Ann', 'owner', 1, false], ['Test Bo', 'editor', 0, true]]);

  // Bo hides Ann: Ann's messages are hidden lines in Bo's view only; not unread for Bo; Ann sees nothing of it
  await call(userB, 'post', `/sets/${set.id}/chat/hide`, { account: a }, 204);
  await call(userA, 'post', `/sets/${set.id}/chat`, { body: 'Test: something unkind' }, 201);
  const bo = await call(userB, 'get', `/sets/${set.id}/chat`, null, 200);
  expect(bo.messages.at(-1)).toEqual(expect.objectContaining({ by: 'Test Ann', hidden: true }));
  expect(bo.members.find((m) => m.id === a).hidden).toBe(true);
  expect((await call(userB, 'get', '/sets', null, 200)).sets.find((s) => s.id === set.id).chat_unread).toBe(0);
  const ann = await call(userA, 'get', `/sets/${set.id}/chat`, null, 200);
  expect(ann.messages.every((m) => !m.hidden)).toBe(true);
  expect(ann.members.find((m) => m.id === b).hidden).toBe(false);
  expect(ann.messages.some((m) => m.kind === 'system')).toBe(false);          // no line tells anyone
  expect((await call(userA, 'get', `/sets/${set.id}/members`, null, 200)).members.every((m) => !m.hidden)).toBe(true);
  // shown again
  await call(userB, 'post', `/sets/${set.id}/chat/hide`, { account: a, hide: '0' }, 204);
  expect((await call(userB, 'get', `/sets/${set.id}/chat`, null, 200)).messages.at(-1).hidden).toBe(false);
  // not someone outside the set, not oneself
  await call(userB, 'post', `/sets/${set.id}/chat/hide`, { account: b }, 404);
});
