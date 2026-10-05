// Smoke tests against the live, curated content (via the dev proxy). They check behaviour, not exact numbers,
// so adding entries in the admin panel doesn't break them. Fixed points: Van Gogh, The Great Wave, woodblock prints.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const noErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

test('explore: map, pickers, timeline; a typed window filters the map', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('details.pick')).toHaveCount(5);
  await expect(page.locator('.row-label').first()).toBeVisible();
  await expect(page.locator('#map-status')).toContainText('places');

  await page.fill('input[name=from]', '1888');
  await page.fill('input[name=to]', '1889');
  await page.press('input[name=to]', 'Enter');
  await expect(page.locator('#map-status')).toContainText('in 1888–1889');
  await expect(page).toHaveURL(/from=1888&to=1889/);
  expect(errors).toEqual([]);
});

test('timeline zooms and pans without changing the window', async ({ page }) => {
  await page.goto('/?from=1880&to=1890');
  const view = page.locator('.timeline-view');
  await page.locator('.timeline-svg').focus();
  await page.keyboard.press('+');
  await expect(view).toContainText('showing');
  await page.click('[data-zoom=fit]');
  await expect(view).toHaveText('');
  await expect(page.locator('input[name=from]')).toHaveValue('1880');
});

test('pickers: search explains matches, ticking every entry means "all", by chosen artists', async ({ page }) => {
  await page.goto('/');
  const artworks = page.locator('details[data-group=artwork]');
  await artworks.locator('summary').click();
  await artworks.locator('.pick-search').fill('wood');
  await expect(artworks.locator('.pick-item').first()).toBeVisible();
  await expect(artworks.locator('.pick-why').first()).toContainText('Type:');
  await expect(artworks.locator('.pick-why mark').first()).toHaveText(/wood/i);

  await artworks.locator('.pick-search').fill('');
  await artworks.locator('[data-act=none]').click();
  await expect(artworks.locator('.pick-count')).toHaveText('none');
  for (const cb of await artworks.locator('.pick-list input[type=checkbox]').all()) await cb.check();
  await expect(artworks.locator('.pick-count')).toHaveText('all');

  await artworks.locator('[data-act=by-artists]').click();
  await expect(artworks.locator('.pick-count')).toHaveText('by chosen artists');
  await expect(page).toHaveURL(/artworks=by-artists/);
});

test('picker names: click ticks, Ctrl+click opens the entry in a new tab', async ({ page, context }) => {
  await page.goto('/');
  const artists = page.locator('details[data-group=artist]');
  await artists.locator('summary').click();
  const vg = artists.locator('.pick-item', { hasText: 'Vincent van Gogh' });
  await vg.locator('.pick-link').click();
  await expect(vg.locator('input')).not.toBeChecked();
  const [tab] = await Promise.all([context.waitForEvent('page'), vg.locator('.pick-link').click({ modifiers: ['ControlOrMeta'] })]);
  await expect(tab).toHaveURL(/\/artists\/vincent-van-gogh$/);
});

test('artist detail: facts, relationships, map, links to explore and network', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/artists/vincent-van-gogh');
  await expect(page.locator('h1')).toHaveText('Vincent van Gogh');
  await expect(page.locator('.facts')).toContainText('Born');
  await expect(page.locator('.rel-presence')).toContainText('lived in');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await page.click('text=Show on the map and timeline');
  await expect(page).toHaveURL(/\/\?artists=vincent-van-gogh/);
  await expect(page.locator('#map-status')).toContainText('chosen entries on the map');
  expect(errors).toEqual([]);
});

test('artwork detail: image with credit opens large', async ({ page }) => {
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.figure .credit')).not.toBeEmpty();
  await page.click('.figure img');
  await expect(page.locator('dialog.lightbox[open] img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.lightbox')).toHaveCount(0);
});

test('list page: same field search as the pickers, typos as similar names', async ({ page }) => {
  await page.goto('/artworks');
  await expect(page.locator('.card').first()).toBeVisible();
  await page.fill('.filter', 'wood');
  await expect(page.locator('#count')).toContainText('match');
  await expect(page.locator('.card mark').first()).toHaveText(/wood/i);

  await page.goto('/artists');
  await page.fill('.filter', 'hokusia');
  await expect(page.locator('.cards-heading-similar')).toBeVisible();
  await expect(page.locator('#items')).toContainText('Hokusai');
});

test('header search finds fields and typos', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('.search-form input');
  await input.fill('zundert');
  await expect(page.locator('.search-results')).toContainText('Born in');
  await input.fill('hokusia');
  await expect(page.locator('.search-results')).toContainText('Hokusai');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/(artists|artworks)\//);
});

