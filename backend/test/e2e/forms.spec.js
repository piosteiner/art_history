// Form details: the slug follows the title and is cleaned as you type — also with a draft banner on the page (its
// hidden "slug" input once caught the script); the series fields behind a button; an artwork's web page (migrations 038, 039).
const { test, expect, sql, submitForm, liveReady, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test('slug: follows the title and is cleaned while a draft banner is shown', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await liveReady(userA);
  await userA.locator('#f-title').pressSequentially('Draft Wörk', { delay: 20 });
  await expect(userA.locator('#f-slug')).toHaveValue('draft-work');
  await expect.poll(() => sql("SELECT count(*) FROM admin_drafts WHERE entity_type = 'artwork' AND entity_id IS NULL")).not.toBe('0');  // saved as a draft
  await userA.goto('/artworks/new');                       // fresh form, the draft offered in a banner (hidden input "slug")
  await expect(userA.locator('.flash.draft input[name=slug]')).toHaveCount(1);
  await liveReady(userA);
  await userA.locator('#f-title').pressSequentially('Second Title', { delay: 20 });
  await expect(userA.locator('#f-slug')).toHaveValue('second-title');
  await userA.locator('#f-slug').fill('');
  await userA.locator('#f-slug').pressSequentially('Mein Bild Ä', { delay: 20 });
  await expect(userA.locator('#f-slug')).toHaveValue('mein-bild-a');
  await userA.click('.flash.draft button:has-text("Discard")');
});

test('series fields are behind "Part of a series…" — open when one of them has a value', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await expect(userA.locator('#group-parent')).not.toHaveAttribute('open', '');
  await expect(userA.locator('#f-parent')).toBeHidden();
  await userA.click('summary:has-text("Part of a series")');
  await expect(userA.locator('#f-parent')).toBeVisible();
  await expect(userA.locator('#f-part_number')).toBeVisible();
  await expect(userA.locator('#f-parts_count')).toBeVisible();
  await userA.goto('/artworks/plum-park-in-kameido/edit');  // not part of anything: closed
  await expect(userA.locator('#group-parent')).not.toHaveAttribute('open', '');
});

test('an artwork\'s web page: saved, checked, in the API; the images section points to it', async ({ userA, request }) => {
  sql("UPDATE artworks SET web_url = NULL WHERE slug = 'plum-park-in-kameido'; DELETE FROM images WHERE artwork_id = entity_id('artwork', 'plum-park-in-kameido')");
  await userA.goto('/artworks/plum-park-in-kameido');
  await expect(userA.locator('#images ~ p.muted').first()).toContainText('No free image? Add the work\'s page at its museum as Web page');
  await userA.goto('/artworks/plum-park-in-kameido/edit');
  await liveReady(userA);
  await userA.fill('#f-web_url', 'not a link');
  await submitForm(userA);
  await expect(userA.locator('.flash.error, ul.errors')).toContainText('Web page: a link starting with https://');
  await userA.fill('#f-web_url', 'https://www.brooklynmuseum.org/opencollection/objects/121664');
  await submitForm(userA);
  await expect(userA.locator('dl.fields')).toContainText('https://www.brooklynmuseum.org/opencollection/objects/121664');
  await expect(userA.locator('#images ~ p.muted').first()).toContainText('the site links the work\'s web page instead');
  const w = await api(request, '/artworks/plum-park-in-kameido');
  expect(w.web_url).toBe('https://www.brooklynmuseum.org/opencollection/objects/121664');
  // the day the link was added, set by the database (migration 039) — kept when the entry is saved again unchanged
  const today = sql('SELECT current_date::text');
  expect(w.web_url_accessed).toBe(today);
  await expect(userA.locator('dl.fields')).toContainText(`added ${sql("SELECT to_char(current_date, 'FMDD FMMonth YYYY')")}`);
  sql("UPDATE artworks SET web_url_accessed = '2001-02-03' WHERE slug = 'plum-park-in-kameido'");  // refused: kept by the trigger
  expect(sql("SELECT web_url_accessed::text FROM artworks WHERE slug = 'plum-park-in-kameido'")).toBe(today);
  sql("UPDATE artworks SET web_url = NULL WHERE slug = 'plum-park-in-kameido'");
});

