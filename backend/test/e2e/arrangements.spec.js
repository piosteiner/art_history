// Shared arrangements of the network's Arrange view (migration 259, POST/GET /v1/arrangements): stored once, the same
// code for the same arrangement whatever the order of its keys, read back as stored; anything but the shape refused.
const { test, expect, sql, API } = require('./helpers');

const H = { Host: 'api.localhost' };
const post = (request, data) => request.post(`${API}/arrangements`, { headers: H, data });

test.afterAll(() => sql('DELETE FROM shared_arrangements'));

test('an arrangement gets a short code; the same one the same code; read back; other shapes refused', async ({ request }) => {
  const state = { pos: { 'artist/vincent-van-gogh': [400, 300.4], 'person/theo-van-gogh': [520, 380] }, hidden: ['artwork/x', 'artwork/x'], folded: [], name: '  Family  ' };
  const a = await post(request, { root: 'artist/vincent-van-gogh', state });
  expect(a.status()).toBe(201);
  const { id } = await a.json();
  expect(id).toMatch(/^[0-9a-f]{8}$/);
  // the same arrangement written in another order: the same code, stored once
  const again = await post(request, { root: 'artist/vincent-van-gogh', state: { name: 'Family', folded: [], hidden: ['artwork/x'], pos: { 'person/theo-van-gogh': [520, 380], 'artist/vincent-van-gogh': [400, 300] } } });
  expect((await again.json()).id).toBe(id);
  expect(sql('SELECT count(*) FROM shared_arrangements')).toBe('1');
  // another centre, another code
  expect((await (await post(request, { root: 'artist/paul-gauguin', state })).json()).id).not.toBe(id);

  const back = await (await request.get(`${API}/arrangements/${id}`, { headers: H })).json();
  expect(back).toEqual({ id, root: 'artist/vincent-van-gogh', state: { pos: { 'artist/vincent-van-gogh': [400, 300], 'person/theo-van-gogh': [520, 380] }, hidden: ['artwork/x'], folded: [], name: 'Family' } });

  expect((await request.get(`${API}/arrangements/00000000`, { headers: H })).status()).toBe(404);
  expect((await post(request, { root: 'not a root', state })).status()).toBe(400);
  expect((await post(request, { root: 'artist/x', state: { pos: { 'artist/x': ['a', 1] } } })).status()).toBe(400);
  expect((await post(request, { root: 'artist/x', state: { pos: {} } })).status()).toBe(400);
  expect((await post(request, { root: 'artist/x', state: { pos: { '<script>': [1, 1] } } })).status()).toBe(400);
});
