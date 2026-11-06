// Study sets on the site (views/sets.ts, sets-button.ts; backend routes/site-sets.js): a logged-in account — the admin
// host is a stand-in (playwright.config.ts: VITE_ADMIN_BASE=http://admin.test) answered here by a small in-memory
// account, so the site's side is tested without a CMS: "+ Set" on an entry's page, the list, a set, the index cards.
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
interface FakeSet {
  id: string; name: string; topic: string | null; description: string | null; visibility: 'private' | 'shared' | 'public'; code: string | null;
  items: { type: string; slug: string; name: string }[];
  members?: { id: string; name: string; me: boolean; rights: string; chat: boolean }[]; updated_by?: string | null;
  links?: { id: string; code: string; rights: string; created_at: string; ended_at: string | null; joined: number; expires_at: string | null; max_joins: number | null; closed: string | null }[];
}
const CODE = 'AbCdEfGh1234';
/** The site asks in its own dialog (src/dialog.ts), never the browser's: answered with its action button, typing `text` first when given. */
async function answerDialogs(page: Page, text?: string) {
  await page.addLocatorHandler(page.locator('dialog.site-dialog[open]'), async (d) => {
    if (text !== undefined && await d.locator('[name=value]').count()) await d.locator('[name=value]').fill(text);
    await d.locator('.site-dialog-ok').click();
  });
}
const JOIN = 'JoinMeToEdit1234';   // a link to join set 77 as an editor with approval (228)
const CARD: Record<string, object> = {
  'the-great-wave-off-kanagawa': { type: 'artwork', name: 'The Great Wave off Kanagawa', facts: [{ label: 'Artist', value: 'Katsushika Hokusai' }, { label: 'Date', value: 'c. 1831' }], text: '', image: PNG, own: true },
  'nishiki-e': { type: 'term', name: 'Ukiyo-e', facts: [{ label: 'Category', value: 'style' }], text: 'Ukiyo-e: pictures of the floating world, woodblock prints of the Edo period.', image: null, own: false },
  'katsushika-hokusai': { type: 'artist', name: 'Katsushika Hokusai', facts: [{ label: 'Lived', value: '1760 – 1849' }], text: '', image: null, own: false },
  'diego-velazquez': { type: 'artist', name: 'Diego Velázquez', facts: [{ label: 'Lived', value: '1599 – 1660' }], text: '', image: null, own: false },
};

/** An account with its sets, answering /site/… on the stand-in admin host; `answers` records the cards' answers,
 *  `rounds` the rounds of quizzes. `others`: a set someone else shared (code CODE). Logged out: only /site/shared. */
