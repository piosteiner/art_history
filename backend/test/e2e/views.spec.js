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

test('a very long selection (over the 2,704 bytes a b-tree entry may hold) is stored and found again (130)', async ({ request }) => {
  // 400 artwork slugs that don't compress: ≈ 8,000 characters (the failure on 2026-10-21 had 3,008 bytes in the index)
  const slugs = Array.from({ length: 400 }, (_, i) => `w${(i * 2654435761 % 4294967296).toString(36)}`);
  const q = `artworks=${slugs.join(',')}`;
  const a = await post(request, q);
  expect(a.status()).toBe(201);
  const { id } = await a.json();
  expect((await (await post(request, q)).json()).id).toBe(id);   // the same code again, through the hash
  expect((await (await request.get(`${API}/views/${id}`, { headers: H })).json()).query.length).toBeGreaterThan(3000);
});
