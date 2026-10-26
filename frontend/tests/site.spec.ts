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
  await expect(page.locator('details.pick')).toHaveCount(7); // artists, artworks, movements, polities, people; museums and events (layers)
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
  // ticks every artwork one by one: five of them (with the whole collection it grew past any timeout, ~170 works)
  await page.route(/\/v1\/artworks\?/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const wood = body.data.filter((a: { kind: string | null }) => /wood/i.test(a.kind ?? '')).slice(0, 2);  // woodblock prints: "Type: …"
    const data = [...wood, ...body.data.filter((a: { slug: string }) => !wood.some((w: { slug: string }) => w.slug === a.slug)).slice(0, 3)];
    await route.fulfill({ response: res, json: { ...body, data, total: data.length } });
  });
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
  await expect(tab).toHaveURL(/\/artists\/\d+\/vincent-van-gogh$/, { timeout: 15_000 }); // a new tab loads slowly in a busy run
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

test('several images: the first large, the others as thumbnails that show it large; a server without CORS still shows its image', async ({ page }) => {
  const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${fill}"/></svg>`;
  await page.route(/wikimedia\.org/, (r) => r.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: svg('#3a6') }));
  // a museum's own image server without Access-Control-Allow-Origin: refused with crossorigin, served without it
  await page.route(/museum\.example\/img/, (r) => (r.request().headers().origin ? r.abort('failed') : r.fulfill({ contentType: 'image/svg+xml', body: svg('#c33') })));
  await patch(page, GREAT_WAVE, (b) => {
    const first = (b.images as Record<string, unknown>[])[0];
    b.images = [first,
      { url: 'https://museum.example/img/second.jpg', credit: 'Second credit', license: 'CC BY 4.0', caption: null, source_url: null },
      { ...first, credit: 'Third credit' }];
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const gallery = page.locator('.gallery-multi');
  await expect(gallery.locator('.gallery-item:visible')).toHaveCount(1);
  await expect(gallery.locator('.gallery-thumb')).toHaveCount(3);
  await gallery.locator('.gallery-thumb').nth(1).click();
  const shown = gallery.locator('.gallery-item:visible');
  await expect(shown).toContainText('Second credit');
  await expect.poll(() => shown.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect(shown.locator('img')).not.toHaveAttribute('crossorigin', /.*/);
  await expect(gallery.locator('.gallery-thumb').nth(1)).toHaveAttribute('aria-current', 'true');
});

test('enlarged image: the wheel zooms towards the pointer, dragging moves it, a click beside it closes', async ({ page }) => {
  // our own picture instead of Wikimedia's (a picture with a known size: throttled or placeholder images have none to zoom)
  await page.route(/wikimedia\.org/, (r) => r.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="860"><rect width="1280" height="860" fill="#3a6"/><circle cx="640" cy="430" r="300" fill="#fff"/></svg>' }));
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await page.click('.figure img');
  const stage = page.locator('dialog.lightbox[open] .lightbox-stage');
  const img = stage.locator('img');
  await expect(img).toBeVisible();
  await expect.poll(async () => (await stage.boundingBox())?.width ?? 0).toBeGreaterThan(200); // laid out, not only loaded
  const view = () => img.evaluate((el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return { s: m.a, x: m.e, y: m.f }; });
  const box = (await stage.boundingBox())!;
  // zoom in at the top left quarter: scale grows smoothly, that point stays put (so the image shifts up-left)
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 4);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await view()).s).toBeGreaterThan(2);
  // settled: the smooth zoom has arrived (two reads a moment apart agree)
  await expect.poll(async () => { const a = await view(); await page.waitForTimeout(150); const b = await view(); return a.s === b.s && a.x === b.x; }).toBe(true);
  const zoomed = await view();
  expect(zoomed.x).toBeLessThan(0);
  await expect(stage).toHaveClass(/zoomed/);
  // drag to the right and down: the image follows (within its edges)
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 4 + 60, box.y + box.height / 4 + 40, { steps: 5 });
  await page.mouse.up();
  const moved = await view();
  expect(moved.x).toBeGreaterThan(zoomed.x);
  await expect(page.locator('dialog.lightbox[open]')).toHaveCount(1); // a click on the image doesn't close
  // never off its edges, never below fit
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await view()).s).toBe(1);
  expect((await view()).x).toBe(0);
  // double click zooms, again fits; a click beside the image closes
  await stage.dblclick();
  await expect.poll(async () => (await view()).s).toBeGreaterThan(2);
  await page.mouse.click(5, box.y + box.height / 2);
  await expect(page.locator('dialog.lightbox')).toHaveCount(0);
});

test('list page: same field search as the pickers, a typo corrected', async ({ page }) => {
  await page.goto('/artworks');
  await expect(page.locator('.card').first()).toBeVisible();
  await page.fill('.filter', 'wood');
  await expect(page.locator('#count')).toContainText('match');
  await expect(page.locator('.card mark').first()).toHaveText(/wood/i);

  await page.goto('/artists');
  await page.fill('.filter', 'hokusia');
  // nothing as typed: the correction searched instead (API 113), not "similar names"
  await expect(page.locator('#count .query-fix')).toContainText('showing “Hokusai”');
  await expect(page.locator('#items')).toContainText('Hokusai');
});