async function loggedIn(page: Page, { login = true, conflict = false } = {}) {
  const sets: FakeSet[] = [];
  const answers: string[] = [];
  const rounds: string[] = [];
  const posts: string[] = [];   // account and plan changes, as "path:field=value"
  let publicName: string | null = null;
  let examOn: string | null = null;
  let clash = conflict;         // the next save of a set's text: someone else changed it meanwhile (409)
  let next = 1;
  const others: FakeSet = { id: '99', name: 'Hokusai for beginners', topic: 'Japanese art', description: '**Read** the [[artist/katsushika-hokusai]] page first.', visibility: 'public', code: CODE,
    items: ['the-great-wave-off-kanagawa', 'nishiki-e', 'katsushika-hokusai', 'diego-velazquez'].map((slug) => ({ type: (CARD[slug] as { type: string }).type, slug, name: slug })) };
  if (login) await page.addInitScript(() => localStorage.setItem('arthistory.account', '1'));
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': new URL(page.url() || 'http://localhost:5180').origin, 'access-control-allow-credentials': 'true' } });
  // a Markdown stand-in good enough for the tests: **bold**, [[type/slug]]
  const md = (t: string) => `<p>${t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[\[(\w+)\/([\w-]+)\]\]/g, '<a class="entry-link" href="/$1s/$2">$2</a>')}</p>`;
  const summary = (s: FakeSet) => ({ id: s.id, name: s.name, topic: s.topic, description: s.description, description_html: s.description ? md(s.description) : null,
    description_text: s.description, visibility: s.visibility, code: s.code, count: s.items.length, created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-04T12:00:00Z',
    role: 'owner', rights: 'owner', members: s.members ?? [], editors: (s.members ?? []).filter((x) => x.rights !== 'view'), updated_by: s.updated_by ?? null, exam_on: examOn, creator: publicName,
    chat_allowed: true, vote_mode: 'advisory', vote_hours: 24, owner_veto: false });
  // the day's plan: the term due again, one of the new cards today (an exam in 12 days when one is set)
  const plan = () => ({ exam_on: examOn, days_left: examOn ? 12 : null,
    directions: { forward: { due: 1, new: 3, new_left_today: 1, new_today: 0 }, reverse: { due: 0, new: 4, new_left_today: 1, new_today: 0 } } });
  const cards = (s: FakeSet) => s.items.map((i) => ({ slug: i.slug, ...CARD[i.slug], progress: i.slug === 'nishiki-e' ? { forward: { box: 2, seen: 1, known: 1, due: true } } : {} }));
  await page.route(/^http:\/\/admin\.test\/site\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/site/, '');
    const form = new URLSearchParams(req.postData() ?? '');
    if (path === `/shared/${CODE}`) return json(route, { set: { ...summary(others), id: undefined, creator: 'Ms Teacher', mine: false }, items: others.items.map((i) => ({ ...i, subtitle: null, image: null, own: false, added_at: '' })) });
    if (path === `/shared/${CODE}/cards`) return json(route, { set: { ...summary(others), creator: 'Ms Teacher' }, cards: cards(others) });
    if (path === '/shared') return json(route, { sets: [{ ...summary(others), creator: 'Ms Teacher' }], topics: [{ topic: 'Japanese art', count: 1 }] });
    if (path === `/shared/join/${JOIN}` && req.method() === 'GET') {
      const joined = sets.some((x) => x.id === '77');
      return json(route, { set: { ...(joined ? { id: '77' } : {}), name: 'Baroque together', topic: 'Baroque', creator: 'Mr Owner', count: 3, members: 1, editors: 1, viewers: 0, vote_mode: 'advisory' },
        rights: 'approval', role: joined ? 'editor' : null, public_name: publicName });
    }
    if (path === '/shared/join/ExpiredLink12345') return json(route, { error: 'this link has expired', closed: 'expired' }, 410);
    if (path === '/signup') return json(route, { open: true, url: 'http://admin.test/signup' });
    if (!login) return json(route, { error: 'not_logged_in' }, 401);
    if (path === `/shared/join/${JOIN}`) {
      if (!publicName && !form.get('public_name')) return json(route, { error: 'the other editors see your public name — choose one first' }, 422);
      publicName = publicName ?? form.get('public_name');
      sets.push({ id: '77', name: 'Baroque together', topic: 'Baroque', description: null, visibility: 'shared', code: null, items: [], members: [{ id: '5', name: 'Ms Other', me: false, rights: 'full', chat: false }] });
      return json(route, { set: { id: '77' } }, 201);
    }
    if (path === '/account' && req.method() === 'GET') {
      return json(route, { username: 'tester', role: 'member', cms: false, public_name: publicName, created_at: '2026-11-05T09:00:00Z', created_via: 'signup', sessions: 2, sets: sets.length, edits: 0 });
    }
    if (path.startsWith('/account/')) {
      posts.push(`${path}:${[...form.keys()].join(',')}`);
      if (path === '/account/public-name') { publicName = form.get('public_name') || null; return json(route, { public_name: publicName }); }
      if (path === '/account/password') return form.get('current') === 'right one' ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' } }) : json(route, { error: 'your current password is not right' }, 403);
      if (path === '/account/sessions') return json(route, { ended: 1 });
    }
    if (path === `/shared/${CODE}/sessions`) { rounds.push(`shared:${form.get('mode')}:${form.get('known')}/${form.get('answered')}`); return json(route, { ok: true }, 201); }
    if (path === `/shared/${CODE}/stats`) return json(route, { modes: {}, boxes: { forward: [4, 0, 0, 0, 0, 0], reverse: [4, 0, 0, 0, 0, 0] }, hardest: [] });
    if (path === `/shared/${CODE}/copy`) {
      const s = { ...others, id: String(next++), visibility: 'private' as const, code: null, items: [...others.items] };
      sets.unshift(s);
      return json(route, { set: { id: s.id, name: s.name } }, 201);
    }
    if (path === '/me') return json(route, { username: 'tester', role: 'member', cms: false, public_name: publicName });
    if (path === '/thumbs') return json(route, { images: {} });
    if (path === '/sets' && req.method() === 'GET') return json(route, { sets: sets.map(summary), public_name: publicName, topics: ['Japanese art'], invitations: [] });
    if (path === '/sets' && req.method() === 'POST') {
      const s: FakeSet = { id: String(next++), name: form.get('name')!, topic: form.get('topic') || null, description: form.get('description') || null, visibility: 'private', code: null, items: [] };
      sets.unshift(s);
      return json(route, { set: summary(s) }, 201);
    }
    if (path === '/sets/preview') return json(route, { html: md(form.get('text') ?? '') });
    if (path === '/sets/of') return json(route, { sets: sets.map((s) => ({ id: s.id, name: s.name, has: s.items.some((i) => i.type === url.searchParams.get('type') && i.slug === url.searchParams.get('slug')) })) });
    if (path === '/sets/progress') { answers.push(`${form.get('slug')}:${form.get('direction')}:${form.get('known')}`); return json(route, { box: form.get('known') === '1' ? 2 : 1, seen: 1, known: Number(form.get('known')) }); }
    const m = /^\/sets\/(\d+)(\/items|\/items\/remove|\/cards|\/delete|\/share|\/sessions|\/stats|\/plan|\/sharing|\/links|\/links\/\d+\/end|\/members\/\d+|\/members|\/settings|\/leave)?$/.exec(path);
    const s = m && sets.find((x) => x.id === m[1]);
    if (!s) return json(route, { error: 'not_found' }, 404);
    if (m![2] === '/items') { if (!s.items.some((i) => i.slug === form.get('slug'))) s.items.push({ type: form.get('type')!, slug: form.get('slug')!, name: form.get('slug')! }); return json(route, { count: s.items.length }); }
    if (m![2] === '/items/remove') { s.items = s.items.filter((i) => i.slug !== form.get('slug')); return json(route, { count: s.items.length }); }
    if (m![2] === '/cards') return json(route, { set: summary(s), cards: cards(s) });
    if (m![2] === '/sessions') { rounds.push(`${s.id}:${form.get('mode')}:${form.get('known')}/${form.get('answered')}:${form.get('complete')}`); return json(route, { ok: true }, 201); }
    if (m![2] === '/stats') {
      return json(route, { modes: { forward: { rounds: 2, answered: 5, known: 4, recent: [100, 67], best: 100, last_at: '2026-11-04T12:00:00Z', seconds: 95 } },
        boxes: { forward: [0, 1, 1, 0, 0, 0], reverse: [2, 0, 0, 0, 0, 0] }, hardest: [{ type: 'artwork', slug: 'the-great-wave-off-kanagawa', name: 'The Great Wave off Kanagawa', seen: 2, known: 1 }], plan: plan() });
    }
    if (m![2] === '/plan') { examOn = form.get('exam_on') || null; posts.push(`plan:${examOn ?? ''}`); return json(route, { plan: plan() }); }
    // members, links (228)
    if (m![2] === '/sharing') return json(route, { links: s.links ?? [], invitations: [], friends: [{ id: '6', name: 'Ms Friend' }], settings: { visibility: s.visibility, vote_mode: 'advisory', vote_hours: 24, owner_veto: false } });
    if (m![2] === '/links') {
      posts.push(`links:${form.get('rights') ?? ''}`);
      publicName = publicName ?? (form.get('public_name') || null);
      if (!publicName) return json(route, { error: 'the members see your public name — choose one first' }, 422);
      if (s.visibility === 'private') s.visibility = 'shared';
      posts.push(`limits:${form.get('expires_on') ?? ''}:${form.get('max_joins') ?? ''}`);
      const link = { id: String((s.links ?? []).length + 1), code: 'InviteLink123456', rights: form.get('rights')!, created_at: '2026-11-05T12:00:00Z', ended_at: null, joined: 0,
        expires_at: form.get('expires_on') ? `${form.get('expires_on')!}T23:00:00Z` : null, max_joins: form.get('max_joins') ? Number(form.get('max_joins')) : null, closed: null };
      s.links = [...(s.links ?? []), link];
      return json(route, { link }, 201);
    }
    if (m![2]?.endsWith('/end')) { s.links = (s.links ?? []).map((l) => ({ ...l, ended_at: '2026-11-05T13:00:00Z', closed: 'off' })); posts.push('link:end'); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' } }); }
    if (m![2]?.startsWith('/members/')) {
      const who = m![2].split('/')[2];
      posts.push(`member:${who}:${form.toString()}`);
      if (form.get('action') === 'remove') s.members = (s.members ?? []).filter((x) => x.id !== who);
      if (form.get('action') === 'rights') s.members = (s.members ?? []).map((x) => (x.id === who ? { ...x, rights: form.get('rights')! } : x));
      return json(route, { set: summary(s) });
    }
    if (m![2] === '/leave') { sets.splice(sets.indexOf(s), 1); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' } }); }
    if (m![2] === '/share') {
      if (form.has('public_name')) publicName = form.get('public_name') || null;
      if (form.get('visibility')) s.visibility = form.get('visibility') as FakeSet['visibility'];
      if (s.visibility !== 'private' && !publicName) return json(route, { error: 'a shared set shows your public name — choose one first' }, 422);
      s.code = s.visibility === 'public' ? 'Shared123456' : null;
      if (s.visibility === 'private') s.members = [];
      return json(route, { set: summary(s), public_name: publicName });
    }
    if (req.method() === 'POST' && !m![2]) {
      if (clash) {
        clash = false;
        Object.assign(s, { description: 'Their **newer** text', updated_by: 'Ms Other' });
        return json(route, { error: 'changed', fields: ['description'], by: 'Ms Other', set: summary(s) }, 409);
      }
      Object.assign(s, { name: form.get('name') ?? s.name, topic: form.get('topic') || null, description: form.get('description') || null });
      return json(route, { set: summary(s) });
    }
    if (req.method() === 'GET') return json(route, { set: summary(s), items: s.items.map((i) => ({ ...i, subtitle: null, image: null, own: false, added_at: '2026-11-04T12:00:00Z' })) });
    return json(route, { error: 'not_found' }, 404);
  });
  return { sets, answers, rounds, posts };
}

