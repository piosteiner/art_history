// Short addresses for long selections (migration 072, POST/GET /v1/views): stored once, the same code for the same
// selection, read back with renamed entries followed; anything else refused.
const { test, expect, sql, API } = require('./helpers');

const H = { Host: 'api.localhost' };
const post = (request, body) => request.post(`${API}/views`, { headers: { ...H, 'Content-Type': 'text/plain' }, data: body });

test.afterAll(() => sql("DELETE FROM shared_views; UPDATE artists SET slug = 'paul-gauguin' WHERE slug = 'paul-gauguin-renamed'"));

test('a long selection gets a short code; the same selection the same code; renames followed', async ({ request }) => {
  const q = 'movements=none&artists=vincent-van-gogh,paul-gauguin&from=1886&to=1890&featured=x';
  const a = await post(request, q);
  expect(a.status()).toBe(201);
  const { id, query } = await a.json();
  expect(id).toMatch(/^[0-9a-f]{8}$/);
  expect(query).toBe('artists=vincent-van-gogh,paul-gauguin&from=1886&movements=none&to=1890');  // keys sorted, the site's switch dropped
  // same selection, other order: same code
  expect((await (await post(request, 'to=1890&from=1886&artists=vincent-van-gogh,paul-gauguin&movements=none')).json()).id).toBe(id);
  expect(sql('SELECT count(*) FROM shared_views')).toBe('1');

  const back = await (await request.get(`${API}/views/${id}`, { headers: H })).json();
  expect(back.query).toBe('artists=vincent-van-gogh,paul-gauguin&from=1886&movements=none&to=1890');
  sql("UPDATE artists SET slug = 'paul-gauguin-renamed' WHERE slug = 'paul-gauguin'");
  expect((await (await request.get(`${API}/views/${id}`, { headers: H })).json()).query).toContain('paul-gauguin-renamed');

  expect((await request.get(`${API}/views/00000000`, { headers: H })).status()).toBe(404);
  expect((await post(request, 'artists=<script>')).status()).toBe(400);
  expect((await post(request, '')).status()).toBe(400);
});
