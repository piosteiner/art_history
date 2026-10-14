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
  await page.goto('/?all');
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
  await page.goto('/?all');
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
  await page.goto('/?all');
  const artists = page.locator('details[data-group=artist]');
  await artists.locator('summary').click();
  const vg = artists.locator('.pick-item', { hasText: 'Vincent van Gogh' });
  await vg.locator('.pick-link').click();
  await expect(vg.locator('input')).not.toBeChecked();
  const [tab] = await Promise.all([context.waitForEvent('page'), vg.locator('.pick-link').click({ modifiers: ['ControlOrMeta'] })]);
  await expect(tab).toHaveURL(/\/artists\/vincent-van-gogh$/, { timeout: 15_000 }); // a new tab loads slowly in a busy run
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
  await page.goto('/?all');
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

test('artists A–Z by the API\'s sort_key ("Family, Given"), also without a sort_name', async ({ page }) => {
  await page.goto('/artists');
  const card = page.locator('.cards > li', { hasText: 'Willem de Kooning' }); // sort_key "Kooning, Willem"
  await expect(card.locator('xpath=preceding-sibling::li[contains(@class,"cards-heading")][1]')).toHaveText('K');
});

test('artworks A–Z by the API sort_key: titles without a leading article in their language', async ({ page }) => {
  await page.goto('/artworks');
  const heading = (title: string) => page.locator('.cards > li', { hasText: title }).first()
    .locator('xpath=preceding-sibling::li[contains(@class,"cards-heading")][1]');
  await expect(heading('Le Phare de Honfleur')).toHaveText('P'); // French "Le" (only English articles were dropped before)
  await expect(heading('The Starry Night')).toHaveText('S');
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
  await page.goto('/?all');
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

test('artwork map: the provenance in chain order — numbered stops, segments with steps passed over, unplaced steps', async ({ page }) => {
  await page.goto('/artworks/heiliger-sebastian');
  // Frankfurt (2, 3), London (4), Zürich (6–9: Bührle, his estate, the foundation, the loan to the Kunsthaus)
  const stops = page.locator('.prov-stop');
  await expect(stops).toHaveText(['2, 3', '4', '6–9']);
  const legend = page.locator('#legend');
  await expect(legend).toContainText('numbered in the provenance\'s order');
  await expect(legend).not.toContainText('route, in date order'); // replaced, not drawn twice
  const unplaced = page.locator('#unplaced li'); // one per line, numbered with the step
  await expect(unplaced).toHaveCount(2);
  await expect(unplaced.nth(0)).toHaveAttribute('value', '1');
  await expect(unplaced.nth(0)).toContainText('Niklaus Weckmann, creation, early 16th century');
  await expect(unplaced.nth(1)).toHaveAttribute('value', '5');
  await expect(unplaced.nth(1)).toContainText('Estate of Hedwig Frieda Ullmann');

  await stops.filter({ hasText: '6–9' }).click();
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText('steps 6–9 of 9');
  await expect(popup.locator('li')).toHaveCount(4);
  await expect(popup.locator('li').nth(1)).toContainText('Estate of Emil Georg Bührle');
  await expect(popup.locator('li').nth(3)).toContainText('at the institution\'s seat');
  await popup.locator('.maplibregl-popup-close-button').click();

  // the line London → Zürich passes over the estate in Frankfurt, whose place isn't recorded
  const pt = await page.evaluate(async () => {
    type M = { project(c: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement; loaded(): boolean };
    const m = (window as unknown as { __maps: M[] }).__maps.at(-1)!;
    const fc = await (await fetch('/v1/map/artworks/heiliger-sebastian')).json();
    const seg = fc.provenance.features.find((f: { properties: { from_step?: number } }) => f.properties.from_step === 4);
    const [a, b] = [seg.geometry.coordinates[0], seg.geometry.coordinates.at(-1)].map((c: [number, number]) => m.project(c));
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + (a.x + b.x) / 2, y: r.top + (a.y + b.y) / 2 };
  });
  await page.waitForFunction(() => !!(window as unknown as { __maps: { getLayer(id: string): unknown }[] }).__maps.at(-1)!.getLayer('prov-hit'));
  await page.mouse.click(pt.x, pt.y);
  await expect(popup).toContainText('4 → 6');
  await expect(popup).toContainText('passes over: 5 Estate of Hedwig Frieda Ullmann (place not recorded)');
});

test('start map: a chosen artwork shows its provenance as on its own page, in its colour', async ({ page }) => {
  await page.goto('/?artworks=heiliger-sebastian');
  const stops = page.locator('.prov-stop');
  await expect(stops).toHaveText(['2, 3', '4', '6–9']);
  expect(await stops.first().evaluate((el) => el.style.getPropertyValue('--pc'))).not.toBe(''); // the selection's colour
  const legend = page.locator('#legend');
  await expect(legend).toContainText('in the provenance\'s order');
  await expect(legend.locator('.unplaced li')).toHaveCount(2);
  await stops.filter({ hasText: '4' }).click();
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText('Heiliger Sebastian'); // named: several entries can be on the map
  await expect(popup).toContainText('Arthur Kauffmann');
  await expect(popup).toHaveCount(1); // not also the popup of a dot underneath
  // a time window shows presence instead: no numbered markers, but the route is the provenance's steps dated in the
  // window (4 London 1938–1954, 6–8 Zürich), in the chain's order — one line London → Zürich, the handover documented
  await page.fill('input[name=from]', '1950');
  await page.fill('input[name=to]', '1960');
  await page.press('input[name=to]', 'Enter');
  await expect(page.locator('#chips .chip')).toHaveText(/Time window 1950–1960/);
  await expect(stops).toHaveCount(0);
  type F = { properties: { slug: string; style: string; stops: string } };
  await page.waitForFunction(() => {
    const m = (window as unknown as { __maps?: { getLayer(id: string): unknown; querySourceFeatures(id: string): unknown[] }[] }).__maps?.at(-1);
    return !!m?.getLayer('ov-routes') && m.querySourceFeatures('ov-routes').length > 0;
  });
  const routes = await page.evaluate(() => (window as unknown as { __maps: { querySourceFeatures(id: string): F[] }[] }).__maps.at(-1)!
    .querySourceFeatures('ov-routes').filter((f) => f.properties.slug === 'heiliger-sebastian')
    .map((f) => ({ style: f.properties.style, steps: (JSON.parse(f.properties.stops) as { step: number }[]).map((s) => s.step) })));
  expect(routes.length).toBeGreaterThan(0);
  expect(routes.every((r) => r.style === 'direct')).toBe(true); // not 'route': no line by date
  expect(routes[0].steps).toEqual([4, 6, 7, 8]); // 2, 3 end before the window, 9 starts after it
  await expect(page.locator('#legend')).toContainText('its steps dated in 1950–1960');
});

test('start map overview: artworks follow their provenance (chain order, dashed where undocumented), not a route by date', async ({ page }) => {
  await page.goto('/?artists=none&movements=none&polities=none&people=none');
  type F = { properties: { slug: string; style: string; provenance?: boolean | string } };
  await page.waitForFunction(() => {
    const m = (window as unknown as { __maps?: { getLayer(id: string): unknown; querySourceFeatures(id: string): unknown[] }[] }).__maps?.at(-1);
    return !!m?.getLayer('ov-routes-gap') && m.querySourceFeatures('ov-routes').length > 0;
  });
  const features = await page.evaluate(() => (window as unknown as { __maps: { querySourceFeatures(id: string): F[] }[] }).__maps.at(-1)!
    .querySourceFeatures('ov-routes').map((f) => ({ slug: f.properties.slug, style: f.properties.style })));
  const sebastian = features.filter((f) => f.slug === 'heiliger-sebastian');
  expect(sebastian.length).toBeGreaterThan(0);
  expect(sebastian.every((f) => f.style !== 'route')).toBe(true); // segments of the provenance
  expect(features.some((f) => f.style === 'gap')).toBe(true); // somewhere a handover isn't documented
  await expect(page.locator('#legend')).toContainText('artworks: their provenance in its order');
  await expect(page.locator('#legend .route-key', { hasText: 'Heiliger Sebastian' })).toHaveCount(1); // one entry, not one per segment
});

test('stop popups count a stop with an open start ("until 1912") in route order', async ({ page }) => {
  // without the provenance the artwork's kept_in stops and route are shown, numbered (live data has open starts only there)
  await page.route(/\/v1\/map\/artworks\/heiliger-sebastian$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    delete body.provenance;
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/?artworks=heiliger-sebastian');
  await page.waitForFunction(() => {
    const m = (window as unknown as { __maps?: { getSource(id: string): unknown; querySourceFeatures(id: string): unknown[] }[] }).__maps?.at(-1);
    return !!m?.getSource('sel-stops') && m.querySourceFeatures('sel-stops').length > 0;
  });
  const numbers = await page.evaluate(() => (window as unknown as { __maps: { querySourceFeatures(id: string): { properties: { stop?: number; period?: string | { label: string } } }[] }[] }).__maps.at(-1)!
    .querySourceFeatures('sel-stops').map((f) => {
      const period = f.properties.period;
      return [f.properties.stop, (typeof period === 'string' ? JSON.parse(period) : period)?.label]; // flattened to JSON or not
    }));
  expect(numbers).toContainEqual([1, 'until 1912']);
});

test('crossed paths: listed under the map, on detail pages, and "only these two"', async ({ page }) => {
  // fixed point in the curated content: Gauguin and Van Gogh both lived in Arles in late 1888
  await page.goto('/?all');
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

// ---- the home page: curated views (/v1/featured, mocked: the live content may not have any yet) ----
const FEATURED = [
  { slug: 'van-gogh', title: 'Van Gogh’s journey', intro_html: '<p>From Zundert to Auvers.</p>',
    query: 'artists=vincent-van-gogh&artworks=none&movements=none&polities=none&people=none' },
  { slug: 'sebastian', title: 'A provenance', intro_html: null,
    query: 'artworks=heiliger-sebastian&movements=none&polities=none&people=none' },
];
const mockFeatured = (page: import('@playwright/test').Page, data: unknown[] | null) =>
  page.route(/\/v1\/featured$/, (route) => (data ? route.fulfill({ json: { data } }) : route.fulfill({ status: 404, json: { error: 'not_found' } })));

test('home page: the first curated view, a switcher; changing the window makes the view your own', async ({ page }) => {
  await mockFeatured(page, FEATURED);
  await page.goto('/');
  const nav = page.locator('#featured');
  await expect(nav.locator('[aria-current=page]')).toHaveText('Van Gogh’s journey');
  await expect(page.locator('#featured-intro')).toContainText('From Zundert to Auvers.');
  await expect(page.locator('#legend')).toContainText('Vincent van Gogh'); // the view's picks, not everything
  expect(new URL(page.url()).search).toBe(''); // the home page keeps its address

  await nav.getByRole('link', { name: 'A provenance' }).click();
  await expect(page).toHaveURL(/\?featured=sebastian$/);
  await expect(page.locator('.prov-stop')).toHaveText(['2, 3', '4', '6–9']);
  await expect(page.locator('#featured-intro h2')).toHaveText('A provenance');

  await page.fill('input[name=from]', '1950');
  await page.fill('input[name=to]', '1960');
  await page.press('input[name=to]', 'Enter');
  await expect(page).toHaveURL(/artworks=heiliger-sebastian.*from=1950&to=1960/);
  await expect(page.locator('#featured-intro')).toBeHidden();
  await expect(nav.locator('[aria-current=page]')).toHaveCount(0);
  await expect(nav.locator('a.chip')).toHaveCount(2); // the switcher stays

  await nav.getByRole('link', { name: 'Explore everything →' }).click();
  await expect(page).toHaveURL(/\/\?all$/);
  await expect(page.locator('#map-status')).toContainText('Click a place to see what happened there');
});

test('home page: the last own view is offered, not restored by itself', async ({ page }) => {
  await mockFeatured(page, FEATURED);
  await page.goto('/privacy');
  await page.evaluate(() => localStorage.setItem('arthistory:explore', 'from=1856&to=1907'));
  await page.goto('/');
  await expect(page.locator('#featured [aria-current=page]')).toHaveText('Van Gogh’s journey');
  const cont = page.locator('#restored');
  await expect(cont).toContainText('Continue where you left off (time window 1856–1907)');
  await cont.getByRole('link').click();
  await expect(page).toHaveURL(/from=1856&to=1907/);
  await expect(page.locator('#chips .chip')).toHaveText(/Time window 1856–1907/);
});

test('home page without curated views (or without the API): everything, as before', async ({ page }) => {
  await mockFeatured(page, null);
  await page.goto('/');
  await expect(page.locator('#map-status')).toContainText('Click a place to see what happened there');
  await expect(page.locator('#featured')).toBeHidden();
  await page.evaluate(() => localStorage.setItem('arthistory:explore', 'from=1856&to=1907'));
  await page.reload();
  await expect(page.locator('#restored')).toContainText('Continue where you left off'); // offered here too
});

test('each displayed route has its own colour, named in the legend', async ({ page }) => {
  await page.goto('/?all');
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
  expect(new Set(values).size).toBe(Math.min(values.length, 12)); // no two routes share a colour until the 12 colours are used up
});

test('years typed while the map is still loading are kept (slow API)', async ({ page }) => {
  // the start map's presence data arrives late, as on a slow connection; meanwhile the user types a window
  await page.route(/\/v1\/map\/presence\?/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.goto('/?all');
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

// ---- glossary (the live glossary may still be empty: the tests bring two sample terms) ----
const TERMS = {
  'woodblock-print': { name: 'Woodblock print', category: 'technique', definition: 'A print made from a carved block of wood.' },
  torii: { name: 'Torii', category: 'architecture', definition: 'A traditional gate at the entrance of a Shinto shrine.' },
};
async function sampleGlossary(page: Page) {
  const item = (slug: keyof typeof TERMS) => ({ slug, ...TERMS[slug], image_url: null, names: [], sort_key: TERMS[slug].name, search_text: '' });
  await page.route(/\/v1\/glossary\?/, (r) => r.fulfill({ json: { data: [item('torii'), item('woodblock-print')], total: 2, limit: 500, offset: 0 } }));
  await page.route(/\/v1\/glossary\/woodblock-print$/, (r) => r.fulfill({ json: {
    type: 'term', slug: 'woodblock-print', ...TERMS['woodblock-print'], alt_names: [], names: [], description_html: '<p>Used for ukiyo-e.</p>',
    images: [], image_url: null, wikidata_id: null, metadata: {}, updated_at: '', glossary: {},
    used_in: [{ type: 'artwork', slug: 'the-great-wave-off-kanagawa', name: 'The Great Wave off Kanagawa' }],
    relationships: [{ type: 'related_term', direction: 'mutual', label: 'related to', category: 'glossary', is_physical_presence: false,
      entity: { type: 'term', slug: 'torii', name: 'Torii' }, period: null, note: null, certainty: 'attested', notes_html: null }],
  } }));
  // the Great Wave's description links one real and one missing term
  await page.route(/\/v1\/artworks\/the-great-wave-off-kanagawa$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.description_html = '<p>A <a href="/glossary/woodblock-print" class="glossary-link" data-term="woodblock-print">woodblock print</a> '
      + 'with a <a href="/glossary/bokashi" class="glossary-link missing" data-term="bokashi">bokashi</a> sky.</p>';
    body.glossary = { 'woodblock-print': TERMS['woodblock-print'] };
    await route.fulfill({ response: res, json: body });
  });
}

test('glossary: A–Z with category buttons, term page with definition, related terms and "used in"', async ({ page }) => {
  await sampleGlossary(page);
  await page.goto('/glossary');
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.locator('.cards-heading').first()).toHaveText('T'); // letter headings
  await page.locator('#categories button', { hasText: 'technique' }).click();
  await expect(page).toHaveURL(/\/glossary\?category=technique$/);
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('A print made from a carved block of wood.');
  await page.locator('.card-link').click();
  await expect(page.locator('h1')).toHaveText('Woodblock print');
  await expect(page.locator('.lead')).toHaveText('A print made from a carved block of wood.');
  await expect(page.locator('main')).toContainText('Related terms');
  await expect(page.locator('main a', { hasText: 'The Great Wave off Kanagawa' })).toBeVisible(); // used in
});

// ---- co-creators, [[links]] to entries, provenance (migrations 028–031; the live content may not have examples yet,
// so the tests change the live responses) ----
async function patch(page: Page, url: RegExp, change: (body: Record<string, unknown>) => void) {
  await page.route(url, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    change(body);
    await route.fulfill({ response: res, json: body });
  });
}
const GREAT_WAVE = /\/v1\/artworks\/the-great-wave-off-kanagawa$/;

test('several creators: attribution instead of the name, co-creators with their part; not repeated below', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    const main = b.creator as { slug: string; name: string };
    b.attribution_label = 'Workshop of Hokusai';
    b.creators = [{ ...main, main: true, role: null, certainty: 'attested' },
      { slug: 'katsushika-oi', name: 'Katsushika Ōi', main: false, role: 'colouring', certainty: 'possible' }];
    (b.relationships as unknown[]).push({ type: 'co_creator', direction: 'outgoing', label: 'co-creator', category: 'collaboration',
      is_physical_presence: false, entity: { type: 'artist', slug: 'katsushika-oi', name: 'Katsushika Ōi' }, period: null, note: 'colouring',
      certainty: 'possible', notes_html: null, derived: false, end_basis: null });
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const facts = page.locator('.facts');
  await expect(facts.locator('dt', { hasText: /^Artists$/ })).toBeVisible();
  await expect(facts.locator('a', { hasText: 'Workshop of Hokusai' })).toHaveAttribute('href', /^\/artists\//);
  await expect(facts).toContainText('Katsushika Ōi (colouring)');
  await expect(facts.locator('.tag', { hasText: 'possible' })).toBeVisible();
  await expect(page.locator('.subtitle')).toContainText('Workshop of Hokusai, Katsushika Ōi');
  await expect(page.locator('.rel-list', { hasText: 'Katsushika Ōi' })).toHaveCount(0);
});

test('a bare qualifier as attribution ("Workshop of") goes before the linked name; its sources on the Artist row', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    b.attribution_label = 'Workshop of';
    b.on_loan = true;
    b.sources = { ...(b.sources as object), attribution_label: [cited({ text: 'Wikidata, Q1, P1' })], on_loan: [cited({ text: 'Wikidata, Q1, P2' })] };
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const facts = page.locator('.facts');
  const artist = facts.locator('dt', { hasText: /^Artist$/ }).locator('+ dd');
  await expect(artist).toContainText('Workshop of Katsushika Hokusai');
  await expect(artist.locator('a')).toHaveText('Katsushika Hokusai');
  await expect(artist.locator('.cite-ref')).toHaveCount(1); // creator and attribution_label: one marker
  await expect(page.locator('.subtitle')).toContainText('Workshop of Katsushika Hokusai');
  await expect(facts.locator('dt', { hasText: /Attribution label|On loan/ })).toHaveCount(0);
});

test('an artist page marks co-created works', async ({ page }) => {
  await patch(page, /\/v1\/artists\/vincent-van-gogh$/, (b) => {
    (b.artworks as unknown[]).push({ slug: 'a-shared-work', title: 'A shared work', created: null, kind: null, co_creator: true, role: 'landscape' });
  });
  await page.goto('/artists/vincent-van-gogh');
  await expect(page.locator('li', { hasText: 'A shared work' }).locator('.tag')).toHaveText('co-creator · landscape');
});

test('[[links]] to entries navigate, a missing one is plain text; "mentioned in" lists backlinks', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    b.description_html = '<p>Admired by <a href="/artists/vincent-van-gogh" class="entry-link" data-entry="artist/vincent-van-gogh">Van Gogh</a> '
      + 'and <a href="/people/nobody-yet" class="entry-link missing" data-entry="person/nobody-yet">someone</a>.</p>';
    b.mentioned_in = [{ type: 'movement', slug: 'japonisme', name: 'Japonisme' }];
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.prose .entry-missing')).toHaveText('someone');
  await expect(page.locator('.prose a[data-entry="person/nobody-yet"]')).toHaveCount(0);
  await expect(page.locator('.backlinks')).toContainText('Mentioned in');
  await expect(page.locator('.backlinks a', { hasText: 'Japonisme' })).toHaveAttribute('href', '/movements/japonisme');
  await page.locator('.prose a.entry-link').click();
  await expect(page.locator('h1')).toHaveText('Vincent van Gogh');
});

test('[[links]] to entries: a preview on hover (name, subtitle, excerpt); an image that fails leaves the text', async ({ page }) => {
  await page.route('https://images.example.org/**', (r) => r.fulfill({ status: 404 }));
  await patch(page, GREAT_WAVE, (b) => {
    b.description_html = '<p>Admired by <a href="/artists/vincent-van-gogh" class="entry-link" data-entry="artist/vincent-van-gogh">Van Gogh</a> '
      + 'in <a href="/places/arles" class="entry-link" data-entry="place/arles">Arles</a>.</p>';
    b.entries = {
      'artist/vincent-van-gogh': { type: 'artist', slug: 'vincent-van-gogh', name: 'Vincent van Gogh', subtitle: '1853–1890',
        image_url: 'https://images.example.org/van-gogh.jpg', excerpt: 'Dutch Post-Impressionist painter.' },
      'place/arles': { type: 'place', slug: 'arles', name: 'Arles', subtitle: 'settlement · Provence', image_url: null, excerpt: null },
    };
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await page.locator('.prose a[data-entry="artist/vincent-van-gogh"]').hover();
  const pop = page.locator('.popover-entry');
  await expect(pop).toContainText('Vincent van Gogh');
  await expect(pop.locator('.popover-subtitle')).toHaveText('1853–1890');
  await expect(pop).toContainText('Dutch Post-Impressionist painter.');
  await expect(pop.locator('.popover-image')).toHaveCount(0); // the image 404s: text only
  await expect(pop).not.toHaveClass(/has-image/);
  await page.locator('.prose a[data-entry="place/arles"]').hover();
  await expect(pop.locator('.popover-subtitle')).toHaveText('settlement · Provence');
  await pop.getByRole('link', { name: 'Open →' }).click();
  await expect(page).toHaveURL(/\/places\/arles$/);
});

test('a work on loan: credit line with the lender from the provenance; further numbers under the inventory number', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    b.institution = { slug: 'kunsthaus-zurich', name: 'Kunsthaus Zürich' };
    b.inventory_number = 'BU 0018';
    b.on_loan = true;
    b.on_loan_since = { label: '2021', from: '2021-01-01', to: '2021-12-31', from_year: 2021, to_year: 2021 };
    b.provenance = [{ position: 0, owner: { type: 'institution', slug: 'foundation-e-g-buhrle-collection', name: 'Foundation E.G. Bührle Collection' },
      owner_label: null, owner_name: 'Foundation E.G. Bührle Collection', acquired: null, ended: null, method: 'gift', direct: true, label: null,
      certainty: 'attested', place: null, period: null, end_basis: 'unknown', notes_html: null, sources: null },
    // the computed last line (063): the lender is still the step before it
    { kind: 'loan', implied: true, position: 1000000, owner: { type: 'institution', slug: 'kunsthaus-zurich', name: 'Kunsthaus Zürich' }, co_owners: [],
      role: 'custodian', owner_label: null, owner_name: 'Kunsthaus Zürich', acquired: null, ended: null, method: 'unknown', direct: false, label: 'on loan',
      certainty: 'attested', price: null, place: null, period: null, end_basis: 'ongoing', notes_html: null, sources: [] }];
    b.numbers = [
      { number: '18', label: null, institution: { slug: 'foundation-e-g-buhrle-collection', name: 'Foundation E.G. Bührle Collection' }, source: null },
      { number: '658', label: 'Rewald (catalogue raisonné)', institution: null, source: null },
      { number: 'W 12', label: null, institution: null, source: { slug: 'rewald-1996', name: 'Rewald 1996' } },
    ];
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const facts = page.locator('.facts');
  await expect(facts.locator('dt', { hasText: 'Collection' }).locator('+ dd'))
    .toHaveText('Foundation E.G. Bührle Collection, on loan to the Kunsthaus Zürich since 2021');
  await expect(facts.locator('dd a[href="/institutions/foundation-e-g-buhrle-collection"]').first()).toBeVisible();
  await expect(facts).toContainText('BU 0018 (Kunsthaus Zürich)');
  await expect(facts).toContainText('18 (Foundation E.G. Bührle Collection)');
  await expect(facts.locator('dt', { hasText: 'Rewald (catalogue raisonné)' }).locator('+ dd')).toHaveText('658');
  await expect(facts.locator('dt', { hasText: 'Catalogue no.' }).locator('+ dd a[href="/bibliography/rewald-1996"]')).toBeVisible();
});

const tr = (text: string, lang: string, status: string | null) => ({ text, lang, role: 'translation', status, ruby_html: null, reading: null });

test('translations: an official title preferred to a common one, with its source; the common one under "Also known as"', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    b.title_status = 'common';
    b.names = [...(b.names as unknown[]), tr('Under the Wave off Kanagawa', 'en', 'official')];
    b.sources = { names: [cited({ kind: 'source', reliability: 'institution', text: 'The Met, collection online', url: 'https://www.metmuseum.org/art/collection/search/45434' })] };
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('h1')).toHaveText('Under the Wave off Kanagawa');
  await expect(page.locator('.title-status')).toContainText('Official English title');
  await expect(page.locator('.title-status .cite-ref')).toHaveText('M');
  const aka = page.locator('.facts dt', { hasText: 'Also known as' }).locator('+ dd');
  await expect(aka).toContainText('The Great Wave off Kanagawa');
  await expect(aka).not.toContainText('Under the Wave');
  await expect(page).toHaveTitle(/^Under the Wave off Kanagawa/);
});

test('translations: an own title and own names in [brackets], official ones marked', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    b.title_status = 'own';
    b.names = [...(b.names as unknown[]), tr('Die große Welle vor Kanagawa', 'de', 'official'), tr('La Grande Vague', 'fr', 'own')];
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('h1')).toHaveText('[The Great Wave off Kanagawa]');
  await expect(page.locator('.title-status')).toHaveText('Own English translation of the title');
  const aka = page.locator('.facts dt', { hasText: 'Also known as' }).locator('+ dd');
  await expect(aka).toContainText('Die große Welle vor Kanagawa official');
  await expect(aka).toContainText('[La Grande Vague]');
});

