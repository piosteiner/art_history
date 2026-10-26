// Light / dark: the admin follows the system unless the header toggle chose a theme (static/theme.js, as on the
// site); the Markdown editor's find panel reads in both (it inherited the admin's full-width inputs and block labels).
const { test, expect } = require('./helpers');

const colors = (page) => page.evaluate(() => {
  const css = getComputedStyle(document.body);
  return { bg: css.backgroundColor, fg: css.color, scheme: getComputedStyle(document.documentElement).colorScheme };
});

test('theme toggle: Auto → Light → Dark, remembered after a reload, set before the page is drawn', async ({ userA }) => {
  await userA.emulateMedia({ colorScheme: 'dark' });
  await userA.goto('/');
  const toggle = userA.locator('header.top [data-theme-toggle]');
  await expect(toggle).toHaveText('◐ Auto');
  expect(await colors(userA)).toMatchObject({ bg: 'rgb(23, 22, 20)', scheme: 'dark' });      // the system's dark

  await toggle.click();
  await expect(toggle).toHaveText('☀ Light');
  await expect(userA.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await colors(userA)).toMatchObject({ bg: 'rgb(251, 250, 247)', fg: 'rgb(31, 29, 26)', scheme: 'light' });

  await userA.reload();
  await expect(userA.locator('html')).toHaveAttribute('data-theme', 'light');                // remembered
  await expect(toggle).toHaveText('☀ Light');

  await toggle.click();
  await expect(toggle).toHaveText('☾ Dark');
  await userA.emulateMedia({ colorScheme: 'light' });                                         // the system changes: the choice stands
  expect(await colors(userA)).toMatchObject({ bg: 'rgb(23, 22, 20)', scheme: 'dark' });

  await toggle.click();                                                                       // back to Auto: the system again
  await expect(toggle).toHaveText('◐ Auto');
  await expect(userA.locator('html')).not.toHaveAttribute('data-theme', /./);
  expect(await colors(userA)).toMatchObject({ bg: 'rgb(251, 250, 247)', scheme: 'light' });
  // the script sits in <head> without defer: the theme is set before the body is drawn
  expect(await userA.locator('head script[src*="theme.js"]').getAttribute('defer')).toBeNull();
});

test('find panel of the Markdown editor: a narrow field, labels beside their boxes, readable buttons in dark', async ({ userA }) => {
  await userA.emulateMedia({ colorScheme: 'dark' });
  await userA.goto('/people/theo-van-gogh/edit');
  await userA.locator('.md-editor .cm-content').first().click();
  await userA.locator('.md-toolbar button[title^="Find and replace"]').first().click();
  const panel = userA.locator('.md-editor .cm-search').first();
  await expect(panel).toBeVisible();
  const field = panel.locator('input[name=search]');
  const fieldBox = await field.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(fieldBox.width).toBeLessThan(panelBox.width * 0.6);                                  // not the whole width
  const box = panel.locator('input[type=checkbox]').first();
  expect((await box.boundingBox()).width).toBeLessThan(30);
  const label = panel.locator('label').first();
  expect(await label.evaluate((l) => getComputedStyle(l).display)).toBe('inline-flex');       // beside each other
  const button = panel.locator('button[name=next]');
  const look = await button.evaluate((b) => ({ fg: getComputedStyle(b).color, image: getComputedStyle(b).backgroundImage }));
  expect(look).toEqual({ fg: 'rgb(233, 229, 222)', image: 'none' });                          // light text, no light gradient
});