// 250: the other web page — a page that is not the holder's, below the text; its site and note only once it has an address
test('an artwork\'s other web page: site and note appear with the address, saved with its day, in the API', async ({ userA, request }) => {
  sql("UPDATE artworks SET other_web_url = NULL, other_web_name = NULL, other_web_note = NULL WHERE slug = 'plum-park-in-kameido'");
  await userA.goto('/artworks/plum-park-in-kameido/edit');
  await liveReady(userA);
  await expect(userA.locator('#f-other_web_name')).toBeHidden();                       // waits for the address
  await userA.fill('#f-other_web_url', 'https://www.wga.hu/html/h/hiroshig/plum.html');
  await expect(userA.locator('#f-other_web_name')).toBeVisible();
  await userA.fill('#f-other_web_name', 'Web Gallery of Art');
  await userA.fill('#f-other_web_note', 'Another impression');
  await submitForm(userA);
  const w = await api(request, '/artworks/plum-park-in-kameido');
  expect(w).toMatchObject({ other_web_url: 'https://www.wga.hu/html/h/hiroshig/plum.html', other_web_name: 'Web Gallery of Art',
    other_web_note: 'Another impression', other_web_accessed: sql('SELECT current_date::text') });
  // a note without an address is refused by the database
  expect(() => sql("UPDATE artworks SET other_web_url = NULL WHERE slug = 'plum-park-in-kameido'")).toThrow(/artworks_other_web_needs_url/);
  sql("UPDATE artworks SET other_web_url = NULL, other_web_name = NULL, other_web_note = NULL WHERE slug = 'plum-park-in-kameido'");
});

test('forms in sections: titles and jump links, short fields in pairs, every field once, help behind an ⓘ', async ({ userA }) => {
  await userA.setViewportSize({ width: 1280, height: 900 });
  await userA.goto('/artworks/new');
  await expect(userA.locator('.form-section-title')).toHaveText(['Title and names', 'Who and when', 'Object', 'Where it is', 'Description', 'Provenance status', 'Fate', 'Identifiers', 'Source']);
  await expect(userA.locator('.form-nav a')).toHaveCount(8);   // "Source" (new entries only, after the fields) has no jump link
  // object type and medium side by side (creator and attribution label too — the label is a rare field, hidden while empty)
  const [a, b] = await Promise.all(['#f-kind', '#f-medium'].map((s) => userA.locator(s).boundingBox()));
  expect(Math.abs(a.y - b.y)).toBeLessThan(5);
  expect(b.x).toBeGreaterThan(a.x + 200);
  // the hints are shown without clicking anything
  // a field's help behind its ⓘ (editor/hints.js): closed, opened and closed again with a click
  const medium = userA.locator('.field', { has: userA.locator('#f-medium') });
  await expect(medium.locator('.hint.help')).toBeHidden();
  await medium.locator('.hint-toggle').click();
  await expect(medium.locator('.hint.help')).toBeVisible();
  await expect(medium.locator('.hint-toggle')).toHaveAttribute('aria-expanded', 'true');
  await medium.locator('.hint-toggle').click();
  await expect(medium.locator('.hint.help')).toBeHidden();
  await expect(userA.locator('.field', { has: userA.locator('#f-medium') }).locator('label')).toHaveText('Medium');   // the ⓘ is not part of the label
  // the slug right before the title it is made from (owner, 2026-10-07)
  await expect(userA.locator('#sec-names #f-slug')).toHaveCount(1);
  // no field twice, none lost
  const names = await userA.locator('form.form [name^="f."]').evaluateAll((els) => els.map((e) => e.name).filter((n) => !/_(lon|lat|label|lang|h|w|d)$/.test(n)));
  expect(new Set(names).size).toBe(names.length);
  expect(names).toEqual(expect.arrayContaining(['f.title', 'f.creator', 'f.web_url', 'f.parent', 'f.area', 'f.metadata', 'f.wikidata_id']));
});

