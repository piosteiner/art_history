// [[links]] to any entry (migration 030): completion in the editor across all types, "Mentioned in" (backlinks),
// the rendered link in the API, and the check for links to missing entries.
const { test, expect, sql, liveReady } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();

test('[[ completes entries of every type; the link is shown, rendered by the API and listed as a backlink', async ({ userA, request }) => {
  await userA.goto('/artists/paul-gauguin/edit');
  await liveReady(userA);
  const cm = userA.locator('.md-editor .cm-content').first();
  await cm.click();
  await userA.keyboard.press('Control+End');
  // an artist: "[[hoku" lists Hokusai (with the type), Enter writes [[artist/…]]
  await userA.keyboard.type(' Admired [[hoku', { delay: 20 });
  await expect(userA.locator('.cm-tooltip-autocomplete li').first()).toContainText('Katsushika Hokusai');
  await expect(userA.locator('.cm-tooltip-autocomplete li').first()).toContainText('artist');
  await userA.waitForTimeout(200);  // CodeMirror ignores Enter for a moment after the list opens
  await userA.keyboard.press('Enter');
  // "[[place/" narrows to places
  await userA.keyboard.type(' in [[place/pari', { delay: 20 });
  await expect(userA.locator('.cm-tooltip-autocomplete li').first()).toContainText('Paris');
  await userA.waitForTimeout(200);
  await userA.keyboard.press('Enter');
  await userA.keyboard.type('.');
  await expect.poll(() => userA.evaluate(() => document.querySelector('#f-biography_md').value))
    .toMatch(/Admired \[\[artist\/katsushika-hokusai\]\] in \[\[place\/paris\]\]\.$/);
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('.md a.entry-link').first()).toHaveText('Katsushika Hokusai');

  await userA.goto('/artists/katsushika-hokusai');
  await expect(userA.locator('#used-in')).toHaveText('Mentioned in');
  await expect(userA.locator('#used-in + ul')).toContainText('Paul Gauguin');

  const gauguin = await api(request, '/artists/paul-gauguin');
  expect(gauguin.biography_html).toContain('<a href="/artists/katsushika-hokusai" class="entry-link" data-entry="artist/katsushika-hokusai">Katsushika Hokusai</a>');
  expect(gauguin.biography_html).toContain('<a href="/places/paris" class="entry-link" data-entry="place/paris">Paris</a>');
  expect((await api(request, '/artists/katsushika-hokusai')).mentioned_in).toEqual([{ type: 'artist', slug: 'paul-gauguin', name: 'Paul Gauguin' }]);
  expect((await api(request, '/places/paris')).mentioned_in).toContainEqual({ type: 'artist', slug: 'paul-gauguin', name: 'Paul Gauguin' });
  sql("UPDATE artists SET biography_md = regexp_replace(biography_md, ' Admired .*$', '') WHERE slug = 'paul-gauguin'");
});

test('a link to a missing entry is shown as such and reported on the quality page', async ({ userA }) => {
  sql("UPDATE artworks SET description_md = 'After [[artwork/no-such-work|a lost print]].' WHERE slug = 'plum-park-in-kameido'");
  await userA.goto('/artworks/plum-park-in-kameido');
  await expect(userA.locator('.md a.entry-link.missing')).toHaveText('a lost print');
  await userA.goto('/quality?check=broken_link');
  await expect(userA.locator('main')).toContainText('links to artwork/no-such-work');
  sql("UPDATE artworks SET description_md = NULL WHERE slug = 'plum-park-in-kameido'");
});
