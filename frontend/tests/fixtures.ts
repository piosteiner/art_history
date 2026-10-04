// Shared test setup. Wikimedia images are answered locally with a 1×1 PNG: the tests don't depend on Wikimedia
// (which throttles image requests from cloud runners such as GitHub's) and don't load it. Like the real server, the
// stand-in allows anonymous loading and offers a tracking cookie, so the no-cookies test checks real browser behaviour.
import { test as base, expect } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(/^https:\/\/[^/]*wikimedia\.org\//, (route) => route.fulfill({
      status: 200, contentType: 'image/png', body: PNG,
      headers: { 'access-control-allow-origin': '*', 'set-cookie': 'WMF-Uniq=test; Domain=thumb.wikimedia.org; Path=/; Secure; SameSite=None' },
    }));
    await use(context);
  },
});

export { expect };