test('study sets: "+ Set" on an entry creates a set and fills it; the list and the set; index cards both ways', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const account = await loggedIn(page);

  // an entry's page: "+ Set" → a new set with this entry in it
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.account-button .account-initial')).toHaveText('T');   // no public name: the initial
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
  await expect(page.locator('.sets-manage h2')).toHaveText('Manage this set');
  await expect(page.locator('.sets-entries-title')).toContainText('Entries 2');

  // removing an entry takes a hold of three seconds: a click or a short press only shows how
  const remove = page.locator('.sets-entry', { hasText: 'nishiki-e' }).locator('.sets-remove');
  await remove.click();
  await expect(remove).toHaveClass(/hold-hint/);
  await remove.hover();
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();
  await page.waitForTimeout(2500);
  expect(account.sets[0].items).toHaveLength(2);
  await remove.focus();                                                     // the keyboard: Enter held down
  await page.keyboard.down('Enter');
  await expect(page.locator('.sets-entry')).toHaveCount(1, { timeout: 6000 });
  await page.keyboard.up('Enter');
  expect(account.sets[0].items.map((i) => i.slug)).toEqual(['the-great-wave-off-kanagawa']);
  account.sets[0].items.push({ type: 'term', slug: 'nishiki-e', name: 'nishiki-e' });   // back for the cards below
  await page.reload();
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

test('a set: topic and a Markdown description (toolbar, preview), made public with a public name, results per kind of quiz', async ({ page }) => {
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
  // "Make my own copy" first says what it does; Cancel closes it, nothing is copied
  await page.locator('.sets-copy-box summary').click();
  await expect(page.locator('.sets-copy-info')).toContainText('A new, private set of your own');
  await page.locator('.sets-copy-cancel').click();
  await expect(page.locator('.sets-copy-info')).toBeHidden();
  expect(account.sets).toHaveLength(1);
  // the description folds away and stays folded on this set
  await page.locator('.sets-about-summary').click();
  await expect(page.locator('.sets-description')).toBeHidden();
  await page.reload();
  await expect(page.locator('.sets-about')).not.toHaveAttribute('open');
  await page.locator('.sets-about-summary').click();
  await expect(page.locator('.sets-description strong')).toHaveText('these');

  // results: per kind of quiz, the boxes, the hardest entry
  await expect(page.locator('.sets-results')).toContainText('Name it');
  await expect(page.locator('.sets-results')).toContainText('80 %');
  await expect(page.locator('.sets-stats')).toContainText('Most often not known: The Great Wave off Kanagawa');

  // public: not without a public name; then its address to copy
  await page.locator('#sets-sharing summary').click();
  await expect(page.locator('.sets-vis-form')).toContainText('anyone can look at it and study it');
  await page.locator('.sets-vis-form input[value=public]').check();
  await page.locator('.sets-vis-form button[type=submit]').click();
  await expect(page.locator('#sets-sharing .sets-panel-msg')).toContainText('public name');
  // no field for it here: a notice leads to the account page, where the section stands out with its field focused
  await expect(page.locator('.sets-vis-form input[name=public_name]')).toHaveCount(0);
  await page.locator('#sets-sharing .sets-need-name a').click();
  await expect(page).toHaveURL(/\/account#public-name$/);
  await expect(page.locator('#public-name')).toHaveClass(/account-highlight/);
  await expect(page.locator('#public-name input[name=public_name]')).toBeFocused();
  await page.keyboard.type('Ms Teacher');
  await page.locator('#public-name button[type=submit]').click();
  await expect(page.locator('#public-name .account-msg')).toHaveText('Saved.');
  await page.goto('/sets/1#sets-sharing');
  await expect(page.locator('#sets-sharing .sets-public-name')).toContainText('see you as Ms Teacher');
  await page.locator('.sets-vis-form input[value=public]').check();
  await page.locator('.sets-vis-form button[type=submit]').click();
  await expect(page.locator('.sets-vis-form .sets-share-link input')).toHaveValue(/\/sets\/s\/Shared123456$/);
  await expect(page.locator('main h1 .sets-vis')).toHaveText('public');
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

test('an exam date plans the day\'s cards: the days counted, today\'s cards studied', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const account = await loggedIn(page);
  account.sets.push({ id: '9', name: 'Exam: Edo', topic: null, description: null, visibility: 'private', code: null,
    items: ['the-great-wave-off-kanagawa', 'nishiki-e', 'katsushika-hokusai'].map((slug) => ({ type: (CARD[slug] as { type: string }).type, slug, name: slug })) });
  await page.goto('/sets/9');
  await expect(page.locator('.sets-plan h2')).toHaveText('Today');
  await expect(page.locator('.sets-plan-today')).toContainText('Name it: 1 card to review + 1 new');
  await expect(page.locator('.sets-today-count')).toHaveText('(2 Name it · 1 Describe it)');
  await page.fill('.sets-exam-form input[type=date]', '2026-11-17');
  await page.locator('.sets-exam-form button[type=submit]').click();
  await expect(page.locator('.sets-plan h2')).toHaveText('Exam in 12 days');
  await expect(page.locator('.sets-plan')).toContainText(/Tuesday,? 17 November 2026/);
  expect(account.posts).toContain('plan:2026-11-17');

  // today's cards, Name it: the term due again, then one new card (the first in the set) — not the third
  await page.locator('.sets-study input[name=cards][value=today]').check();
  await page.click('.sets-study button[type=submit]');
  await expect(page).toHaveURL(/cards=today/);
  await expect(page.locator('.study-mode')).toContainText("today's cards");
  await expect(page.locator('.study-count')).toContainText('of 2');
  for (let i = 0; i < 2; i++) { await page.keyboard.press(' '); await page.keyboard.press('ArrowRight'); }
  await expect(page.locator('.study-done')).toContainText('2 known');
  expect(account.answers.map((a) => a.split(':')[0]).sort()).toEqual(['nishiki-e', 'the-great-wave-off-kanagawa']);

  // the date removed
  await page.goto('/sets/9');
  await page.locator('.sets-exam-remove').click();
  await expect(page.locator('.sets-plan h2')).toHaveText('Today');
  expect(errors).toEqual([]);
});

test('members: the owner\'s panel — rights changed, a link with rights, a member removed; joining by a link that says what it gives; a save after someone else\'s change shows theirs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await answerDialogs(page);
  const account = await loggedIn(page, { conflict: true });
  account.sets.push({ id: '9', name: 'Exam: Edo', topic: null, description: 'Mine', visibility: 'shared', code: null, items: [],
    members: [{ id: '5', name: 'Ms Other', me: false, rights: 'full', chat: false }], updated_by: 'Ms Other' });
  await page.goto('/sets/9');
  await expect(page.locator('main h1 .sets-together-tag')).toHaveText('1 member');
  await expect(page.locator('.sets-meta')).toContainText('by Ms Other');
  await expect(page.locator('.sets-your-part')).toContainText('Your part: Owner');
  await page.locator('#sets-members-panel summary').click();
  await page.locator('#sets-sharing summary').click();
  const panel = page.locator('#sets-sharing');
  const membersPanel = page.locator('#sets-members-panel');
  // what each part may do, in the same words the members see
  await expect(membersPanel.locator('.sets-rights-legend')).toContainText('Editor with approval');
  await expect(membersPanel.locator('.sets-rights-legend')).toContainText('each waits until the owner accepts or rejects it');
  // hours and the veto only for binding votes — with advisory ones the owner decides anyway
  await expect(panel.locator('input[name=owner_veto]')).toBeHidden();
  await panel.locator('.sets-votes-form input[value=binding]').check();
  await expect(panel.locator('input[name=owner_veto]')).toBeVisible();
  await panel.locator('.sets-votes-form input[value=advisory]').check();
  await expect(panel.locator('input[name=vote_hours]')).toBeHidden();
  // a member's rights changed
  await membersPanel.locator('[data-member="5"] select').selectOption('vote');
  await expect.poll(() => account.posts).toContain('member:5:action=rights&rights=vote');
  await expect(membersPanel.locator('.sets-share-msg')).toContainText('Now: Editor with votes');   // the panel drawn again
  // a link with rights: not without a public name — then one to copy, marked with what it gives
  await panel.locator('.sets-link-form select').selectOption('approval');
  await panel.locator('.sets-link-form button').click();
  await expect(page.locator('#sets-sharing .sets-panel-msg')).toContainText('public name');
  await page.goto('/account#public-name');
  await expect(page.locator('#public-name input[name=public_name]')).toBeFocused();
  await page.keyboard.type('Mr Owner');
  await page.locator('#public-name button[type=submit]').click();
  await expect(page.locator('#public-name .account-msg')).toHaveText('Saved.');
  await page.goto('/sets/9#sets-sharing');
  await panel.locator('.sets-link-form select').selectOption('approval');
  // optional limits (230): a last day and at most how many join
  await panel.locator('.sets-link-form input[name=expires_on]').fill('2026-12-31');
  await panel.locator('.sets-link-form input[name=max_joins]').fill('3');
  await panel.locator('.sets-link-form button').click();
  await expect(panel.locator('.sets-links input')).toHaveValue(/\/sets\/join\/InviteLink123456$/);
  await expect(panel.locator('.sets-links .tag')).toHaveText('Editor with approval');
  await expect(panel.locator('.sets-links')).toContainText('0 of 3 joined · works until 31 December 2026');
  expect(account.posts).toContain('limits:2026-12-31:3');
  await panel.locator('[data-end]').click();
  await expect(panel.locator('.sets-links')).toHaveCount(0);
  await expect(panel).toContainText('No longer open (1)');
  await membersPanel.locator('summary').first().click();
  await membersPanel.locator('[data-remove="5"]').click();
  await expect(membersPanel).toContainText('No members yet');

  // a save from an older text: refused, theirs shown, mine kept; saving again replaces theirs
  await page.locator('.sets-edit summary').click();
  await page.locator('.md-editor textarea').fill('My new text');
  await page.locator('.sets-edit-form button[type=submit]').click();
  await expect(page.locator('.sets-conflict')).toContainText('Ms Other changed this set meanwhile');
  await expect(page.locator('.sets-conflict strong')).toHaveText('newer');
  await expect(page.locator('.md-editor textarea')).toHaveValue('My new text');
  await page.locator('.sets-edit-form button[type=submit]').click();
  await expect(page.locator('.sets-description')).toContainText('My new text');

  // a link from someone else: what it gives, in plain words, before joining; then the set opens
  await page.goto(`/sets/join/${JOIN}`);
  await expect(page.locator('main h1')).toHaveText('Join “Baroque together”');
  await expect(page.locator('main')).toContainText('Mr Owner shares this set');
  await expect(page.locator('.sets-your-part')).toContainText('You join as: Editor with approval');
  await expect(page.locator('.sets-your-part')).toContainText('each waits until the owner accepts or rejects it');
  await expect(page.locator('main')).toContainText('The others see you as Mr Owner');
  await expect(page.locator('.sets-join button')).toHaveText('Join as an editor');
  await page.locator('.sets-join button').click();
  await expect(page).toHaveURL(/\/sets\/77$/);
  // a link past its last day says so
  await page.goto('/sets/join/ExpiredLink12345');
  await expect(page.locator('.flash')).toContainText('This link has expired — ask the owner of the set for a new one.');
  expect(errors).toEqual([]);
});

test('the account page: public name, password, other sessions; visitors get Log in and Create an account', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const account = await loggedIn(page);
  await page.goto('/account');
  await expect(page.locator('main h1')).toHaveText('Your account');
  await expect(page.locator('.account-facts')).toContainText('tester');
  await expect(page.locator('.account-facts')).toContainText('Site account');
  await page.fill('[data-form=name] input', 'Ms Student');
  await page.locator('[data-form=name] button').click();
  await expect(page.locator('[data-form=name] .account-msg')).toHaveText('Saved.');
  await page.fill('[data-form=password] input[name=current]', 'wrong one');
  await page.fill('[data-form=password] input[name=password]', 'a new secret 1');
  await page.fill('[data-form=password] input[name=password2]', 'a new secret 1');
  await page.locator('[data-form=password] button').click();
  await expect(page.locator('[data-form=password] .account-msg')).toHaveText('Your current password is not right');
  await page.fill('[data-form=password] input[name=current]', 'right one');
  await page.locator('[data-form=password] button').click();
  await expect(page.locator('[data-form=password] .account-msg')).toContainText('logged out everywhere else');
  await page.locator('.account-sessions').click();
  await expect(page.locator('main')).toContainText('1 other session ended');
  await expect(page.locator('[data-form=delete] button')).toHaveText('Delete my account');
  expect(account.posts).toEqual(['/account/public-name:public_name', '/account/password:current,password,password2', '/account/password:current,password,password2', '/account/sessions:']);
  await expect(page.locator('.account-button .account-name')).toHaveText('Ms Student');   // the header follows the new name
  expect(errors).toEqual([]);
});

test('visitors: /sets and /account offer Log in and, while open, Create an account', async ({ page }) => {
  await loggedIn(page, { login: false });
  await page.goto('/sets');
  await expect(page.locator('.sets-account-links a', { hasText: 'Create an account' })).toHaveAttribute('href', /^http:\/\/admin\.test\/signup\?next=/);
  await page.goto('/account');
  await expect(page.locator('main a', { hasText: 'Log in' })).toBeVisible();
});

// 221, 228: the owner's set page — a removal proposed by an editor with votes, the votes and the decision; the history
// with "Back to here"; lock; made private. The set (55) answered by its own stand-in routes.
test('a set\'s owner: a proposed change with votes and the decision, the history and a restore, lock, made private', async ({ page }) => {
  await loggedIn(page);
  const posts: string[] = [];
  let open = true;
  let locked = false;
  let visibility: 'private' | 'shared' = 'shared';
  const set = () => ({ id: '55', name: 'Baroque exam', topic: null, description: null, visibility, code: null,
    count: open ? 2 : 1, created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-05T09:00:00Z', role: 'owner', rights: 'owner', locked_at: locked ? '2026-11-05T10:00:00Z' : null,
    members: visibility === 'shared' ? [{ id: '8', name: 'Ann Helper', me: false, rights: 'vote', chat: false }, { id: '9', name: 'Bo Other', me: false, rights: 'full', chat: false }] : [],
    updated_by: 'Ann Helper', exam_on: null, creator: 'Test Owner', chat_allowed: true, vote_mode: 'advisory', vote_hours: 24, owner_veto: false });
  const proposal = { id: '3', kind: 'remove', field: null, old: null, new: null, type: 'artist', slug: 'diego-velazquez', name: 'Diego Velázquez', procedure: 'advisory',
    reason: 'Not on the exam', created_at: '2026-11-05T08:00:00Z', closes_at: null, tie_at: null, mine: false, proposed_by: 'Ann Helper', added_by: 'Test Owner',
    votes: [{ by: 'Ann Helper', vote: 'yes' }, { by: 'Bo Other', vote: 'yes' }], my_vote: null, voters: 3, decided_at: null, outcome: null, decided_by: null, by_vote: false };
  await page.route(/^http:\/\/admin\.test\/site\/sets\/55(\/.*)?$/, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/site\/sets\/55/, '');
    const body = new URLSearchParams(req.postData() ?? '');
    if (req.method() === 'POST') posts.push(`${path}:${body.toString()}`);
    const json = (b: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b),
      headers: { 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' } });
    if (path === '') return json({ set: set(), items: [{ type: 'artwork', slug: 'the-great-wave-off-kanagawa', name: 'The Great Wave', subtitle: null, image: null, own: false, added_at: '', mine: true },
      ...(open ? [{ type: 'artist', slug: 'diego-velazquez', name: 'Diego Velázquez', subtitle: null, image: null, own: false, added_at: '', mine: true }] : [])], proposals: open ? [proposal] : [],
      decided: open ? [] : [{ ...proposal, decided_at: '2026-11-05T11:00:00Z', outcome: 'accepted', decided_by: 'Test Owner' }] });
    if (path === '/sharing') return json({ links: [], invitations: [], friends: [], settings: { visibility, vote_mode: 'advisory', vote_hours: 24, owner_veto: false } });
    if (path === '/members') return json({ members: [] });
    if (path === '/stats') return json({ modes: {}, boxes: { forward: [2, 0, 0, 0, 0, 0], reverse: [2, 0, 0, 0, 0, 0] }, hardest: [] });
    if (path === '/history') return json({ more: false, events: [
      { id: '12', at: '2026-11-05T09:00:00.123456Z', action: 'added', field: null, old: null, new: null, by: 'Ann Helper', seeded: false, entry: { type: 'term', slug: 'nishiki-e', name: 'Ukiyo-e' }, detail: null },
      { id: '11', at: '2026-11-05T08:00:00Z', action: 'changed', field: 'name', old: 'Baroque', new: 'Baroque exam', by: 'Test Owner', seeded: false, entry: null, detail: null },
      { id: '10', at: '2026-11-01T12:00:00Z', action: 'created', field: null, old: null, new: null, by: 'Test Owner', seeded: false, entry: null, detail: null }] });
    if (path === '/proposals/3/decide') { open = false; return json({ outcome: 'accepted', proposals: [], count: 1 }); }
    if (path === '/proposals/3/vote') return json({ proposals: [proposal] });
    if (path === '/restore') return json({ restored: { removed: 1, added: 0 } });
    if (path === '/lock') { locked = body.get('locked') === '1'; return json({ set: set() }); }
    if (path === '/share') { visibility = body.get('visibility') === 'private' ? 'private' : 'shared'; return json({ set: set(), public_name: 'Test Owner' }); }
    return json({});
  });
  await answerDialogs(page);
  await page.goto('/sets/55');
  const box = page.locator('#sets-proposals');
  await expect(box).toContainText('Diego Velázquez');
  await expect(box).toContainText('remove Diego Velázquez');
  await expect(box).toContainText('proposed by Ann Helper');
  await expect(box.locator('.sets-proposal-how')).toContainText('the owner decides, seeing the votes');
  await expect(box.locator('.sets-votes')).toContainText('2 yes · 0 no · 0 abstain · 1 not voted yet');
  await box.locator('[data-vote="no"]').click();
  await expect.poll(() => posts).toContain('/proposals/3/vote:vote=no');
  await box.locator('[data-decide="accepted"]').click();
  await expect(box.locator('.sets-proposal')).toHaveCount(0);
  await expect(box.locator('.sets-decided')).toContainText('accepted');
  expect(posts).toContain('/proposals/3/decide:decision=accepted');

  // the history: who did what; the owner brings the set back to a step, by the step itself
  await page.locator('.sets-history summary').click();
  await expect(page.locator('.sets-history-list li').first()).toContainText('Ann Helper added Ukiyo-e');
  await expect(page.locator('.sets-history-list li').nth(1)).toContainText('changed the name: Baroque → Baroque exam');
  await page.locator('.sets-history-list li').nth(1).locator('.sets-restore').click();
  await expect(page.locator('dialog.site-dialog')).toHaveCount(0);           // asked and answered
  await expect.poll(() => posts).toContain('/restore:event=11&reason=');

  // lock, then private again: the members go (asked first)
  await page.locator('.sets-lock').click();
  await expect(page.locator('h1 .tag', { hasText: 'locked' })).toBeVisible();
  await expect(page.locator('.sets-lock')).toHaveText('Unlock');
  await page.locator('#sets-sharing summary').click();
  await page.locator('.sets-vis-form input[value=private]').check();
  await page.locator('.sets-vis-form button[type=submit]').click();
  await expect(page.locator('dialog.site-dialog')).toHaveCount(0);
  await expect.poll(() => posts.some((p) => p.startsWith('/share:visibility=private'))).toBe(true);
  await expect(page.locator('#sets-sharing .sets-share-msg')).toContainText('Private: only you see it now');
});

