// Study sets on the site (views/sets.ts, sets-button.ts; backend routes/site-sets.js): a logged-in account — the admin
// host is a stand-in (playwright.config.ts: VITE_ADMIN_BASE=http://admin.test) answered here by a small in-memory
// account, so the site's side is tested without a CMS: "+ Set" on an entry's page, the list, a set, the index cards.
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
interface FakeSet {
  id: string; name: string; topic: string | null; description: string | null; visibility: 'private' | 'link' | 'public'; code: string | null;
  items: { type: string; slug: string; name: string }[];
}
const CODE = 'AbCdEfGh1234';
const CARD: Record<string, object> = {
  'the-great-wave-off-kanagawa': { type: 'artwork', name: 'The Great Wave off Kanagawa', facts: [{ label: 'Artist', value: 'Katsushika Hokusai' }, { label: 'Date', value: 'c. 1831' }], text: '', image: PNG, own: true },
  'nishiki-e': { type: 'term', name: 'Ukiyo-e', facts: [{ label: 'Category', value: 'style' }], text: 'Ukiyo-e: pictures of the floating world, woodblock prints of the Edo period.', image: null, own: false },
  'katsushika-hokusai': { type: 'artist', name: 'Katsushika Hokusai', facts: [{ label: 'Lived', value: '1760 – 1849' }], text: '', image: null, own: false },
  'diego-velazquez': { type: 'artist', name: 'Diego Velázquez', facts: [{ label: 'Lived', value: '1599 – 1660' }], text: '', image: null, own: false },
};

/** An account with its sets, answering /site/… on the stand-in admin host; `answers` records the cards' answers,
 *  `rounds` the rounds of quizzes. `others`: a set someone else shared (code CODE). Logged out: only /site/shared. */
