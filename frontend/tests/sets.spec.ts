// Study sets on the site (views/sets.ts, sets-button.ts; backend routes/site-sets.js): a logged-in account — the admin
// host is a stand-in (playwright.config.ts: VITE_ADMIN_BASE=http://admin.test) answered here by a small in-memory
// account, so the site's side is tested without a CMS: "+ Set" on an entry's page, the list, a set, the index cards.
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
interface FakeSet { id: string; name: string; description: string | null; items: { type: string; slug: string; name: string }[] }

/** An account with its sets, answering /site/… on the stand-in admin host; `answers` records the cards' answers. */
async function loggedIn(page: Page) {
  const sets: FakeSet[] = [];
  const answers: string[] = [];
  let next = 1;
  await page.addInitScript(() => localStorage.setItem('arthistory.account', '1'));
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': new URL(page.url() || 'http://localhost:5180').origin, 'access-control-allow-credentials': 'true' } });
  await page.route(/^http:\/\/admin\.test\/site\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/site/, '');
    const form = new URLSearchParams(req.postData() ?? '');
    const find = (id: string) => sets.find((s) => s.id === id);
    const summary = (s: FakeSet) => ({ id: s.id, name: s.name, description: s.description, count: s.items.length, updated_at: '2026-11-04T12:00:00Z' });
    if (path === '/me') return json(route, { username: 'tester' });
    if (path === '/thumbs') return json(route, { images: {} });
    if (path === '/sets' && req.method() === 'GET') return json(route, { sets: sets.map(summary) });
    if (path === '/sets' && req.method() === 'POST') {
      const s = { id: String(next++), name: form.get('name')!, description: form.get('description') || null, items: [] };
      sets.unshift(s);
      return json(route, { set: summary(s) }, 201);
    }
    if (path === '/sets/of') return json(route, { sets: sets.map((s) => ({ id: s.id, name: s.name, has: s.items.some((i) => i.type === url.searchParams.get('type') && i.slug === url.searchParams.get('slug')) })) });
    if (path === '/sets/progress') { answers.push(`${form.get('slug')}:${form.get('direction')}:${form.get('known')}`); return json(route, { box: form.get('known') === '1' ? 2 : 1, seen: 1, known: Number(form.get('known')) }); }
    const m = /^\/sets\/(\d+)(\/items|\/items\/remove|\/cards|\/delete)?$/.exec(path);
    const s = m && find(m[1]);
    if (!s) return json(route, { error: 'not_found' }, 404);
    if (m![2] === '/items') { if (!s.items.some((i) => i.slug === form.get('slug'))) s.items.push({ type: form.get('type')!, slug: form.get('slug')!, name: form.get('slug')! }); return json(route, { count: s.items.length }); }
    if (m![2] === '/items/remove') { s.items = s.items.filter((i) => i.slug !== form.get('slug')); return json(route, { count: s.items.length }); }
    if (m![2] === '/cards') {
      return json(route, { set: summary(s), cards: s.items.map((i) => (i.type === 'artwork'
        ? { type: 'artwork', slug: i.slug, name: 'The Great Wave off Kanagawa', facts: [{ label: 'Artist', value: 'Katsushika Hokusai' }, { label: 'Date', value: 'c. 1831' }], text: '', image: PNG, own: true, progress: {} }
        : { type: 'term', slug: i.slug, name: 'Ukiyo-e', facts: [{ label: 'Category', value: 'style' }], text: 'Ukiyo-e: pictures of the floating world, woodblock prints of the Edo period.', image: null, own: false, progress: { forward: { box: 2, seen: 1, known: 1 } } })) });
    }
    if (req.method() === 'GET') return json(route, { set: summary(s), items: s.items.map((i) => ({ ...i, subtitle: null, image: null, own: false, added_at: '2026-11-04T12:00:00Z' })) });
    return json(route, { error: 'not_found' }, 404);
  });
  return { sets, answers };
}

test('study sets: "+ Set" on an entry creates a set and fills it; the list and the set; index cards both ways', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const account = await loggedIn(page);

  // an entry's page: "+ Set" → a new set with this entry in it
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.account')).toContainText('Logged in as tester');
  await page.locator('.set-menu summary').click();
  await expect(page.locator('.set-menu-list')).toContainText('No sets yet');
  await page.fill('.set-menu-new input', 'Exam: Japan');
  await page.click('.set-menu-new button');
  await expect(page.locator('.set-menu summary')).toHaveText('✓ In 1 set');
  expect(account.sets[0].items.map((i) => i.slug)).toEqual(['the-great-wave-off-kanagawa']);
  // a second entry ticked into the same set
  await page.goto('/glossary/nishiki-e');
  await page.locator('.set-menu summary').click();
  await page.locator('.set-menu-list input[type=checkbox]').first().check();
  await expect(page.locator('.set-menu-msg')).toHaveText('Added.');

  // the list of sets, one set
  await page.goto('/sets');
  await expect(page.locator('.sets-item')).toContainText(['Exam: Japan']);
  await expect(page.locator('.sets-item')).toContainText('2 entries');
  await page.locator('.sets-name', { hasText: 'Exam: Japan' }).click();
  await expect(page.locator('main h1')).toHaveText('Exam: Japan');
  await expect(page.locator('.sets-entry')).toHaveCount(2);

  // Name it: the picture first (the weakest box first — the artwork is new), then the term's definition with its name blanked
  await page.click('.sets-study button[type=submit]');
  await expect(page).toHaveURL(/\/sets\/1\/study\?dir=forward/);
  await expect(page.locator('.study-front img.study-img')).toBeVisible();
  await expect(page.locator('.study-prompt')).toHaveText('Which work is it — title, artist, date?');
  await expect(page.locator('.study-card')).not.toContainText('Great Wave');
  await page.keyboard.press(' ');
  await expect(page.locator('.study-back .study-name')).toHaveText('The Great Wave off Kanagawa');
  await expect(page.locator('.study-back')).toContainText('Katsushika Hokusai');
  await page.keyboard.press('ArrowLeft');                                   // not yet: it comes back at the end
  await expect(page.locator('.study-front')).toContainText('pictures of the floating world');
  await expect(page.locator('.study-front')).not.toContainText('Ukiyo');    // the whole name blanked out of its definition
  await expect(page.locator('.study-front')).not.toContainText('-e:');
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.study-count')).toContainText('once more');    // the picture again
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.study-done')).toContainText('2 known · 1 not yet');
  expect(account.answers).toEqual(['the-great-wave-off-kanagawa:forward:0', 'nishiki-e:forward:1', 'the-great-wave-off-kanagawa:forward:1']);

  // Describe it: the name first, the picture and the facts on the back
  await page.goto('/sets/1/study?dir=reverse');
  await expect(page.locator('.study-front .study-name')).toBeVisible();
  await page.locator('.study-buttons button', { hasText: 'Show the answer' }).click();
  await expect(page.locator('.study-back dl.study-facts')).toBeVisible();
  expect(errors).toEqual([]);
});

test('study sets: visitors are asked to log in; no "+ Set" on entry pages', async ({ page }) => {
  await page.goto('/sets');
  await expect(page.locator('main h1')).toHaveText('Study sets');
  await expect(page.locator('main')).toContainText('Log in');
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('.set-menu')).toHaveCount(0);
});
