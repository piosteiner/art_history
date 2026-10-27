// The header menu: five groups — collection, context, reference, the data's tools, the public site's texts and settings.
const { test, expect } = require('./helpers');

test('menu: the groups in order, the site\'s pages and settings in their own group', async ({ userA }) => {
  await userA.goto('/');
  const groups = await userA.locator('header.top nav .nav-group').evaluateAll((gs) => gs.map((g) => [...g.querySelectorAll('a')].map((a) => a.textContent)));
  expect(groups).toEqual([
    ['Artworks', 'Artists', 'People', 'Institutions'],
    ['Events', 'Movements', 'Places', 'Polities'],
    ['Glossary', 'Bibliography'],
    ['Quality', 'History'],
    ['Pages', 'Changelog', 'Roadmap', 'Start views', 'Search words', 'Feedback'],
  ]);
  // a group that starts a row has no line before it: the menu's left strip is clipped
  await userA.setViewportSize({ width: 1100, height: 600 });
  const nav = await userA.locator('header.top nav').evaluate((n) => getComputedStyle(n).clipPath);
  expect(nav).toContain('inset');
});
