// Login, logout, and the protections around them (cross-site posts, the live WebSocket).
const WebSocket = require('ws');
const { test, expect } = require('./helpers');
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

test('login, dashboard, logout', async ({ userA }) => {
  await expect(userA.locator('h1')).toHaveText('Dashboard');
  await expect(userA.locator('.card').first()).toBeVisible();
  await userA.click('form[action="/logout"] button');
  await expect(userA).toHaveURL(/\/login$/);
  await userA.goto('/');
  await expect(userA).toHaveURL(/\/login$/);
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
