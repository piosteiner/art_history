# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor.spec.js >> artwork list shows 120 px thumbnails, the artwork page a larger preview with credit
- Location: test/e2e/editor.spec.js:53:1

# Error details

```
Error: Command failed: psql -X -h localhost -U arthistory_owner -d arthistory_test -Atc INSERT INTO images (artwork_id, url, license, credit) VALUES (entity_id('artwork', 'the-great-wave-off-kanagawa'),
    'https://upload.wikimedia.org/wikipedia/commons/b/b5/Great_Wave.jpg', 'Public domain', 'Katsushika Hokusai')
ERROR:  duplicate key value violates unique constraint "images_artwork_url"
DETAIL:  Key (artwork_id, url)=(6, https://upload.wikimedia.org/wikipedia/commons/b/b5/Great_Wave.jpg) already exists.

```

# Test source

```ts
  1  | // Fixtures and helpers for the specs.
  2  | //   test('…', async ({ userA, userB }) => …)   two logged-in users (tester, tester2), each in its own browser context;
  3  | //                                                every page records script errors — a spec fails if any occurred
  4  | //   sql('SELECT …')                             a query against the test database (as owner), result as text
  5  | //   await settled()                             derived data (stored graph, search fields, findings) caught up
  6  | const fs = require('fs');
  7  | const { execFileSync } = require('child_process');
  8  | const { test: base, expect } = require('@playwright/test');
  9  | const { AUTH_FILE, DB, BASE, API, sessionFile } = require('./env');
  10 | 
> 11 | const sql = (q) => execFileSync('psql', ['-X', '-h', 'localhost', '-U', 'arthistory_owner', '-d', DB, '-Atc', q]).toString().trim();
     |                    ^ Error: Command failed: psql -X -h localhost -U arthistory_owner -d arthistory_test -Atc INSERT INTO images (artwork_id, url, license, credit) VALUES (entity_id('artwork', 'the-great-wave-off-kanagawa'),
  12 | // Derived data — search fields, findings, the stored graph and the list rows the API reads (125–127) — follows a
  13 | // change within a moment: the server's worker empties derived_queue and list_queue. Wait for that before reading
  14 | // what derives from a change.
  15 | const settled = () => expect.poll(() => sql('SELECT (SELECT count(*) FROM derived_queue) + (SELECT count(*) FROM list_queue)'),
  16 |   { timeout: 15000 }).toBe('0');
  17 | 
  18 | // A change made the way the admin panel makes it (admin role, tagged source 'admin') → its txid, for revert tests.
  19 | function adminChange(statement) {
  20 |   // Separate -c commands run one after another in the same session (SQL and \meta-commands can't share one -c).
  21 |   const out = execFileSync('psql', ['-X', '-q', '-h', 'localhost', '-U', 'arthistory_admin', '-d', DB, '-At', '-v', 'ON_ERROR_STOP=1',
  22 |     '-c', 'BEGIN', '-c', "SELECT set_config('arthistory.source', 'admin', true)", '-c', statement,
  23 |     '-c', 'SELECT pg_current_xact_id()::text', '-c', 'COMMIT']).toString().trim().split('\n');
  24 |   return out[out.length - 1];
  25 | }
  26 | 
  27 | async function login(browser, user) {
  28 |   const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  29 |   const context = await browser.newContext({ baseURL: BASE });
  30 |   const page = await context.newPage();
  31 |   page.jsErrors = [];
  32 |   page.on('pageerror', (e) => page.jsErrors.push(e.message));
  33 |   await page.goto('/login');
  34 |   await page.fill('#u', user);
  35 |   await page.fill('#p', auth[user]);
  36 |   await Promise.all([page.waitForURL('**/'), page.click('button')]);
  37 |   return page;
  38 | }
  39 | 
  40 | // A logged-in user: a fresh browser context (own cookies, storage, pages) with the session global-setup.js logged in
  41 | // once per run — no login form per test. A test that logs out uses login() instead: it would end the shared session.
  42 | async function asUser(browser, user) {
  43 |   const context = await browser.newContext({ baseURL: BASE, storageState: sessionFile(user) });
  44 |   const page = await context.newPage();
  45 |   page.jsErrors = [];
  46 |   page.on('pageerror', (e) => page.jsErrors.push(e.message));
  47 |   return page;
  48 | }
  49 | 
  50 | const test = base.extend({
  51 |   // this worker's own test server (env.js: one shard per worker) — for page.goto('/…') and request
  52 |   baseURL: async ({}, use) => { await use(BASE); },
  53 |   userA: async ({ browser }, use) => {
  54 |     const page = await asUser(browser, 'tester');
  55 |     await use(page);
  56 |     expect(page.jsErrors, 'script errors on the page').toEqual([]);
  57 |     await page.context().close();
  58 |   },
  59 |   userB: async ({ browser }, use) => {
  60 |     const page = await asUser(browser, 'tester2');
  61 |     await use(page);
  62 |     expect(page.jsErrors, 'script errors on the page').toEqual([]);
  63 |     await page.context().close();
  64 |   },
  65 | });
  66 | 
  67 | // The status pill of the live connection says it is connected to the shared working copy.
  68 | const liveReady = (page) => expect(page.locator('.live-status')).toHaveText(/Live/, { timeout: 15000 });
  69 | 
  70 | // Submit the entity form (Save / Publish / Create) and wait for the redirect.
  71 | async function submitForm(page) {
  72 |   await Promise.all([page.waitForNavigation(), page.click('form.form > .actions button')]);
  73 | }
  74 | 
  75 | module.exports = { test, expect, sql, settled, adminChange, login, liveReady, submitForm, API, BASE };
  76 | 
```