async function loggedIn(page: Page, { login = true } = {}) {
  const sets: FakeSet[] = [];
  const answers: string[] = [];
  const rounds: string[] = [];
  let publicName: string | null = null;
  let next = 1;
  const others: FakeSet = { id: '99', name: 'Hokusai for beginners', topic: 'Japanese art', description: '**Read** the [[artist/katsushika-hokusai]] page first.', visibility: 'link', code: CODE,
    items: ['the-great-wave-off-kanagawa', 'nishiki-e', 'katsushika-hokusai', 'diego-velazquez'].map((slug) => ({ type: (CARD[slug] as { type: string }).type, slug, name: slug })) };
  if (login) await page.addInitScript(() => localStorage.setItem('arthistory.account', '1'));
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': new URL(page.url() || 'http://localhost:5180').origin, 'access-control-allow-credentials': 'true' } });
  // a Markdown stand-in good enough for the tests: **bold**, [[type/slug]]
  const md = (t: string) => `<p>${t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[\[(\w+)\/([\w-]+)\]\]/g, '<a class="entry-link" href="/$1s/$2">$2</a>')}</p>`;
  const summary = (s: FakeSet) => ({ id: s.id, name: s.name, topic: s.topic, description: s.description, description_html: s.description ? md(s.description) : null,
    description_text: s.description, visibility: s.visibility, code: s.code, count: s.items.length, created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-04T12:00:00Z' });
  const cards = (s: FakeSet) => s.items.map((i) => ({ slug: i.slug, ...CARD[i.slug], progress: i.slug === 'nishiki-e' ? { forward: { box: 2, seen: 1, known: 1 } } : {} }));
  await page.route(/^http:\/\/admin\.test\/site\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/site/, '');
    const form = new URLSearchParams(req.postData() ?? '');
    if (path === `/shared/${CODE}`) return json(route, { set: { ...summary(others), id: undefined, creator: 'Ms Teacher', mine: false }, items: others.items.map((i) => ({ ...i, subtitle: null, image: null, own: false, added_at: '' })) });
    if (path === `/shared/${CODE}/cards`) return json(route, { set: { ...summary(others), creator: 'Ms Teacher' }, cards: cards(others) });
    if (path === '/shared') return json(route, { sets: [{ ...summary(others), creator: 'Ms Teacher' }], topics: [{ topic: 'Japanese art', count: 1 }] });
    if (!login) return json(route, { error: 'not_logged_in' }, 401);
    if (path === `/shared/${CODE}/sessions`) { rounds.push(`shared:${form.get('mode')}:${form.get('known')}/${form.get('answered')}`); return json(route, { ok: true }, 201); }
    if (path === `/shared/${CODE}/stats`) return json(route, { modes: {}, boxes: { forward: [4, 0, 0, 0, 0, 0], reverse: [4, 0, 0, 0, 0, 0] }, hardest: [] });
    if (path === `/shared/${CODE}/copy`) {
      const s = { ...others, id: String(next++), visibility: 'private' as const, code: null, items: [...others.items] };
      sets.unshift(s);
      return json(route, { set: { id: s.id, name: s.name } }, 201);
    }
    if (path === '/me') return json(route, { username: 'tester' });
    if (path === '/thumbs') return json(route, { images: {} });
    if (path === '/sets' && req.method() === 'GET') return json(route, { sets: sets.map(summary), public_name: publicName, topics: ['Japanese art'] });
    if (path === '/sets' && req.method() === 'POST') {
      const s: FakeSet = { id: String(next++), name: form.get('name')!, topic: form.get('topic') || null, description: form.get('description') || null, visibility: 'private', code: null, items: [] };
      sets.unshift(s);
      return json(route, { set: summary(s) }, 201);
    }
    if (path === '/sets/preview') return json(route, { html: md(form.get('text') ?? '') });
    if (path === '/sets/of') return json(route, { sets: sets.map((s) => ({ id: s.id, name: s.name, has: s.items.some((i) => i.type === url.searchParams.get('type') && i.slug === url.searchParams.get('slug')) })) });
    if (path === '/sets/progress') { answers.push(`${form.get('slug')}:${form.get('direction')}:${form.get('known')}`); return json(route, { box: form.get('known') === '1' ? 2 : 1, seen: 1, known: Number(form.get('known')) }); }
    const m = /^\/sets\/(\d+)(\/items|\/items\/remove|\/cards|\/delete|\/share|\/sessions|\/stats)?$/.exec(path);
    const s = m && sets.find((x) => x.id === m[1]);
    if (!s) return json(route, { error: 'not_found' }, 404);
    if (m![2] === '/items') { if (!s.items.some((i) => i.slug === form.get('slug'))) s.items.push({ type: form.get('type')!, slug: form.get('slug')!, name: form.get('slug')! }); return json(route, { count: s.items.length }); }
    if (m![2] === '/items/remove') { s.items = s.items.filter((i) => i.slug !== form.get('slug')); return json(route, { count: s.items.length }); }
    if (m![2] === '/cards') return json(route, { set: summary(s), cards: cards(s) });
    if (m![2] === '/sessions') { rounds.push(`${s.id}:${form.get('mode')}:${form.get('known')}/${form.get('answered')}:${form.get('complete')}`); return json(route, { ok: true }, 201); }
    if (m![2] === '/stats') {
      return json(route, { modes: { forward: { rounds: 2, answered: 5, known: 4, recent: [100, 67], best: 100, last_at: '2026-11-04T12:00:00Z', seconds: 95 } },
        boxes: { forward: [0, 1, 1, 0, 0, 0], reverse: [2, 0, 0, 0, 0, 0] }, hardest: [{ type: 'artwork', slug: 'the-great-wave-off-kanagawa', name: 'The Great Wave off Kanagawa', seen: 2, known: 1 }] });
    }
    if (m![2] === '/share') {
      if (form.has('public_name')) publicName = form.get('public_name') || null;
      if (form.get('visibility')) s.visibility = form.get('visibility') as FakeSet['visibility'];
      if (s.visibility !== 'private' && !publicName) return json(route, { error: 'a shared set shows your public name — choose one first' }, 422);
      if (s.visibility !== 'private' && (!s.code || form.get('new_link'))) s.code = form.get('new_link') ? 'NewLink12345' : 'Shared123456';
      return json(route, { set: summary(s), public_name: publicName });
    }
    if (req.method() === 'POST' && !m![2]) {
      Object.assign(s, { name: form.get('name') ?? s.name, topic: form.get('topic') || null, description: form.get('description') || null });
      return json(route, { set: summary(s) });
    }
    if (req.method() === 'GET') return json(route, { set: summary(s), items: s.items.map((i) => ({ ...i, subtitle: null, image: null, own: false, added_at: '2026-11-04T12:00:00Z' })) });
    return json(route, { error: 'not_found' }, 404);
  });
  return { sets, answers, rounds };
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
  await expect(page).toHaveURL(/\/sets\/1\/study\?mode=forward/);
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
  await expect.poll(() => account.rounds).toEqual(['1:forward:2/3:1']);   // the round kept with its result

  // Describe it: the name first, the picture and the facts on the back
  await page.goto('/sets/1/study?mode=reverse');
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

test('a set: topic and a Markdown description (toolbar, preview), shared by link with a public name, results per kind of quiz', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const account = await loggedIn(page);
  await page.goto('/sets');
  await page.fill('.sets-new input[name=name]', 'Exam: Edo');
  await page.fill('.sets-new input[name=topic]', 'Japanese art');
  await page.click('.sets-new button');
  await expect(page.locator('main h1')).toHaveText('Exam: Edo');
  await expect(page.locator('.sets-meta')).toContainText('Japanese art');
  await expect(page.locator('.sets-meta')).toContainText('created 1 November 2026');
  await expect(page.locator('.sets-meta')).toContainText('last changed 4 November 2026');

  // the description: Markdown with the toolbar, a preview from the server, shown rendered
  await page.locator('.sets-edit summary').click();
  const area = page.locator('.md-editor textarea');
  await area.fill('Learn ');
  await page.locator('.md-tool', { hasText: /^B$/ }).click();          // **bold** with "bold" selected
  await page.keyboard.type('these');
  await expect(area).toHaveValue('Learn **these**');
  await page.locator('.md-tab', { hasText: 'Preview' }).click();
  await expect(page.locator('.md-preview strong')).toHaveText('these');
  await page.locator('.md-tab', { hasText: 'Write' }).click();
  await page.locator('.sets-edit-form button[type=submit]').click();
  await expect(page.locator('.sets-description strong')).toHaveText('these');
  expect(account.sets[0].description).toBe('Learn **these**');

  // results: per kind of quiz, the boxes, the hardest entry
  await expect(page.locator('.sets-results')).toContainText('Name it');
  await expect(page.locator('.sets-results')).toContainText('80 %');
  await expect(page.locator('.sets-stats')).toContainText('Most often not known: The Great Wave off Kanagawa');

  // sharing: not without a public name; then a link to copy
  await page.locator('.sets-share summary').click();
  await page.locator('.sets-share-form input[value=link]').check();
  await page.locator('.sets-share-form button[type=submit]').click();
  await expect(page.locator('.sets-share-msg')).toContainText('public name');
  await page.fill('.sets-share-form input[name=public_name]', 'Ms Teacher');
  await page.locator('.sets-share-form button[type=submit]').click();
  await expect(page.locator('.sets-share-link input')).toHaveValue(/\/sets\/s\/Shared123456$/);
  await expect(page.locator('main h1 .sets-vis')).toHaveText('shared by link');
  expect(errors).toEqual([]);
});