const step = (position: number, owner: { type: string; slug: string; name: string } | null, extra: Record<string, unknown>) => ({
  position, owner, owner_label: null, owner_name: owner?.name ?? null, acquired: null, ended: null, method: 'purchase', direct: false,
  label: null, certainty: 'attested', place: null, period: null, end_basis: 'unknown', notes_html: null, sources: null, ...extra,
});
/** A citation (API migration 049) with defaults for what a test doesn't care about. */
const cited = (c: Record<string, unknown>) => ({ kind: 'wikidata', reliability: 'database', text: 'Wikidata', source: null, wikidata: null, locator: null,
  url: null, accessed: null, note: null, outdated: false, ...c });

test('sources for facts: markers by kind, best first; the citations in a popover with the full reference; outdated ones muted', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    const wd = (p: string, extra = {}) => cited({ text: `Wikidata, Q252485, ${p}`, wikidata: { item: 'Q252485', property: p, url: 'https://www.wikidata.org/wiki/Q252485' }, accessed: '2026-10-08', ...extra });
    b.sources = {
      created: [wd('P571'), cited({ kind: 'source', reliability: 'scholarly', text: 'Busch 1993, S. 45', source: { slug: 'busch-1993', siglum: 'Busch 1993' } })],
      medium: [wd('P186', { outdated: true })], // changed since: no marker
      kind: [cited({ kind: 'text', reliability: null, text: 'Label in the exhibition, 2019', note: 'seen on site' })],
    };
    b.bibliography = { ...(b.bibliography as object), 'busch-1993': { siglum: 'Busch 1993', citation: 'Busch, Werner: <i>Das sentimentalische Bild</i>, München 1993.' } };
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const facts = page.locator('.facts');
  const date = facts.locator('dt', { hasText: 'Date' }).locator('+ dd');
  await expect(date.locator('.cite-ref')).toHaveText('LW'); // literature before Wikidata
  await expect(facts.locator('dt', { hasText: 'Medium' }).locator('+ dd .cite-ref')).toHaveCount(0);
  await expect(facts.locator('dt', { hasText: 'Type' }).locator('+ dd .cite-ref')).toHaveText('T');
  await date.locator('.cite-ref').hover();
  const pop = page.locator('.popover-cite');
  await expect(pop.locator('.cite-item').first()).toContainText('Busch 1993, S. 45');
  await expect(pop.locator('.cite-item').first()).toContainText('Das sentimentalische Bild');
  await expect(pop.locator('.cite-item').nth(1).locator('a')).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q252485');
  await page.mouse.move(5, 5);
  await expect(pop).toHaveCount(0);
  // keyboard: Tab onto the marker opens it; the popover of a marker is reachable by click too
  await facts.locator('dt', { hasText: 'Type' }).locator('+ dd .cite-ref').click();
  await expect(pop).toContainText('seen on site');
});

