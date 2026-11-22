// A temporary password (backend migration 256): logged in with the one an admin's reset gave, the site shows a form
// over the whole page that can't be closed until the account has set its own (account.ts passwordRequired); logging
// out stays possible. The admin host is the stand-in of playwright.config.ts (VITE_ADMIN_BASE), answered here.
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';

const TEMP = 'abcd-efgh-jkmn-pqrs';

async function account(page: Page) {
  const state = { changed: false, loggedOut: false, posts: [] as string[] };
  await page.addInitScript(() => localStorage.setItem('arthistory.account', '1'));
  const cors = () => ({ 'access-control-allow-origin': new URL(page.url() || 'http://localhost:5180').origin, 'access-control-allow-credentials': 'true' });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: cors() });
  await page.route(/^http:\/\/admin\.test\/site\//, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/site/, '');
    const form = new URLSearchParams(req.postData() ?? '');
    if (req.method() === 'POST') state.posts.push(`${path} ${[...form.keys()].join(',')}`);
    if (state.loggedOut) return json(route, { error: 'not_logged_in' }, 401);
    if (path === '/logout') { state.loggedOut = true; return route.fulfill({ status: 204, headers: cors() }); }
    if (path === '/me') {
      return json(route, { username: 'student', role: 'member', cms: false, public_name: 'A Student',
        ...(state.changed ? {} : { password_change_required: true, temporary_until: '2026-12-22T10:00:00Z' }) });
    }
    if (path === '/account/password' && !state.changed) {
      if (form.get('password') === TEMP) return json(route, { error: 'Choose a password of your own — not the temporary one.' }, 422);
      state.changed = true;
      return route.fulfill({ status: 204, headers: cors() });
    }
    if (!state.changed) return json(route, { error: 'password_change_required' }, 403);
    if (path === '/thumbs') return json(route, { images: {} });
    if (path === '/friends') return json(route, { me: { public_name: 'A Student', friend_code: 'F1' }, people: [], unread: 0 });
    if (path === '/friends/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 60000\n\n', headers: cors() });
    return json(route, {});
  });
  return state;
}

test('a temporary password: the form to set one\'s own covers the page, can\'t be closed, and goes once it is set', async ({ page }) => {
  const state = await account(page);
  await page.goto('/');
  const dialog = page.locator('dialog.password-required');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Your password was reset by the admin. Set your own password to continue.');
  await expect(dialog).toContainText('Your temporary password stops working once you have, or on 22 December 2026.');
  // the whole page, and it stays
  const box = await dialog.boundingBox();
  const view = page.viewportSize()!;
  expect(box!.width).toBeGreaterThanOrEqual(view.width - 1);
  expect(box!.height).toBeGreaterThanOrEqual(view.height - 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await expect(page.locator('.account-button')).toHaveCount(0);   // not logged in as usual yet

  await dialog.locator('input[name=password]').fill('my own secret 1');
  await dialog.locator('input[name=password2]').fill('my own secret 2');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.locator('.account-msg')).toHaveText('The two passwords differ.');
  await dialog.locator('input[name=password]').fill(TEMP);
  await dialog.locator('input[name=password2]').fill(TEMP);
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.locator('.account-msg')).toHaveText('Choose a password of your own — not the temporary one.');
  await dialog.locator('input[name=password]').fill('my own secret 1');
  await dialog.locator('input[name=password2]').fill('my own secret 1');
  await dialog.locator('button[type=submit]').click();
  // set: the page reloads, logged in as usual
  await expect(page.locator('.account-button')).toBeVisible();
  await expect(page.locator('dialog.password-required')).toHaveCount(0);
  expect(state.posts.filter((p) => p.startsWith('/account/password'))).toEqual(['/account/password password,password2', '/account/password password,password2']);
});

test('a temporary password: logging out stays possible', async ({ page }) => {
  const state = await account(page);
  await page.goto('/');
  const dialog = page.locator('dialog.password-required');
  await expect(dialog).toBeVisible();
  await dialog.locator('button.password-required-logout').click();
  await expect(page.locator('.account-login')).toBeVisible();
  await expect(page.locator('dialog.password-required')).toHaveCount(0);
  expect(state.loggedOut).toBe(true);
});