test('a shared set: visitors see who made it and learn it — nothing is kept; the public sets by topic', async ({ page: visitor }) => {
  const v = await loggedIn(visitor, { login: false });
  await visitor.goto(`/sets/s/${CODE}`);
  await expect(visitor.locator('main h1')).toHaveText('Hokusai for beginners');
  await expect(visitor.locator('.sets-meta')).toContainText('by Ms Teacher');
  await expect(visitor.locator('.sets-description strong')).toHaveText('Read');
  await expect(visitor.locator('.sets-copy')).toHaveCount(0);
  await expect(visitor.locator('main')).toContainText('to keep track of what you know');
  await visitor.goto(`/sets/s/${CODE}/study?mode=forward`);
  await visitor.keyboard.press(' ');
  await visitor.keyboard.press('ArrowRight');
  expect(v.answers).toEqual([]);
  await visitor.goto('/sets/shared');
  await expect(visitor.locator('.sets-item')).toContainText('Hokusai for beginners');
  await expect(visitor.locator('.sets-topics')).toContainText('Japanese art');
});

test('a shared set, logged in: Pick it and Type it count among the account\'s results; Save a copy', async ({ page }) => {
  // logged in: Pick it — four names of the set, the right one marked
  const account = await loggedIn(page);
  await page.goto(`/sets/s/${CODE}`);
  await expect(page.locator('.sets-study input[value=choice]')).toBeVisible();   // four entries: Pick it offered
  await page.goto(`/sets/s/${CODE}/study?mode=choice`);
  for (let i = 0; i < 4; i++) {
    await expect(page.locator('.study-option')).toHaveCount(4);
    // always pick the first option: right or wrong, the right one gets marked
    await page.keyboard.press('1');
    await expect(page.locator('.study-option.study-right')).toHaveCount(1);
    await expect(page.locator('.study-verdict')).toBeVisible();
    await page.locator('.study-next').click();
  }
  // missed ones come back once; answer them until done
  while (await page.locator('.study-option').count()) { await page.keyboard.press('1'); await page.locator('.study-next').click(); }
  await expect(page.locator('.study-done')).toBeVisible();
  await expect.poll(() => account.rounds.length).toBe(1);
  expect(account.rounds[0]).toMatch(/^shared:choice:\d\/\d+$/);

  // Type it: a typo still counts
  await page.goto(`/sets/s/${CODE}/study?mode=typed`);
  const card = page.locator('.study-front .study-type');
  for (let i = 0; i < 4; i++) {
    const type = (await card.innerText()).toLowerCase();
    const answer = type === 'artwork' ? 'The Great Wave of Kanagawa' : type.startsWith('glossary') || type === 'term' ? 'Ukiyoe' : 'nobody at all';
    await page.fill('.study-type-form input', answer);
    await page.keyboard.press('Enter');
    await expect(page.locator('.study-verdict')).toBeVisible();
    if (answer !== 'nobody at all') await expect(page.locator('.study-verdict')).toHaveClass(/study-right/);
    await page.locator('.study-next').click();
  }

  // Save a copy → the account's own set
  await page.goto(`/sets/s/${CODE}`);
  await page.locator('.sets-copy').click();
  await expect(page).toHaveURL(/\/sets\/1$/);
  await expect(page.locator('main h1')).toHaveText('Hokusai for beginners');
});