test('a map in a closed group works once it is opened (Leaflet measures again)', async ({ userA }) => {
  await userA.setViewportSize({ width: 1280, height: 900 });
  await userA.goto('/artworks/new');
  await userA.click('summary:has-text("Where it stands")');
  const map = userA.locator('#group-location .leaflet-container');
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  expect(box.width).toBeGreaterThan(300);
  await expect.poll(() => map.evaluate((el) => el.querySelectorAll('.leaflet-tile-loaded, .leaflet-tile').length)).toBeGreaterThan(0);
  await userA.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(userA.locator('input[name="f.location_lon"]')).not.toHaveValue('');
});

test('bibliography: a section whose fields the kind of source doesn\'t use is hidden, title and all', async ({ userA }) => {
  await userA.goto('/bibliography/new');
  await userA.selectOption('#f-kind', 'archival');
  await expect(userA.locator('#sec-container')).toBeHidden();          // "Appeared in": nothing for an archival source
  await expect(userA.locator('#sec-online')).toBeVisible();            // archive, shelfmark
  await userA.selectOption('#f-kind', 'article');
  await expect(userA.locator('#sec-container')).toBeVisible();
});

// ---- forms that fill themselves out (editor/relevance.js, rules in src/admin/relevance.js; owner 2026-11-04) ----
test('relevance: a web source needs its address and the day it was read; publisher hidden; the checklist links to the field; show all', async ({ userA }) => {
  await userA.goto('/bibliography/new');
  await userA.selectOption('#f-kind', 'web');
  const bar = userA.locator('.form-relevance');
  await expect(bar).toContainText('Still to fill in for a web page');
  // the sections in the web page's order: the address right after the kind (relevance.js SOURCE_KINDS[].sections)
  await expect(userA.locator('.form-section:visible .form-section-title')).toHaveText(['Kind', 'Online', 'Title', 'People', 'Appeared in', 'Publication', 'Cited and read', 'Notes', 'Identifiers']);   // no "Source": a bibliography entry is the source itself
  await expect(userA.locator('#cite-url')).toHaveCount(0);           // one place for the address: its own URL field
  await expect(userA.locator('.form-nav a').first()).toHaveText('Kind');
  await expect(userA.locator('.form-nav a', { hasText: 'Video, archive' })).toBeHidden();   // its section is hidden: no jump link
  await expect(bar.locator('a[data-focus]')).toHaveText(['URL', 'Last accessed', 'Title']);   // appeared in, year: optional (KHIST § 9.5)   // in the form's order
  await expect(userA.locator('.field', { has: userA.locator('#f-accessed') })).toHaveClass(/needed/);
  await expect(userA.locator('#f-publisher')).toBeHidden();            // not used by a web page
  await expect(userA.locator('#f-edition')).toBeHidden();
  await expect(userA.locator('#f-pages')).toBeHidden();
  await expect(userA.locator('#f-siglum')).toBeHidden();                // rare: an override, hidden while empty
  await userA.fill('#f-name', 'Sammlung online');
  // the checklist links to a needed field
  await bar.locator('a[data-focus="url"]').click();
  await expect(userA.locator('#f-url')).toBeFocused();
  // a link entered: "last accessed" becomes today (sourceform.js), the checklist is done
  await userA.fill('#f-url', 'https://collection.kunsthaus.ch/');
  await userA.locator('#f-url').blur();
  const today = await userA.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await expect(userA.locator('#f-accessed')).toHaveValue(today);
  await userA.fill('#f-accessed', '2026-11-03');                     // changeable like any value
  await userA.fill('#f-url', 'https://collection.kunsthaus.ch/de/');
  await userA.locator('#f-url').blur();
  await expect(userA.locator('#f-accessed')).toHaveValue('2026-11-03');   // an existing date is never replaced
  await expect(bar).toContainText('Everything for a web page is filled in');
  await expect(userA.locator('.field', { has: userA.locator('#f-accessed') })).not.toHaveClass(/needed/);
  // a book: its authors first; cited with a link, the day it was read is needed too
  await userA.selectOption('#f-kind', 'book');
  await expect(userA.locator('.form-section:visible .form-section-title').nth(1)).toHaveText('People');
  await expect(userA.locator('#f-publisher')).toBeVisible();
  await expect(bar.locator('a[data-focus]')).toHaveText(['Authors', 'Place of publication', 'Year']);   // the publisher is optional (KHIST § 9)
  await userA.fill('#f-accessed', '');
  await expect(bar.locator('a[data-focus]')).toContainText(['Last accessed']);
  // show all: the fields a book doesn't use come back, remembered in this browser
  await bar.locator('.relevance-toggle').click();
  await expect(userA.locator('#f-pages')).toBeVisible();
  await userA.reload();
  await expect(userA.locator('#f-pages')).toBeVisible();
  await userA.locator('.form-relevance .relevance-toggle').click();
  await expect(userA.locator('#f-pages')).toBeHidden();
  // a value in a field the kind doesn't use is never hidden: shown dimmed
  await userA.selectOption('#f-kind', 'article');
  await userA.fill('#f-pages', '12–30');
  await userA.selectOption('#f-kind', 'book');
  await expect(userA.locator('#f-pages')).toBeVisible();
  await expect(userA.locator('.field', { has: userA.locator('#f-pages') })).toHaveClass(/unusual/);
});

