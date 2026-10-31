// "Search elsewhere" on the Enrich page (src/admin/lookups.js): sites we may not read automatically, opened in the
// editor's browser with the entry's name searched — by type, nothing fetched by the server.
const { test, expect, sql } = require('./helpers');

test('Enrich: buttons that open other sites with the entry searched, by type', async ({ userA }) => {
  const title = sql("SELECT title FROM artworks WHERE slug = 'sunflowers-national-gallery'");
  await userA.goto('/artworks/sunflowers-national-gallery/enrich');
  const box = userA.locator('.lookups');
  await expect(box).toContainText(`“${title}” searched`);
  const wpi = box.locator('a:has-text("Wildenstein Plattner Institute")');
  await expect(wpi).toHaveAttribute('href', `https://digitalprojects.wpi.art/search?modeSelect=all&all=${encodeURIComponent(title)}`);
  await expect(wpi).toHaveAttribute('target', '_blank');
  await expect(box.locator('a:has-text("Getty ULAN")')).toHaveCount(0);
  // Korea's e-museum: the Korean name when the entry has one, else the name
  await expect(box.locator('a:has-text("e-museum (Korea)")')).toHaveAttribute('href', new RegExp(`emuseum\\.go\\.kr/headerSearch\\?.*&keyword=${encodeURIComponent(title)}$`));
  sql(`UPDATE artworks SET names = names || '[{"text": "해바라기", "lang": "ko", "role": "translation"}]'::jsonb WHERE slug = 'sunflowers-national-gallery'`);
  try {
    await userA.reload();
    await expect(box.locator('a:has-text("e-museum (Korea)")')).toHaveAttribute('href', /&keyword=%ED%95%B4%EB%B0%94%EB%9D%BC%EA%B8%B0$/);
    await expect(wpi).toHaveAttribute('href', `https://digitalprojects.wpi.art/search?modeSelect=all&all=${encodeURIComponent(title)}`);
  } finally {
    sql(`UPDATE artworks SET names = (SELECT coalesce(jsonb_agg(n), '[]') FROM jsonb_array_elements(names) n WHERE n->>'lang' IS DISTINCT FROM 'ko') WHERE slug = 'sunflowers-national-gallery'`);
  }  // ULAN names people and institutions, not works
  // an institution: ULAN, not the WPI
  const slug = sql("SELECT slug FROM institutions ORDER BY id LIMIT 1");
  await userA.goto(`/institutions/${slug}/enrich`);
  await expect(userA.locator('.lookups a:has-text("Getty ULAN")')).toHaveAttribute('href', /getty\.edu\/vow\/ULANServlet\?english=Y&find=/);
  await expect(userA.locator('.lookups a:has-text("Wildenstein Plattner Institute")')).toHaveCount(0);
});
