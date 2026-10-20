// One search, front and back (migration 110: view entry_search_fields; src/admin/match.js fieldSearchSql; the site's
// frontend/src/catalog.ts uses the API's search_fields): the admin's lists find what the site's lists find, in the
// same order — names first, then the rest, then entries found only through a museum ("Now in", "Formerly in").
const { test, expect, sql, API } = require('./helpers');
const { fold } = require('../../src/fold');

const api = async (request, p) => (await request.get(`${API}${p}`, { headers: { Host: 'api.localhost' } })).json();

// the site's rules (catalog.ts: matches, explain, ordered), applied to the API's list items
function siteSearch(items, nameKey, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hits = items.map((it) => {
    const name = fold(it[nameKey]);
    const other = (it.names || []).map((n) => n.text).join(' ') + ' ' + (it.search_text || '');
    const fields = it.search_fields || [];
    const visible = fold(`${it[nameKey]} ${other} ${fields.filter((f) => f.shown).map((f) => f.match || f.text).join(' ')}`);
    const all = `${visible} ${fold(fields.map((f) => f.match || f.text).join(' '))}`;
    if (!words.every((w) => all.includes(w))) return null;
    const hidden = words.filter((w) => !visible.includes(w));
    const by = fields.filter((f) => !f.shown && hidden.some((w) => fold(f.match || f.text).includes(w)));
    const tier = hidden.length && by.length && by.every((f) => f.tier) ? Math.min(...by.map((f) => f.tier.rank)) : null;
    return { slug: it.slug, tier, score: name.startsWith(words.join(' ')) ? 3 : words.every((w) => name.includes(w)) ? 2 : 1 };
  }).filter(Boolean);
  return hits.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || b.score - a.score).map((h) => `${h.tier ?? '-'} ${h.slug}`);
}
// the admin's list, in its order, with the tier each row is under
async function adminSearch(page, folder, query) {
  await page.goto(`/${folder}?q=${encodeURIComponent(query)}`);
  return page.evaluate(() => {
    let tier = '-';
    const out = [];
    for (const tr of document.querySelectorAll('main table tbody tr')) {
      if (tr.classList.contains('list-group')) { tier = { 'Now in the collection': '1', 'Formerly in the collection': '2', 'With works by a matching artist': '1' }[tr.textContent.trim()] || '-'; continue; }
      out.push(`${tier} ${tr.querySelector('td a[href]:not([tabindex])').getAttribute('href').split('/').pop()}`);
    }
    return out;
  });
}

test.afterAll(() => sql(`DELETE FROM provenance WHERE owner_label = 'test-fieldsearch' OR (artwork_id = entity_id('artwork', 'sunflowers-national-gallery') AND owner_institution_id = entity_id('institution', 'van-gogh-museum'))`));

test('the admin finds what the site finds: museums now and before, birthplaces, types — and typos as similar names', async ({ userA, request }) => {
  // the Sunflowers were once at the Van Gogh Museum
  sql(`INSERT INTO provenance (artwork_id, position, owner_institution_id, acquired, acquired_label, ended, ended_label)
       VALUES (entity_id('artwork', 'sunflowers-national-gallery'), 90, entity_id('institution', 'van-gogh-museum'), year_range(1900), '1900', year_range(1910), '1910')`);

  await userA.goto('/artworks?q=van+gogh+museum');
  const rows = userA.locator('main table tbody tr');
  await expect(rows.filter({ hasText: 'Now in the collection' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Bridge in the Rain' })).toContainText('Now in: Van Gogh Museum');
  await expect(rows.filter({ hasText: 'Formerly in the collection' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Sunflowers' })).toContainText('Formerly in: Van Gogh Museum');
  // a birthplace (artists), a type (artworks)
  await userA.goto('/artists?q=zundert');
  await expect(userA.locator('main table tbody tr', { hasText: 'Vincent van Gogh' })).toContainText('Born in: Zundert');
  // nothing as typed: names that are close
  await userA.goto('/artists?q=hokusia');
  await expect(userA.locator('main table tbody tr').first()).toHaveText('Similar names');
  await expect(userA.locator('main table tbody tr').nth(1)).toContainText('Katsushika Hokusai');

  // the API sends the fields with its lists; the artist and date as shown
  const list = (await api(request, '/artworks?limit=500')).data;
  const bridge = list.find((w) => w.slug === 'bridge-in-the-rain-after-hiroshige');
  expect(bridge.search_fields).toEqual(expect.arrayContaining([
    { label: 'Artist', text: 'Vincent van Gogh', shown: true },
    { label: 'Now in', text: 'Van Gogh Museum', tier: { rank: 1, heading: 'Now in the collection' } }]));

  // the same hits in the same order, front and back
  for (const [plural, folder, nameKey, queries] of [
    ['artworks', 'artworks', 'title', ['van gogh museum', 'gogh', 'hiroshige', 'museum', 'woodblock']],
    ['artists', 'artists', 'name', ['zundert', 'gogh', 'japan']],
    ['institutions', 'institutions', 'name', ['gogh', 'amsterdam']],
  ]) {
    const items = (await api(request, `/${plural}?limit=500`)).data;
    for (const q of queries) {
      const site = siteSearch(items, nameKey, q);
      const admin = await adminSearch(userA, folder, q);
      // within a group the order follows the sort key on both sides: compare the groups as sets, in group order
      const groups = (list2) => [...new Set(list2.map((x) => x.split(' ')[0]))].map((t) => [t, list2.filter((x) => x.startsWith(`${t} `)).sort()]);
      expect(groups(admin), `${plural}: "${q}"`).toEqual(groups(site));
    }
  }
});