test('list search ignores accents and special letters: "soren gross" finds Søren Groß, typed apostrophes d’Anvers', async ({ page }) => {
  await page.route(/\/v1\/artists\?/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (body.data?.length) Object.assign(body.data[0], { name: 'Søren Groß d’Anvers', sort_key: 'Gross' });
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/artists');
  await expect(page.locator('.card').first()).toBeVisible();
  for (const q of ['soren gross', "d'anvers", 'SØREN']) {
    await page.fill('.filter', q);
    await expect(page.locator('#items .card').first(), q).toContainText('Søren Groß');
  }
  await expect(page.locator('#items .card mark').first()).toHaveText('Søren');  // highlighted in the original spelling
  // the list's background name search may still be on its way through the route above: let it go
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('header search finds fields and typos', async ({ page }) => {
  await page.goto('/?all');
  const input = page.locator('.search-form input');
  await input.fill('zundert');
  await expect(page.locator('.search-results')).toContainText('Born in');
  await input.fill('hokusia');
  await expect(page.locator('.search-results')).toContainText('Hokusai');
  await input.press('ArrowDown');            // a hit chosen with the arrow keys: Enter opens it
  await input.press('Enter');
  await expect(page).toHaveURL(/\/(artists|artworks)\//);
});

test('back from an entry returns to the search it was opened from: search page, list, header', async ({ page }) => {
  await page.goto('/search');
  await page.fill('.search-page-form input', 'gauguin');
  await expect(page).toHaveURL(/\/search\?q=gauguin$/);
  await page.locator('#items .text-hit-name').first().click();
  await expect(page).not.toHaveURL(/\/search/);
  await page.goBack();
  await expect(page.locator('.search-page-form input')).toHaveValue('gauguin');
  await expect(page.locator('#items .text-hit').first()).toBeVisible();

  await page.goto('/artists');
  await expect(page.locator('.card').first()).toBeVisible();
  await page.fill('.filter', 'van gogh');
  await expect(page).toHaveURL(/\/artists\?q=van\+gogh$/);
  await page.locator('.card-link', { hasText: 'Vincent van Gogh' }).click();
  await expect(page.locator('h1')).toHaveText('Vincent van Gogh');
  await page.goBack();
  await expect(page.locator('.filter')).toHaveValue('van gogh');
  await expect(page.locator('#items .card').first()).toContainText(/van gogh/i);
  await expect(page.locator('#count')).toContainText('match');

  await page.goto('/?all');
  const input = page.locator('.search-form input');
  await input.fill('hokusai');
  await page.locator('.search-results [role=option] a').first().click();
  await expect(page).toHaveURL(/\/(artists|artworks)\//);
  await expect(input).toHaveValue('');
  await page.goBack();
  await expect(input).toHaveValue('hokusai');
  await expect(page.locator('.search-results [role=option]').first()).toBeVisible();
});

test('search page (087): Enter opens full-text search — names and texts, why it matched, the passage; by type; pages', async ({ page }) => {
  await page.goto('/?all');
  const input = page.locator('.search-form input');
  await input.fill('gauguin');
  await expect(page.locator('.search-results .hit-all')).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=gauguin$/);
  await expect(page.locator('main h1')).toHaveText('Search');
  await expect(page.locator('.search-page-form input')).toHaveValue('gauguin');
  const rows = page.locator('#items .text-hit');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first().locator('.text-hit-name')).toContainText('Gauguin');                 // the name ranks first
  await expect(rows.first().locator('.tag-matched')).toHaveText('name');
  await expect(page.locator('#items .text-hit-name[href$="/paul-gauguin"]')).toHaveAttribute('href', /^\/artists\/\d+\/paul-gauguin$/);
  // a match in a text: the passage with the words marked (escaped HTML from the API)
  await expect(page.locator('#items .text-hit', { has: page.locator('.tag-matched-text') }).first().locator('.text-hit-passage mark').first()).toBeVisible();
  // by type: the address follows; an older plural (?type=artworks) still works
  await page.locator('#types button', { hasText: 'Artworks' }).click();
  await expect(page).toHaveURL(/\/search\?q=gauguin&type=artwork$/);
  await expect(page.locator('#count')).toContainText('among artworks');
  expect(new Set(await page.locator('#items .text-hit .muted.small').allTextContents().then((t) => t.map((x) => x.split(' · ')[0])))).toEqual(new Set(['Artwork']));
  await page.goto('/search?q=gauguin&type=artworks');
  await expect(page.locator('#types button.on')).toHaveText('Artworks');
  // no pages: more results load while scrolling
  await page.goto('/search?q=painting');
  await expect(page.locator('#count')).toContainText(/^\d+ results/);
  const total = Number((await page.locator('#count').textContent())!.match(/^(\d+)/)![1]);
  expect(total).toBeGreaterThan(20);
  await expect(page.locator('#pager')).toHaveCount(0);
  await page.locator('#more').scrollIntoViewIfNeeded();
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(20);
  await expect(page).toHaveURL(/\/search\?q=painting$/);
});

test('searches read exclusions and plain words; a misspelt word is corrected (API 113)', async ({ page }) => {
  // list page: -word, and "but not in …" = the collection a work is in now — the reading shown
  await page.goto('/artworks');
  const filter = page.locator('.list-tools .filter');
  const cards = page.locator('#items .card');
  await expect(cards.first()).toBeVisible();
  // the number of matches as the count line says it — written in the same redraw as the list (counting cards while
  // the list is redrawn after typing races)
  const matched = async () => Number((await page.locator('#count').textContent())!.match(/^(\d+) of/)![1]);
  await filter.fill('gauguin');
  await expect(page.locator('#count')).toContainText(/^\d+ of \d+ match/);
  await expect(page.locator('#count .query-read')).toHaveCount(0);
  const all = await matched();
  expect(all).toBeGreaterThan(0);
  await filter.fill('gauguin but not in kunsthaus zürich');
  await expect(page.locator('#count .query-read')).toContainText('not in: kunsthaus zürich');
  expect(await matched()).toBeLessThan(all);
  await filter.fill('gauguin -kunsthaus');
  await expect(page.locator('#count .query-read')).toContainText('without: kunsthaus');
  expect(await matched()).toBeLessThan(all);
  // a typo: nothing found as typed → the correction, with a way back
  await filter.fill('hokusia');
  await expect(page.locator('#count .query-fix')).toContainText('showing “Hokusai”');
  await expect(cards.first()).toBeVisible();
  await page.locator('#count button[data-literal]').click();
  await expect(page.locator('#items')).toContainText('Nothing found for “hokusia”');
  // the search page: the same corrections
  await page.goto('/search?q=gaugin');
  await expect(page.locator('#count')).toContainText('nothing for “gaugin”');
  await expect(page.locator('#items .text-hit').first()).toContainText('Gauguin');
  await page.goto(`/search?q=${encodeURIComponent('gauguin but not in kunsthaus zürich')}&type=artwork`);
  await expect(page.locator('#count .query-read')).toContainText('not in: kunsthaus zürich');
});

test('search page: a hit in a provenance links to the artwork\'s provenance', async ({ page }) => {
  await page.goto('/search?q=confiscation');
  const hit = page.locator('#items .text-hit', { hasText: 'La Petite Irène' });
  await expect(hit.locator('.tag-matched')).toHaveText('provenance');
  // the passage marks every word that matched — with the synonyms (API 102) also "seized"
  await expect(hit.locator('.text-hit-passage mark', { hasText: /confiscation/i }).first()).toBeVisible();
  await expect(hit.locator('.text-hit-name')).toHaveAttribute('href', /^\/artworks\/100476\/irene-cahen-danvers-la-petite-irene\?hl=[^#]*confiscation[^#]*#provenance-\d+$/);
  await hit.locator('.text-hit-name').click();
  // the step outlined and in view, the matched word marked in it
  const step = page.locator('.provenance-step.search-target');
  await expect(step).toBeInViewport();
  await expect(step.locator('mark.search-hit', { hasText: /confiscation/i }).first()).toBeVisible();
});

test('search page: a hit in the texts opens the entry with the matched words marked, the first in view', async ({ page }) => {
  await page.goto('/search?q=arles&type=artist');
  const hit = page.locator('#items .text-hit', { hasText: 'Paul Gauguin' });
  await expect(hit.locator('.text-hit-name')).toHaveAttribute('href', /^\/artists\/100002\/paul-gauguin\?hl=arles$/);
  await hit.locator('.text-hit-name').click();
  const marks = page.locator('.detail-main mark.search-hit');
  await expect(marks.first()).toHaveText(/^arles$/i);
  await expect(marks.first()).toBeInViewport();
  // without ?hl= nothing is marked
  await page.goto('/artists/100002/paul-gauguin');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('mark.search-hit')).toHaveCount(0);
});

const IRENE = '/artworks/100476/irene-cahen-danvers-la-petite-irene';

test('provenance map: the first and last placed stop are marked; a destroyed work ends at its last known place (API 103)', async ({ page }) => {
  await page.goto('/artworks/100501/der-wanderer-uber-dem-nebelmeer');
  // step 1 (the artist) has no place: the map starts at the first known place; the last step still runs: today
  await expect(page.locator('.prov-start')).toHaveAttribute('data-cap', 'first known place');
  await expect(page.locator('.prov-end')).toHaveAttribute('data-cap', 'today');

  // the same work as if it had burnt in 1945: said under the title, in the facts, and on the map
  await page.route(/\/v1\/artworks\/(100501|der-wanderer-uber-dem-nebelmeer)(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.fate = { status: 'destroyed', label: 'destroyed', note: 'Burnt in a test fire',
      date: { label: '1945', from: '1945-01-01', to: '1945-12-31', from_year: 1945, to_year: 1945 } };
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  await expect(page.locator('.subtitle')).toContainText('destroyed 1945');
  await expect(page.locator('dt:has-text("Fate") + dd')).toContainText('destroyed 1945 — Burnt in a test fire');
  await expect(page.locator('.prov-end')).toHaveAttribute('data-cap', 'last known place');
});

test('how are they connected (088): pick any entry, the shortest chain top to bottom', async ({ page }) => {
  await page.goto(IRENE);
  const box = page.locator('#connect');
  // the full name: "van gogh" alone now also finds the letters, the museum, his family and his works first
  await box.locator('input').fill('vincent van gogh');
  await box.locator('.connect-hits button', { hasText: /^\s*Vincent van Gogh/ }).first().click();   // the artist, not a work of his
  const chain = box.locator('.net-path');
  await expect(chain.locator('.net-node').first()).toContainText('La Petite Irène');
  await expect(chain.locator('.net-node').last()).toContainText('Vincent van Gogh');
  expect(await chain.locator('.net-link').count()).toBeGreaterThan(0);
  await expect(chain.locator('.net-link .net-reads').first()).not.toBeEmpty();
  // not found: said so
  await page.route(/\/v1\/network\/path\?/, (r) => r.fulfill({ json: { from: null, to: null, found: false, length: null, steps: [] } }));
  await box.locator('input').fill('hokusai');
  await box.locator('.connect-hits button').first().click();
  await expect(box.locator('#connect-result')).toHaveText('No connection within 6 steps.');
});

test('through the same hands (088): grouped by holder, "at the same time", further ones folded; current holders on request', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => r.url().includes('/network/shared-hands') && asked.push(r.url()));
  await page.goto(IRENE);
  const sec = page.locator('#shared-hands');
  await expect(sec.locator('h2')).toHaveText('Through the same hands');
  const buhrle = sec.locator('.shared-hands > li', { has: page.locator('a', { hasText: 'Emil Georg Bührle' }) });
  await expect(buhrle).toContainText('also held by');
  await expect(buhrle.locator('.tag', { hasText: 'at the same time' })).toHaveCount(1); // once per holder, not per work
  await expect(buhrle.locator('details.hands-more summary')).toContainText(/^and \d+ more$/); // a long list folds
  await expect(sec.locator('details.shared-far summary')).toContainText(/^Further: \d+ works?/);
  await sec.locator('.shared-current input').check();
  await expect.poll(() => asked.some((u) => u.includes('current=1'))).toBe(true);
  await expect(sec.locator('.shared-current input')).toBeChecked();
});

test('through whose hands 1933–1945 (088): holders, possessors in red, handovers; the window adjustable', async ({ page }) => {
  await page.goto('/artworks');
  await page.locator('a', { hasText: 'Through whose hands, 1933–1945' }).click();
  await expect(page).toHaveURL(/\/provenance\/1933-1945$/);
  await expect(page.locator('h1')).toHaveText('Through whose hands, 1933–1945');
  const goring = page.locator('.hands-holders > li', { hasText: 'Hermann Göring' });
  await expect(goring).toHaveClass(/hands-flagged/);
  await expect(goring.locator('.tag-ns', { hasText: 'held without title' })).toBeVisible();
  await expect(goring.locator('.hands-works a', { hasText: 'La Petite Irène' })).toBeVisible();
  expect(await page.locator('.hands-handovers > li').count()).toBeGreaterThan(0);
  await page.fill('input[name=from]', '1900');
  await page.fill('input[name=to]', '1920');
  await page.locator('.hands-window button').click();
  await expect(page).toHaveURL(/\/provenance\/1900-1920$/);
  await expect(page.locator('h1')).toHaveText('Through whose hands, 1900–1920');
  await expect(page.locator('.hands-holders > li', { hasText: 'Hermann Göring' })).toHaveCount(0);
});

test('cite this version (089): the latest version with its exact moment; opening it shows the entry as recorded then', async ({ page }) => {
  await page.goto(IRENE);
  const box = page.locator('#cite-version');
  await expect(box.locator('h2')).toHaveText('Cite this version');
  const text = box.locator('.cite-version-text');
  await expect(text).toContainText('“Irène Cahen d\'Anvers (La Petite Irène).” Art History, no. 100476, version of ');
  // the moment exactly as the API gave it: microseconds
  await expect(text).toContainText(/https:\/\/arthistory\.piogino\.ch\/artworks\/100476\/irene-cahen-danvers-la-petite-irene\?as_of=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z/);
  // an earlier version, then open it
  const options = box.locator('select option');
  const n = await options.count();
  expect(n).toBeGreaterThan(2);
  await box.locator('select').selectOption(String(n - 2));
  const href = await box.locator('a', { hasText: 'Open this version' }).getAttribute('href');
  expect(href).toMatch(/\?as_of=\d{4}-.*\.\d{6}Z$/);
  await box.locator('a', { hasText: 'Open this version' }).click();
  const banner = page.locator('.asof-banner');
  await expect(banner).toContainText('As recorded on ');
  await expect(banner).toContainText(/\d+ changes since/);
  await expect(banner.locator('a', { hasText: 'see the current version' })).toHaveAttribute('href', '/artworks/100476/irene-cahen-danvers-la-petite-irene');
  await expect(page.locator('h1')).toHaveText("Irène Cahen d'Anvers (La Petite Irène)");
  await expect(page.locator('.facts dt', { hasText: 'Inventory number' })).toBeVisible(); // fields as stored then
  await banner.locator('a', { hasText: 'see the current version' }).click();
  await expect(page.locator('.asof-banner')).toHaveCount(0);
  await expect(page.locator('#cite-version h2')).toBeVisible();
});

test('versions: before the entry existed "not recorded yet then"; a bad date says why; a deleted entry says so', async ({ page }) => {
  await page.goto(`${IRENE}?as_of=2026-09-29`);
  await expect(page.locator('h1')).toHaveText('Not recorded yet then');
  await expect(page.locator('main')).toContainText('first recorded on 16 October 2026');
  await page.goto(`${IRENE}?as_of=2020-01-01`);
  await expect(page.locator('h1')).toHaveText('No such version');
  await expect(page.locator('main')).toContainText('the history begins on 2026-09-28');
  await page.route(/\/v1\/artworks\/100476\?as_of=/, async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    await r.fulfill({ response: res, json: { ...body, current: null, deleted: true } });
  });
  await page.goto(`${IRENE}?as_of=2026-10-16`);
  await expect(page.locator('.asof-banner')).toContainText('this entry no longer exists');
});

test('travel (091): under the provenance map, how far the work went over how many steps', async ({ page }) => {
  await page.goto(IRENE);
  await expect(page.locator('#legend #travel')).toHaveText(/^Travelled ≈ [\d,]+ km over \d+ of \d+ steps$/);
});

test('crossed paths (091): from the database on entry pages, "nearby" on request; the browser\'s own search as fallback and for places', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => r.url().includes('/map/encounters') && asked.push(r.url()));
  await page.goto('/artists/vincent-van-gogh');
  const sec = page.locator('#crossed');
  await sec.scrollIntoViewIfNeeded();
  await expect(sec.locator('li', { hasText: 'Paul Gauguin' })).toContainText('Arles');
  expect(asked.some((u) => u.includes('entity=artists%2Fvincent-van-gogh') || u.includes('entity=artists/vincent-van-gogh'))).toBe(true);
  await sec.locator('.crossed-nearby input').check();
  await expect.poll(() => asked.some((u) => u.includes('within_km=50'))).toBe(true);
  await expect(sec.locator('li', { hasText: 'km apart' }).first()).toContainText('nearby at the same time');
  // the API fails: the browser finds the same
  await page.route(/\/v1\/map\/encounters/, (r) => r.fulfill({ status: 500, json: { error: 'internal_error', message: 'down' } }));
  await page.goto('/artists/paul-gauguin');
  await page.locator('#crossed-anchor').scrollIntoViewIfNeeded();
  await expect(page.locator('#crossed li', { hasText: 'Vincent van Gogh' })).toContainText('Arles');
  // a place: the browser's search (the API has no place filter)
  asked.length = 0;
  await page.unroute(/\/v1\/map\/encounters/);
  await page.goto('/places/paris');
  await page.locator('#crossed-anchor').scrollIntoViewIfNeeded();
  await expect(page.locator('#crossed h2')).toHaveText('Crossed paths here');
  expect(asked).toEqual([]);
});

test('start map zoomed out (091): numbered bubbles of nearby places; a click zooms in; not with single picks', async ({ page }) => {
  await page.goto('/?all');
  const bubbles = page.locator('.map-cluster');
  await expect(bubbles.first()).toBeVisible();
  const zoom = () => page.evaluate(() => (window as unknown as { __maps: { getZoom(): number }[] }).__maps.at(-1)!.getZoom());
  const before = await zoom();
  const biggest = await bubbles.evaluateAll((els) => els.map((e) => Number(e.textContent!.replace(/,/g, ''))).indexOf(Math.max(...els.map((e) => Number(e.textContent!.replace(/,/g, ''))))));
  await expect(bubbles.nth(biggest)).toHaveAttribute('title', /stays at \d+ places: \S/);   // which city is biggest follows the data
  await bubbles.nth(biggest).click();
  await expect.poll(zoom).toBeGreaterThan(before + 1);
  // close in: the dots, no bubbles
  await page.evaluate(() => (window as unknown as { __maps: { jumpTo(o: object): void }[] }).__maps.at(-1)!.jumpTo({ center: [8.54, 47.37], zoom: 7 }));
  await expect(bubbles).toHaveCount(0);
  // single picks: their own dots and routes, never bubbles
  await page.goto('/?artists=vincent-van-gogh&artworks=none&movements=none&polities=none&people=none');
  await expect(page.locator('#map-status')).toContainText('chosen entries on the map');
  await expect(bubbles).toHaveCount(0);
});

test('prices: AFRF reads "French francs (before 1960)"', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    b.provenance = [step(0, { type: 'person', slug: 'a-buyer', name: 'A Buyer' }, { kind: 'step', in_chain: true, direct: true, price: { amount: 20000, currency: 'AFRF', note: null, chf_today: null } })];
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.provenance-step .provenance-how')).toContainText('20,000 French francs (before 1960)');
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
  await expect(page).toHaveURL(/\/artists\/\d+\/vincent-van-gogh$/); // and the canonical address (API 085)
});

