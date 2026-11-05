// Accounts (migration 220, src/admin/routes/accounts.js, signup.js, site-account.js): admins manage accounts in the
// CMS; site-only accounts (members) never reach the CMS; sign-up when open; an account's own settings on the site.
const { request: pw } = require('@playwright/test');
const { test, expect, sql } = require('./helpers');
const { BASE } = require('./env');

const SITE = 'https://arthistory.piogino.ch';   // config.corsOrigin's default
const cleanup = () => sql(`DELETE FROM admin_users WHERE username LIKE 'test-acc-%'; DELETE FROM account_log WHERE username LIKE 'test-acc-%';
  UPDATE site_settings SET value = 'false' WHERE key = 'signup_open'; UPDATE site_settings SET value = '50' WHERE key = 'signup_daily_limit'`);
test.beforeAll(cleanup);
test.afterAll(cleanup);

/** A fresh browser-less client, logged in as `username` (no redirects followed). */
async function loginAs(username, password) {
  const http = await pw.newContext({ baseURL: BASE });
  const res = await http.post('/login', { form: { username, password }, headers: { Origin: BASE }, maxRedirects: 0 });
  return { http, res };
}

test('admins create, change, switch off and delete accounts; a site-only account never reaches the CMS', async ({ userA, userB }) => {
  // only admins see the page (tester2 is a CMS editor)
  expect((await userB.goto('/accounts')).status()).toBe(403);
  await userB.goto('/');
  await expect(userB.locator('nav a[href="/accounts"]')).toHaveCount(0);

  await userA.goto('/accounts');
  await expect(userA.locator('nav a[href="/accounts"]')).toBeVisible();
  await userA.locator('summary', { hasText: 'New account' }).click();
  await userA.fill('#a-u', 'test-acc-student');
  await userA.selectOption('select[name="role"]', 'member');
  await userA.fill('#a-n', 'Test Student');
  await Promise.all([userA.waitForURL('**/accounts/new'), userA.click('form[action="/accounts/new"] button')]);
  const password = await userA.locator('.password-once code').innerText();
  expect(password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  expect(sql("SELECT role || ' ' || created_via || ' ' || public_name FROM admin_users WHERE username = 'test-acc-student'")).toBe('member cms Test Student');

  // the member logs in: back to the site, never the CMS
  const { http, res } = await loginAs('test-acc-student', password);
  expect(res.status()).toBe(303);
  expect(res.headers().location).toBe(`${SITE}/sets?login=1`);
  const cms = await http.get('/', { maxRedirects: 0 });
  expect(cms.status()).toBe(403);
  expect(await cms.text()).toContain('No access to the CMS');
  expect((await http.post('/artworks/new', { headers: { Origin: BASE }, form: { title: 'x' }, maxRedirects: 0 })).status()).toBe(403);
  const me = await (await http.get('/site/me', { headers: { Origin: SITE } })).json();
  expect(me).toEqual({ username: 'test-acc-student', role: 'member', cms: false, public_name: 'Test Student' });

  // made a CMS editor: the CMS opens
  const id = sql("SELECT id FROM admin_users WHERE username = 'test-acc-student'");
  await userA.goto(`/accounts/${id}`);
  await userA.selectOption('select[name="role"]', 'editor');
  await Promise.all([userA.waitForURL(/ok=saved/), userA.click('form.accounts-box button:has-text("Save")')]);
  expect((await http.get('/', { maxRedirects: 0 })).status()).toBe(200);

  // switched off: logged out, no login; on again: a login works
  userA.on('dialog', (d) => d.accept());
  await Promise.all([userA.waitForURL(/ok=disabled/), userA.click('button:has-text("Switch off")')]);
  expect((await http.get('/site/me', { headers: { Origin: SITE } })).status()).toBe(401);
  const off = await loginAs('test-acc-student', password);
  expect(off.res.status()).toBe(401);
  expect(await off.res.text()).toContain('switched off');
  await Promise.all([userA.waitForURL(/ok=enabled/), userA.click('button:has-text("Switch on again")')]);

  // a new password: shown once, the old one stops working
  await Promise.all([userA.waitForURL(/password$/), userA.click('button:has-text("New password")')]);
  const fresh = await userA.locator('.password-once code').innerText();
  expect((await loginAs('test-acc-student', password)).res.status()).toBe(401);
  expect((await loginAs('test-acc-student', fresh)).res.status()).toBe(303);

  // the log; not one's own account; deleted only with its name typed
  await userA.goto(`/accounts/${id}`);
  await expect(userA.locator('h2:has-text("Log") + table')).toContainText('switched off');
  await expect(userA.locator('h2:has-text("Log") + table')).toContainText('role changed');
  await userA.locator('summary', { hasText: 'Delete the account' }).click();
  await userA.fill('input[name="confirm"]', 'wrong');
  await Promise.all([userA.waitForURL(/error=/), userA.click('button.danger')]);
  await userA.locator('summary', { hasText: 'Delete the account' }).click();
  await userA.fill('input[name="confirm"]', 'test-acc-student');
  await Promise.all([userA.waitForURL(/ok=deleted/), userA.click('button.danger')]);
  // kept 30 days (221): no login, its sets hidden; restored by an admin — with its old password and its set
  sql(`INSERT INTO study_sets (owner_id, name, visibility, share_code) SELECT id, 'Test set kept', 'link', 'TestKept1234' FROM admin_users WHERE username = 'test-acc-student'`);
  expect(sql("SELECT deleted_at IS NOT NULL AND disabled_at IS NOT NULL FROM admin_users WHERE username = 'test-acc-student'")).toBe('t');
  const gone = await loginAs('test-acc-student', fresh);
  expect(await gone.res.text()).toContain('deleted');
  expect((await userA.request.get('/site/shared/TestKept1234', { headers: { Origin: SITE } })).status()).toBe(404);
  await userA.goto('/accounts?q=test-acc-student');
  await expect(userA.locator('.accounts-list')).toContainText('deleted — restorable until');
  await userA.goto(`/accounts/${id}`);
  await Promise.all([userA.waitForURL(/ok=restored/), userA.click('button:has-text("Restore the account")')]);
  expect((await loginAs('test-acc-student', fresh)).res.status()).toBe(303);
  expect((await userA.request.get('/site/shared/TestKept1234', { headers: { Origin: SITE } })).status()).toBe(200);
  await expect(userA.locator('h2:has-text("Log") + table')).toContainText('restored after deletion');
  // after 30 days: gone for good, with its set
  sql(`UPDATE admin_users SET disabled_at = now() - interval '31 days', deleted_at = now() - interval '31 days' WHERE username = 'test-acc-student'; SELECT purge_deleted_accounts()`);
  expect(sql("SELECT count(*) FROM admin_users WHERE username = 'test-acc-student'")).toBe('0');
  expect(sql("SELECT count(*) FROM study_sets WHERE name = 'Test set kept'")).toBe('0');
  const own = sql("SELECT id FROM admin_users WHERE username = 'tester'");
  await userA.goto(`/accounts/${own}`);
  await expect(userA.locator('button:has-text("Switch off")')).toHaveCount(0);
  await expect(userA.locator('select[name="role"]')).toBeDisabled();
  await http.dispose();
});

test('the database keeps one active admin', async () => {
  expect(() => sql("UPDATE admin_users SET role = 'editor' WHERE role = 'admin'")).toThrow(/at least one active admin/);
  expect(() => sql("UPDATE admin_users SET disabled_at = now() WHERE role = 'admin'")).toThrow(/at least one active admin/);
  expect(sql("SELECT count(*) FROM admin_users WHERE role = 'admin' AND disabled_at IS NULL")).not.toBe('0');
});

test('sign-up: only when open, a site-only account, logged in and back to the site; brakes', async ({ userA }) => {
  const http = await pw.newContext({ baseURL: BASE });
  const signup = (form) => http.post('/signup', { form: { password2: form.password, privacy: '1', ...form }, headers: { Origin: BASE }, maxRedirects: 0 });
  expect(await (await http.get('/signup')).text()).toContain('Sign-up is closed');
  expect((await signup({ username: 'test-acc-new', password: 'a long secret 1' })).status()).toBe(403);
  expect((await (await http.get('/site/signup', { headers: { Origin: SITE } })).json()).open).toBe(false);

  // the admin opens it on the Accounts page
  await userA.goto('/accounts');
  await userA.check('input[name="signup_open"]');
  await Promise.all([userA.waitForURL(/ok=settings/), userA.click('form[action="/accounts/settings"] button')]);
  expect((await (await http.get('/site/signup', { headers: { Origin: SITE } })).json()).open).toBe(true);
  expect(await (await http.get('/login')).text()).toContain('Create one');

  // what doesn't do
  expect(await (await signup({ username: 'test-acc-new', password: 'short' })).text()).toContain('at least 10');
  expect(await (await signup({ username: 'test-acc-new', password: 'my test-acc-new pw' })).text()).toContain('must not contain the username');
  expect(await (await signup({ username: 'test-acc-new', password: 'a long secret 1', password2: 'another one 2' })).text()).toContain('differ');
  expect(await (await signup({ username: 'Bad Name!', password: 'a long secret 1' })).text()).toContain('2–40 small letters');
  expect(await (await signup({ username: 'test-acc-new', password: 'a long secret 1', privacy: '' })).text()).toContain('privacy statement');
  expect(await (await signup({ username: 'test-acc-bot', password: 'a long secret 1', website: 'http://spam' })).text()).toContain('went wrong');
  expect(await (await signup({ username: 'tester', password: 'a long secret 1' })).text()).toContain('taken');
  expect(sql("SELECT count(*) FROM admin_users WHERE username IN ('test-acc-new', 'test-acc-bot')")).toBe('0');

  // an account: a member, logged in, back to the site
  const res = await signup({ username: 'Test-Acc-New', password: 'a long secret 1', public_name: 'Test Newcomer', next: `${SITE}/quiz?login=1` });
  expect(res.status()).toBe(303);
  expect(res.headers().location).toBe(`${SITE}/quiz?login=1`);
  expect(sql("SELECT role || ' ' || created_via || ' ' || public_name FROM admin_users WHERE username = 'test-acc-new'")).toBe('member signup Test Newcomer');
  expect((await (await http.get('/site/me', { headers: { Origin: SITE } })).json()).role).toBe('member');
  expect(sql("SELECT action FROM account_log WHERE username = 'test-acc-new'")).toBe('signed_up');

  // the day's limit closes it
  sql("UPDATE site_settings SET value = '1' WHERE key = 'signup_daily_limit'");
  expect((await (await http.get('/site/signup', { headers: { Origin: SITE } })).json()).open).toBe(false);
  const visitor = await pw.newContext({ baseURL: BASE });
  expect(await (await visitor.get('/signup')).text()).toContain('Too many new accounts today');
  await visitor.dispose();
  await http.dispose();
});

test('an account on the site: public name, password, log out elsewhere, delete itself (site-only accounts only)', async ({ userA }) => {
  sql("UPDATE site_settings SET value = 'true' WHERE key = 'signup_open'; UPDATE site_settings SET value = '50' WHERE key = 'signup_daily_limit'");
  const S = { Origin: SITE };
  const http = await pw.newContext({ baseURL: BASE });
  expect((await http.post('/signup', { form: { username: 'test-acc-self', password: 'first secret 1', password2: 'first secret 1', privacy: '1' }, headers: { Origin: BASE }, maxRedirects: 0 })).status()).toBe(303);
  const other = (await loginAs('test-acc-self', 'first secret 1')).http;   // a second session

  const account = await (await http.get('/site/account', { headers: S })).json();
  expect(account).toEqual(expect.objectContaining({ username: 'test-acc-self', role: 'member', cms: false, public_name: null, created_via: 'signup', sessions: 2, sets: 0 }));
  expect((await http.post('/site/account/public-name', { headers: S, form: { public_name: 'test-acc-self' } })).status()).toBe(422);
  expect((await (await http.post('/site/account/public-name', { headers: S, form: { public_name: 'Test Self' } })).json()).public_name).toBe('Test Self');

  // a new password: the current one asked; the other session ends, this one stays
  expect((await http.post('/site/account/password', { headers: S, form: { current: 'wrong', password: 'second secret 2', password2: 'second secret 2' } })).status()).toBe(403);
  expect((await http.post('/site/account/password', { headers: S, form: { current: 'first secret 1', password: 'second secret 2', password2: 'second secret 2' } })).status()).toBe(204);
  expect((await other.get('/site/me', { headers: S })).status()).toBe(401);
  expect((await http.get('/site/me', { headers: S })).status()).toBe(200);

  // a CMS account isn't deleted from the site
  expect((await userA.request.post('/site/account/delete', { headers: S, form: { password: 'x' } })).status()).toBe(403);
  // the member deletes itself: kept 30 days (an admin can restore it on request), then everything goes (221)
  sql("INSERT INTO study_sets (owner_id, name) SELECT id, 'Test set of a leaver' FROM admin_users WHERE username = 'test-acc-self'");
  expect((await http.post('/site/account/delete', { headers: S, form: { password: 'first secret 1' } })).status()).toBe(403);
  expect((await http.post('/site/account/delete', { headers: S, form: { password: 'second secret 2' } })).status()).toBe(204);
  expect(sql("SELECT deleted_at IS NOT NULL FROM admin_users WHERE username = 'test-acc-self'")).toBe('t');
  expect((await http.get('/site/me', { headers: S })).status()).toBe(401);
  expect((await loginAs('test-acc-self', 'second secret 2')).res.status()).toBe(401);
  sql(`UPDATE admin_users SET deleted_at = now() - interval '31 days' WHERE username = 'test-acc-self'; SELECT purge_deleted_accounts()`);
  expect(sql("SELECT count(*) FROM admin_users WHERE username = 'test-acc-self'")).toBe('0');
  expect(sql("SELECT count(*) FROM study_sets WHERE name = 'Test set of a leaver'")).toBe('0');
  expect(sql("SELECT count(*) FROM account_log WHERE username = 'test-acc-self'")).toBe('0');
  await http.dispose();
  await other.dispose();
});

// 222: an account for the test environment — made here, refused here; marked in the list; found with the filter
test('an account for the test environment: created here, refused by the live login, marked and filtered', async ({ userA }) => {
  await userA.goto('/accounts?new=1');
  await userA.fill('#a-u', 'test-acc-tester-env');
  await userA.selectOption('select[name="role"] >> nth=0', 'editor');
  await userA.check('input[name="env"][value="test"]');
  await userA.fill('#a-p', 'a test env secret 7');
  await Promise.all([userA.waitForURL(/ok=created/), userA.click('button:has-text("Create account")')]);
  await expect(userA.locator('h1 .account-test')).toHaveText('test environment');
  await expect(userA.locator('.flash')).toContainText('not set up on this server');          // no test database in the e2e run
  expect(sql("SELECT test_env::text || role::text FROM admin_users WHERE username = 'test-acc-tester-env'")).toBe('trueeditor');
  const live = await loginAs('test-acc-tester-env', 'a test env secret 7');
  expect(live.res.status()).toBe(401);
  expect(await live.res.text()).toContain('test environment');
  await userA.goto('/accounts?env=test');
  await expect(userA.locator('.accounts-list tbody tr')).toHaveCount(1);
  await expect(userA.locator('h2.accounts-search-title')).toHaveText('User search');
  await expect(userA.locator('.accounts-search button')).toHaveText('Search');
  // a test admin keeps no one able to log in here: the last live admin still can't be switched off
  expect(() => sql("UPDATE admin_users SET role = 'admin' WHERE username = 'test-acc-tester-env'; UPDATE admin_users SET disabled_at = now() WHERE NOT test_env AND role = 'admin'")).toThrow(/active admin/);
  // deleted: gone at once, not kept 30 days (owner 2026-11-05)
  const id = sql("SELECT id FROM admin_users WHERE username = 'test-acc-tester-env'");
  sql("UPDATE admin_users SET role = 'editor' WHERE username = 'test-acc-tester-env'");
  await userA.goto(`/accounts/${id}`);
  await expect(userA.locator('details.danger')).toContainText('not kept');
  await userA.locator('summary', { hasText: 'Delete the account' }).click();
  await userA.fill('input[name="confirm"]', 'test-acc-tester-env');
  await Promise.all([userA.waitForURL(/ok=deleted_test/), userA.click('button.danger')]);
  expect(sql("SELECT count(*) FROM admin_users WHERE username = 'test-acc-tester-env'")).toBe('0');
  await live.http.dispose();
});

// the sign-up form (owner 2026-11-05): the username is said to be for logging in only, the public name why; the
// privacy box its own size with its sentence in one block
test('the sign-up form explains username and public name; the privacy box sits beside one sentence', async ({ browser }) => {
  sql("UPDATE site_settings SET value = 'true' WHERE key = 'signup_open'");
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await page.goto('/signup');
    await expect(page.locator('label[for="u"]')).toContainText('only for logging in, never shown to anyone');
    await expect(page.locator('.field', { has: page.locator('#n') }).locator('.hint')).toContainText('when you share a set');
    const box = await page.locator('input[name="privacy"]').boundingBox();
    const text = await page.locator('label.check > span').boundingBox();
    expect(box.width).toBeLessThan(30);
    expect(text.width).toBeGreaterThan(250);   // one block of text, not words in columns
  } finally {
    sql("UPDATE site_settings SET value = 'false' WHERE key = 'signup_open'");
    await ctx.close();
  }
});
