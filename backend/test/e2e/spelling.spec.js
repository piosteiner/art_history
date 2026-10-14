// The spell check language of Markdown texts (src/textlang.js, editor.js): recognised as you type (English / German),
// set as the editable area's lang attribute, shown and switchable in the toolbar.
const { test, expect, liveReady } = require('./helpers');

test('a German description switches the spell check to German; the toolbar button switches it by hand', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await liveReady(userA);
  const editor = userA.locator('.md-editor').first();
  const content = editor.locator('.cm-content');
  const langButton = editor.locator('button.md-lang');
  await expect(content).toHaveAttribute('lang', 'en');              // empty: the page's language
  await expect(content).toHaveAttribute('spellcheck', 'true');
  await expect(langButton).toHaveText('EN');

  await content.click();
  await userA.keyboard.type('Das Blatt gehört zu der Serie und ist eines der bekanntesten Werke von ihm.', { delay: 5 });
  await expect(content).toHaveAttribute('lang', 'de');
  await expect(langButton).toHaveText('DE');
  await expect(langButton).toHaveAttribute('title', /German — recognised from the text/);

  await langButton.click();                                         // by hand: stays, whatever is typed next
  await expect(content).toHaveAttribute('lang', 'en');
  await userA.keyboard.type(' Es wurde um 1831 von dem Verleger herausgegeben.', { delay: 5 });
  await userA.waitForTimeout(1000);
  await expect(content).toHaveAttribute('lang', 'en');
  await expect(langButton).toHaveAttribute('title', /English — chosen by you/);
});