const year = (y: number, to: number | null = y) => ({ label: to === null ? `since ${y}` : to === y ? `${y}` : `${y}–${to}`, from: `${y}-01-01`, to: to === null ? null : `${to}-12-31`, from_year: y, to_year: to });

test('provenance: owners in order, implied ends and undocumented handovers marked, not repeated below', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    b.provenance = [
      step(0, { type: 'person', slug: 'first-owner', name: 'First Owner' }, { method: 'inheritance', label: 'estate', period: year(1926, 1952), end_basis: 'recorded',
        place: { slug: 'paris', name: 'Paris' }, sources: [cited({ kind: 'source', reliability: 'institution', text: 'Some Museum, collection online', url: 'https://collection.example.org/item/1', source: { slug: 'some-museum-online', siglum: 'Some Museum, collection online' } })] }),
      step(1, null, { owner_label: 'Private collection, Zürich', period: year(1952), end_basis: 'implied' }),
      step(2, { type: 'institution', slug: 'some-museum', name: 'Some Museum' }, { method: 'gift', direct: true, period: year(1952, null), end_basis: 'ongoing' }),
    ];
    (b.relationships as unknown[]).push({ type: 'owned_by', direction: 'outgoing', label: 'owned by', category: 'provenance', is_physical_presence: false,
      entity: { type: 'person', slug: 'first-owner', name: 'First Owner' }, period: year(1926, 1952), note: null, certainty: 'attested', notes_html: null,
      derived: true, end_basis: 'recorded' });
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const steps = page.locator('.provenance-step');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('First Owner');
  await expect(steps.nth(0).locator('.provenance-how')).toContainText('inheritance · estate · in Paris');
  await expect(steps.nth(0).locator('.cite-ref')).toHaveText('M'); // a museum's database
  await steps.nth(0).locator('.cite-ref').hover();
  await expect(page.locator('.popover-cite .cite-body > a').first()).toHaveAttribute('href', 'https://collection.example.org/item/1');
  await expect(steps.nth(0)).not.toHaveClass(/undocumented/); // the first owner has no handover before it
  await expect(steps.nth(1)).toHaveClass(/undocumented/);
  await expect(steps.nth(1)).toContainText('Private collection, Zürich');
  await expect(steps.nth(1).locator('.tag-implied')).toBeVisible();
  await expect(steps.nth(2)).not.toHaveClass(/undocumented/);
  await expect(steps.nth(2)).toContainText('since 1952');
  await expect(page.locator('.rel-list', { hasText: 'First Owner' })).toHaveCount(0); // under Provenance only
});

