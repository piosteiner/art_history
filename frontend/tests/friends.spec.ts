// Friends and chat on the site (views/friends.ts; backend routes/site-friends.js, 224): the list by set and A–Z,
// a request to answer, a chat with a friend. The admin host is the stand-in of playwright.config.ts (VITE_ADMIN_BASE).
import type { Route } from '@playwright/test';
import { expect, test } from './fixtures';

test('friends: by set and A–Z, a request accepted, a chat sent and shown', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('arthistory.account', '1'));
  const posts: string[] = [];
  let accepted = false;
  const messages = [{ id: '1', mine: false, body: 'Hi — shall we do the Fuji set?', at: '2026-11-05T09:00:00Z', read: false }];
  const people = () => [
    { id: '2', name: 'Ann Helper', status: 'friend', sets: [{ id: '55', name: 'Baroque exam' }], unread: 1, last_at: '2026-11-05T09:00:00Z' },
    { id: '3', name: 'Bo Other', status: accepted ? 'friend' : 'received', sets: [], unread: 0, last_at: null },
    { id: '4', name: 'Cy Third', status: 'none', sets: [{ id: '55', name: 'Baroque exam' }], unread: 0, last_at: null },
  ];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': new URL(page.url() || 'http://localhost:5180').origin, 'access-control-allow-credentials': 'true' } });
  await page.route(/^http:\/\/admin\.test\/site\//, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/site/, '');
    const form = new URLSearchParams(req.postData() ?? '');
    if (req.method() === 'POST') posts.push(`${path}:${form.toString()}`);
    if (path === '/me') return json(route, { username: 'tester', role: 'member', cms: false, public_name: 'Test Me' });
    if (path === '/thumbs') return json(route, { images: {} });
    if (path === '/friends/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 60000\n\n',
      headers: { 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' } });
    if (path === '/friends') return json(route, { me: { public_name: 'Test Me', friend_code: 'FriendCode12' }, people: people(), unread: 1 });
    if (path === '/friends/accept') { accepted = true; return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' } }); }
    if (path === '/friends/chat/2' && req.method() === 'GET') return json(route, { friend: { id: '2', name: 'Ann Helper' }, messages, more: false });
    if (path === '/friends/chat/2') {
      const m = { id: String(messages.length + 1), mine: true, body: form.get('body')!, at: '2026-11-05T09:05:00Z', read: false };
      messages.push(m);
      return json(route, { message: m }, 201);
    }
    return json(route, {});
  });
  await page.goto('/friends');
  await expect(page.locator('h1')).toHaveText('Friends');
  await expect(page.locator('.friends-group h2')).toHaveText(['Baroque exam']);   // a request waits under Requests
  await expect(page.locator('.friends-requests')).toContainText('Bo Other wants to be your friend');
  await expect(page.locator('.friends-link input')).toHaveValue(/\/friends\/add\/FriendCode12$/);
  await page.locator('.friends-requests [data-do="accept"]').click();
  await expect(page.locator('.friends-requests')).toHaveCount(0);
  expect(posts).toContain('/friends/accept:account=3');
  await expect(page.locator('.friends-group h2')).toHaveText(['Baroque exam', 'Not in a set with you']);
  await page.locator('[data-by="name"]').click();
  await expect(page.locator('.friends-list .friend-name')).toHaveText(['Ann Helper', 'Bo Other', 'Cy Third']);
  await expect(page.locator('.friend', { hasText: 'Cy Third' }).locator('[data-do="request"]')).toBeVisible();

  // the chat with a friend
  await page.locator('.friend', { hasText: 'Ann Helper' }).locator('a.friend-name').click();
  await expect(page).toHaveURL(/\/friends\/2$/);
  await expect(page.locator('.chat-msg')).toHaveText([/Hi — shall we do the Fuji set\?/]);
  await page.fill('.chat-form textarea', 'Yes, let us.');
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-msg.mine')).toContainText('Yes, let us.');
  expect(posts).toContain('/friends/chat/2:body=Yes%2C+let+us.');
});