test('public numbers (085): /<plural>/<number>/<slug> is the address; old slugs, renamed slugs and other types land there', async ({ page }) => {
  const irene = /\/artworks\/100476\/irene-cahen-danvers-la-petite-irene$/;
  // the number decides; the canonical address replaces the one typed
  await page.goto('/artworks/100476');
  await expect(page.locator('h1')).toContainText('Irène');
  await expect(page).toHaveURL(irene);
  // an old slug address (bookmarks, links from before 085)
  await page.goto('/artworks/irene-cahen-danvers-la-petite-irene');
  await expect(page).toHaveURL(irene);
  // an outdated slug after the number: the entry was renamed
  await page.goto('/artworks/100476/an-old-name?x=1#facts');
  await expect(page).toHaveURL(/\/artworks\/100476\/irene-cahen-danvers-la-petite-irene\?x=1#facts$/);
  // a number under the wrong type: the right type's page
  await page.goto('/people/100476');
  await expect(page).toHaveURL(irene);
  await expect(page.locator('.crumbs a')).toHaveText('Artworks');
  // links carry the numbers: relationships, provenance owners, list rows
  const louis = page.locator('.provenance a[href="/people/100481/louis-cahen-d-anvers"]').first();
  await expect(louis).toBeVisible();
  await louis.hover(); // a numbered link gets its preview like a slug one
  await expect(page.locator('.popover-entry')).toContainText("Louis Cahen d'Anvers");
  await page.goto('/artworks');
  await expect(page.locator('.card a[href="/artworks/100476/irene-cahen-danvers-la-petite-irene"]')).toBeVisible();
});

test('public numbers: an unknown number is "Not found"; back after the address was replaced returns to the list', async ({ page }) => {
  await page.goto('/artworks/999999999');
  await expect(page.locator('main')).toContainText(/not found|not_found/i);
  await page.goto('/artworks');
  await page.locator('.card a[href="/artworks/100476/irene-cahen-danvers-la-petite-irene"]').click();
  await expect(page.locator('h1')).toContainText('Irène');
  await page.goBack();
  await expect(page).toHaveURL(/\/artworks$/);
  await expect(page.locator('.card').first()).toBeVisible();
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

test('privacy page from the footer (the CMS page "privacy"); the site sets no cookies', async ({ page, context }) => {
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.figure img')).toBeVisible();
  await page.locator('.site-footer a', { hasText: 'Privacy' }).click();
  await expect(page.locator('h1')).toHaveText('Privacy');
  await expect(page.locator('article.text-page')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.text-page > h1 + p')).toContainText('Last updated');
  await expect(page.locator('.text-page table tbody tr').first()).toBeVisible();          // the services, from the page's Markdown table
  await expect(page.locator('main a[href="mailto:info@piogino.ch"]').first()).toBeVisible();
  expect(await context.cookies()).toEqual([]); // the image stand-in offers a cookie (fixtures.ts): it must be refused
});

test('start map: routes of the selection, a place lists what happened there', async ({ page }) => {
  // the place itself, not an event or a museum drawn on it (Paris has the 1878 World's Fair): both layers off
  await page.goto('/?events=none&institutions=none');
  await expect(page.locator('#map-status')).toContainText('Click a place to see what happened there');
  // the dev build exposes the map (window.__maps) so the test can click a known place
  await page.waitForFunction(() => {
    const m = (window as unknown as { __maps?: { getSource(id: string): unknown; querySourceFeatures(id: string): unknown[] }[] }).__maps?.at(-1);
    return !!m?.getSource('ov-routes') && m.querySourceFeatures('ov-routes').length > 0; // drawn, not just added
  });
  const routes = await page.evaluate(() => (window as unknown as { __maps: { querySourceFeatures(id: string): { properties: { name: string } }[] }[] }).__maps.at(-1)!
    .querySourceFeatures('ov-routes').map((f) => f.properties.name));
  expect(routes).toContain('Vincent van Gogh');
  await page.locator('.maplibregl-canvas').first().scrollIntoViewIfNeeded();
  const atRest = () => page.waitForFunction(() => {
    const m = (window as unknown as { __maps: { loaded(): boolean; isMoving(): boolean }[] }).__maps.at(-1)!;
    return m.loaded() && !m.isMoving();
  });
  await atRest();  // the layers redrawn
  await page.evaluate(() => (window as unknown as { __maps: { jumpTo(o: object): void }[] }).__maps.at(-1)!.jumpTo({ center: [2.35, 48.86], zoom: 6 }));
  await atRest();
  await page.waitForTimeout(500);
  const pt = await page.evaluate(() => {
    const m = (window as unknown as { __maps: { project(c: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement }[] }).__maps.at(-1)!;
    const p = m.project([2.3522, 48.8566]);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  const popup = page.locator('.maplibregl-popup:not(.hover-tip)');
  await expect(popup).toContainText('Paris');
  await expect(popup.locator('.popup-events a', { hasText: 'Vincent van Gogh' })).toBeVisible();
  await expect(popup).toContainText('lived in');
});

test('artwork map: the provenance in chain order — numbered stops, segments with steps passed over, unplaced steps', async ({ page }) => {
  await page.goto('/artworks/heiliger-sebastian');
  // Ulm (1: made where Weckmann worked), Frankfurt (2, 3), London (4), Zürich (6–9: Bührle, his estate, the
  // foundation, the loan to the Kunsthaus)
  const stops = page.locator('.prov-stop');
  await expect(stops).toHaveText(['1', '2, 3', '4', '6–9']);
  const legend = page.locator('#legend');
  await expect(legend).toContainText('numbered in the provenance\'s order');
  await expect(legend).not.toContainText('route, in date order'); // replaced, not drawn twice
  const unplaced = page.locator('#unplaced li'); // one per line, numbered with the step
  await expect(unplaced).toHaveCount(1);
  await expect(unplaced.nth(0)).toHaveAttribute('value', '5');
  await expect(unplaced.nth(0)).toContainText('Estate of Hedwig Frieda Ullmann');

  await stops.filter({ hasText: '6–9' }).click();
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText('steps 6–9 of 9');
  await expect(popup.locator('li')).toHaveCount(4);
  await expect(popup.locator('li').nth(1)).toContainText('Estate of Emil Georg Bührle');
  await expect(popup.locator('li').nth(3)).toContainText('at the institution\'s seat');
  await popup.locator('.maplibregl-popup-close-button').click();

  // the line London → Zürich passes over the estate in Frankfurt, whose place isn't recorded
  // (measured once the map has stopped moving: fitting the provenance animates, and a point taken during it is stale)
  await page.waitForFunction(() => {
    const m = (window as unknown as { __maps: { loaded(): boolean; isMoving(): boolean }[] }).__maps.at(-1)!;
    return m.loaded() && !m.isMoving();
  });
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

test('artwork map (077): a step with further places — a stop at each, the move between them solid', async ({ page }) => {
  const PARIS: [number, number] = [2.3522, 48.8566];
  await patch(page, /\/v1\/map\/artworks\/heiliger-sebastian$/, (b) => {
    const prov = b.provenance as { features: { geometry: { coordinates: unknown }; properties: Record<string, unknown> }[] };
    const london = prov.features.find((f) => f.properties.layer === 'provenance_stop' && f.properties.step === 4)!;
    const seg = prov.features.find((f) => f.properties.from_step === 4)!;
    const LONDON = london.geometry.coordinates;
    seg.geometry.coordinates = [PARIS, (seg.geometry.coordinates as unknown[])[1]];
    const at = prov.features.indexOf(london) + 1;
    prov.features.splice(at, 0, { geometry: { type: 'Point', coordinates: PARIS } as never,
      properties: { ...london.properties, part: 1, part_label: '1938', place: { slug: 'paris', name: 'Paris' } } } as never);
    prov.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [LONDON, PARIS] },
      properties: { layer: 'provenance_segment', from_step: 4, to_step: 4, move: true, direct: true, implied: false, between: [] } } as never);
  });
  await page.goto('/artworks/heiliger-sebastian');
  const stops = page.locator('.prov-stop');
  await expect(stops).toHaveText(['1', '2, 3', '4', '4', '6–9']);
  await stops.nth(3).click();   // the second "4": Paris
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText('Paris');
  await expect(popup.locator('.tag', { hasText: 'moved here' })).toBeVisible();
  await expect(popup).toContainText('1938');
  await popup.locator('.maplibregl-popup-close-button').click();

  await page.waitForFunction(() => !!(window as unknown as { __maps: { getLayer(id: string): unknown }[] }).__maps.at(-1)!.getLayer('prov-hit'));
  // measured once the map is at rest (the popup pans it; a point taken while it moves is stale) — and again until drawn
  const atRest = () => page.waitForFunction(() => {
    const m = (window as unknown as { __maps: { loaded(): boolean; isMoving(): boolean }[] }).__maps.at(-1)!;
    return m.loaded() && !m.isMoving();
  });
  const measure = async () => { await atRest(); return page.evaluate(async (paris) => {
    type M = { project(c: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement;
      queryRenderedFeatures(p: [number, number], o: { layers: string[] }): unknown[] };
    const m = (window as unknown as { __maps: M[] }).__maps.at(-1)!;
    const fc = await (await fetch('/v1/map/artworks/heiliger-sebastian')).json();
    const london = fc.provenance.features.find((f: { properties: { step?: number } }) => f.properties.step === 4).geometry.coordinates;
    const [a, b] = [london, paris].map((c: [number, number]) => m.project(c));
    const mid: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + mid[0], y: r.top + mid[1], solid: m.queryRenderedFeatures(mid, { layers: ['prov-direct'] }).length };
  }, PARIS); };
  await expect.poll(async () => (await measure()).solid).toBeGreaterThan(0);
  const hit = await measure();
  await page.mouse.click(hit.x, hit.y);
  await expect(popup).toContainText('step 4');
  await expect(popup).toContainText('London → Paris');
  await expect(popup).toContainText('moved by the same holder');
});

test('start map: a chosen artwork shows its provenance as on its own page, in its colour', async ({ page }) => {
  await page.goto('/?artworks=heiliger-sebastian');
  const stops = page.locator('.prov-stop');
  await expect(stops).toHaveText(['1', '2, 3', '4', '6–9']);
  expect(await stops.first().evaluate((el) => el.style.getPropertyValue('--pc'))).not.toBe(''); // the selection's colour
  const legend = page.locator('#legend');
  await expect(legend).toContainText('in the provenance\'s order');
  await expect(legend.locator('.unplaced li')).toHaveCount(1);
  await stops.filter({ hasText: /^4$/ }).click();
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText('Heiliger Sebastian'); // named: several entries can be on the map
  await expect(popup).toContainText('Arthur Kauffmann');
  await expect(popup).toHaveCount(1); // not also the popup of a dot underneath
  // a time window shows presence, with the provenance's steps dated in the window numbered as in the chain
  // (4 London 1938–1954, 6–8 Zürich) and the route through them in the chain's order — one line London → Zürich
  await page.fill('input[name=from]', '1950');
  await page.fill('input[name=to]', '1960');
  await page.press('input[name=to]', 'Enter');
  await expect(page.locator('#chips .chip')).toHaveText(/Time window 1950–1960/);
  await expect(stops).toHaveText(['4', '6–8']);  // 2, 3 end before the window, 9 starts after it
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
  // the provenances come after the first drawing (one request for all): the legend names them when they are drawn
  await expect(page.locator('#legend')).toContainText('artworks: their provenance in its order', { timeout: 30000 });
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
  const more = page.locator('#legend [data-legend-all]'); // the first 12 routes are named, the rest behind "+ N more"
  if (await more.count()) await more.click();
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
  // the first six are shown; more data puts others first — open the whole list
  await list.locator('[data-crossed-all]').click();
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
  await expect(page).toHaveURL(/\/people\/(\d+\/)?theo-van-gogh$/);   // the numbered address where the number is known (085)
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
  await expect(page.locator('.prov-stop')).toHaveText(['1', '2, 3', '4', '6–9']);
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
  // the legend names the first twelve routes A–Z ("+ 331 more"): which ones depends on the live data
  await expect(page.locator('#legend .route-key').first()).toBeVisible();
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
    b.sources = {};   // the live work's sources (the Met's, 2026-10-22) would add their markers to the lines tested here
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
      { number: 'W 12', label: null, institution: null, source: { slug: 'rewald-1996', name: 'Rewald 1996' },
        sources: [cited({ kind: 'text', reliability: null, text: 'Lugt, Marques de collections' })] },  // a number's own sources (API 081)
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
  await expect(facts.locator('dt', { hasText: 'Catalogue no.' }).locator('+ dd .cite-ref')).toHaveText('T');
  await expect(facts.locator('dt', { hasText: 'Rewald (catalogue raisonné)' }).locator('+ dd .cite-ref')).toHaveCount(0);
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

test('a creation span says what it means (API 135): worked on over the years, or made at some point in them', async ({ page }) => {
  await patch(page, GREAT_WAVE, (b) => {
    b.sources = {};
    b.created = year(1916, 1918);
    b.conceived = null;
    b.created_span = 'duration';
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const date = page.locator('.facts dt', { hasText: 'Date' }).locator('+ dd');
  await expect(date).toHaveText('1916–1918 (worked on over these years)');
  await patch(page, GREAT_WAVE, (b) => {
    b.sources = {};
    b.created = year(1916, 1918);
    b.conceived = null;
    b.created_span = 'uncertain';
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(date).toHaveText('1916–1918 (made at some point in these years)');
});

test('provenance (074): agents and custodians held alongside the owner, not sold, via, settlement; status A–D; design date', async ({ page }) => {
  const inst = (slug: string, name: string) => ({ type: 'institution', slug, name });
  await patch(page, GREAT_WAVE, (b) => {
    b.sources = {};   // as above: no markers of the live work's sources on the lines tested here
    b.created = year(1921);
    b.conceived = year(1893, 1894);
    b.kind = 'woodcut';
    b.provenance_status = { category: 'D', code: 'd_seized', label: 'looted art / seized as a result of Nazi persecution', note: 'NS-verfolgungsbedingt entzogenes Kulturgut' };
    b.sources = { ...(b.sources as object), provenance_status: [cited({ kind: 'text', reliability: null, text: 'Museum record' })] };
    b.provenance = [
      step(0, { type: 'person', slug: 'first-owner', name: 'First Owner' }, { kind: 'step', in_chain: true, period: year(1920, 1937), end_basis: 'recorded' }),
      step(1, inst('an-auction-house', 'An Auction House'), { kind: 'step', role: 'agent', method: 'auction', in_chain: false, not_sold: true, direct: true, period: year(1933) }),
      step(2, inst('galerie-moos', 'Galerie Moos'), { kind: 'step', role: 'agent', method: 'auction', in_chain: false, direct: true, period: year(1937) }),
      step(3, { type: 'person', slug: 'second-owner', name: 'Second Owner' }, { kind: 'step', method: 'forced_sale', in_chain: true, via: 'Galerie Moos', direct: true,
        period: year(1937, 2025), end_basis: 'implied' }),
      step(4, { type: 'person', slug: 'second-owner', name: 'Second Owner' }, { kind: 'step', method: 'settlement', in_chain: true, direct: true, period: year(2025, null), end_basis: 'ongoing' }),
    ];
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.facts dt', { hasText: 'Date' }).locator('+ dd')).toHaveText('designed 1893–1894, printed 1921');
  const status = page.locator('.provenance .provenance-status');
  await expect(status.locator('.prov-badge')).toHaveText('D');
  await expect(status).toContainText('looted art / seized as a result of Nazi persecution');
  await expect(status).toContainText('NS-verfolgungsbedingt entzogenes Kulturgut');
  await expect(status.locator('.cite-ref')).toHaveCount(1); // its sources here, not as a fact row
  await expect(page.locator('.facts dt', { hasText: /Provenance status/i })).toHaveCount(0);

  const steps = page.locator('.provenance-step');
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(1)).toHaveClass(/custody/);
  await expect(steps.nth(1).locator('.provenance-owner')).toContainText('held by An Auction House');
  await expect(steps.nth(1).locator('.tag', { hasText: 'not sold' })).toBeVisible();
  await expect(steps.nth(2)).toHaveClass(/custody/);
  await expect(steps.nth(2).locator('.tag', { hasText: 'not sold' })).toHaveCount(0);
  const indent = async (i: number) => steps.nth(i).locator('.provenance-owner').evaluate((el) => el.getBoundingClientRect().left);
  expect(await indent(1)).toBeGreaterThan(await indent(0)); // indented, not a new owner
  await expect(steps.nth(3)).not.toHaveClass(/custody/);
  await expect(steps.nth(3).locator('.provenance-how')).toContainText('forced sale · via Galerie Moos');
  await expect(steps.nth(4).locator('.provenance-how .explained')).toHaveText('settlement');
});

test('provenance (077): events as notes, theft, publisher / trustee, further places, numbers, event links, RM', async ({ page }) => {
  const person = (slug: string, name: string) => ({ type: 'person', slug, name });
  await patch(page, GREAT_WAVE, (b) => {
    b.provenance = [
      step(0, { type: 'institution', slug: 'a-publisher', name: 'A Publisher' }, { kind: 'step', role: 'publisher', in_chain: true, direct: true, period: year(1831, 1900), end_basis: 'recorded' }),
      step(1, person('first-owner', 'First Owner'), { kind: 'step', in_chain: true, direct: true, period: year(1900, 1950), end_basis: 'recorded',
        place: { slug: 'cologne', name: 'Köln' },
        further_places: [{ slug: 'berlin', name: 'Berlin', period: year(1933) }, { slug: 'geneva', name: 'Geneva', period: null }],
        price: { amount: 4500, currency: 'RM', note: null },
        numbers: [{ kind: 'munich', label: 'Munich no.', number: '4317', id: 71, shared: 2 }, { kind: 'lugt', label: 'Lugt', number: '1234a', id: 72, shared: 0 }] }),
      step(2, null, { kind: 'step', role: 'custodian', method: 'theft', in_chain: false, direct: true, owner_label: 'Unknown thieves', owner_name: 'Unknown thieves',
        period: year(1940, 1945), ended: year(1945), end_basis: 'recorded' }),
      step(3, { type: 'institution', slug: 'a-bank', name: 'A Bank' }, { kind: 'step', role: 'trustee', method: 'unknown', in_chain: false, direct: true, period: year(1946) }),
      step(4, person('first-owner', 'First Owner'), { kind: 'step', role: 'event', method: 'claim', in_chain: false, direct: true,
        label: 'settlement between First Owner and the heirs', period: year(1949), event: { slug: 'a-trial', name: 'A Trial' } }),
      step(5, person('second-owner', 'Second Owner'), { kind: 'step', method: 'auction', in_chain: true, direct: true, period: year(1950, null), end_basis: 'ongoing',
        event: { slug: 'an-auction', name: 'An Auction' } }),
    ];
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const steps = page.locator('.provenance-step');
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(0).locator('.tag', { hasText: 'publisher' })).toBeVisible();
  await expect(steps.nth(0)).not.toHaveClass(/custody/); // an edition's publisher is of the chain
  const how1 = steps.nth(1).locator('.provenance-how');
  await expect(how1).toContainText('in Köln → Berlin (1933) → Geneva');
  await expect(how1.locator('a[href="/places/geneva"]')).toBeVisible();
  await expect(how1).toContainText('4,500 RM');
  await expect(how1).toContainText('Munich no. 4317');
  await expect(how1).toContainText('Lugt 1234a');
  // linked only when other works share it (API 113), to that number's series
  await expect(how1.locator('a', { hasText: '4317' })).toHaveAttribute('href', '/provenance-numbers?number=4317&kind=munich&of=n71');
  await expect(how1.locator('a', { hasText: '4317' })).toHaveAttribute('title', 'Also recorded for 2 other works');
  await expect(how1.locator('a', { hasText: '1234a' })).toHaveCount(0);
  await expect(steps.nth(2)).toHaveClass(/custody/);
  await expect(steps.nth(2).locator('.provenance-how')).toContainText('stolen — recovered 1945');
  await expect(steps.nth(2).locator('.provenance-owner')).toContainText('taken by Unknown thieves');
  await expect(steps.nth(2).locator('.tag')).toHaveCount(0);
  await expect(steps.nth(3)).toHaveClass(/custody/);
  await expect(steps.nth(3).locator('.tag', { hasText: 'trustee' })).toBeVisible();
  // the event: a note on the rail, not a holder
  await expect(steps.nth(4)).toHaveClass(/provenance-event/);
  await expect(steps.nth(4).locator('.provenance-owner')).toHaveCount(0);
  await expect(steps.nth(4).locator('.provenance-event-line')).toContainText('• settlement between First Owner and the heirs');
  await expect(steps.nth(4).locator('a[href="/events/a-trial"]')).toBeVisible();
  await expect(steps.nth(5)).not.toHaveClass(/undocumented/);
  await expect(steps.nth(5).locator('.provenance-how')).toContainText('auction · at An Auction');
  await expect(steps.nth(5).locator('a[href="/events/an-auction"]')).toBeVisible();
});

test('provenance numbers: a number links to every work recording it; the header search offers the lookup', async ({ page }) => {
  const asked: string[] = [];
  await page.route(/\/v1\/provenance-numbers\?/, (r) => {
    asked.push(new URL(r.request().url()).search);
    return r.fulfill({ json: { data: [
      { kind: 'munich', kind_label: 'Munich no.', number: '4317', artwork: { slug: 'the-great-wave-off-kanagawa', title: 'The Great Wave off Kanagawa' },
        position: 1, owner_name: 'First Owner', period: year(1900, 1950) },
    ] } });
  });
  await page.goto('/provenance-numbers?number=4317&kind=munich');
  await expect(page.locator('h1')).toHaveText('Provenance numbers');
  await expect(page.locator('#number-count')).toContainText('1 step records Munich no. “4317”');
  await expect(page.locator('.number-hits li')).toContainText('Munich no. 4317');
  await expect(page.locator('.number-hits a[href="/artworks/the-great-wave-off-kanagawa"]')).toBeVisible();
  expect(asked[0]).toContain('kind=munich');

  await page.goto('/artists');
  await page.fill('.search-form input', '4317');
  const lookup = page.locator('.search-results .hit-number a');
  await expect(lookup).toContainText('“4317” as a provenance number');
  await lookup.click();
  await expect(page).toHaveURL(/\/provenance-numbers\?number=4317$/);
  await expect(page.locator('.number-hits li')).toHaveCount(1);
});

test('provenance (083/084): possessors held without title, exchanged for, another reading under its step', async ({ page }) => {
  const person = (slug: string, name: string) => ({ type: 'person', slug, name });
  await patch(page, GREAT_WAVE, (b) => {
    b.provenance = [
      step(0, person('the-owner', 'The Owner'), { kind: 'step', in_chain: true, direct: true, period: year(1900, 1946), end_basis: 'recorded',
        alternatives: [{ owner: person('her-daughter', 'Her Daughter'), owner_label: null, role: 'owner', method: 'gift', acquired: year(1926), ended: null,
          label: 'a gift, says the family', certainty: 'disputed', notes_html: null, sources: [cited({ kind: 'text', reliability: null, text: 'A letter' })] }] }),
      step(1, { type: 'institution', slug: 'the-err', name: 'The ERR' }, { kind: 'step', role: 'possessor', method: 'confiscation', in_chain: false, direct: true, period: year(1941) }),
      step(2, person('a-dealer', 'A Dealer'), { kind: 'step', role: 'possessor', method: 'exchange', in_chain: false, direct: true, period: year(1942, 1945),
        exchanged_for: { artwork: { slug: 'heiliger-sebastian', title: 'Heiliger Sebastian' }, text: null } }),
      step(3, person('the-owner', 'The Owner'), { kind: 'step', method: 'restitution', in_chain: true, direct: true, period: year(1946, null), end_basis: 'ongoing' }),
    ];
    (b.relationships as unknown[]).push({ type: 'exchanged_for', direction: 'outgoing', label: 'exchanged for', category: 'provenance', is_physical_presence: false,
      entity: { type: 'artwork', slug: 'heiliger-sebastian', name: 'Heiliger Sebastian' }, period: year(1942), note: null, certainty: 'attested', notes_html: null, derived: true, end_basis: null });
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const steps = page.locator('.provenance-step');
  await expect(steps).toHaveCount(4);
  // the possessors: indented, marked, never an owner
  await expect(steps.nth(1)).toHaveClass(/custody/);
  await expect(steps.nth(1)).toHaveClass(/possession/);
  await expect(steps.nth(1).locator('.provenance-owner')).toContainText('taken by The ERR');
  await expect(steps.nth(1).locator('.tag', { hasText: 'without title' })).toBeVisible();
  await expect(steps.nth(2).locator('.provenance-owner')).toContainText('held by A Dealer');
  const how = steps.nth(2).locator('.provenance-how');
  await expect(how).toHaveText('exchanged for Heiliger Sebastian'); // not "Exchange · exchanged for …"
  await expect(how.locator('a[href="/artworks/heiliger-sebastian"]')).toBeVisible();
  await expect(steps.nth(3)).not.toHaveClass(/custody/);
  // the other reading: inside its step, with its own sources and certainty
  const alt = steps.nth(0).locator('.provenance-alt');
  await expect(alt).toHaveCount(1);
  await expect(alt).toContainText('Another reading (sources disagree): Her Daughter');
  await expect(alt).toContainText('1926');
  await expect(alt.locator('.tag', { hasText: 'disputed' })).toBeVisible();
  await expect(alt.locator('.provenance-how')).toContainText('gift · a gift, says the family');
  await expect(alt.locator('.cite-ref')).toHaveCount(1);
  // the exchange is in the step, not repeated below
  await expect(page.locator('.rel-list li', { hasText: 'Heiliger Sebastian' })).toHaveCount(0);
});

test('a possessor’s page: works it held without title say so', async ({ page }) => {
  await page.goto('/people/hermann-goring');
  const irene = page.locator('.rel-holdings > ul > li', { hasText: 'La Petite Irène' });
  await expect(irene.locator('.tag', { hasText: 'held without title' })).toBeVisible();
  await expect(irene.locator('.tag', { hasText: 'held, not owned' })).toHaveCount(0);
});

test('what the dates imply (086): derived lines under their step; the distance travelled labels the segment and the stop', async ({ page }) => {
  const travelled = { kind: 'travelled', text: 'Hedwig Frieda Ullmann was in Frankfurt then: the work travelled to London, ≈ 640 km', period: null, km: 640 };
  await patch(page, /\/v1\/artworks\/heiliger-sebastian$/, (b) => {
    const steps = b.provenance as Record<string, unknown>[];
    const kauffmann = steps.find((st) => st.position === 2)!;
    kauffmann.inferences = [
      { kind: 'narrowed', text: 'from Hedwig Frieda Ullmann during her lifetime — by 3 May 1935 at the latest', period: { label: null, from: '1933-01-01', to: '1935-05-03', from_year: 1933, to_year: 1935 }, km: null },
      travelled,
    ];
  });
  await page.goto('/artworks/heiliger-sebastian');
  const step = page.locator('.provenance-step', { hasText: 'Arthur Kauffmann' }).first();
  const derived = step.locator('.provenance-inference');
  await expect(derived).toHaveCount(2);
  await expect(derived.nth(0).locator('.tag-derived')).toHaveText('derived');
  await expect(derived.nth(0).locator('i')).toHaveText(/by 3 May 1935 at the latest$/);
  await expect(derived.nth(1)).toContainText('the work travelled to London, ≈ 640 km');
  // the map: "≈ 640 km" on the segment into that step (Frankfurt → London), the inference in London's popup
  const km = page.locator('.prov-km');
  await expect(km).toHaveCount(1);
  await expect(km).toHaveText('≈ 640 km');
  await expect(km).toHaveAttribute('title', /^Derived: .*travelled to London/);
  await page.locator('.prov-stop', { hasText: /^4$/ }).click();
  await expect(page.locator('.maplibregl-popup .popup-derived')).toHaveCount(2);
  await expect(page.locator('.maplibregl-popup .popup-derived', { hasText: 'travelled to London' })).toBeVisible();
});

const span = (from: string, to: string) => ({ label: null, from, to, from_year: Number(from.slice(0, 4)), to_year: Number(to.slice(0, 4)) });
const seg = (kind: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({ kind, period: span(from, to), in_1933_1945: false,
  before: null, after: null, candidates: [], before_position: null, after_position: null, ...extra });

test('provenance coverage (078): a bar from the creation until today, gap lines after their step, 1933–1945 marked', async ({ page }) => {
  const person = (slug: string, name: string) => ({ type: 'person', slug, name });
  await patch(page, GREAT_WAVE, (b) => {
    b.provenance = [
      step(0, person('first-owner', 'First Owner'), { kind: 'step', in_chain: true, direct: true, period: year(1900, 1928), end_basis: 'recorded' }),
      step(1, person('maybe-owner', 'Maybe Owner'), { kind: 'step', in_chain: true, direct: false }),
      step(2, person('second-owner', 'Second Owner'), { kind: 'step', in_chain: true, direct: false, period: year(1947, null), end_basis: 'ongoing' }),
    ];
    b.provenance_coverage = {
      documented_percent: 60, has_provenance: true, gap_years: 18.2, gap_1933_1945_years: 12.3,
      segments: [
        seg('presumed', '1831-01-01', '1899-12-31'),
        seg('documented', '1900-01-01', '1928-12-31'),
        seg('gap', '1929-01-01', '1946-12-31', { in_1933_1945: true, before: 'First Owner', after: 'Second Owner', candidates: ['Maybe Owner'], before_position: 0, after_position: 2 }),
        seg('documented', '1947-01-01', '2026-10-15'),
      ],
    };
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const bar = page.locator('.provenance .coverage-bar');
  await expect(bar.locator('.coverage-seg')).toHaveCount(4);
  await expect(bar.locator('.coverage-seg.presumed')).toHaveCount(1);
  const gap = bar.locator('.coverage-seg.gap');
  await expect(gap).toHaveClass(/ns/);
  await expect(gap).toHaveAttribute('title', /Gap 1929–1946: no holder known \(after First Owner, before Second Owner\)\. Possibly: Maybe Owner/);
  await expect(bar.locator('.coverage-ns')).toHaveCount(1);
  await expect(page.locator('.coverage figcaption')).toContainText('60% documented, gaps 18 years, 12 of them in 1933–1945');
  // the documented stretch from 1900 to 1928 starts about a third of the way along (1831 → 2026)
  const box = await bar.boundingBox();
  const doc = await bar.locator('.coverage-seg.documented').first().boundingBox();
  expect((doc!.x - box!.x) / box!.width).toBeGreaterThan(0.3);
  expect((doc!.x - box!.x) / box!.width).toBeLessThan(0.4);

  const items = page.locator('.provenance-list > li');
  await expect(items).toHaveCount(4);
  await expect(items.nth(1)).toHaveClass(/provenance-gap-line/); // after the step at position 0
  await expect(items.nth(1)).toHaveClass(/ns/);
  await expect(items.nth(1)).toContainText('Gap 1929–1946 — no holder known · possibly Maybe Owner');
  await expect(items.nth(1).locator('.tag-ns')).toHaveText('1933–1945');
  await expect(items.nth(2).locator('.provenance-gap')).toHaveCount(0); // the gap line says it already
  await expect(items.nth(3).locator('.provenance-gap')).toHaveText('handover not documented');
});

test('artwork map (078): a "?" with the years mid-segment, red in 1933–1945; the gaps listed under the map', async ({ page }) => {
  const g = { period: span('1934-01-02', '1946-12-30'), in_1933_1945: true, before: 'Alfred Gold', after: 'Arthur Byron', candidates: ['Arthur Jeffress'] };
  await patch(page, /\/v1\/map\/artworks\/heiliger-sebastian$/, (b) => {
    const prov = b.provenance as { features: { properties: Record<string, unknown> }[]; gaps?: unknown[] };
    prov.features.find((f) => f.properties.from_step === 4)!.properties.gaps = [g];
    prov.gaps = [g, { ...g, period: span('1899-01-01', '1912-12-31'), in_1933_1945: false, candidates: [] }];
  });
  await page.goto('/artworks/heiliger-sebastian');
  const marker = page.locator('.prov-gap:not(.prov-gap-key)', { hasText: '1934–1946' });   // (the live data has gaps of its own)
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveText('? 1934–1946');
  await expect(marker).toHaveClass(/ns/);
  await marker.click();
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText('Gap 1934–1946 — no holder known · possibly Arthur Jeffress');
  await expect(popup).toContainText('after Alfred Gold, before Arthur Byron');
  const list = page.locator('#gaps li');
  await expect(list).toHaveCount(2);
  await expect(list.nth(0)).toHaveClass(/ns/);
  await expect(list.nth(1)).toContainText('Gap 1899–1912 — no holder known');
});

test('artworks list: "Works with open questions 1933–1945", also with a category', async ({ page }) => {
  await patch(page, /\/v1\/artworks\?/, (b) => {
    for (const a of b.data as Record<string, unknown>[]) {
      const wave = a.slug === 'the-great-wave-off-kanagawa';
      a.provenance_category = wave || a.slug === 'heiliger-sebastian' ? 'C' : null;
      a.provenance_coverage = { documented_percent: wave ? 40 : 100, has_provenance: true, gap_1933_1945: wave };
    }
  });
  await page.goto('/artworks');
  const toggle = page.locator('#gap-filter button');
  await expect(toggle).toContainText('Works with open questions 1933–1945 1');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/artworks\?provenance_gap=1933-1945$/);
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('#categories button', { hasText: 'C · indications' }).click();
  await expect(page).toHaveURL(/\?provenance=C&provenance_gap=1933-1945$/);
  await expect(page.locator('.card')).toHaveCount(1);
  await toggle.click();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.goto('/artworks?provenance_gap=1933-1945');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('The Great Wave');
});

test('artworks list: a filter by the 1933–1945 provenance category', async ({ page }) => {
  await patch(page, /\/v1\/artworks\?/, (b) => {
    for (const a of b.data as Record<string, unknown>[]) a.provenance_category = a.slug === 'the-great-wave-off-kanagawa' ? 'D' : null;
  });
  await page.goto('/artworks');
  const filter = page.locator('#categories');
  await expect(filter).toContainText('Provenance 1933–1945');
  await filter.locator('button', { hasText: 'D · looted / seized' }).click();
  await expect(page).toHaveURL(/\?provenance=D$/);
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('The Great Wave');
  await filter.locator('button', { hasText: 'All' }).click();
  await expect(page.locator('.card').nth(1)).toBeVisible();
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
  const museum = page.locator('.facts a[href^="/institutions/"][href$="/metropolitan-museum-of-art"]');
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

test('same institution at the same time: "could have met there"; the museum is linked, so "auto" shows it', async ({ page }) => {
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

// ---- series and other wholes (API migration 037): a mock series of its own (the live one has other parts) ----
const SERIES = { slug: 'mock-thirty-six-views', title: 'Thirty-six Views of Mount Fuji', kind: 'print series', parts_count: 36 };
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
  await page.route(/\/v1\/artworks\/mock-thirty-six-views$/, async (route) => {
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
  await page.route(/\/v1\/map\/artworks\/mock-thirty-six-views$/, (r) => r.fulfill({ json: { type: 'FeatureCollection', entity: { type: 'artwork', slug: SERIES.slug, name: SERIES.title }, features: [] } }));
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

test('versions of one composition (API 132): "Version 2 of 3 in …", the whole lists its versions', async ({ page }) => {
  const whole = { slug: 'mock-versions', title: 'The Bedroom', kind: 'versions', parts_count: 3, is_group: true };
  await page.route(/\/v1\/artworks\/the-great-wave-off-kanagawa$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    Object.assign(body, { part_of: [whole], part_number: '2', previous_part: { slug: 'south-wind-clear-sky', title: 'The Bedroom', part_number: '1' }, next_part: null, parts_count: null, parts: [] });
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.series-line')).toHaveText(/Version 2\s+of 3 in\s+The Bedroom/);
  await expect(page.locator('.part-nav .part-prev')).toContainText('Version 1');
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

async function sampleEvents(page: Page) {
  await page.route(/\/v1\/map\/events$/, (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: FIRE.area, properties: { type: 'event', slug: FIRE.slug, name: FIRE.name, kind: 'fire', period: FIRE_PERIOD, place: { slug: 'edo', name: 'Edo' }, precision: 'area' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [6.63, 46.52] }, properties: { type: 'event', slug: TRIAL.slug, name: TRIAL.name, kind: 'trial', period: TRIAL.period, place: TRIAL.place, precision: 'place' } },
  ] } }));
  const fireItem = { ...FIRE, location: null, relationships: undefined, parts: undefined };
  await page.route(/\/v1\/events\?/, (r) => r.fulfill({ json: { data: [fireItem, TRIAL], total: 2, limit: 500, offset: 0 } }));
}

test('explore: an events layer that follows the time window, and events on the timeline', async ({ page }) => {
  await sampleEvents(page);
  await page.goto('/?all');
  const key = page.locator('#events-toggle');
  await expect(key).toContainText(/Events \(2\b/);
  await expect(page.locator('#timeline')).toContainText('Bührle trial');
  await page.fill('input[name=from]', '1960');
  await page.fill('input[name=to]', '1980');
  await page.locator('.timeline-form button[type=submit]').click();
  await expect(key).toContainText('Events (1 in 1960–1980)');
  // the events picker: "auto" ticks what the window picked; None takes them off the map and the timeline
  const events = page.locator('details[data-group=event]');
  await events.locator('summary').click();
  await expect(events.locator('.pick-count')).toHaveText('auto · 1');
  await expect(events.locator('.pick-item', { hasText: 'Bührle trial' }).locator('input')).toBeChecked();
  await events.locator('[data-act=none]').click();
  await expect(key).toContainText('Events (0');
  await expect(page.locator('#timeline')).not.toContainText('Bührle trial');
  await expect(page).toHaveURL(/events=none/);
});

test('explore: events on "auto" follow the years of what is chosen; chosen works run on the timeline until today', async ({ page }) => {
  await sampleEvents(page);
  // Van Gogh alone: 1853–1890 — neither the fire of 1657 nor the trial of 1970
  await page.goto('/?artists=vincent-van-gogh&movements=none&polities=none&people=none&artworks=none');
  await expect(page.locator('#events-toggle')).toContainText('Events (0 in 1853–1890)');
  await expect(page.locator('#timeline')).not.toContainText('Bührle trial');
  // a work of his added: its bar runs until today, and with it the span — the trial of 1970 is in
  await page.goto('/?artists=vincent-van-gogh&movements=none&polities=none&people=none&artworks=by-artists');
  await expect(page.locator('#timeline')).toContainText('Artworks');
  await expect(page.locator('#events-toggle')).toContainText(/Events \(1 in 18\d\d–20\d\d\)/);
  await expect(page.locator('#timeline')).toContainText('Bührle trial');
  await expect(page.locator('#timeline')).not.toContainText('Great Fire of Meireki');
  // chosen by hand: the fire too, also outside the span
  await page.goto('/?artists=vincent-van-gogh&movements=none&polities=none&people=none&artworks=none&events=great-fire-of-meireki');
  await expect(page.locator('#events-toggle')).toContainText('Events (1)');
  await expect(page.locator('#timeline')).toContainText('Great Fire of Meireki');
});

test('explore: museums on "auto" are the ones linked to the map; in a time window only those that existed then', async ({ page }) => {
  await sampleVenues(page);
  await page.route(/\/v1\/map\/sites$/, (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: KH_POINT },
      properties: { type: 'institution', ...KUNSTHAUS, kind: 'museum', address: null, place: ZH, from_year: 1910, to_year: null } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.86] },
      properties: { type: 'institution', slug: 'musee-test', name: 'Musée Test', kind: 'museum', address: null, place: null, from_year: 1800, to_year: 1850 } },
  ] } }));
  await page.goto('/?all');
  await expect(page.locator('#sites-toggle')).toContainText('Museums and sites (1)'); // the Kunsthaus: a venue of the stays
  await page.goto('/?institutions=all');
  await expect(page.locator('#sites-toggle')).toContainText('Museums and sites (2)');
  await page.goto('/?institutions=all&from=1820&to=1840');
  await expect(page.locator('#sites-toggle')).toContainText('Museums and sites (1 that existed in 1820–1840)');
});

test('explore: a start view\'s introduction previews its [[links]]; chosen works have their ends marked on the map', async ({ page }) => {
  await page.route(/\/v1\/featured$/, (r) => r.fulfill({ json: { data: [{ slug: 'gogh', title: 'Van Gogh', query: 'artists=paul-gauguin,vincent-van-gogh&artworks=tournesols-sur-un-fauteuil&movements=none&polities=none&people=none',
    intro_html: '<p>About <a href="/artists/vincent-van-gogh" class="entry-link" data-entry="artist/vincent-van-gogh">Vincent</a>.</p>' }] } }));
  // the previews late (as from far away): a link hovered before they come opens when they do
  await page.route(/\/v1\/previews/, async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue(); });
  await page.goto('/');
  const link = page.locator('#featured-intro a.entry-link');
  await link.hover();
  await expect(page.locator('.glossary-popover')).toContainText('Vincent van Gogh');
  // an artwork's provenance on the start map: its last placed stop says "today" (or "last known place")
  await expect(page.locator('.prov-stop.prov-end').first()).toHaveAttribute('data-cap', /today|last known place/);
});

test('artworks list: searching a museum lists what is there now first, then what was there', async ({ page }) => {
  await page.route(/\/v1\/artworks\?/, async (route) => {
    const res = await route.fetch().catch(() => null);
    // a request the page dropped meanwhile (it loads the list again when the search starts): nothing to answer
    const body = res && await res.json().catch(() => null);
    if (!res || !body) return route.abort().catch(() => {});
    if (body.data.length < 2) return route.fulfill({ response: res });
    const [a, b] = body.data.slice(0, 2);
    // the museums as the API's search fields say them (API 110: view entry_search_fields)
    a.holders = { now: [], before: [{ slug: 'museo-del-prado', name: 'Museo del Prado' }] };
    a.search_fields = [{ label: 'Formerly in', text: 'Museo del Prado', tier: { rank: 2, heading: 'Formerly in the collection' } }];
    b.holders = { now: [{ slug: 'museo-del-prado', name: 'Museo del Prado' }], before: [] };
    b.search_fields = [{ label: 'Now in', text: 'Museo del Prado', tier: { rank: 1, heading: 'Now in the collection' } }];
    await route.fulfill({ response: res, json: { ...body, data: [a, b] } });
  });
  await page.goto('/artworks');
  await page.fill('input.filter', 'prado');
  const headings = page.locator('.cards-heading');
  await expect(headings).toHaveText(['Now in the collection', 'Formerly in the collection']);
  await expect(page.locator('.card').first()).toContainText('Now in: Museo del Prado');
});

test('museums list: an artist’s name finds the museums with their works, most first; the link lists them there', async ({ page }) => {
  const MUSEUM = { slug: 'musee-test', name: 'Musée Test', kind: 'museum', founded: null, image_url: null, country: null, polities: [], names: [] };
  const OTHER = { ...MUSEUM, slug: 'galerie-test', name: 'Galerie Test' };
  const worksBy = [{ label: 'Works by', text: 'Paul Gauguin', tier: { rank: 1, heading: 'With works by a matching artist' } }];  // API 110
  await page.route(/\/v1\/institutions\?/, (r) => r.fulfill({ json: { data: [
    { ...OTHER, artists_held: [{ slug: 'paul-gauguin', name: 'Paul Gauguin', now: 1, before: 0 }], search_fields: worksBy },
    { ...MUSEUM, artists_held: [{ slug: 'paul-gauguin', name: 'Paul Gauguin', now: 2, before: 1 }], search_fields: worksBy },
  ], total: 2, limit: 500, offset: 0 } }));
  await page.route(/\/v1\/artworks\?/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (body.data.length < 3) return route.fulfill({ response: res });
    const work = (a: Record<string, unknown>, held: 'now' | 'before') => ({ ...a, creator: { slug: 'paul-gauguin', name: 'Paul Gauguin' }, creators: [{ slug: 'paul-gauguin', name: 'Paul Gauguin', main: true, role: null, certainty: 'attested' }],
      holders: { now: held === 'now' ? [{ slug: 'musee-test', name: 'Musée Test' }] : [], before: held === 'before' ? [{ slug: 'musee-test', name: 'Musée Test' }] : [] } });
    await route.fulfill({ response: res, json: { ...body, total: 3, data: [work(body.data[0], 'now'), work(body.data[1], 'before'), { ...body.data[2], holders: { now: [], before: [] } }] } });
  });
  await page.goto('/institutions');
  await page.fill('input.filter', 'gauguin');
  await expect(page.locator('.cards-heading')).toHaveText(['With works by a matching artist']);
  const first = page.locator('.card').first();
  await expect(first).toContainText('Musée Test');               // 3 works before 1
  await expect(first.locator('.card-extra')).toContainText('3 works by Paul Gauguin (2 there now, 1 formerly)');
  await first.locator('.card-extra a').click();
  await expect(page).toHaveURL(/\/artworks\?artist=paul-gauguin&institution=musee-test/);
  await expect(page.locator('#stats')).toContainText('Works by Paul Gauguin held by Musée Test');
  await expect(page.locator('.cards-heading')).toHaveText(['In the Musée Test now', 'Formerly there']);
  await expect(page.locator('.card')).toHaveCount(2);
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
  // (events on "auto" follow what is chosen: with nothing chosen, none)
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

test('type and materials in any language: "Holzschnitt" finds the woodblock prints, linked to the glossary', async ({ page }) => {
  await page.goto('/artworks');
  await expect(page.locator('.card').first()).toBeVisible();
  await page.fill('.filter', 'Holzschnitt');
  await expect(page.locator('#items')).toContainText('The Great Wave');
  await expect(page.locator('#items')).toContainText('Type: woodblock print');           // the stored name, explained
  await page.fill('.filter', 'Leinwand');                                                 // a material, through its German name
  await expect(page.locator('#count')).toContainText('match');
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.facts a[href="/glossary/woodblock-print"]')).toHaveText('woodblock print');
});

test('a long selection gets a short address; the short address opens the same selection', async ({ page }) => {
  // many artists picked (built from the live list, so it doesn't depend on exact entries)
  await page.goto('/artists');
  await expect(page.locator('.card').first()).toBeVisible();
  const slugs = await page.locator('.card a[href^="/artists/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')!.split('/').at(-1)!))].slice(0, 30));
  expect(slugs.length).toBeGreaterThan(10);
  await page.goto(`/?artists=${slugs.join(',')}&movements=none`);
  await expect(page.locator('#map-status')).toContainText('places');
  await page.fill('input[name=from]', '1850');                                   // a change: the address is written
  await page.fill('input[name=to]', '1900');
  await page.press('input[name=to]', 'Enter');
  await expect(page).toHaveURL(/\/\?v=[0-9a-f]{8,}$/);                          // stored once the choosing pauses
  const short = new URL(page.url());

  await page.goto(`${short.pathname}${short.search}`);                           // opened again: the same view
  await expect(page.locator('#map-status')).toContainText('in 1850–1900');
  await expect(page).toHaveURL(new RegExp(`\\?v=${short.searchParams.get('v')}$`)); // and the short address stays
  await page.goto('/?v=00000000');
  await expect(page.locator('.explore')).toContainText('This short link is unknown');
});

test('a tab left open sees entries added meanwhile (the lists are fetched again after 5 minutes)', async ({ page }) => {
  await page.clock.install();
  let calls = 0;
  await page.route(/\/v1\/artworks\?.*limit=500/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (++calls > 1) {  // added after the first visit
      body.data.push({ ...body.data[0], slug: 'zz-test-fresh-artwork', title: 'Zz Test Fresh Artwork', names: [], alt_titles: [] });
      body.total += 1;
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/artworks');
  await expect(page.locator('.card').first()).toBeVisible();
  await page.fill('.filter', 'Zz Test Fresh');
  await expect(page.locator('#items .card')).toHaveCount(0);
  await page.locator('header a[href="/artists"]').first().click();              // elsewhere in the site, no reload
  await expect(page.locator('.card').first()).toBeVisible();
  await page.clock.fastForward('06:00');                                       // six minutes later
  await page.locator('header a[href="/artworks"]').first().click();
  await expect(page.locator('.card').first()).toBeVisible();
  await page.fill('.filter', 'Zz Test Fresh');
  await expect(page.locator('#items .card')).toHaveCount(1);
});

test('in a time window an artwork that stayed in one place keeps its colour in the legend and its numbered stop', async ({ page }) => {
  await page.goto('/?artists=salvador-dali&artworks=carriere-aux-environs-de-pontoise&movements=none&polities=none&people=none&from=1926&to=1927');
  await expect(page.locator('#map-status')).toContainText('in 1926–1927');
  await expect(page.locator('#legend')).toContainText('Carrière aux environs de Pontoise');  // with Vollard in Paris all the window
  await expect(page.locator('#legend')).toContainText('Salvador Dalí');
  await expect(page.locator('.prov-stop').first()).toBeVisible();                     // its step, numbered as in the provenance
  await page.locator('#chips .chip').click();                                            // the window removed: the whole provenance
  await expect(page.locator('#map-status')).toContainText('chosen entries on the map');
  await expect(page.locator('.prov-stop')).not.toHaveCount(0);
});

test('in a time window a numbered stop opens the place\'s popup: one popup with everyone there', async ({ page }) => {
  await page.goto('/?artists=salvador-dali&artworks=carriere-aux-environs-de-pontoise&movements=none&polities=none&people=none&from=1926&to=1927');
  const stop = page.locator('.prov-stop').first();
  await expect(stop).toBeVisible();
  await stop.click();
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toHaveCount(1);
  await expect(popup).toContainText('Salvador Dalí');                  // the place's popup, not only the artwork's steps
  await expect(popup).toContainText('Carrière aux environs de Pontoise');
  // the marker's numbers explained: the artwork's steps here, numbered as on the marker
  const label = (await stop.innerText()).trim();                       // e.g. "3, 6, 9"
  await expect(popup.locator('.popup-steps-block')).toContainText(`steps ${label} of`);
  await expect(popup.locator('.popup-steps-block ol li').first()).toHaveAttribute('value', label.split(/[,–]/)[0].trim());
  await expect(popup.locator('.popup-steps-block')).toContainText('Ambroise Vollard');
});

test('periods: lanes per region, phases, a region hidden, a window lists the works of those years', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/periods');
  await expect(page.locator('h1')).toHaveText('Periods');
  await expect(page.locator('.group-label', { hasText: 'Europe' })).toBeVisible();
  await expect(page.locator('.row-label', { hasText: 'Baroque' }).first()).toBeVisible();
  await expect(page.locator('.row-label-sub').first()).toBeVisible();   // a phase, indented under its style
  await expect(page.locator('.tl-dot').first()).toBeVisible();          // the collection's works on the period bars
  await expect(page.locator('.group-label', { hasText: 'In the collection' })).toHaveCount(0);
  // a region hidden; phases off — kept in the address
  await page.click('.periods-controls button[data-lane="japan"]');
  await expect(page.locator('.group-label', { hasText: 'Japan' })).toHaveCount(0);
  await expect(page).toHaveURL(/regions=/);
  await page.uncheck('.periods-phases input');
  await expect(page.locator('.row-label-sub')).toHaveCount(0);
  await expect(page).toHaveURL(/phases=0/);
  // a window: the periods and the collection's works of those years
  await page.fill('input[name=from]', '1880');
  await page.fill('input[name=to]', '1890');
  await page.press('input[name=to]', 'Enter');
  await expect(page.locator('#periods-window h2')).toHaveText('1880–1890');
  await expect(page.locator('.periods-active a').first()).toBeVisible();
  await expect(page.locator('.periods-works li').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('periods: a work\'s dot shows its preview; clicked again it opens the work in a new tab, the periods stay', async ({ page, context }) => {
  await page.goto('/periods');
  const dot = page.locator('.tl-dot-link').first();
  await dot.scrollIntoViewIfNeeded();
  await dot.click();
  const pop = page.locator('.glossary-popover');
  await expect(pop).toBeVisible();
  await expect(pop.locator('a', { hasText: 'Open' })).toHaveAttribute('target', '_blank');
  await expect(page).toHaveURL(/\/periods/);
  const [tab] = await Promise.all([context.waitForEvent('page'), dot.click()]);
  await expect(tab).toHaveURL(/\/artworks\//, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/periods/);                               // no navigation here
  // the preview itself opens it too — on another work's dot that is on top at its centre (works of one year overlap)
  const other = await page.$$eval('.tl-dot-link', (as) => as.findIndex((a, i) => {
    if (i === 0 || a.getAttribute('href') === as[0].getAttribute('href')) return false;
    const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && a.contains(hit);
  }));
  expect(other).toBeGreaterThan(0);
  await page.locator('.tl-dot-link').nth(other).click();
  await expect(pop).toBeVisible();
  const [tab2] = await Promise.all([context.waitForEvent('page'), pop.locator('.glossary-popover-head').click()]);
  await expect(tab2).toHaveURL(/\/artworks\//, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/periods/);
});

test('periods: switched to artists — lifespans under their periods, their works as dots, kept in the address; a window lists the artists alive then', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/periods');
  await page.click('.periods-controls button[data-show="artists"]');
  await expect(page).toHaveURL(/show=artists/);
  await expect(page.locator('.periods-controls button[data-show="artists"]')).toHaveAttribute('aria-pressed', 'true');
  // an artist's row: a thin bar from birth to death, linked to the artist, under the period (indented)
  const monet = page.locator('.row-label', { hasText: 'Claude Monet' }).first();
  await expect(monet).toBeVisible();
  await expect(page.locator('a:has(.row-label:has-text("Claude Monet"))').first()).toHaveAttribute('href', /\/artists\//);
  await expect(page.locator('rect.bar-thin').first()).toBeVisible();
  await expect(page.locator('.periods-legend')).toContainText("an artist's life");
  // the period bars carry no work dots now; the works sit on their artists' rows
  await expect(page.locator('.tl-dot').first()).toBeVisible();
  // a window: the artists alive in those years
  await page.fill('input[name=from]', '1870');
  await page.fill('input[name=to]', '1880');
  await page.press('input[name=to]', 'Enter');
  await expect(page.locator('#periods-window h3')).toContainText('Artists of the periods alive in these years');
  await expect(page.locator('#periods-window .periods-works')).toContainText('Claude Monet');
  // reloaded: still artists; back to works
  await page.reload();
  await expect(page.locator('.row-label', { hasText: 'Claude Monet' }).first()).toBeVisible();
  await page.click('.periods-controls button[data-show="works"]');
  await expect(page.locator('.row-label', { hasText: 'Claude Monet' })).toHaveCount(0);
  await expect(page).not.toHaveURL(/show=artists/);
  expect(errors).toEqual([]);
});

test('project documentation (API 114/116): from the footer, the overview with its chapters, a chapter with its contents and neighbours; unpublished → a note', async ({ page }) => {
  const base = { slug: 'projekt-dokumentation', title: 'Projekt Dokumentation', lang: 'de-CH', updated_at: '2026-10-20T12:00:00Z', words: 1200, chars: 8400,
    intro_html: '<p>Einleitung mit <mark>Markierung</mark>.</p>',
    chapters: [{ id: 'pitch', title: 'Pitch', words: 400, chars: 2800 }, { id: 'projektstart', title: 'Projektstart', words: 600, chars: 4200 }, { id: 'provenienz', title: 'Provenienz', words: 200, chars: 1400 }] };
  const chapter = { id: 'projektstart', index: 2, title: 'Projektstart', prev: { id: 'pitch', title: 'Pitch' }, next: { id: 'provenienz', title: 'Provenienz' },
    toc: [{ level: 1, id: 'projektstart', text: 'Projektstart' }, { level: 2, id: 'backend-setup', text: 'Backend Setup' }, { level: 3, id: 'node-app', text: 'Node App' }],
    html: '<h1 id="projektstart">Projektstart</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" width="1" height="1"><ul><li class="task task-done"><span class="task-box">☑</span> erledigt</li></ul><p><a href="/dokumentation/projektstart#node-app">zur Node App</a></p><p style="height:3000px"></p><h2 id="backend-setup">Backend Setup</h2><h3 id="node-app">Node App</h3>' };
  await page.route(/\/v1\/pages\/projekt-dokumentation(\?.*)?$/, (r) => {
    const asked = new URL(r.request().url()).searchParams.get('chapter');
    if (asked && asked !== 'projektstart') return r.fulfill({ status: 404, json: { error: 'not_found', message: 'no chapter' } });
    return r.fulfill({ json: asked ? { ...base, chapter } : base });
  });
  await page.goto('/privacy');
  await page.locator('footer a', { hasText: 'Projekt Dokumentation' }).click();
  await expect(page).toHaveURL(/\/dokumentation$/);
  await expect(page.locator('article.doc-page')).toHaveAttribute('lang', 'de-CH');
  await expect(page.locator('main h1')).toHaveText('Projekt Dokumentation');
  await expect(page.locator('.doc-page > p.muted').first()).toContainText(/Stand 20\. Oktober 2026 · 1.200 Wörter · 8.400 Zeichen mit Leerzeichen · rund 6 Minuten/);
  await expect(page.locator('.doc-chapters li').nth(1)).toContainText(/600 Wörter · 4.200 Zeichen · 3 min/);
  await expect(page.locator('.doc-body mark')).toHaveText('Markierung');
  await expect(page.locator('.doc-chapters li a')).toHaveText(['Pitch', 'Projektstart', 'Provenienz']);
  // room for two-digit chapter numbers ("13."): tablets cut the tens off when the markers stick out of the list
  const room = await page.locator('.doc-chapters').evaluate((ol) => parseFloat(getComputedStyle(ol).paddingLeft) / parseFloat(getComputedStyle(ol).fontSize));
  expect(room).toBeGreaterThanOrEqual(2.2);
  // a chapter: its text, its own contents, previous / next
  await page.locator('.doc-chapters a', { hasText: 'Projektstart' }).click();
  await expect(page).toHaveURL(/\/dokumentation\/projektstart$/);
  await expect(page.locator('.doc-crumb')).toContainText('Kapitel 2 von 3');
  await expect(page.locator('.doc-toc li')).toHaveText(['Backend Setup', 'Node App']);
  await expect(page.locator('.doc-body li.task-done')).toContainText('erledigt');
  await expect(page.locator('.doc-pager a[rel=prev]')).toHaveText('← Pitch');
  await expect(page.locator('.doc-pager a[rel=next]')).toHaveText('Provenienz →');
  // [[#Node App]] (API: a link to the heading in its chapter) — here the same chapter: scrolled there, the address with it
  await page.locator('.doc-body a', { hasText: 'zur Node App' }).click();
  await expect(page).toHaveURL(/\/dokumentation\/projektstart#node-app$/);
  await expect(page.locator('#node-app')).toBeInViewport();
  // an old link to a heading of the whole text opens its chapter; an unknown chapter: a way back
  await page.goto('/dokumentation#projektstart');
  await expect(page).toHaveURL(/\/dokumentation\/projektstart/);
  await page.goto('/dokumentation/gibt-es-nicht');
  await expect(page.locator('main')).toContainText('Kapitel nicht gefunden');
  // before it is published: a note instead of an error
  await page.unroute(/\/v1\/pages\/projekt-dokumentation(\?.*)?$/);
  await page.route(/\/v1\/pages\/projekt-dokumentation(\?.*)?$/, (r) => r.fulfill({ status: 404, json: { error: 'not_found', message: 'no page' } }));
  await page.goto('/dokumentation');
  await expect(page.locator('main')).toContainText('noch nicht veröffentlicht');
});

test('changelog and roadmap (API 118): from the footer, kinds as badges, filtered by kind, more on scrolling; the roadmap columns', async ({ page }) => {
  const entry = (id: number, day: string, kind = 'neu') => ({ id, day, title: id === 1 ? 'Patch: Suche' : null,
    items: [{ kind, label: kind === 'neu' ? 'Neu' : 'Behoben', html: `Punkt <a href="/artists/paul-gauguin">${id}</a>`, roadmap: id === 1 ? { id: 7, title: 'Suche' } : null }] });
  const all = Array.from({ length: 25 }, (_, n) => entry(n + 1, `2026-10-${String(20 - (n % 20)).padStart(2, '0')}`, n % 5 === 1 ? 'behoben' : 'neu'));
  await page.route(/\/v1\/changelog(\?.*)?$/, (r) => {
    const q = new URL(r.request().url()).searchParams;
    const list = q.get('kind') ? all.filter((e) => e.items[0].kind === q.get('kind')) : all;
    const offset = Number(q.get('offset') || 0);
    return r.fulfill({ json: { total: list.length, data: list.slice(offset, offset + Number(q.get('limit') || 20)) } });
  });
  await page.route(/\/v1\/roadmap$/, (r) => r.fulfill({ json: { columns: [
    { status: 'jetzt', label: 'In Arbeit', items: [{ id: 7, title: 'Projekt Dokumentation', area: 'Dokumentation', notes_html: '<p>Aus Obsidian</p>', done_on: null }] },
    { status: 'naechstes', label: 'Als Nächstes', items: [] },
    { status: 'spaeter', label: 'Später', items: [{ id: 8, title: 'Historische Karten', area: 'Karte', notes_html: null, done_on: null }] },
    { status: 'erledigt', label: 'Erledigt', items: [{ id: 9, title: 'Suche über Sprachen', area: null, notes_html: null, done_on: '2026-10-19' }] }] } }));
  await page.goto('/privacy');
  await page.locator('footer a', { hasText: 'Changelog' }).click();
  await expect(page).toHaveURL(/\/changelog$/);
  await expect(page.locator('.changelog-page')).toHaveAttribute('lang', 'de-CH');
  const first = page.locator('#eintrag-1');
  await expect(first.locator('h2')).toHaveText('Dienstag, 20. Oktober 2026 · Patch: Suche');
  await expect(first.locator('.cl-kind')).toHaveText('Neu');
  await expect(first.locator('.cl-text a')).toHaveAttribute('href', '/artists/paul-gauguin');
  await expect(page.locator('a.cl-feed')).toHaveAttribute('href', /\/v1\/changelog\/feed\.xml$/);
  await page.locator('.cl-more').scrollIntoViewIfNeeded();
  await expect(page.locator('.cl-entry')).toHaveCount(25);
  await page.locator('.cl-chips button', { hasText: 'Behoben' }).click();
  await expect(page).toHaveURL(/\/changelog\?kind=behoben$/);
  await expect(page.locator('.cl-entry')).toHaveCount(5);
  await expect(page.locator('.cl-entry .cl-kind').first()).toHaveText('Behoben');
  // the roadmap, from the intro
  await page.locator('.changelog-page a', { hasText: 'Roadmap' }).first().click();
  await expect(page).toHaveURL(/\/roadmap$/);
  await expect(page.locator('.roadmap-col h2')).toHaveText(['In Arbeit 1', 'Als Nächstes 0', 'Später 1', 'Erledigt 1']);
  await expect(page.locator('.roadmap-jetzt .roadmap-notes')).toHaveText('Aus Obsidian');
  await expect(page.locator('.roadmap-erledigt')).toContainText('erledigt am 19. Oktober 2026');
});

test('provenance records (API 104): the inventories under a step, the doubts tagged, more than three folded', async ({ page }) => {
  const rec = (date: string, number: string | null, extra: Record<string, unknown> = {}) => ({ kind: 'inventory', date: { label: date, from: `${date}-01-01`, to: `${date}-12-31` },
    place: { slug: 'madrid', name: 'Madrid' }, room: null, number, number_certainty: 'attested', document: 'royal inventory', certainty: 'attested', note: null, ...extra });
  await patch(page, GREAT_WAVE, (b) => {
    b.provenance = [{ kind: 'step', implied: false, position: 0, id: 1, owner: { type: 'institution', slug: 'museo-del-prado', name: 'Spanish royal collection' }, co_owners: [],
      role: 'owner', owner_label: null, owner_name: 'Spanish royal collection', acquired: null, ended: null, method: 'unknown', direct: false, label: null,
      certainty: 'attested', place: null, period: null, end_basis: 'unknown', notes_html: null, sources: [], in_chain: true,
      records: [rec('1700', '286', { room: 'summer office', id: 9, shared: 1 }), rec('1747', '4', { id: 10, shared: 0 }), rec('1745', '411', { number_certainty: 'possible' }), rec('1666', null, { certainty: 'possible', note: 'without number' })] }];
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const fold = page.locator('.provenance-records-fold');
  await expect(fold.locator('summary')).toHaveText('4 records — inventories, catalogues, sightings');
  await fold.locator('summary').click();
  const items = fold.locator('.provenance-record');
  await expect(items).toHaveCount(4);
  await expect(items.first()).toContainText('1700 · royal inventory · Madrid, summer office · no. 286');
  // a number another work shares in the same inventory is linked to it; one of its own is just the number (API 113)
  await expect(items.first().locator('a', { hasText: '286' })).toHaveAttribute('href', '/provenance-numbers?number=286&of=r9');
  await expect(items.nth(1)).toContainText('no. 4');
  await expect(items.nth(1).locator('a', { hasText: /^4$/ })).toHaveCount(0);
  await expect(items.nth(2)).toContainText('no. 411possible');                         // the number doubted
  await expect(items.nth(3)).toContainText('royal inventorypossible');                  // the whole entry doubted
  await expect(items.nth(3)).toContainText('— without number');
});