test('a holder’s page: works held one line each (own and estate periods), then whom it acquired from and passed on to', async ({ page }) => {
  await page.goto('/people/emil-georg-buhrle');
  const held = page.locator('.rel-holdings');
  await expect(held.locator('h2')).toHaveText('Works held');
  const sebastian = held.locator('> ul > li', { hasText: 'Heiliger Sebastian' });
  await expect(sebastian).toHaveCount(1); // his ownership and his estate's: one line, both periods
  await expect(sebastian).toContainText('16 February 1954–28 November 1956');
  await expect(sebastian).toContainText('28 November 1956–1960');
  await expect(held.locator('h3')).toHaveText(['Acquired from', 'Passed on to']);
  const nathan = held.locator('ul', { has: page.locator('a', { hasText: 'Fritz Nathan' }) }).locator('li', { hasText: 'Fritz Nathan' });
  await expect(nathan).toHaveCount(1); // one line per counterpart
  await expect(nathan.locator('.tag')).toContainText(/\d+ works/);
  // not repeated as single provenance links below
  await expect(page.locator('.rel-provenance .rel-label', { hasText: 'owner of' })).toHaveCount(0);
});

test('provenance (063): computed artist and loan lines in italics, roles, joint owners, estates, prices', async ({ page }) => {
  const person = (slug: string, name: string) => ({ type: 'person', slug, name });
  await patch(page, GREAT_WAVE, (b) => {
    b.provenance = [
      step(-1, { type: 'artist', slug: 'katsushika-hokusai', name: 'Katsushika Hokusai' }, { kind: 'creation', implied: true, method: 'creation', direct: true,
        period: { ...year(1831, 1904), label: '1831 – by 1904' }, end_basis: 'implied', sources: [] }),
      step(0, person('a-dealer', 'A Dealer'), { kind: 'step', role: 'dealer', direct: true, label: 'bought from the artist', price: { amount: 200, currency: 'FRF', note: null },
        period: { ...year(1831, 1904), from: null, from_year: null, label: 'until 28 October 1904' }, end_basis: 'recorded' }),
      step(1, person('leo-stein', 'Leo Stein'), { kind: 'step', co_owners: [person('gertrude-stein', 'Gertrude Stein')], direct: true,
        price: { amount: 18000, currency: 'USD', note: 'ca.' }, period: year(1904, 1936), end_basis: 'recorded' }),
      step(2, person('leo-stein', 'Leo Stein'), { kind: 'step', role: 'estate', method: 'inheritance', direct: true, period: year(1936, null), end_basis: 'ongoing' }),
      step(1000000, { type: 'institution', slug: 'some-museum', name: 'Some Museum' }, { kind: 'loan', implied: true, role: 'custodian', method: 'unknown',
        direct: false, label: 'on loan', period: year(2021, null), end_basis: 'ongoing', sources: [] }),
    ];
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const steps = page.locator('.provenance-step');
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(0)).toHaveClass(/implied/);
  await expect(steps.nth(0).locator('.provenance-how')).toHaveText('the artist');
  await expect(steps.nth(0).locator('.provenance-owner')).toHaveCSS('font-style', 'italic');
  await expect(steps.nth(1)).not.toHaveClass(/implied/);
  await expect(steps.nth(1).locator('.tag', { hasText: 'dealer' })).toBeVisible();
  await expect(steps.nth(1)).toContainText('until 28 October 1904');
  await expect(steps.nth(1).locator('.provenance-how')).toContainText('purchase · bought from the artist · 200 FRF');
  await expect(steps.nth(2).locator('.provenance-owner')).toContainText('Leo Stein and Gertrude Stein');
  await expect(steps.nth(2).locator('a[href="/people/gertrude-stein"]')).toBeVisible();
  await expect(steps.nth(2).locator('.provenance-how')).toContainText('ca. 18,000 USD');
  await expect(steps.nth(3).locator('.provenance-owner')).toContainText('Estate of Leo Stein');
  await expect(steps.nth(4)).toHaveClass(/implied/);
  await expect(steps.nth(4)).not.toHaveClass(/undocumented/); // a loan is no handover of ownership
  await expect(steps.nth(4).locator('.tag', { hasText: 'custodian' })).toBeVisible();
  await expect(steps.nth(4).locator('.cite-ref')).toHaveCount(0);
});

test('an owner\'s page and the network mark periods whose end is only implied', async ({ page }) => {
  await patch(page, /\/v1\/people\/theo-van-gogh$/, (b) => {
    (b.relationships as unknown[]).push({ type: 'owned_by', direction: 'incoming', label: 'owner of', category: 'provenance', is_physical_presence: false,
      entity: { type: 'artwork', slug: 'the-great-wave-off-kanagawa', name: 'The Great Wave off Kanagawa' }, period: year(1890), note: null,
      certainty: 'attested', notes_html: null, derived: true, end_basis: 'implied' });
  });
  await page.goto('/people/theo-van-gogh');
  await expect(page.locator('.rel-list li', { hasText: 'The Great Wave off Kanagawa' }).locator('.tag-implied')).toBeVisible();

  const node = (type: string, slug: string, name: string, depth: number) => ({ id: `${type}/${slug}`, type, slug, name, kind: null, depth, period: null });
  await page.route(/\/v1\/graph\/people\/theo-van-gogh\?/, (r) => r.fulfill({ json: {
    root: 'person/theo-van-gogh', depth: 2, types: [], truncated: false,
    nodes: [node('person', 'theo-van-gogh', 'Theo van Gogh', 0), node('artwork', 'the-great-wave-off-kanagawa', 'The Great Wave off Kanagawa', 1),
      node('institution', 'some-museum', 'Some Museum', 1)],
    edges: [
      { source: 'artwork/the-great-wave-off-kanagawa', target: 'person/theo-van-gogh', type: 'owned_by', label: 'owned by', category: 'provenance',
        symmetric: false, certainty: 'attested', note: null, period: year(1890), derived: true, end_basis: 'implied' },
      { source: 'artwork/the-great-wave-off-kanagawa', target: 'institution/some-museum', type: 'owned_by', label: 'owned by', category: 'provenance',
        symmetric: false, certainty: 'attested', note: null, period: year(1890, null), derived: true, end_basis: 'ongoing' },
    ],
  } }));
  await page.goto('/graph/people/theo-van-gogh?depth=2');
  await expect(page.locator('.edge')).toHaveCount(2);
  await expect(page.locator('.edge.implied')).toHaveCount(1);
});

// GET /v1/previews answered locally: every asked-for ref gets a preview named after it
async function samplePreviews(page: Page, asked: string[][] = []) {
  await page.route(/\/v1\/previews\?/, (r) => {
    const refs = new URL(r.request().url()).searchParams.get('refs')!.split(',');
    asked.push(refs);
    r.fulfill({ json: { data: Object.fromEntries(refs.map((ref) => {
      const [type, slug] = ref.split('/');
      return [ref, { type, slug, name: `Preview of ${slug}`, subtitle: 'a subtitle', image_url: null, excerpt: `Excerpt about ${slug}.` }];
    })) } });
  });
  return asked;
}

test('previews on every internal link: fields and relationships, fetched together; not the breadcrumbs', async ({ page }) => {
  const asked = await samplePreviews(page);
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  expect(asked[0].length).toBeGreaterThan(1); // the page's links in one request
  expect(asked.flat()).not.toContain('artwork/the-great-wave-off-kanagawa'); // not the page itself
  const museum = page.locator('.facts a[href="/institutions/metropolitan-museum-of-art"]');
  await museum.hover();
  const pop = page.locator('.popover-entry');
  await expect(pop).toContainText('Excerpt about metropolitan-museum-of-art.');
  await page.mouse.move(5, 5);
  await expect(pop).toHaveCount(0);
  await page.locator('.crumbs a').hover();
  await page.waitForTimeout(500);
  await expect(pop).toHaveCount(0);
  // focus moved by a script after a click (a map popup focuses its first link): no preview
  await page.locator('h1').click();
  await museum.evaluate((a: HTMLElement) => a.focus());
  await page.waitForTimeout(500);
  await expect(pop).toHaveCount(0);
  // keyboard: Tab onto the link opens it
  await museum.evaluate((a: HTMLElement) => a.blur());
  await page.locator('.facts a').first().evaluate((a: HTMLElement) => a.focus());
  while (!(await museum.evaluate((a) => a === document.activeElement))) await page.keyboard.press('Tab');
  await expect(pop).toContainText('Preview of metropolitan-museum-of-art');
});

test('glossary links in texts: popover with the definition; a missing term is plain text', async ({ page }) => {
  await sampleGlossary(page);
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const linkEl = page.locator('.prose a.glossary-link');
  await linkEl.hover();
  await expect(page.locator('.glossary-popover')).toContainText('A print made from a carved block of wood.');
  await expect(page.locator('.prose a[data-term="bokashi"]')).toHaveCount(0); // no dead link
  await expect(page.locator('.prose .glossary-missing')).toHaveText('bokashi');
  await page.locator('.glossary-popover a').click();
  await expect(page).toHaveURL(/\/glossary\/woodblock-print$/);
});

// ---- exact locations (API migration 034); the live data has none yet, so the tests bring a sample ----
const ZH = { slug: 'zurich', name: 'Zürich' };
const KUNSTHAUS = { slug: 'kunsthaus-zurich', name: 'Kunsthaus Zürich' };
const KH_POINT: [number, number] = [8.5481, 47.3702];
function stay(entity: { type: string; slug: string; name: string }, from: string, to: string) {
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: KH_POINT },
    properties: {
      relationship: 'worked_in', label: 'worked at', place: ZH, institution: KUNSTHAUS, artwork: null, entity, note: null, certainty: 'attested',
      period: { label: `${from}–${to}`, from: `${from}-01-01`, to: `${to}-12-31`, from_year: Number(from), to_year: Number(to) },
    },
  };
}
async function sampleVenues(page: Page) {
  await page.route(/\/v1\/map\/presence\?/, (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [
    stay({ type: 'artist', slug: 'claude-monet', name: 'Claude Monet' }, '1910', '1912'),
    stay({ type: 'person', slug: 'theo-van-gogh', name: 'Theo van Gogh' }, '1911', '1915'),
  ] } }));
  await page.route(/\/v1\/map\/sites$/, (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: KH_POINT },
      properties: { type: 'institution', ...KUNSTHAUS, kind: 'museum', address: 'Heimplatz 1, 8001 Zürich', place: ZH } },
  ] } }));
}

