// An account's own start-map views (227): saved with a name and a Markdown description, listed, changed, deleted;
// only the account's own; only the start map's query is kept.
const { test, expect, sql } = require('./helpers');

const H = { Origin: 'https://arthistory.piogino.ch' };
const call = async (user, method, path, form, status) => {
  const res = await user.request[method](`/site/views${path}`, { headers: H, ...(form ? { form } : {}) });
  expect(res.status()).toBe(status);
  return status === 204 ? null : res.json();
};
test.afterAll(() => sql("DELETE FROM account_views WHERE name LIKE 'Test view%'"));

test('own views: saved with a description, listed, updated, private, deleted', async ({ userA, userB, request }) => {
  const { view } = await call(userA, 'post', '', { name: 'Test view Hokusai', description: 'Look at the **Tōkaidō** prints — [[artist/katsushika-hokusai]].',
    query: '?artists=katsushika-hokusai&featured=x&mine=7&from=1830&to=1834' }, 201);
  expect(view.query).toBe('artists=katsushika-hokusai&from=1830&to=1834');      // only the map's own keys
  expect(view.description_html).toContain('<strong>Tōkaidō</strong>');
  expect(view.description_html).toContain('class="entry-link');
  expect((await call(userA, 'get', '', null, 200)).views.map((v) => v.name)).toContain('Test view Hokusai');
  const changed = (await call(userA, 'post', `/${view.id}`, { name: 'Test view Hokusai, later', query: 'artists=katsushika-hokusai' }, 200)).view;
  expect(changed).toEqual(expect.objectContaining({ name: 'Test view Hokusai, later', query: 'artists=katsushika-hokusai', description: view.description }));
  // another account: not in its list, can't change or delete it; no login: nothing
  expect((await call(userB, 'get', '', null, 200)).views.map((v) => v.id)).not.toContain(view.id);
  await call(userB, 'post', `/${view.id}`, { name: 'x' }, 404);
  await call(userB, 'post', `/${view.id}/delete`, {}, 204);
  expect(sql(`SELECT count(*) FROM account_views WHERE id = ${view.id}`)).toBe('1');
  expect((await request.get('/site/views', { headers: H })).status()).toBe(401);
  await call(userA, 'post', '', { name: '', query: 'all=' }, 422);
  await call(userA, 'post', `/${view.id}/delete`, {}, 204);
  expect(sql(`SELECT count(*) FROM account_views WHERE id = ${view.id}`)).toBe('0');
});
