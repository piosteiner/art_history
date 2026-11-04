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

test('the first switch to German shows how to add the German dictionary — once, "Got it" is remembered', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await userA.evaluate(() => localStorage.removeItem('arthistory.cms.dictNote.de'));
  await userA.reload();
  await liveReady(userA);
  const editor = userA.locator('.md-editor').first();
  await expect(userA.locator('.md-dict-note')).toHaveCount(0);           // English: nothing to say
  await editor.locator('.cm-content').click();
  await userA.keyboard.type('Das Blatt gehört zu der Serie und ist eines der bekanntesten Werke von ihm.', { delay: 5 });
  await expect(userA.locator('.md-dict-note')).toContainText('no German dictionary');
  await userA.locator('.md-dict-note button', { hasText: 'Got it' }).click();
  await expect(userA.locator('.md-dict-note')).toHaveCount(0);
  await userA.reload();
  await liveReady(userA);
  await userA.locator('.md-editor .cm-content').first().click();
  await userA.keyboard.type('Das Blatt gehört zu der Serie und ist eines der bekanntesten Werke von ihm.', { delay: 5 });
  await expect(userA.locator('.md-editor .cm-content').first()).toHaveAttribute('lang', 'de');
  await expect(userA.locator('.md-dict-note')).toHaveCount(0);            // remembered in this browser
});