test('same institution at the same time: "could have met there"; the museums layer has a switch', async ({ page }) => {
  await sampleVenues(page);
  await page.goto('/?all');
  const item = page.locator('#encounters .encounter').first();
  await expect(item).toContainText('Kunsthaus Zürich');
  await expect(item).toContainText('could have met there');
  await expect(page.locator('#sites-toggle')).toContainText('Museums and sites (1)');
});

test('institution page: address and its own point', async ({ page }) => {
  await page.route(/\/v1\/institutions\/kunsthaus-zurich$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.address = 'Heimplatz 1, 8001 Zürich';
    body.location = { type: 'Point', coordinates: KH_POINT };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/institutions/kunsthaus-zurich');
  await expect(page.locator('.facts')).toContainText('Heimplatz 1, 8001 Zürich');
  await expect(page.locator('#legend')).toContainText('its building');
});

// ---- bibliography and footnotes (the live bibliography may still be empty: the tests bring two sample sources) ----
const BUSCH = { slug: 'busch-1993', siglum: 'Busch 1993', citation: 'Werner Busch, <i>Das sentimentalische Bild</i>, München 1993.' };
const KAT = { slug: 'kat-paris-2007', siglum: 'Kat. Paris 2007', citation: '<i>Hokusai</i>, hg. von X, Ausst.-Kat. Paris 2007.' };
async function sampleBibliography(page: Page) {
  const item = (s: typeof BUSCH, status: string, year: number) => ({ ...s, name: s.siglum, kind: 'monograph', subtitle: null, authors: ['Werner Busch'], year,
    reading_status: status, read_on: null, primary_source: false, names: [], sort_key: s.siglum, search_text: '' });
  await page.route(/\/v1\/bibliography\?/, (r) => r.fulfill({ json: { data: [item(BUSCH, 'read', 1993), item(KAT, 'to_read', 2007)], total: 2, limit: 500, offset: 0,
    stats: { total: 2, read: 1, reading: 0, to_read: 1 } } }));
  await page.route(/\/v1\/bibliography\/busch-1993$/, (r) => r.fulfill({ json: { type: 'source', ...item(BUSCH, 'read', 1993), description_html: '<p>Read for the chapter on Romanticism.</p>',
    wikidata_id: null, metadata: {}, updated_at: '', relationships: [], glossary: {}, bibliography: {},
    mentioned_in: [{ type: 'artwork', slug: 'the-great-wave-off-kanagawa', name: 'The Great Wave off Kanagawa' }] } }));
  // the Great Wave's description with a footnote citing Busch, as the backend renders it
  await page.route(/\/v1\/artworks\/the-great-wave-off-kanagawa$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.description_html = '<p>The wave became an icon.<sup class="fn-ref" id="nabc123-r1"><a href="#nabc123-n1">1</a></sup></p>'
      + '<section class="footnotes"><ol class="footnote-list"><li id="nabc123-n1"><a href="/bibliography/busch-1993" class="source-link" data-source="busch-1993">Busch 1993</a>, S. 12. '
      + '<a href="#nabc123-r1" class="fn-back" title="back to the text">↩</a></li></ol></section>'
      + `<section class="bibliography"><h4>Literatur</h4><ul class="source-list"><li id="nabc123-s-busch-1993"><span class="siglum">Busch 1993:</span> ${BUSCH.citation}</li></ul></section>`;
    body.bibliography = { 'busch-1993': { siglum: BUSCH.siglum, citation: BUSCH.citation } };
    await route.fulfill({ response: res, json: body });
  });
}