test('relevance: a place form follows its kind; an artwork on loan needs its lender date; an artist without dates of life is asked when they were active', async ({ userA }) => {
  await userA.goto('/places/new');
  await userA.selectOption('#f-kind', 'country');
  const bar = userA.locator('.form-relevance');
  await expect(bar.locator('a[data-focus]')).toHaveText(['Name', 'Country code', 'Boundary']);
  await expect(userA.locator('.field', { has: userA.locator('#f-route') })).toBeHidden();
  await expect(userA.locator('.relevance-note')).toContainText('outline comes with the boundary code');
  await userA.selectOption('#f-kind', 'street');
  await expect(userA.locator('.field', { has: userA.locator('#f-route') })).toBeVisible();   // (its GeoJSON sits in a closed details)
  await expect(bar.locator('a[data-focus]')).toHaveText(['Name', 'Parent', 'Location']);
  await expect(userA.locator('#f-boundary_code')).toBeHidden();

  await userA.goto('/artworks/new');
  await expect(bar.locator('a[data-focus]')).toHaveText(['Title', 'Created', 'Object type']);   // in the form's order
  await expect(userA.locator('#f-title_status')).toBeHidden();          // rare: hidden while empty
  await expect(userA.locator('#f-fate_date')).toBeHidden();             // no fate: no date of it
  await userA.selectOption('#f-fate', 'lost');
  await expect(userA.locator('#f-fate_date')).toBeVisible();
  await expect(bar.locator('a[data-focus]')).toContainText(['Fate: when']);
  await expect(userA.locator('#f-on_loan')).toBeHidden();               // no institution: no loan there
  await userA.fill('#f-institution', 'Kunsthaus Zürich');
  await expect(userA.locator('#f-on_loan')).toBeVisible();
  await expect(bar.locator('a[data-focus]')).toContainText(['Inventory number', 'Web page']);
  await userA.selectOption('#f-on_loan', 'yes');
  await expect(bar.locator('a[data-focus]')).toContainText(['On loan since']);
  await userA.fill('#f-institution', '');
  await userA.fill('#f-kind', 'series');
  await expect(userA.locator('#f-inventory_number')).toBeHidden();      // a group of works: no object fields while empty
  await expect(userA.locator('.relevance-note')).toContainText('A group of works');
  await expect(bar.locator('a[data-focus]')).toContainText(['Number of parts']);

  // an artist: birth asked for first, "active" offered beside it — either settles it; the note under Birth
  await userA.goto('/artists/new');
  await expect(bar.locator('a[data-focus]')).toHaveText(['Name', 'Birth']);
  await expect(userA.locator('.field', { has: userA.locator('#f-active') })).not.toHaveClass(/needed/);
  await expect(userA.locator('.field', { has: userA.locator('#f-birth') }).locator('.relevance-field-note')).toContainText('when they were active');
  await userA.fill('#f-active', '1520/1540');
  await expect(bar.locator('a[data-focus]')).toHaveText(['Name']);
  await userA.fill('#f-active', '');
  await userA.fill('#f-birth', '1853');
  await expect(userA.locator('#f-active')).toBeHidden();                 // dates of life: no need for an active period
  // a rule's note under its own field: "In a museum …" under the institution, not under the object type
  await userA.goto('/artworks/new');
  await userA.fill('#f-institution', 'Kunsthaus Zürich');
  await expect(userA.locator('.field', { has: userA.locator('#f-institution') }).locator('.relevance-field-note')).toContainText('In a museum');
  await expect(userA.locator('.relevance-note')).not.toContainText('In a museum');
});