// 226: a set's members; someone hidden in the set's chat — their message a "hidden message" line, shown on a click
test('a set\'s members, and a hidden member\'s message in the set\'s chat', async ({ page }) => {
  await loggedIn(page);
  const posts: string[] = [];
  let hidden = true;
  await page.route(/^http:\/\/admin\.test\/site\/sets\/56(\/.*)?$/, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/site\/sets\/56/, '');
    const body = new URLSearchParams(req.postData() ?? '');
    if (req.method() === 'POST') posts.push(`${path}:${body.toString()}`);
    if (path === '/chat/hide') hidden = body.get('hide') !== '0';
    const json = (b: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b),
      headers: { 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' } });
    if (path === '') return json({ set: { id: '56', name: 'Fuji together', topic: null, description: null, visibility: 'private', code: null, count: 0, created_at: '2026-11-01T12:00:00Z',
      updated_at: '2026-11-05T09:00:00Z', role: 'editor', rights: 'full', chat_on: true, chat_allowed: true, vote_mode: 'advisory', vote_hours: 24, owner_veto: false,
      members: [{ id: '9', name: 'Me Editor', me: true, rights: 'full', chat: false }], creator: 'Ann Owner' }, items: [], proposals: [] });
    if (path === '/members') return json({ members: [
      { id: '8', name: 'Ann Owner', role: 'owner', rights: 'owner', via: null, since: '2026-11-01T12:00:00Z', added: 3, me: false, chat: true, chat_allowed: false, removed: false, hidden },
      { id: '9', name: 'Me Editor', role: 'editor', rights: 'full', via: 'link', since: '2026-11-02T12:00:00Z', added: 1, me: true, chat: true, chat_allowed: false, removed: false, hidden: false }] });
    if (path === '/chat') return json({ on: true, removed: false, more: false,
      members: [{ id: '8', name: 'Ann Owner', owner: true, removed: false, me: false, hidden }, { id: '9', name: 'Me Editor', owner: false, removed: false, me: true, hidden: false }],
      messages: [{ id: '1', kind: 'message', by: 'Ann Owner', by_id: '8', mine: false, body: 'Something unkind', at: '2026-11-05T09:00:00Z', deleted: null, hidden: hidden ? 'hidden' : null },
        { id: '2', kind: 'message', by: 'Cy Blocked', by_id: '10', mine: false, body: 'Spam from a blocked one', at: '2026-11-05T09:01:00Z', deleted: null, hidden: 'blocked' }] });
    if (path === '/stats') return json({ modes: {}, boxes: { forward: [0, 0, 0, 0, 0, 0], reverse: [0, 0, 0, 0, 0, 0] }, hardest: [] });
    if (path === '/chat/hide') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' } });
    return json({});
  });
  await page.goto('/sets/56');
  const members = page.locator('#sets-members');
  await expect(members.locator('li')).toHaveCount(2);
  await expect(members.locator('li').first()).toContainText('Ann Owner');
  await expect(members.locator('li').first()).toContainText('3 entries added');
  await expect(members.locator('li').first()).toContainText('hidden by you');
  await expect(members.locator('li').nth(1)).toContainText('Editor with full rights');
  await expect(page.locator('.sets-your-part')).toContainText('Your part: Editor with full rights');
  await expect(page.locator('.sets-your-part')).toContainText('given by the owner, Ann Owner');
  const chat = page.locator('#sets-chat');
  await expect(chat.locator('.chat-hidden').first()).toHaveText(/You have hidden this user's message\./);
  await expect(chat.locator('.chat-hidden').nth(1)).toContainText('You have blocked this user; their message is hidden.');
  await expect(chat).not.toContainText('Spam from a blocked one');
  await expect(chat).not.toContainText('Something unkind');
  await chat.locator('[data-reveal="1"]').click();
  await expect(chat).toContainText('Something unkind');
  // shown again for good, from the members list
  await members.locator('[data-hide="8"]').click();
  await expect.poll(() => posts).toContain('/chat/hide:account=8&hide=0');
  await expect(members.locator('li').first()).not.toContainText('hidden by you');
});