test('bibliography: A–Z by short reference with reading statistics and status filter; source page', async ({ page }) => {
  await sampleBibliography(page);
  await page.goto('/bibliography');
  await expect(page.locator('#stats')).toHaveText('1 read · 0 reading · 1 to read');
  await expect(page.locator('.card')).toHaveCount(2);
  await page.locator('#categories button', { hasText: 'to read' }).click();
  await expect(page).toHaveURL(/\/bibliography\?status=to_read$/);
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('#categories button', { hasText: 'All' }).click();
  await page.locator('.card-link', { hasText: 'Busch 1993' }).click();
  await expect(page.locator('h1')).toHaveText('Busch 1993');
  await expect(page.locator('.lead.citation i')).toHaveText('Das sentimentalische Bild'); // italic title
  await expect(page.locator('main')).toContainText('Cited in');
  await expect(page.locator('main a', { hasText: 'The Great Wave off Kanagawa' })).toBeVisible();
});

test('footnotes in texts: popovers for the note and the source; the jump keeps the page', async ({ page }) => {
  await sampleBibliography(page);
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await page.locator('.prose sup.fn-ref a').hover();
  await expect(page.locator('.popover-note')).toContainText('Busch 1993, S. 12');
  await page.locator('.prose .footnote-list a.source-link').hover();
  await expect(page.locator('.popover-source i')).toHaveText('Das sentimentalische Bild');
  // clicking the number jumps to the note within the page (no re-render)
  await page.evaluate(() => document.querySelector('h1')!.setAttribute('data-marker', '1')); // a re-render would replace it
  await page.locator('.prose sup.fn-ref a').click();
  await expect(page).toHaveURL(/#nabc123-n1$/);
  await page.waitForTimeout(500);
  await expect(page.locator('h1')).toHaveAttribute('data-marker', '1');
  await expect(page.locator('h1')).toHaveText('The Great Wave off Kanagawa');
  await expect(page.locator('#nabc123-n1')).toBeVisible();
});

// ---- series and other wholes (API migration 037); the live data has no series yet, so the tests bring one ----
const SERIES = { slug: 'thirty-six-views-of-mount-fuji', title: 'Thirty-six Views of Mount Fuji', kind: 'print series', parts_count: 36 };
async function sampleSeries(page: Page) {
  await page.route(/\/v1\/artworks\/the-great-wave-off-kanagawa$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    Object.assign(body, {
      part_of: [SERIES], part_number: '21',
      previous_part: { slug: 'south-wind-clear-sky', title: 'South Wind, Clear Sky', part_number: '20' },
      next_part: { slug: 'shower-below-the-summit', title: 'Shower Below the Summit', part_number: '22' },
      parts_count: null, parts: [],
    });
    await route.fulfill({ response: res, json: body });
  });
  await page.route(/\/v1\/artworks\/thirty-six-views-of-mount-fuji$/, async (route) => {
    const base = { type: 'artwork', slug: SERIES.slug, title: SERIES.title, alt_titles: [], attribution_label: null, created: null, kind: 'print series',
      medium: null, inventory_number: null, materials: [], dimensions: null, other_dimensions: [], description_html: null, images: [], image_url: null,
      creator: { slug: 'katsushika-hokusai', name: 'Katsushika Hokusai' }, institution: null, wikidata_id: null, metadata: {}, updated_at: '',
      relationships: [], country: null, polities: [], names: [], part_of: [], part_number: null, previous_part: null, next_part: null, parts_count: 36,
      parts: [
        { slug: 'south-wind-clear-sky', title: 'South Wind, Clear Sky', part_number: '20', kind: 'woodblock print', created: null, image_url: null, parts: 0 },
        { slug: 'the-great-wave-off-kanagawa', title: 'The Great Wave off Kanagawa', part_number: '21', kind: 'woodblock print', created: { label: 'c. 1831' }, image_url: null, parts: 0 },
      ] };
    await route.fulfill({ json: base });
  });
  await page.route(/\/v1\/map\/artworks\/thirty-six-views-of-mount-fuji$/, (r) => r.fulfill({ json: { type: 'FeatureCollection', entity: { type: 'artwork', slug: SERIES.slug, name: SERIES.title }, features: [] } }));
}

