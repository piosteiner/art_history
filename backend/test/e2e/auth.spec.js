// Login, logout, and the protections around them (cross-site posts, the live WebSocket).
const WebSocket = require('ws');
const { test, expect, login } = require('./helpers');
const { BASE, PORT } = require('./env');

test('logged out: pages redirect to the login, posts are refused', async ({ page, request }) => {
  await page.goto('/artists');
  await expect(page).toHaveURL(/\/login$/);
  const res = await request.post(`${BASE}/artists`, { headers: { Origin: BASE }, form: { slug: 'x' }, maxRedirects: 0 });
  expect(res.status()).toBe(401);
});

test('wrong password is rejected with a message', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#u', 'tester');
  await page.fill('#p', 'not-the-password');
  await page.click('button');
  await expect(page.locator('.flash.error')).toHaveText(/Wrong username or password/);
});

test('login, dashboard, logout', async ({ browser }) => {
  // its own login: logging out ends the session, so not the shared one of the other tests (helpers.js)
  const userA = await login(browser, 'tester');
  await expect(userA.locator('h1')).toHaveText('Dashboard');
  await expect(userA.locator('.card').first()).toBeVisible();
  await userA.click('form[action="/logout"] button');
  await expect(userA).toHaveURL(/\/login$/);
  await userA.goto('/');
  await expect(userA).toHaveURL(/\/login$/);
  await userA.context().close();
});

test('a post from another site is refused even with a valid session', async ({ userA }) => {
  const res = await userA.request.post(`${BASE}/artists`, { headers: { Origin: 'https://evil.example' }, form: { slug: 'evil' } });
  expect(res.status()).toBe(403);
});

test('the live WebSocket needs a session and the admin origin', async ({ userA }) => {
  const cookies = await userA.context().cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const attempt = (headers, path = '/live') => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`, { headers: { Host: `admin.localhost:${PORT}`, ...headers } });
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('error', () => {});
  });
  expect(await attempt({ Origin: BASE })).toBe(401);                            // no session
  expect(await attempt({ Origin: 'https://evil.example', Cookie: cookie })).toBe(403);  // foreign origin
  expect(await attempt({ Origin: BASE, Cookie: cookie }, '/other')).toBe(404);  // wrong path
  expect(await attempt({ Origin: BASE, Cookie: cookie })).toBe('open');
});

// The site's login (owner 2026-11-06): the redirect back to the site after the form is allowed by the page's
// Content-Security-Policy (form-action) — Chromium stops it otherwise and the page just stays; the login and sign-up
// pages take the site's light/dark choice (?theme=, kept for the tab) and lead back to the site.
test('logging in from the site: back to the site (Chromium checks form-action on the redirect), the site\'s theme, a way back', async ({ browser }) => {
  const fs = require('fs');
  const { AUTH_FILE } = require('./env');
  const SITE = 'https://arthistory.piogino.ch';
  const next = `${SITE}/sets?login=1`;
  const context = await browser.newContext({ baseURL: BASE, serviceWorkers: 'block' });
  const page = await context.newPage();
  // the document after the redirect can't be intercepted (Playwright, Chromium); what it would load is refused
  await page.route('**/*', (route) => (route.request().url().startsWith(`${SITE}/`) ? route.abort() : route.continue()));
  const res = await page.goto(`/login?${new URLSearchParams({ next, theme: 'light' })}`);
  expect(res.headers()['content-security-policy']).toContain(`form-action 'self' ${SITE}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.login-back a')).toHaveAttribute('href', next);
  // the sign-up page in the same tab keeps the site's choice and leads back too
  await page.goto(`/signup?${new URLSearchParams({ next })}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.login-back a')).toHaveAttribute('href', next);
  await page.goto(`/login?${new URLSearchParams({ next, theme: 'auto' })}`);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  await page.fill('#u', 'tester2');
  await page.fill('#p', JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')).tester2);
  // the form's redirect reaches the site (before the fix, Chromium stayed on the login page)
  await Promise.all([page.waitForURL(next, { waitUntil: 'commit' }), page.click('form[action="/login"] button')]);
  await context.close();
});