test('network graph: nodes, details on click, filters in the URL', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/graph/artists/vincent-van-gogh?depth=2');
  await expect(page.locator('.node.root')).toHaveCount(1);
  expect(await page.locator('.node').count()).toBeGreaterThan(2);
  await page.locator('.node.root circle').click({ force: true });
  await expect(page.locator('.graph-info h2')).toHaveText('Vincent van Gogh');
  await page.locator('.graph-cats input[value=influence]').uncheck();
  await expect(page).toHaveURL(/categories=/);
  expect(errors).toEqual([]);
});

test('theme toggle switches to dark and back', async ({ page }) => {
  await page.goto('/artists');
  const toggle = page.locator('.theme-toggle');
  await toggle.click(); // light
  await toggle.click(); // dark
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await toggle.click(); // auto
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('unknown entries show "Not found"', async ({ page }) => {
  await page.goto('/artists/no-such-artist');
  await expect(page.locator('h1')).toHaveText('Not found');
});

test('old #/ addresses still work and become paths', async ({ page }) => {
  await page.goto('/#/artists/vincent-van-gogh');
  await expect(page.locator('h1')).toHaveText('Vincent van Gogh');
  await expect(page).toHaveURL(/\/artists\/vincent-van-gogh$/);
});

test('links navigate without reloading; back returns', async ({ page }) => {
  await page.goto('/artists');
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
  await page.locator('.card-link', { hasText: 'Vincent van Gogh' }).click();
  await expect(page.locator('h1')).toHaveText('Vincent van Gogh');
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1); // same page, no reload
  await page.goBack();
  await expect(page.locator('h1')).toHaveText('Artists');
});

test('privacy page from the footer; the site sets no cookies', async ({ page, context }) => {
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.figure img')).toBeVisible();
  await page.locator('.site-footer a', { hasText: 'Privacy' }).click();
  await expect(page.locator('h1')).toHaveText('Privacy');
  await expect(page.locator('main')).toContainText('info@piogino.ch');
  expect(await context.cookies()).toEqual([]); // the image stand-in offers a cookie (fixtures.ts): it must be refused
});

test('start map: routes of the selection, a place lists what happened there', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#map-status')).toContainText('Click a place to see what happened there');
  // the dev build exposes the map (window.__maps) so the test can click a known place
  await page.waitForFunction(() => {
    const m = (window as unknown as { __maps?: { getSource(id: string): unknown; querySourceFeatures(id: string): unknown[] }[] }).__maps?.at(-1);
    return !!m?.getSource('ov-routes') && m.querySourceFeatures('ov-routes').length > 0; // drawn, not just added
  });
  const routes = await page.evaluate(() => (window as unknown as { __maps: { querySourceFeatures(id: string): { properties: { name: string } }[] }[] }).__maps.at(-1)!
    .querySourceFeatures('ov-routes').map((f) => f.properties.name));
  expect(routes).toContain('Vincent van Gogh');
  const pt = await page.evaluate(() => {
    const m = (window as unknown as { __maps: { jumpTo(o: object): void; project(c: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement }[] }).__maps.at(-1)!;
    m.jumpTo({ center: [2.35, 48.86], zoom: 6 });
    const p = m.project([2.3522, 48.8566]);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.waitForTimeout(500);
  await page.mouse.click(pt.x, pt.y);
  const popup = page.locator('.maplibregl-popup:not(.hover-tip)');
  await expect(popup).toContainText('Paris');
  await expect(popup.locator('.popup-events a', { hasText: 'Vincent van Gogh' })).toBeVisible();
  await expect(popup).toContainText('lived in');
});

test('crossed paths: listed under the map, on detail pages, and "only these two"', async ({ page }) => {
  // fixed point in the curated content: Gauguin and Van Gogh both lived in Arles in late 1888
  await page.goto('/');
  const list = page.locator('#encounters');
  const arles = list.locator('.encounter', { hasText: 'Arles' }).filter({ hasText: 'Paul Gauguin' }).filter({ hasText: 'Vincent van Gogh' });
  await expect(arles).toContainText('1888');
  await arles.getByRole('link', { name: 'only these two →' }).click();
  await expect(page).toHaveURL(/artists=paul-gauguin,vincent-van-gogh&from=1888&to=1888/);
  await expect(page.locator('#map-status')).toContainText('in 1888');

  await page.goto('/artists/paul-gauguin');
  await expect(page.locator('#crossed')).toContainText('Vincent van Gogh');
  await expect(page.locator('#crossed')).toContainText('Arles');
});

test('names in several languages: lang, original with furigana, search by other names and readings', async ({ page }) => {
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('h1')).toHaveAttribute('lang', 'en');
  const original = page.locator('.original-name [lang="ja"]');
  await expect(original).toContainText('神奈川');
  await expect(original.locator('ruby rt').first()).toHaveText('かながわ'); // furigana
  await page.goto('/artworks');
  await page.fill('.filter', 'かながわ'); // a reading, not part of any displayed title
  await expect(page.locator('.card', { hasText: 'The Great Wave off Kanagawa' })).toBeVisible();
});

test('people (formerly patrons): page, roles, old /patrons/ addresses redirect', async ({ page }) => {
  await page.goto('/patrons/theo-van-gogh');
  await expect(page).toHaveURL(/\/people\/theo-van-gogh$/);
  await expect(page.locator('h1')).toHaveText('Theo van Gogh');
  await expect(page.locator('.facts')).toContainText('patron'); // role derived from "patron of"
  await page.goto('/people');
  await expect(page.locator('h1')).toHaveText('People');
});

test('a remembered time window: routes still drawn, the page says so, "Start fresh" resets', async ({ page }) => {
  await page.goto('/privacy');
  await page.evaluate(() => localStorage.setItem('arthistory:explore', 'from=1856&to=1907'));
  await page.goto('/');
  await expect(page.locator('#restored')).toContainText('time window 1856–1907');
  await page.waitForFunction(() => {
    const m = (window as unknown as { __maps?: { getSource(id: string): unknown; querySourceFeatures(id: string): unknown[] }[] }).__maps?.at(-1);
    return !!m?.getSource('ov-routes') && m.querySourceFeatures('ov-routes').length > 0;
  });
  await page.locator('[data-fresh]').click();
  await expect(page.locator('#restored')).toBeHidden();
  await expect(page.locator('#map-status')).toContainText('Click a place to see what happened there');
});

test('each displayed route has its own colour, named in the legend', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#legend .route-key', { hasText: 'Vincent van Gogh' })).toBeVisible();
  await page.waitForFunction(() => {
    const m = (window as unknown as { __maps?: { querySourceFeatures(id: string): unknown[] }[] }).__maps?.at(-1);
    return !!m && m.querySourceFeatures('ov-routes').length > 1;
  });
  const colours = await page.evaluate(() => {
    const m = (window as unknown as { __maps: { querySourceFeatures(id: string): { properties: { key: string; color: string } }[] }[] }).__maps.at(-1)!;
    return Object.fromEntries(m.querySourceFeatures('ov-routes').map((f) => [f.properties.key, f.properties.color]));
  });
  const values = Object.values(colours);
  expect(new Set(values).size).toBe(values.length); // no two routes share a colour (up to 12)
});

test('years typed while the map is still loading are kept (slow API)', async ({ page }) => {
  // the start map's presence data arrives late, as on a slow connection; meanwhile the user types a window
  await page.route(/\/v1\/map\/presence\?/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.goto('/');
  await page.fill('input[name=from]', '1830');
  await page.fill('input[name=to]', '1850');
  // the routes arrive and recolour the timeline: the typed years must survive
  await expect(page.locator('#map-status')).toContainText('Click a place', { timeout: 20_000 });
  await expect(page.locator('input[name=from]')).toHaveValue('1830');
  await page.locator('.timeline-form button[type=submit]').click();
  await expect(page.locator('#map-status')).toContainText('1830–1850', { timeout: 20_000 });
});

test('artwork dimensions: the work itself (with note), then one line per further measured part', async ({ page }) => {
  // no artwork has further measurements yet: add some to the Great Wave's response
  await page.route(/\/v1\/artworks\/the-great-wave-off-kanagawa$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.dimensions = { ...body.dimensions, note: 'image' };
    body.other_dimensions = [
      { part: 'mount', height_cm: 180, width_cm: 95.5, depth_cm: null, label: '180 × 95.5 cm' },
      { part: 'frame', height_cm: 190, width_cm: 105.5, depth_cm: 6, label: '190 × 105.5 × 6 cm' },
    ];
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const dims = page.locator('.facts dd').filter({ hasText: 'cm' }).first();
  await expect(dims).toContainText('25.7 × 37.9 cm (image)');
  await expect(dims).toContainText('Mount: 180 × 95.5 cm');
  await expect(dims).toContainText('Frame: 190 × 105.5 × 6 cm');
});
