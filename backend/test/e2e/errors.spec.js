// A rejected form shows which fields the messages are about — also for the database's rules (RULE_FIELDS in index.js).
const { test, expect, submitForm } = require('./helpers');

test('an inventory number without institution: both fields marked in red, linked, the first one focused', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Error marking test');
  await userA.fill('#f-inventory_number', 'BU 9999');
  await submitForm(userA);
  await expect(userA.locator('.errors')).toContainText('An inventory number belongs to a collection');
  const field = (id) => userA.locator('.field', { has: userA.locator(`#${id}`) });
  await expect(field('f-inventory_number')).toHaveClass(/has-error/);
  await expect(field('f-institution')).toHaveClass(/has-error/);
  await expect(field('f-title')).not.toHaveClass(/has-error/);
  await expect(userA.locator('.error-fields')).toContainText('Inventory number');
  await expect(userA.locator('.error-fields')).toContainText('Institution (where it is now)');
  await expect(userA.locator('#f-institution')).toBeFocused();                   // the first marked field in the form
});
