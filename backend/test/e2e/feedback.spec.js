// Feedback from visitors (migration 141, POST /v1/feedback, CMS /feedback): stored through submit_feedback() — the API
// role can't read it —, shown with its page and elements, outlined on the site via #fb=, statuses, a roadmap item made
// from it, deleted for good.
const { test, expect, sql, API } = require('./helpers');

const post = (request, body) => request.post(`${API}/feedback`, { headers: { Host: 'api.localhost' }, data: body });
const one = { kind: 'bug', message: 'The provenance step is wrong.\nIt should say 1875.', page_url: '/artworks/1/the-great-wave-off-kanagawa?x=1#provenance-2',
  page_title: 'The Great Wave · Art History', viewport: '1280x800', email: 'reader@example.org',
  elements: [{ label: 'list item', heading: 'Provenance', text: 'Bought at auction', selector: '#app > article > ol > li:nth-of-type(2)' }] };

test.afterEach(() => sql('DELETE FROM feedback; DELETE FROM roadmap_items'));

test('feedback: sent through the API, checked; in the CMS with page and elements; read, roadmap, delete', async ({ userA, request }) => {
  // the API: stored, checked, a bot's honeypot quietly dropped
  expect((await post(request, one)).status()).toBe(201);
  expect((await post(request, { ...one, message: '   ' })).status()).toBe(400);
  expect((await post(request, { ...one, email: 'not an address' })).status()).toBe(400);
  expect((await post(request, { ...one, page_url: 'https://elsewhere.example/' })).status()).toBe(400);
  expect((await post(request, { ...one, website: 'spam.example' })).status()).toBe(201);
  expect(sql('SELECT count(*) FROM feedback')).toBe('1');
  expect(sql("SELECT has_table_privilege('arthistory_api', 'feedback', 'SELECT')")).toBe('f');   // the API can't read it

  // the CMS: the menu counts the new one; the card with the page, the elements in words, the message, the address
  await userA.goto('/feedback');
  await expect(userA.locator('header.top a[href="/feedback"] .nav-count')).toHaveText('1');
  const card = userA.locator('.feedback-card');
  await expect(card.locator('.fb-kind')).toHaveText('Bug');
  await expect(card.locator('.feedback-elements li')).toContainText(/list item.*in “Provenance”.*Bought at auction/);
  await expect(card.locator('.feedback-message')).toHaveText('The provenance step is wrong.\nIt should say 1875.');
  await expect(card.locator('a[href^="mailto:"]')).toHaveText('reader@example.org');
  // "Open on the site": the path (without its own anchor) and the selectors to outline
  const href = await card.locator('.feedback-page a').getAttribute('href');
  expect(href).toMatch(/\/artworks\/1\/the-great-wave-off-kanagawa\?x=1#fb=/);
  expect(JSON.parse(decodeURIComponent(href.split('#fb=')[1]))).toEqual(['#app > article > ol > li:nth-of-type(2)']);

  // a note marks it read
  await card.locator('textarea[name=note_md]').fill('Check the auction catalogue.');
  await Promise.all([userA.waitForURL(/\/feedback/), card.locator('button:has-text("Save note")').click()]);
  expect(sql('SELECT status || \' \' || note_md FROM feedback')).toBe('read Check the auction catalogue.');
  await expect(userA.locator('header.top a[href="/feedback"] .nav-count')).toHaveCount(0);

  // to the roadmap: an unpublished item in Später with the message quoted, linked back; the feedback "on the roadmap"
  await Promise.all([userA.waitForURL(/\/roadmap\/\d+\/edit\?done=from-feedback/), userA.locator('.feedback-card button:has-text("Add to roadmap")').click()]);
  await expect(userA.locator('#rm-title')).toHaveValue('The provenance step is wrong.');
  expect(sql("SELECT status || ' ' || published FROM roadmap_items")).toBe('spaeter false');
  expect(sql('SELECT notes_md FROM roadmap_items')).toContain('> It should say 1875.');
  expect(sql('SELECT f.status FROM feedback f JOIN roadmap_items r ON r.id = f.roadmap_item_id')).toBe('planned');
  await userA.goto('/feedback?status=planned');
  await expect(userA.locator('.feedback-card')).toContainText('On the roadmap: The provenance step is wrong.');

  // deleted: gone for good (no history)
  userA.once('dialog', (d) => d.accept());
  await Promise.all([userA.waitForURL(/done=deleted/), userA.locator('.feedback-card button:has-text("delete")').click()]);
  expect(sql('SELECT count(*) FROM feedback')).toBe('0');
  expect(sql("SELECT count(*) FROM audit_log WHERE table_name = 'feedback'")).toBe('0');
});

test('feedback: at most 10 per 10 minutes from one address', async ({ request }) => {
  let last;
  for (let i = 0; i < 12; i++) last = await post(request, { ...one, message: `Number ${i}` });
  expect(last.status()).toBe(429);
});