// 228: a member editing with approval — their part in plain words; a change proposed instead of made; a viewer sees no
// tools to change; an invitation from a friend, with what it gives, accepted from the list
test('rights on the member\'s side: editing with approval proposes; a viewer only reads; an invitation says what it gives', async ({ page }) => {
  await loggedIn(page);
  const posts: string[] = [];
  let rights = 'approval';
  let invited = true;
  let stale = true;   // the first Accept: the set was made private meanwhile
  const cors = { 'access-control-allow-origin': 'http://localhost:5180', 'access-control-allow-credentials': 'true' };
  await page.route(/^http:\/\/admin\.test\/site\/sets(\/57(\/.*)?|\/invitations\/57)?$/, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/site\/sets/, '');
    const body = new URLSearchParams(req.postData() ?? '');
    if (req.method() === 'POST') posts.push(`${path}:${body.toString()}`);
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b), headers: { ...cors, 'access-control-allow-origin': new URL(page.url()).origin } });
    if (path === '') return json({ sets: [], public_name: 'Me Member', topics: [], invitations: invited ? [{ set_id: 57, name: 'Fuji together', topic: 'Japanese art', creator: 'Ann Owner', rights: 'vote', chat: false,
      invited_at: '2026-11-05T09:00:00Z', vote_mode: 'binding', count: 2 }] : [] });
    if (path === '/invitations/57') {
      if (stale) { stale = false; invited = false; return json({ error: 'this invitation is no longer valid — the set was deleted or made private, or the owner withdrew it' }, 404); }
      invited = false; return json({ set: { id: '57' } });
    }
    if (path === '/57') return json({ set: { id: '57', name: 'Fuji together', topic: null, description: null, visibility: 'shared', code: null, count: 1, created_at: '2026-11-01T12:00:00Z',
      updated_at: '2026-11-05T09:00:00Z', role: rights === 'view' ? 'viewer' : 'editor', rights, chat_on: false, chat_allowed: rights !== 'view', vote_mode: 'binding', vote_hours: 6, owner_veto: true,
      members: [{ id: '9', name: 'Me Member', me: true, rights, chat: false }], creator: 'Ann Owner' },
      items: [{ type: 'artwork', slug: 'the-great-wave-off-kanagawa', name: 'The Great Wave', subtitle: null, image: null, own: false, added_at: '', added_by: 'Ann Owner', mine: false }], proposals: [], decided: [] });
    if (path === '/57/items/remove') return json({ proposed: true, proposal: { id: '4', procedure: 'approval', outcome: null } }, 202);
    if (path === '/57/members') return json({ members: [] });
    if (path === '/57/stats') return json({ modes: {}, boxes: { forward: [1, 0, 0, 0, 0, 0], reverse: [1, 0, 0, 0, 0, 0] }, hardest: [] });
    return json({});
  });
  await answerDialogs(page, 'Not on the exam');
  // the invitation in the list: who, which set, which rights — and what they mean here (binding votes)
  await page.goto('/sets');
  const inv = page.locator('.sets-invitations li');
  await expect(inv).toContainText('Ann Owner invites you to Fuji together');
  await expect(inv).toContainText('as Editor with votes');
  await expect(inv.locator('.sets-invitation-rights')).toContainText('more Yes than No accepts the change');
  await inv.locator('[data-accept="1"]').click();
  // no longer valid: a sentence that says why, and the list as it is now
  await expect(page.locator('.sets-msg')).toContainText('This invitation is no longer valid — the set was deleted or made private');
  await expect(page.locator('.sets-invitations')).toHaveCount(0);
  invited = true;
  await page.reload();
  await page.locator('.sets-invitations [data-accept="1"]').click();
  await expect(page).toHaveURL(/\/sets\/57$/);
  expect(posts).toContain('/invitations/57:accept=1');

  // editing with approval: the part explained; the tools propose
  const part = page.locator('.sets-your-part');
  await expect(part).toContainText('Your part: Editor with approval');
  await expect(part).toContainText('given by the owner, Ann Owner');
  await expect(part).toContainText('Votes in this set:');
  await expect(part).toContainText('The owner keeps a veto');
  await expect(page.locator('.sets-edit summary')).toHaveText('Propose a new name, topic, description');
  await page.locator('.sets-propose').click();
  await expect(page.locator('dialog.site-dialog')).toHaveCount(0);
  await expect.poll(() => posts).toContain('/57/items/remove:type=artwork&slug=the-great-wave-off-kanagawa&reason=Not+on+the+exam');
  await expect(page.locator('.sets-msg')).toContainText('it applies once the owner accepts it');

  // a viewer: reads and studies — no tools to change, no history
  rights = 'view';
  await page.reload();
  await expect(part).toContainText('Your part: Viewer');
  await expect(part).toContainText('Changes nothing and votes on nothing');
  await expect(page.locator('.sets-edit')).toHaveCount(0);
  await expect(page.locator('.sets-history')).toHaveCount(0);
  await expect(page.locator('.sets-propose, .sets-remove')).toHaveCount(0);
  await expect(page.locator('.sets-study')).toBeVisible();
});

