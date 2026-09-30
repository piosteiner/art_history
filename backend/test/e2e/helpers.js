// Fixtures and helpers for the specs.
//   test('…', async ({ userA, userB }) => …)   two logged-in users (tester, tester2), each in its own browser context;
//                                                every page records script errors — a spec fails if any occurred
//   sql('SELECT …')                             a query against the test database (as owner), result as text
const fs = require('fs');
const { execFileSync } = require('child_process');
const { test: base, expect } = require('@playwright/test');
const { AUTH_FILE, DB, BASE } = require('./env');

const sql = (q) => execFileSync('psql', ['-X', '-h', 'localhost', '-U', 'arthistory_owner', '-d', DB, '-Atc', q]).toString().trim();

// A change made the way the admin panel makes it (admin role, tagged source 'admin') → its txid, for revert tests.
function adminChange(statement) {
  // Separate -c commands run one after another in the same session (SQL and \meta-commands can't share one -c).
  const out = execFileSync('psql', ['-X', '-q', '-h', 'localhost', '-U', 'arthistory_admin', '-d', DB, '-At', '-v', 'ON_ERROR_STOP=1',
    '-c', 'BEGIN', '-c', "SELECT set_config('arthistory.source', 'admin', true)", '-c', statement,
    '-c', 'SELECT pg_current_xact_id()::text', '-c', 'COMMIT']).toString().trim().split('\n');
  return out[out.length - 1];
}

async function login(browser, user) {
  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  page.jsErrors = [];
  page.on('pageerror', (e) => page.jsErrors.push(e.message));
  await page.goto('/login');
  await page.fill('#u', user);
  await page.fill('#p', auth[user]);
  await Promise.all([page.waitForURL('**/'), page.click('button')]);
  return page;
}

const test = base.extend({
  userA: async ({ browser }, use) => {
    const page = await login(browser, 'tester');
    await use(page);
    expect(page.jsErrors, 'script errors on the page').toEqual([]);
    await page.context().close();
  },
  userB: async ({ browser }, use) => {
    const page = await login(browser, 'tester2');
    await use(page);
    expect(page.jsErrors, 'script errors on the page').toEqual([]);
    await page.context().close();
  },
});

// The status pill of the live connection says it is connected to the shared working copy.
const liveReady = (page) => expect(page.locator('.live-status')).toHaveText(/Live/, { timeout: 15000 });

// Submit the entity form (Save / Publish / Create) and wait for the redirect.
async function submitForm(page) {
  await Promise.all([page.waitForNavigation(), page.click('form.form > .actions button')]);
}

module.exports = { test, expect, sql, adminChange, login, liveReady, submitForm };
