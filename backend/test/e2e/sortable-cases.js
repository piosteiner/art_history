// Drag and drop in the provenance (editor/sortable.js): a floating copy follows the pointer, a placeholder shows where
// the step lands, the others make room — over any distance; Esc cancels. Shared by sortable.spec.js (Chromium) and
// sortable.firefox.spec.js (Firefox — where moving the dragged element itself had lost the pointer after one place).
const { test, expect, sql } = require('./helpers');

const order = () => sql(`SELECT string_agg(owner_label, ' > ' ORDER BY position) FROM provenance WHERE artwork_id = entity_id('artwork', 'drag-test')`);

function dragTests() {
  test.beforeEach(() => {
    sql(`INSERT INTO artworks (slug, title) VALUES ('drag-test', 'Drag test') ON CONFLICT DO NOTHING;
         DELETE FROM provenance WHERE artwork_id = entity_id('artwork', 'drag-test');
         INSERT INTO provenance (artwork_id, position, owner_label) VALUES
           (entity_id('artwork', 'drag-test'), 0, 'A'), (entity_id('artwork', 'drag-test'), 1, 'B'),
           (entity_id('artwork', 'drag-test'), 2, 'C'), (entity_id('artwork', 'drag-test'), 3, 'D')`);
  });
  test.afterAll(() => sql("DELETE FROM artworks WHERE slug = 'drag-test'"));

  test('a step dragged past several others, with a placeholder on the way; Esc cancels', async ({ userA }) => {
    await userA.setViewportSize({ width: 1200, height: 1000 });
    await userA.goto('/artworks/drag-test');
    const rows = userA.locator('table.provenance tr:not(.transfer)');
    await userA.locator('table.provenance').scrollIntoViewIfNeeded();
    const h = await rows.nth(0).locator('.drag-handle').boundingBox();
    const last = await rows.nth(3).boundingBox();
    await userA.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await userA.mouse.down();
    await userA.mouse.move(h.x + h.width / 2, last.y + last.height - 2, { steps: 20 });   // down to the last step's lower half
    await expect(userA.locator('.sort-ghost')).toBeVisible();                            // the copy under the pointer
    await expect(userA.locator('table.provenance:not(.sort-ghost) > .sort-placeholder')).toHaveCount(1);  // the gap …
    expect(await userA.locator('table.provenance:not(.sort-ghost) > tbody').evaluateAll((els) => els.map((e) => (e.classList.contains('sort-placeholder') ? '_' : e.hidden ? 'x' : e.textContent.match(/\b[ABCD]\b/)[0])).join('')))
      .toBe('xBCD_');                                                                    // … at the end, A hidden meanwhile
    await Promise.all([userA.waitForEvent('load'), userA.mouse.up()]);
    await expect.poll(order).toBe('B > C > D > A');

    // Esc while dragging: nothing changes, nothing is saved
    await userA.locator('table.provenance').scrollIntoViewIfNeeded();
    const h2 = await rows.nth(1).locator('.drag-handle').boundingBox();
    await userA.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
    await userA.mouse.down();
    await userA.mouse.move(h2.x + h2.width / 2, h2.y + 200, { steps: 10 });
    await userA.keyboard.press('Escape');
    await userA.mouse.up();
    await expect(userA.locator('.sort-ghost')).toHaveCount(0);
    await expect(userA.locator('.sort-placeholder')).toHaveCount(0);
    await expect(rows.nth(1)).toContainText('C');
    expect(order()).toBe('B > C > D > A');
  });
}

module.exports = { dragTests };