test('series: "No. 21 of 36 in …" with previous/next; the series page shows its parts', async ({ page }) => {
  await sampleSeries(page);
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.series-line')).toHaveText(/No\. 21\s+of 36 in\s+Thirty-six Views of Mount Fuji/);
  await expect(page.locator('.part-nav .part-prev')).toContainText('South Wind, Clear Sky');
  await expect(page.locator('.part-nav .part-next')).toContainText('Shower Below the Summit');
  await page.locator('.series-line a').click();
  await expect(page.locator('h1')).toHaveText('Thirty-six Views of Mount Fuji');
  await expect(page.locator('.parts h2')).toContainText('2 of 36');
  await expect(page.locator('.parts-grid .part-card')).toHaveCount(2);
  await expect(page.locator('.parts-grid .part-card').nth(1)).toContainText('No. 21');
});

// ---- an artwork's web page (API migrations 038/039; no live artwork has one yet: the tests add it) ----
async function withWebPage(page: Page, change: (body: Record<string, unknown>) => void) {
  await page.route(/\/v1\/artworks\/the-great-wave-off-kanagawa$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.web_url = 'https://www.metmuseum.org/art/collection/search/45434';
    body.web_url_accessed = '2026-10-07';
    change(body);
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
}

test('artwork web page: a prominent link at the top, named after the collection, with the day it was accessed', async ({ page }) => {
  await withWebPage(page, (body) => { body.institution = { slug: 'metropolitan-museum-of-art', name: 'The Metropolitan Museum of Art' }; });
  const link = page.locator('.detail-actions a.web-link');
  await expect(link).toHaveText('View at The Metropolitan Museum of Art ↗');
  await expect(link).toHaveAttribute('href', 'https://www.metmuseum.org/art/collection/search/45434');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.locator('.detail-actions .web-accessed')).toHaveText('link accessed 7 October 2026');
  await expect(page.locator('.web-panel')).toHaveCount(0);  // there are images: no panel
});

test('artwork web page without a free image: shown in place of the image, named after the domain', async ({ page }) => {
  await withWebPage(page, (body) => { body.images = []; body.image_url = null; body.institution = null; });
  const panel = page.locator('.web-panel');
  await expect(panel).toContainText('no freely licensed image');
  await expect(panel.locator('a.web-link')).toHaveText('View at metmuseum.org ↗');
  await expect(panel).toContainText('link accessed 7 October 2026');
  // not twice on a wide screen; on a narrow one the map comes first, so the link is also at the top
  const top = page.locator('.detail-actions a.web-link');
  if ((page.viewportSize()?.width ?? 1200) > 860) await expect(top).toBeHidden();
  else await expect(top).toBeVisible();
});

// ---- events (API migration 047); the live data has none yet, so the tests bring samples ----
const yr = (from: string, to: string, label: string) => ({ label, from, to, from_year: Number(from.slice(0, 4)), to_year: Number(to.slice(0, 4)) });
const FIRE_PERIOD = yr('1657-03-02', '1657-03-04', '2 March–4 March 1657');
const EDO = { slug: 'edo', name: 'Edo', location: { type: 'Point', coordinates: [139.76, 35.68] } };
const FIRE = {
  type: 'event', slug: 'great-fire-of-meireki', name: 'Great Fire of Meireki', name_lang: 'en', names: [], alt_names: [],
  kind: 'fire', period: FIRE_PERIOD, place: EDO, part_of: null, country: null, polities: [],
  parts: [{ slug: 'first-day', name: 'First day', kind: 'fire', period: yr('1657-03-02', '1657-03-02', '2 March 1657') }],
  location: null, area: { type: 'MultiPolygon', coordinates: [[[[139.74, 35.67], [139.78, 35.67], [139.78, 35.70], [139.74, 35.67]]]] },
  description_html: '<p>A fire that destroyed much of Edo.</p>', images: [], image_url: null, wikidata_id: null, metadata: {}, updated_at: '2026-10-08',
  relationships: [
    { type: 'participated_in', direction: 'incoming', label: 'participants', category: 'event', is_physical_presence: false,
      entity: { type: 'person', slug: 'some-official', name: 'Some Official' }, period: null, note: 'fire commissioner', certainty: 'attested', notes_html: null },
    { type: 'concerns', direction: 'outgoing', label: 'concerns', category: 'event', is_physical_presence: false,
      entity: { type: 'place', slug: 'edo', name: 'Edo' }, period: null, note: null, certainty: 'attested', notes_html: null },
    { type: 'depicts', direction: 'incoming', label: 'depicted in', category: 'depiction', is_physical_presence: false,
      entity: { type: 'artwork', slug: 'meireki-fire-scroll', name: 'Meireki fire handscroll' }, period: null, note: null, certainty: 'attested', notes_html: null },
  ],
  glossary: {}, bibliography: {}, entries: {}, mentioned_in: [],
};
const TRIAL = { slug: 'buehrle-trial', name: 'Bührle trial', kind: 'trial', period: yr('1970-01-01', '1970-12-31', '1970'),
  place: { slug: 'lausanne', name: 'Lausanne' }, part_of: null, image_url: null, country: null, polities: [], names: [], location: null };

test('an event page: date, place, parts, participants with their role, what it concerns, works depicting it, its area', async ({ page }) => {
  await page.route(/\/v1\/events\/great-fire-of-meireki$/, (r) => r.fulfill({ json: FIRE }));
  await page.goto('/events/great-fire-of-meireki');
  await expect(page.locator('h1')).toHaveText('Great Fire of Meireki');
  await expect(page.locator('.subtitle')).toHaveText('fire · 2 March–4 March 1657 · Edo');
  await expect(page.locator('.facts')).toContainText('2 March–4 March 1657');
  await expect(page.locator('.facts a[href="/places/edo"]')).toBeVisible();
  await expect(page.locator('.event-parts a[href="/events/first-day"]')).toBeVisible();
  const participants = page.locator('.rel-group', { has: page.getByRole('heading', { name: 'Participants' }) });
  await expect(participants).toContainText('Some Official (fire commissioner)');
  await expect(participants.locator('.rel-label')).toHaveCount(0); // not "participants" on every row
  await expect(page.getByRole('heading', { name: 'What it concerns' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Works depicting it' })).toBeVisible();
  await expect(page.locator('#legend')).toContainText('the area it covered');
  await expect(page.locator('a.button-link', { hasText: 'Show on the map and timeline' })).toHaveAttribute('href', '/?from=1657&to=1657');
});

test('events list: cards with date and place, filter by kind', async ({ page }) => {
  const fireItem = { ...FIRE, location: null, relationships: undefined, parts: undefined };
  await page.route(/\/v1\/events\?/, (r) => r.fulfill({ json: { data: [fireItem, TRIAL], total: 2, limit: 500, offset: 0 } }));
  await page.goto('/events');
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.locator('.card', { hasText: 'Bührle trial' })).toContainText('Lausanne');
  await page.locator('#categories button', { hasText: 'trial' }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page).toHaveURL(/\/events\?kind=trial$/);
});

test('explore: an events layer that follows the time window, and events on the timeline', async ({ page }) => {
  await page.route(/\/v1\/map\/events$/, (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: FIRE.area, properties: { type: 'event', slug: FIRE.slug, name: FIRE.name, kind: 'fire', period: FIRE_PERIOD, place: { slug: 'edo', name: 'Edo' }, precision: 'area' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [6.63, 46.52] }, properties: { type: 'event', slug: TRIAL.slug, name: TRIAL.name, kind: 'trial', period: TRIAL.period, place: TRIAL.place, precision: 'place' } },
  ] } }));
  await page.goto('/?all');
  const toggle = page.locator('#events-toggle');
  await expect(toggle).toContainText('Events (2)');
  await expect(page.locator('#timeline')).toContainText('Bührle trial');
  await page.fill('input[name=from]', '1960');
  await page.fill('input[name=to]', '1980');
  await page.locator('.timeline-form button[type=submit]').click();
  await expect(toggle).toContainText('Events (1 in 1960–1980)');
  await toggle.locator('input').uncheck();
  await expect(page.locator('#timeline')).not.toContainText('Bührle trial');
});

