# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: theme.spec.js >> theme toggle: Auto → Light → Dark, remembered after a reload, set before the page is drawn
- Location: test/e2e/theme.spec.js:10:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://admin.localhost:3006/
Call log:
  - navigating to "http://admin.localhost:3006/", waiting until "load"

```

# Test source

```ts
  1  | // Light / dark: the admin follows the system unless the header toggle chose a theme (static/theme.js, as on the
  2  | // site); the Markdown editor's find panel reads in both (it inherited the admin's full-width inputs and block labels).
  3  | const { test, expect } = require('./helpers');
  4  | 
  5  | const colors = (page) => page.evaluate(() => {
  6  |   const css = getComputedStyle(document.body);
  7  |   return { bg: css.backgroundColor, fg: css.color, scheme: getComputedStyle(document.documentElement).colorScheme };
  8  | });
  9  | 
  10 | test('theme toggle: Auto → Light → Dark, remembered after a reload, set before the page is drawn', async ({ userA }) => {
  11 |   await userA.emulateMedia({ colorScheme: 'dark' });
> 12 |   await userA.goto('/');
     |               ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://admin.localhost:3006/
  13 |   const toggle = userA.locator('header.top [data-theme-toggle]');
  14 |   await expect(toggle).toHaveText('◐ Auto');
  15 |   expect(await colors(userA)).toMatchObject({ bg: 'rgb(23, 22, 20)', scheme: 'dark' });      // the system's dark
  16 | 
  17 |   await toggle.click();
  18 |   await expect(toggle).toHaveText('☀ Light');
  19 |   await expect(userA.locator('html')).toHaveAttribute('data-theme', 'light');
  20 |   expect(await colors(userA)).toMatchObject({ bg: 'rgb(251, 250, 247)', fg: 'rgb(31, 29, 26)', scheme: 'light' });
  21 | 
  22 |   await userA.reload();
  23 |   await expect(userA.locator('html')).toHaveAttribute('data-theme', 'light');                // remembered
  24 |   await expect(toggle).toHaveText('☀ Light');
  25 | 
  26 |   await toggle.click();
  27 |   await expect(toggle).toHaveText('☾ Dark');
  28 |   await userA.emulateMedia({ colorScheme: 'light' });                                         // the system changes: the choice stands
  29 |   expect(await colors(userA)).toMatchObject({ bg: 'rgb(23, 22, 20)', scheme: 'dark' });
  30 | 
  31 |   await toggle.click();                                                                       // back to Auto: the system again
  32 |   await expect(toggle).toHaveText('◐ Auto');
  33 |   await expect(userA.locator('html')).not.toHaveAttribute('data-theme', /./);
  34 |   expect(await colors(userA)).toMatchObject({ bg: 'rgb(251, 250, 247)', scheme: 'light' });
  35 |   // the script sits in <head> without defer: the theme is set before the body is drawn
  36 |   expect(await userA.locator('head script[src*="theme.js"]').getAttribute('defer')).toBeNull();
  37 | });
  38 | 
  39 | test('find panel of the Markdown editor: a narrow field, labels beside their boxes, readable buttons in dark', async ({ userA }) => {
  40 |   await userA.emulateMedia({ colorScheme: 'dark' });
  41 |   await userA.goto('/people/theo-van-gogh/edit');
  42 |   await userA.locator('.md-editor .cm-content').first().click();
  43 |   await userA.locator('.md-toolbar button[title^="Find and replace"]').first().click();
  44 |   const panel = userA.locator('.md-editor .cm-search').first();
  45 |   await expect(panel).toBeVisible();
  46 |   const field = panel.locator('input[name=search]');
  47 |   const fieldBox = await field.boundingBox();
  48 |   const panelBox = await panel.boundingBox();
  49 |   expect(fieldBox.width).toBeLessThan(panelBox.width * 0.6);                                  // not the whole width
  50 |   const box = panel.locator('input[type=checkbox]').first();
  51 |   expect((await box.boundingBox()).width).toBeLessThan(30);
  52 |   const label = panel.locator('label').first();
  53 |   expect(await label.evaluate((l) => getComputedStyle(l).display)).toBe('inline-flex');       // beside each other
  54 |   const button = panel.locator('button[name=next]');
  55 |   const look = await button.evaluate((b) => ({ fg: getComputedStyle(b).color, image: getComputedStyle(b).backgroundImage }));
  56 |   expect(look).toEqual({ fg: 'rgb(233, 229, 222)', image: 'none' });                          // light text, no light gradient
  57 | });
  58 | 
```