// 229: every round with the set as it was — also for a set since deleted; a version saved again as a new set
test('your results: rounds by set, each with the set as it was; a deleted set\'s results stay; saved again as a set', async ({ page }) => {
  const account = await loggedIn(page);
  account.sets.push({ id: '1', name: 'Edo prints', topic: 'Japanese art', description: null, visibility: 'private', code: null,
    items: [{ type: 'artwork', slug: 'the-great-wave-off-kanagawa', name: 'The Great Wave off Kanagawa' }, { type: 'term', slug: 'nishiki-e', name: 'Ukiyo-e' }] });
  const posts: string[] = [];
  const cors = () => ({ 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' });
  await page.route(/^http:\/\/admin\.test\/site\/sets\/results(\/.*)?$/, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/site\/sets\/results/, '');
    if (req.method() === 'POST') posts.push(`${path}:${req.postData() ?? ''}`);
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b), headers: cors() });
    if (path === '') return json({ more: false, sets: [{ key: '31', name: 'Edo exam', topic: 'Japanese art', access: null, id: null, code: null, rounds: [
      { id: '2', at: '2026-11-05T10:00:00Z', mode: 'typed', answered: 4, known: 3, seconds: 120, complete: true, snapshot: { id: '8', name: 'Edo exam', item_count: 2, taken_at: '2026-11-05T10:00:00Z' } },
      { id: '1', at: '2026-11-04T10:00:00Z', mode: 'forward', answered: 3, known: 1, seconds: 40, complete: false, snapshot: { id: '7', name: 'Edo prints', item_count: 3, taken_at: '2026-11-04T10:00:00Z' } }] }] });
    if (path === '/snapshots/7') return json({ snapshot: { id: '7', name: 'Edo prints', topic: 'Japanese art', description_html: '<p>For the <strong>exam</strong></p>', taken_at: '2026-11-04T10:00:00Z',
      items: [{ type: 'artwork', name: 'The Great Wave', slug: 'the-great-wave-off-kanagawa', now_name: 'The Great Wave off Kanagawa' }, { type: 'term', name: 'Ukiyo-e', slug: 'nishiki-e', now_name: 'Ukiyo-e' },
        { type: 'artist', name: 'A deleted painter', slug: null, now_name: null }] } });
    if (path === '/snapshots/7/copy') return json({ set: { id: '1', name: 'Edo prints', entries: 2, missing: 1 } }, 201);
    return json({});
  });
  await page.goto('/sets/results');
  const set = page.locator('.results-set');
  await expect(set.locator('h2')).toContainText('Edo exam');
  await expect(set.locator('h2 .tag')).toHaveText('no longer available');
  await expect(set).toContainText('2 rounds · 57 % known');
  await expect(set.locator('tbody tr').nth(1)).toContainText('1 of 3 (33 %)');
  await expect(set.locator('tbody tr').nth(1)).toContainText('left early');
  // the set as it was for the older round: its text, its entries (renamed since, deleted since)
  await set.locator('[data-snapshot="7"]').click();
  const then = set.locator('.results-snapshot');
  await expect(then.locator('h3')).toContainText('Edo prints');
  await expect(then.locator('strong')).toHaveText('exam');
  await expect(then.locator('li').first()).toContainText('now “The Great Wave off Kanagawa”');
  await expect(then.locator('li').nth(2)).toContainText('no longer on the site');
  await then.locator('[data-copy-this]').click();
  await expect(page).toHaveURL(/\/sets\/1\?missing=1$/);
  expect(posts).toContain('/snapshots/7/copy:');
  await expect(page.locator('.sets-msg')).toContainText('1 entry of that version is no longer on the site');
});