test('quick entry: Wikidata search on a new entry, an empty other-names row is only its name field, Ctrl+S creates', async ({ userA }) => {
  await userA.goto('/artists/new');
  await expect(userA.locator('#from-wikidata input[name="search"]')).toBeVisible();
  await expect(userA.locator('#from-wikidata')).toHaveAttribute('action', '/artists/new/wikidata');
  const row = userA.locator('.names-row').first();
  await expect(row.locator('.n-lang')).toBeHidden();                     // no name yet: no language, role, kind …
  await row.locator('.n-text').fill('Test Quick Name');
  await expect(row.locator('.n-lang')).toBeVisible();
  await userA.fill('#f-name', 'Test Quick Entry');
  await userA.fill('#f-birth', '1850');
  await expect(userA.locator('form.form > .actions > button')).toHaveAttribute('title', /\+S\)$/);
  await Promise.all([userA.waitForURL(/\/artists\/test-quick-entry/), userA.keyboard.press('Control+s')]);
  await expect(userA.locator('h1')).toContainText('Test Quick Entry');
});

test('kind fields show their common values as chips; a click fills the field in', async ({ userA }) => {
  await userA.goto('/events/new');
  const chips = userA.locator('.field', { has: userA.locator('#f-kind') }).locator('.fill-chips .chip');
  expect(await chips.count()).toBeGreaterThan(3);
  const first = await chips.first().textContent();
  await chips.first().click();
  await expect(userA.locator('#f-kind')).toHaveValue(first);
  await expect(userA.locator('#f-kind')).toBeFocused();
  await userA.goto('/institutions/new');
  await expect(userA.locator('.field', { has: userA.locator('#f-kind') }).locator('.fill-chips')).toContainText('museum');
});

// Nothing written, no draft (owner 2026-11-05): a new entry where only a choice was made — the kind, a recent source —
// is not kept as an "unsaved draft"; a draft saved once goes again when its text is removed (editor/blank.js).
test('a new entry with nothing written in it is not kept as a draft', async ({ userA }) => {
  const drafts = () => sql("SELECT count(*) FROM admin_drafts WHERE entity_type = 'source' AND entity_id IS NULL AND user_id = (SELECT id FROM admin_users WHERE username = 'tester')");
  sql("DELETE FROM admin_drafts WHERE entity_type = 'source' AND entity_id IS NULL");
  await userA.goto('/bibliography/new');
  await liveReady(userA);
  await userA.selectOption('#f-kind', 'web');                 // a choice only
  await userA.waitForTimeout(2500);                            // past the 1.5 s autosave
  expect(drafts()).toBe('0');
  await userA.locator('#f-name').pressSequentially('A page', { delay: 20 });
  await expect.poll(drafts).toBe('1');                         // written: a draft
  await userA.locator('#f-name').fill('');
  await userA.locator('#f-slug').fill('');
  await expect.poll(drafts).toBe('0');                         // emptied again: gone, the kind still chosen
  await userA.goto('/bibliography/new');
  await expect(userA.locator('.flash.draft')).toHaveCount(0);
});

// An institution's online collection (migration 238, owner 2026-11-06): a field beside the website, saved, in the API.
test('an institution has an online collection beside its website — saved and given by the API', async ({ userA, request }) => {
  const { liveReady } = require('./helpers');
  sql("UPDATE institutions SET collection_url = NULL WHERE slug = 'van-gogh-museum'; DELETE FROM live_docs WHERE entity_type = 'institution'");
  await userA.goto('/institutions/van-gogh-museum/edit');
  await liveReady(userA);
  await expect(userA.locator('label[for="f-collection_url"]')).toContainText('Online collection');
  await userA.fill('#f-collection_url', 'https://www.vangoghmuseum.nl/en/collection');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('dl.fields')).toContainText('https://www.vangoghmuseum.nl/en/collection');
  expect((await api(request, '/institutions/van-gogh-museum')).collection_url).toBe('https://www.vangoghmuseum.nl/en/collection');
  sql("UPDATE institutions SET collection_url = NULL WHERE slug = 'van-gogh-museum'");
});