test('full screen map: legend and layer switches come along, the button leaves it again', async ({ page }) => {
  await page.goto('/?all');
  await expect(page.locator('#map-status')).toContainText('places');
  const wrap = page.locator('.map-wrap');
  await page.click('.maplibregl-ctrl-fullscreen');
  // headless browsers may refuse the Fullscreen API; then MapLibre fills the window itself
  await expect.poll(() => wrap.evaluate((el) => document.fullscreenElement === el || el.classList.contains('maplibregl-pseudo-fullscreen'))).toBe(true);
  const box = (await page.locator('#map').boundingBox())!;
  expect(box.height).toBeGreaterThan(page.viewportSize()!.height * 0.5);
  await expect(wrap.locator('#legend .route-key').first()).toBeVisible();
  await page.click('.maplibregl-ctrl-shrink');
  await expect.poll(() => wrap.evaluate((el) => document.fullscreenElement === el || el.classList.contains('maplibregl-pseudo-fullscreen'))).toBe(false);
});

test('a prerendered page stays on screen until the app replaces it: no "Loading…" flash', async ({ page }) => {
  await page.route('**/artists/vincent-van-gogh', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace('<main id="app"></main>',
      '<main id="app"><article class="page" data-prerendered><h1>Vincent van Gogh</h1><p class="subtitle">prerendered</p></article></main>');
    await route.fulfill({ response: res, body });
  });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('#app .loading')) (window as unknown as { sawLoading: boolean }).sawLoading = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/artists/vincent-van-gogh');
  await expect(page.locator('.detail h1')).toHaveText('Vincent van Gogh');
  await expect(page.locator('.subtitle')).not.toHaveText('prerendered');
  expect(await page.evaluate(() => (window as unknown as { sawLoading?: boolean }).sawLoading ?? false)).toBe(false);
});

test('lists beyond 500 entries: the rest is fetched with offset, nothing is cut off', async ({ page }) => {
  let firstCount = 0;
  await page.route(/\/v1\/glossary\?limit=500$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    firstCount = body.data.length;
    await route.fulfill({ json: { ...body, total: firstCount + 1 } });
  });
  await page.route(/\/v1\/glossary\?limit=500&offset=\d+$/, (route) => route.fulfill({
    json: { data: [{ slug: 'zz-paged-term', name: 'Zz paged term', category: 'technique', definition: 'from the second page', image_url: null }], total: firstCount + 1, limit: 500, offset: firstCount },
  }));
  await page.goto('/glossary');
  await expect(page.locator('.card-name', { hasText: 'Zz paged term' })).toBeVisible();
  await expect(page.locator('#count')).toHaveText(`${firstCount + 1} entries`);
});

test('back to a list returns to where the reader was; a new page starts at the top', async ({ page }) => {
  await page.goto('/artworks');
  await expect(page.locator('.card').nth(10)).toBeVisible();
  const target = await page.evaluate(() => Math.min(800, document.documentElement.scrollHeight - innerHeight));
  expect(target).toBeGreaterThan(200);
  await page.mouse.wheel(0, target);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(target - 5);
  // a card in the middle of the screen (clicking a locator would first scroll it into view)
  await page.evaluate(() => ([...document.querySelectorAll<HTMLElement>('.card-link')]
    .find((a) => { const r = a.getBoundingClientRect(); return r.top > 100 && r.bottom < innerHeight; }))!.click());
  await expect(page.locator('.detail h1')).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.goBack();
  await expect(page.locator('.card').nth(10)).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(target - 5);
});

test('switching to dark keeps the page: only the base map changes, the overlays stay', async ({ page }) => {
  const errors = noErrors(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?all');
  await expect(page.locator('#map-status')).toContainText('places');
  type W = { __maps: { getStyle(): { layers: { id: string; paint?: unknown }[] } | undefined; hasImage(id: string): boolean }[] };
  const arrows = () => page.evaluate(() => (window as unknown as W).__maps.at(-1)!.hasImage('route-arrow'));
  const overlays = () => page.evaluate(() => (window as unknown as W).__maps.at(-1)!.getStyle()?.layers.filter((l) => /^(places|ov-)/.test(l.id)).length ?? 0); // no style while one loads
  // the base map's first layer (its background): another colour in the dark style
  const baseName = () => page.evaluate(() => JSON.stringify((window as unknown as W).__maps.at(-1)!.getStyle()?.layers[0].paint ?? null));
  await expect.poll(overlays).toBeGreaterThan(0);
  const before = { name: await baseName(), overlays: await overlays(), arrows: await arrows() };
  expect(before.arrows).toBe(true); // the start map has routes
  await page.fill('input[name=from]', '1890'); // typed, not yet applied: a re-render would lose it
  const toggle = page.locator('.theme-toggle');
  await toggle.click(); // light (no change from the system)
  await toggle.click(); // dark
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(baseName).not.toBe(before.name);
  await expect.poll(overlays).toBe(before.overlays);
  await expect.poll(arrows).toBe(before.arrows); // the routes' arrows are drawn again for the new style
  await expect(page.locator('input[name=from]')).toHaveValue('1890');
  expect(errors).toEqual([]);
});

test('accessibility: after a navigation the new heading has focus; skip link; the network without animation', async ({ page }) => {
  await page.goto('/artists');
  await expect(page.locator('.card').first()).toBeVisible();
  // first load: focus stays where the browser puts it
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
  await page.locator('.card-link').first().click();
  await expect(page.locator('.detail h1')).toBeFocused();

  await page.goto('/artists');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await expect(page.locator('.skip-link')).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#app h1')).toBeFocused();
  expect(page.url()).not.toContain('#app');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/graph/artists/vincent-van-gogh');
  await expect(page.locator('g.nodes a').first()).toBeVisible();
  // laid out at once: positions don't change any more
  const pos = () => page.evaluate(() => [...document.querySelectorAll('g.nodes a')].slice(0, 5).map((n) => n.getAttribute('transform')).join('|'));
  const first = await pos();
  await page.waitForTimeout(300);
  expect(await pos()).toBe(first);
});

test('timeline: changing the picks replaces its rows, zoom and half-typed years stay; none selected shows a note', async ({ page }) => {
  await page.goto('/?all');
  await expect(page.locator('.row-label').first()).toBeVisible();
  await page.locator('.timeline-svg').focus();
  await page.keyboard.press('+');
  const view = await page.locator('.timeline-view').textContent();
  expect(view).toContain('showing');
  await page.fill('input[name=from]', '1850'); // not applied
  const rows = await page.locator('.row-label').count();

  const movements = page.locator('details[data-group=movement]');
  await movements.locator('summary').click();
  await movements.locator('[data-act=none]').click();
  await expect.poll(() => page.locator('.row-label').count()).toBeLessThan(rows);
  await expect(page.locator('input[name=from]')).toHaveValue('1850');
  await expect(page.locator('.timeline-view')).toContainText('showing');

  for (const g of ['artist', 'artwork', 'polity', 'person']) {
    const d = page.locator(`details[data-group=${g}]`);
    await d.locator('summary').click();
    await d.locator('[data-act=none]').click();
  }
  if (await page.locator('#events-toggle').isVisible()) await page.locator('#events-toggle input').uncheck();
  await expect(page.locator('.timeline-empty')).toBeVisible();
  await expect(page.locator('.timeline-svg')).toBeHidden();
  if ((await movements.getAttribute('open')) === null) await movements.locator('summary').click();
  await movements.locator('[data-act=all]').click();
  await expect(page.locator('.timeline-svg')).toBeVisible();
  await expect(page.locator('input[name=from]')).toHaveValue('1850');
});

test('explore: the time window is named above the map; ✕ clears it', async ({ page }) => {
  await page.goto('/?artists=vincent-van-gogh&from=1888&to=1889');
  const chip = page.locator('#chips .chip');
  await expect(chip).toHaveText(/Time window 1888–1889/);
  await chip.click();
  await expect(page).not.toHaveURL(/from=/);
  await expect(page).toHaveURL(/artists=vincent-van-gogh/); // the picks stay
  await expect(page.locator('input[name=from]')).toHaveValue('');
  await expect(page.locator('#chips')).toBeHidden();
  await page.fill('input[name=from]', '1890');
  await page.fill('input[name=to]', '1890');
  await page.press('input[name=to]', 'Enter');
  await expect(chip).toHaveText(/Time window 1890/);
});
