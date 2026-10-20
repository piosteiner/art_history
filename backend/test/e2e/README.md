# End-to-end tests (admin panel)

Real browser (headless Chromium via Playwright) against a real server and database — the scripts from development
turned into permanent tests.

```bash
cd backend
npm run test:e2e              # all specs (~3 min, two workers)
E2E_WORKERS=1 npm run test:e2e  # one after another (~4 min)
npx playwright test history   # one spec file
npx playwright show-trace test/e2e/.results/<…>/trace.zip   # what the browser saw in a failed test
```

- **Isolated:** each worker has its own shard (`env.js`): database `arthistory_test` + server :3006, `arthistory_test_1` +
  :3008 (`arthistory_test_2` + :3009 for a third) — created once with `db/setup.sh <name>`, reset before every run
  (`reset.sql`) and filled from the frozen sample `fixtures/content/` (not the live `content/` snapshot); two users with
  passwords generated per run (stored in the OS temp dir, never in the repo). Dev (`arthistory_dev`, :3005) and
  production are never touched. The fixture server (:3007) is shared. Use `API` / `BASE` from `helpers.js` — never a port.
- **Offline:** OpenStreetMap tiles are intercepted and answered with a blank image.
- **deploy.sh runs them** before migrating/reloading production; a failure stops the deploy
  (`deploy.sh --skip-tests` for emergencies only).
- Spec files run side by side (two workers); the tests of one file in order, on one shard. Which files share a shard
  changes from run to run — each spec still cleans up its own entries.

| Spec | Covers |
|---|---|
| `auth` | redirects, wrong password, logout, cross-site posts, WebSocket origin/session checks |
| `entities` | create/validate/publish/delete, protected deletes, reverse relationships, typo-tolerant pickers |
| `search` | typo tolerance, alternative names, stemming, relationships, literal `%` |
| `history` | conflicts kept, restore version, word-level merge, restoring a deletion with its id, stale previews, diffs |
| `changelog` | changelog entry from "Kind: text" lines, draft vs published, API + kind filter + RSS; roadmap columns, done → today's changelog entry linked, drag order, link kept on re-save (118); drafts autosaved and restored, bullets edited in place, delete (confirmed) + restore with the old id, older version restored, roadmap item restored (119) |
| `pages` | a CMS page: images uploaded by name and embedded (![[…]]), preview, publish, API HTML + contents, image by name/ETag, delete, history (114) |
| `as-of` | an entry as of a moment (fields, relationships, provenance), changes since, versions, deleted entries (089) |
| `search-text` | full-text search: stems (EN/DE/FR), accents, phrases, exclusions, provenance steps, escaped highlights (087) |
| `network` | shortest path, holders in a window, shared hands with depth and current holders (088) |
| `spatial` | travel distance, encounters (same place / within km), clusters by zoom; prices: exclusion constraint, null value, currency codes (090/091) |
| `sound-alike` | names that sound alike as possible duplicates, candidate pairs, live check, quality page (092/093) |
| `editor-scopes` | row-level security: a scoped account writes only its collection's artworks and their provenance, admin message (094) |
| `live` | presence, drafts of new entries, co-editing convergence, publish, offline merge across a restart, discard, rebase |
| `editor` | Markdown shortcuts/styling/preview (escaping), map picker (Referer, click, polygon) |

**Logged in once per run.** `global-setup.js` logs `tester` and `tester2` in and stores the sessions; the `userA` / `userB`
fixtures start every test in a fresh browser context with them (no login form per test). A test that logs out must
use `login(browser, user)` from `helpers.js` — logging out ends a session, and the shared one is used by every other test.
A fresh context starts on a blank page: open the page you need first (`await userA.goto('/')`).