test('the account menu in the header: logged out Log in and Sign up; logged in the pages, unread messages, Log out', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loggedIn(page);
  await page.goto('/artworks');
  const button = page.locator('.site-header .account-button');
  await expect(button.locator('.account-initial')).toHaveText('T');
  await expect(page.locator('.site-footer .account')).toHaveCount(0);                    // no longer in the footer
  await expect(page.locator('.nav a', { hasText: 'Sets' })).toHaveAttribute('href', '/sets');
  await expect(page.locator('.account-items')).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.account-items [role=menuitem]')).toHaveText(['Study sets', 'Your results', 'Your views', /^Friends/, 'Your account', 'Log out']);
  await page.keyboard.press('Escape');                                                    // closed (focus in the menu first)
  await button.press('ArrowDown');
  await expect(page.locator('.account-items a').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.account-items')).toBeHidden();
  await button.click();
  await page.locator('.account-items a', { hasText: 'Your account' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator('.account-items')).toBeHidden();
  await expect(page.locator('.nav a.current')).toHaveCount(0);
  await page.goto('/sets');
  await expect(page.locator('.nav a.current')).toHaveText('Sets');

  // visitors: Log in and Sign up, both back to the page they were on; Sets leads to the shared sets
  const visitor = await browser.newPage();
  await loggedIn(visitor, { login: false });
  await visitor.goto('/quiz');
  await expect(visitor.locator('.account-login')).toHaveAttribute('href', /^http:\/\/admin\.test\/login\?next=.*%2Fquiz%3Flogin%3D1/);
  await expect(visitor.locator('.account-signup')).toHaveAttribute('href', /^http:\/\/admin\.test\/signup\?next=/);
  // the site's light/dark choice goes along (the login pages live on another origin, 2026-11-06)
  await expect(visitor.locator('.account-login')).toHaveAttribute('href', /&theme=auto$/);
  await visitor.evaluate(() => localStorage.setItem('arthistory:theme', 'light'));
  await visitor.locator('.account-login').dispatchEvent('pointerdown');
  await expect(visitor.locator('.account-login')).toHaveAttribute('href', /&theme=light$/);
  await expect(visitor.locator('.account-signup')).toHaveAttribute('href', /&theme=light$/);
  await expect(visitor.locator('.nav a', { hasText: 'Sets' })).toHaveAttribute('href', '/sets/shared');
  await visitor.close();
  expect(errors).toEqual([]);
});
