// Searches ignore accents and special letters (migration 080, src/fold.js): "irene" finds Irène, "aero" Ærø, "gross" Groß,
// "d'anvers" (typed apostrophe) d’Anvers — in the admin lists, the pickers, the top-bar search and the public API.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const NAME = 'Irène Ærø-Groß d’Anvers';

test('accents, special letters and typographic apostrophes are folded in every search', async ({ userA, request }) => {
  sql(`INSERT INTO people (slug, name) VALUES ('test-irene', '${NAME}')`);
  try {
    for (const q of ['irene', 'aero', 'gross', "d'anvers", 'IRENE AERO']) {
      const hits = await (await userA.request.get(`/lookup?q=${encodeURIComponent(q)}&types=person`)).json();
      expect(hits.map((h) => h.label ?? h.name).join('|'), q).toContain('Irène');
      expect((await api(request, `/search?q=${encodeURIComponent(q)}`)).data.map((h) => h.slug), q).toContain('test-irene');
    }
    await userA.goto('/people?q=gross');
    await expect(userA.locator('main')).toContainText(NAME);
    await userA.goto(`/search?q=${encodeURIComponent("irene d'anvers")}`);
    await expect(userA.locator('.search-hit').first()).toContainText('Irène');
  } finally {
    sql("DELETE FROM people WHERE slug = 'test-irene'");
  }
});
