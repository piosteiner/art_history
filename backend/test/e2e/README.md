# End-to-end tests (admin panel)

Real browser (headless Chromium via Playwright) against a real server and database — the scripts from development
turned into permanent tests.

```bash
cd backend
npm run test:e2e              # all specs (~1–2 min)
npx playwright test history   # one spec file
npx playwright show-trace test/e2e/.results/<…>/trace.zip   # what the browser saw in a failed test
```

- **Isolated:** database `arthistory_test` (created once with `db/setup.sh arthistory_test`), reset before every run
  (`reset.sql`) and filled from `content/`; server on port 3006; two users with passwords generated per run (stored in
  the OS temp dir, never in the repo). Dev (`arthistory_dev`, :3005) and production are never touched.
- **Offline:** OpenStreetMap tiles are intercepted and answered with a blank image.
- **deploy.sh runs them** before migrating/reloading production; a failure stops the deploy
  (`deploy.sh --skip-tests` for emergencies only).
- Specs share one database and run one after another; each uses its own entries so they don't interfere.

| Spec | Covers |
|---|---|
| `auth` | redirects, wrong password, logout, cross-site posts, WebSocket origin/session checks |
| `entities` | create/validate/publish/delete, protected deletes, reverse relationships, typo-tolerant pickers |
| `search` | typo tolerance, alternative names, stemming, relationships, literal `%` |
| `history` | conflicts kept, restore version, word-level merge, restoring a deletion with its id, stale previews, diffs |
| `live` | presence, drafts of new entries, co-editing convergence, publish, offline merge across a restart, discard, rebase |
| `editor` | Markdown shortcuts/styling/preview (escaping), map picker (Referer, click, polygon) |
