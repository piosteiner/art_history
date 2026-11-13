// What the public API's role may read (249): the owner role's default privileges give arthistory_api every new table,
// so a private table must be revoked by name. This test fails when one is forgotten — a table of accounts, chats,
// study sets, drafts or open cases readable by the role that answers the public — and checks the public view of
// open cases (248) stays readable.
const { test, expect, sql } = require('./helpers');

const PRIVATE = /^(account_|admin_|chat_|set_chat_|study_|friendships$|form_drafts$|page_drafts$|page_downloads$|editor_scopes$|open_case|private_images$|feedback$|audit_log$)/;

test('the API role reads no private table; the public view of open cases it does', () => {
  const readable = sql(`SELECT string_agg(c.relname, ' ' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm') AND has_table_privilege('arthistory_api', c.oid, 'SELECT')`).split(' ');
  expect(readable.filter((t) => PRIVATE.test(t))).toEqual([]);
  expect(readable).toContain('public_open_cases');
  expect(readable).toContain('artworks');   // the content stays readable
});
