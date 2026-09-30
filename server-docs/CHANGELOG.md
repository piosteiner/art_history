# Changelog

Format: date — what — why — how to revert.

## 2026-09-30

### Admin: revert changes and restore versions from the history (migration 009)
- **What:** every history entry has "revert…" (undo one save — all rows of its transaction) and entity history rows have
  "restore this version…". A preview plans each row: three-way comparison per field (before / after the change / now)
  with fields changed since defaulting to "keep", deleted rows re-created with their original id (`OVERRIDING SYSTEM
  VALUE`, values via `jsonb_populate_record`), taken slugs / Wikidata ids, vanished references and relationship ends,
  and deletions of rows edited since or with newer relationships (need confirmation). Every plan is dry-run in a
  transaction that is rolled back; applying re-checks a fingerprint of the current state. Reverts are audited with
  `audit_log.reverts` (txid) / `restores` (entry) and can themselves be reverted. Code: `backend/src/admin/revert.js`,
  `revert-ui.js`; migration 009 adds the two columns, two indexes and extends `audit_row()`.
- **Why:** owner wanted undo from the history with proper conflict handling.
- **Tested (dev):** plain revert, conflict kept / reverted on purpose, deleted place with 3 relationships restored with
  the same ids, slug taken meanwhile → restored under a new slug, creation with newer relationship refused until
  confirmed, stale preview refused, restore version, revert of a restore; smoke test and unit tests pass.
- **Revert:** redeploy the previous commit; 009 can stay (or as owner: restore `audit_row()` from 006, drop the two columns).

### Migration 008: clearer inverse labels
- **What:** `member_of` → "has member" (was "member"), `owned_by` → "owner of" (was "owned"), `housed_at` → "holds / held"
  (was "held"). Display text only; codes and data unchanged.
- **Why:** owner review of all labels: the inverse is what the object's page shows, and these read awkwardly.
- **Revert:** as arthistory_owner, set the three inverse labels back and delete the `schema_migrations` row for 008.

### Migration 007: relationship vocabulary round 2; reverse types in the admin form
- **What:** `inspired_by_place` removed (unused; overlapped with `influenced_by_culture_of`), `depicts` added (artwork →
  place, category association), `owned_by` / `commissioned` / `patron_of` widened to institutions and places. Admin
  "Add relationship" also offers reverse types ("commissioned by", "birthplace of", …) grouped "From / Towards this …",
  saved in canonical direction. Docs: data-model.md, content/README.md.
- **Why:** owner feedback on the vocabulary: overlapping place types, owners/commissioners that are cities or
  churches, and commissions that couldn't be entered from the artwork's page.
- **Tested (dev):** smoke test; commission by a place entered on the artwork page stored as place → artwork; `depicts`;
  wrong target types rejected with a readable message.
- **Revert:** as arthistory_owner: `DELETE FROM relationships WHERE relationship_type = 'depicts'`, delete the `depicts`
  row, restore the old subject/object types (see migration 002), re-insert `inspired_by_place` from 002, delete the
  `schema_migrations` row for 007; redeploy the previous commit.

### Admin: typo-tolerant search everywhere + fuzzy pickers; deploy keeps dev dependencies
- **What:** one scoring rule for all admin search boxes (`backend/src/admin/match.js`): name prefix > word start >
  substring > pg_trgm `word_similarity` (also with spaces removed: "vangog" → Van Gogh), plus alternative names/titles
  (0.9×). Used by the list pages (now typo-tolerant, best match first), `/search` (alt names now fuzzy), and the new
  `GET /lookup` behind the form pickers (`src/admin/editor/autocomplete.js`: creator, institution, place, parent,
  relationship target — the latter filtered by the relationship type's allowed target types; keyboard + mouse).
  `deploy.sh` no longer runs `npm prune --omit=dev`: this checkout is also the dev environment, and pruning removed
  esbuild, breaking the next local build. Dev bundles now go to `src/admin/static-dev/` (served first by the dev
  server only), so a dev build can never replace the bundles production serves from `static/`.
- **Why:** owner: all search bars should tolerate typos.
- **Tested (dev, headless Chromium):** "hokusia" → Hokusai picked with Enter (form not submitted), existing parent shown as
  "→ France (place)", "lived in" + "pari" → only the place Paris, "influenced by" + "hirosige" → Hiroshige first.
- **Revert:** redeploy the previous commit.

### Admin: search across everything
- **What:** `GET /search` (+ a search box in the admin top bar), `backend/src/admin/search.js`: one query over all six
  entity tables — names (accent-insensitive, typo-tolerant `word_similarity`), alt names/slug/medium/Wikidata id/metadata
  (ILIKE), and biography/description/notes via Postgres full-text search (`to_tsvector('english', …)`,
  `websearch_to_tsquery`, `ts_rank`, `ts_headline` snippets) — plus relationships by label, notes and sources.
  No schema change, no new index (sequential scan is milliseconds at this size; the GIN expression index to add later
  is noted in the file). App change only; deployed with `deploy.sh`.
- **Why:** owner wanted one search over all content instead of per-type lists.
- **Revert:** redeploy the previous commit.

## 2026-09-29

### Admin: map picker for place location and area
- **What:** place forms show a Leaflet map (OpenStreetMap tiles): click/drag sets the location, Geoman tools draw/edit/cut/
  remove polygons for the area, and a search box queries OpenStreetMap Nominatim through the app (`GET /geocode`, logged-in
  only, ≤ 1 request/s, identifying User-Agent per the Nominatim usage policy) — a result can set the location or take over
  its boundary as the area. Bundle `static/map.js` + `map.css` (esbuild, git-ignored), loaded only on pages with a map.
  CSP (helmet): `img-src` now also allows `https://tile.openstreetmap.org`. Areas are stored via
  `ST_Multi(ST_CollectionExtract(ST_MakeValid(…), 3))` so hand-drawn self-intersections are repaired (import too; valid
  input unchanged — import dry run: all unchanged). New dev deps: leaflet 1.9.4 (BSD-2), @geoman-io/leaflet-geoman-free 2.20.2 (MIT).
- **Why:** owner: pick locations and draw areas on a map instead of typing coordinates/GeoJSON.
- **Tested (dev, headless Chromium):** tiles load, click moves the pin (5-decimal inputs), polygon tool → Polygon in the
  textarea without moving the pin, "Provence-Alpes-Côte d'Azur" outline → MultiPolygon, saved; PostGIS area 31,864 km²
  (official ≈ 31,400 km²). Bow-tie polygon repaired into two valid polygons; non-polygon GeoJSON rejected.
- **Revert:** redeploy the previous commit.

### Admin: Markdown editor with live styling; gzip for the admin site
- **What:** Markdown fields (biography, descriptions, notes incl. relationship notes) use a CodeMirror 6 editor
  (`backend/src/admin/editor/editor.js`): **bold**/*italic*/headings/links styled in place with dimmed markers, toolbar
  + Ctrl/⌘ B/I/K, and a Preview rendered by the server (`POST /preview` → same markdown-it + sanitize-html as the API).
  The textarea stays in the form (hidden, kept in sync) — without JS it still works. Bundle built by esbuild at deploy:
  `deploy.sh` now runs full `npm ci` → `npm run build:admin` → `npm prune --omit=dev`; the bundle is git-ignored.
  View page: Markdown values use the full column width like other fields. nginx (admin server block):
  `gzip_proxied any`, `gzip_vary on`, `gzip_types` for CSS/JS/JSON (editor bundle ~310 KB → ~100 KB on the wire).
- **Why:** owner wanted to see formatting while typing and a consistent field width.
- **Tested:** headless Chromium (Playwright, scratch dir): no JS errors, bold/italic/marker styles computed, Ctrl+B,
  toolbar italic and Ctrl+K produced `**bold** and *italic* [link text](…)` in the textarea and in the DB after Save,
  Preview shows sanitized HTML and hides the editor, light + dark screenshots.
- **Revert:** redeploy the previous commit; remove the four gzip lines from the admin server block and reload nginx.

### Admin panel: login fixed ("Forbidden: cross-site request.") and moved to the root of its host
- **What:** helmet's default `Referrer-Policy: no-referrer` made browsers send `Origin: null` on the admin's own form
  posts, so `checkOrigin` rejected every login (curl tests set `Origin` by hand and missed it). Now
  `Referrer-Policy: same-origin`, and `checkOrigin` also accepts `Sec-Fetch-Site: same-origin` when Origin is null/absent.
  The panel is now served at https://admin.arthistory.piogino.ch/ instead of `/admin/`; GET `/admin/…` → 301 to `/…`.
  Routing is by hostname (dev: `ADMIN_HOST` defaults to `admin.localhost`, i.e. http://admin.localhost:3005/). Unknown
  admin paths get the HTML 404 page. No nginx or DB change; session cookies stay valid (Path=/).
- **Why:** owner couldn't log in; the `/admin` prefix was redundant on a dedicated admin hostname (it only existed so
  dev on plain localhost could tell admin from API by path).
- **Tested on dev:** Origin exact / null + same-origin → accepted; null without Sec-Fetch-Site, cross-site → 403;
  full login → dashboard → list → logout with a temporary user (deleted afterwards); old URLs redirect; /v1 unaffected.
- **Revert:** redeploy the previous commit (`ee5f03b`) with `backend/deploy.sh`.

## 2026-09-29

### Admin: single login — nginx basic auth replaced by fail2ban
- **What:** removed `auth_basic` from the admin server block in `/etc/nginx/sites-available/arthistory` and deleted
  `/etc/nginx/arthistory-admin.htpasswd` (+ its entries in `~/.config/arthistory/admin-credentials.env`). Installed
  fail2ban 0.11.2 (apt) with one jail, `arthistory-admin`: filter matches `POST /login` answered with 401 in the admin
  access log; 5 in 10 min → REJECT on ports 80/443 for 1 h (iptables chain `f2b-arthistory-admin`); server IP exempt.
  Ubuntu's default `sshd` jail explicitly disabled in `jail.d/arthistory.local` (out of scope; key-only SSH).
  Copies: `config/fail2ban/`, `config/nginx/arthistory`.
- **Why:** owner: the browser's basic-auth dialog was clumsy (no logout, poor password-manager support, two passwords).
  fail2ban keeps the "stop brute force before it matters" role invisibly; the app's own per-IP limit stays as well.
- **Tested:** filter against sample lines (matches only 401 POSTs to /login), wrong login → 401 logged, manual ban of
  203.0.113.9 created the REJECT rule, unban removed it.
- **Revert:** re-add the two `auth_basic` lines (see the 2026-09-28 entry), recreate the htpasswd file
  (`openssl passwd -6`), `sudo systemctl reload nginx`; `sudo systemctl disable --now fail2ban` or `sudo apt purge fail2ban`.

## 2026-09-28

### Admin panel live (Phase 5) — the database is now the source of truth
- **Incident + rotation (same day):** while testing the login through nginx, curl's `%{redirect_url}` output printed the
  basic-auth credentials (curl embeds user:password in redirect URLs) into the Claude session log. The basic-auth password
  was rotated immediately (new htpasswd entry; old one verified rejected with 401). App login password was never shown.
  Lesson: never print `%{redirect_url}` (or `-v`) for requests made with `-u`/`user =`.
- **What:** `backend/src/admin/` served at https://admin.arthistory.piogino.ch/admin/ by the existing pm2 process.
  Migration 006: `admin_users` (scrypt hashes), `admin_sessions` (SHA-256 of cookie tokens), `audit_log` + `audit_row()`
  trigger (SECURITY DEFINER) on all content tables; api role can't see these tables, admin role can't write history or
  create users. nginx: `auth_basic` on the admin server block (`/etc/nginx/arthistory-admin.htpasswd`, root:www-data 640);
  site config copied to `config/nginx/arthistory`. `deploy.sh` no longer runs `npm run import`; new `npm run export`
  (DB → content/ YAML) and `npm run admin:user`. Content model moved to `backend/src/content.js` (shared by import,
  export, admin). Markdown fields are stored without trailing whitespace (import and forms agree).
- **Why:** owner decision: edit in the admin panel, database = truth, history in Postgres; YAML stays as export/bulk import.
- **Tested on dev:** login/rate-limit/Origin check, create/edit/delete with validation and friendly DB errors, optimistic
  locking, relationships add/edit/delete, history; all 44 entities re-saved through their edit forms → 0 audit rows
  (lossless round trip); export → import --dry-run → all unchanged; smoke test incl. 4 new privilege checks.
- **Revert:** redeploy commit `1163ad5` (restores the 503 placeholder and the import in deploy.sh); remove the two
  `auth_basic` lines from `/etc/nginx/sites-available/arthistory` and `sudo systemctl reload nginx`. Migration 006 can stay
  (harmless); to drop it as arthistory_owner: drop the 7 `*_audit` triggers, `audit_row()`, `audit_log`, `admin_sessions`,
  `admin_users`, type `audit_action`, and its `schema_migrations` row.

### Nightly database backups (Phase 4)
- **Live:** repo `piosteiner/art_history-backups` created by the owner (verified private: 404 without auth), cloned to
  `~/backups/arthistory-offsite`; first backup pushed via systemd; restore from a fresh GitHub clone matched production
  (row counts + entities); a second run correctly skipped the unchanged data. Passphrase is in the owner's password manager.
- **What:** `scripts/backup.sh` (dump → verify by restoring into a scratch DB and comparing row counts → encrypted off-site
  copy to the private GitHub repo `art_history-backups`, only when the data changed) and `scripts/restore.sh` (always into a
  new database). systemd `arthistory-backup.service` + `.timer` (03:30 UTC, Persistent) in `/etc/systemd/system/`
  (copies in `config/systemd/`). Local dumps in `~/backups/arthistory` (700, 14 days). New secrets outside the repo:
  `~/.config/arthistory/backup-passphrase`, deploy key `~/.ssh/art_history_backups_deploy` (+ `github-art_history-backups`
  host alias in `~/.ssh/config`). `backend/db/setup-database.sql`: default privileges skipped when `-v restore=1`
  (the dump brings its own; otherwise `schema_migrations` would become readable by admin/api after a restore).
- **Why:** off-server copy of the data at no cost; GitHub private repo instead of paid storage (owner decision).
  Dumps are ~12 KB, so the repo stays tiny. Content is also in YAML today, but admin-panel edits (Phase 5) will only live in the DB.
- **Revert:** `sudo systemctl disable --now arthistory-backup.timer && sudo rm /etc/systemd/system/arthistory-backup.* &&
  sudo systemctl daemon-reload`; optionally `rm -r ~/backups`, remove the deploy key on GitHub + `~/.ssh/art_history_backups_deploy*`.

### Open-ended periods in content ("1808/" = since 1808, still ongoing)
- **What:** the date parser accepts an open end for periods only — relationship `period`, `movements.period`,
  `patrons.active` — stored as `[1808-01-01,)` (infinite upper bound), label "since 1808". Births, deaths, creation and
  founding dates still reject it. No migration (daterange supports it natively); API already returns `to: null`.
- **Why:** an institution's current location can be a dated `located_in` too, so its map route ends where it is now.
- **Revert:** redeploy the previous commit (first remove any `…/` periods from `content/`, or the import will fail).

### Migration 005: location history for institutions that moved
- **What:** new relationship type `located_in` (institution → place, physical presence, with period).
  `institutions.place_id` stays the current location. `/v1/map/presence` accepts `types=…,institution` (default unchanged).
  Smoke test covers it; docs: `backend/docs/data-model.md`, `backend/docs/api.md`, `content/README.md`.
- **Why:** owner decision — an institution can move, so one place isn't enough. Mirrors
  `artworks.current_institution_id` + `housed_at`.
- **Revert:** as arthistory_owner: `DELETE FROM relationships WHERE relationship_type = 'located_in';
  DELETE FROM relationship_types WHERE code = 'located_in'; DELETE FROM schema_migrations WHERE name = '005_institution_locations.sql'`,
  then redeploy the previous commit.

### Checkout renamed: /var/www/arthistory-api → /var/www/arthistory
- **What:** `mv /var/www/arthistory-api /var/www/arthistory`; `~/server-docs` symlink repointed; pm2 process re-created from
  the new `backend/ecosystem.config.js` (`cwd` updated) and `pm2 save`d. The pm2 process name stays `arthistory-api`
  (it is the API process), as do the nginx log names. nginx and the Git remote are unaffected.
- **Why:** the folder holds the whole repo (backend, content, server docs, later the admin panel), not only the API.
- **Revert:** `pm2 delete arthistory-api && mv /var/www/arthistory /var/www/arthistory-api`, restore `cwd` in
  `backend/ecosystem.config.js`, `pm2 start backend/ecosystem.config.js && pm2 save`,
  `ln -sfn /var/www/arthistory-api/server-docs ~/server-docs`.

## 2026-09-24

### Art history read API + content import (Phase 3)
- **Memory check first:** 2.2 GiB of 3.8 available, swap in use 335 MB but no active swapping (vmstat si/so 0), PSI memory ≈ 0,
  no OOM kills. Largest consumers are the VS Code server (~430 MB) and Claude Code (~250 MB). No action needed.
- **API:** `GET /v1/{artists,artworks,places,movements,institutions,patrons}[/:slug]`, `/v1/search`, `/v1/vocabulary`,
  `/v1/map/{places,presence,<type>/:slug}` (GeoJSON), `/v1/graph/<type>/:slug` (nodes + edges). Reference: `backend/docs/api.md`.
  Markdown fields served as sanitized HTML (markdown-it + sanitize-html). `Cache-Control: public, max-age=60` + ETag.
- **Migration 004:** `f_unaccent()` + trigram GIN indexes (accent-insensitive fuzzy search), `range_json()` (date JSON shape),
  `entity_index` view. Applied to `arthistory_dev` and (via deploy) `arthistory`.
- **Content:** `content/**/*.yaml` (format: `content/README.md`), starter set of 44 entities around Van Gogh, Gauguin,
  Hokusai, Hiroshige and Japonisme, 58 relationships. `npm run import` (arthistory_admin role, one transaction, idempotent,
  `--dry-run`, opt-in `--prune`); `deploy.sh` now runs it after migrations.
- **New npm deps:** yaml, markdown-it, sanitize-html. `npm test` runs unit tests for the date parser.
- **Revert:** redeploy the previous commit (`git checkout a32f79d -- backend && pm2 reload arthistory-api`); data can be
  removed with `DELETE FROM relationships; DELETE FROM artworks; …` as arthistory_admin. Migration 004 is harmless to leave;
  to drop it as arthistory_owner: `DROP VIEW entity_index; DROP FUNCTION range_json, iso_date; DROP INDEX …_trgm; DROP FUNCTION f_unaccent;
  DELETE FROM schema_migrations WHERE name = '004_read_api.sql'`.

### PostgreSQL 18 + PostGIS 3.6 installed (Phase 2)
- **What:** added the official PGDG apt repo (`/etc/apt/sources.list.d/pgdg.list`, via `postgresql-common`), installed
  `postgresql-18` (18.6) and `postgresql-18-postgis-3` (3.6.4). Cluster `18/main`, port 5432, **localhost only**; pg_hba unchanged
  (local peer, 127.0.0.1/::1 scram-sha-256). ~310 MB disk.
- **Why PGDG and not Ubuntu's package:** Ubuntu 22.04 ships PostgreSQL 14, end-of-life Nov 2026.
- **Tuning:** `/etc/postgresql/18/main/conf.d/arthistory.conf` (copy: `server-docs/config/postgresql/arthistory.conf`):
  shared_buffers 256MB, effective_cache_size 1GB, work_mem 8MB, max_connections 30, jit off, slow-query log ≥ 1 s only.
- **Roles:** `arthistory_owner` (migrations/DDL), `arthistory_admin` (read/write, no DDL, 30 s timeout),
  `arthistory_api` (read-only + `default_transaction_read_only`, 5 s timeout). Passwords generated into
  `~/.config/arthistory/backend.env` and `~/.pgpass` (both 600, outside the repo).
- **Databases:** `arthistory` (production) and `arthistory_dev`, both owned by arthistory_owner, CONNECT revoked from PUBLIC.
  Extensions: postgis, pg_trgm, unaccent. Setup is scripted and idempotent: `backend/db/setup.sh <db>`.
- **Schema:** migrations 001 (core model), 002 (relationship vocabulary, 20 types), 003 (`entity_id()` lookup) applied to both DBs.
  Design: `backend/docs/data-model.md`. Smoke test: `backend/db/tests/schema_smoke.sql` (10 rule violations rejected, queries verified).
- **App:** pg pools (api: 5, admin: 3 connections); `/v1/health` now also checks the DB → `{"status":"ok","db":"ok"}`.
  `deploy.sh` now runs `npm run migrate`. Graceful shutdown closes pools on pm2 reload.
- **MySQL:** untouched.
- **Revert:** `pm2 reload` an older commit; `sudo -u postgres dropdb arthistory && sudo -u postgres dropdb arthistory_dev`;
  `sudo apt purge postgresql-18 postgresql-18-postgis-3` (deletes all Postgres data!); `sudo rm /etc/apt/sources.list.d/pgdg.list`.

## 2026-09-23

### Art history backend live (Phase 1: health check)
- **App:** `backend/` — Express 5, `GET /v1/health` → `{"status":"ok"}`. Binds `127.0.0.1:3004` only. CORS allows exactly `https://arthistory.piogino.ch`. Host routing: `/v1` only on api host, `/admin` only on admin host (placeholder 503).
  Loads secrets from `~/.config/arthistory/backend.env` (outside repo; currently empty).
- **pm2:** process `arthistory-api` from `backend/ecosystem.config.js` (max_memory_restart 300M), `pm2 save` done — the existing `pm2-ubuntu.service` restores it on boot.
- **pm2-logrotate** installed (server-wide, affects all pm2 apps' logs in `~/.pm2/logs`): max_size 10M, retain 5, compress.
- **nginx:** `/etc/nginx/sites-available/arthistory` (symlinked in sites-enabled): `api.arthistory.piogino.ch` proxies only `/v1/`; `admin.arthistory.piogino.ch` proxies `/`. Own access/error logs `/var/log/nginx/arthistory-*.log`.
- **TLS:** certbot cert `api.arthistory.piogino.ch` (SAN: admin.arthistory…), HTTP→HTTPS redirect, auto-renew via `certbot.timer`. Expires 2026-12-22 (renews automatically ~30 days before).
- **Deploy:** `backend/deploy.sh` (git pull, npm ci, pm2 reload, health probe).
- **Test page:** `health.html` in the repo root → https://arthistory.piogino.ch/health.html shows the browser CORS round-trip.
- **Revert:** `pm2 delete arthistory-api && pm2 save`; `sudo rm /etc/nginx/sites-enabled/arthistory && sudo systemctl reload nginx`; `sudo certbot delete --cert-name api.arthistory.piogino.ch`; `pm2 uninstall pm2-logrotate`.

### Secrets policy: secrets never enter the repo
- **What:** all credentials (DB passwords, admin login, session secret, API keys) live only in `~/.config/arthistory/*.env` (dir 700, files 600, user `ubuntu`) — outside the git checkout. The app will load `~/.config/arthistory/backend.env`; the repo only has `backend/.env.example` with placeholder names.
  Git hooks (`scripts/githooks/`): `pre-commit` and `pre-push` run `check-secrets.sh`, which blocks secret file names, credential-looking lines/bcrypt hashes, and **any real value present in the secrets files**. `pre-push` re-scans every outgoing commit, so `git commit --no-verify` cannot sneak a secret out. Tested all cases.
- **Why:** the repo is public; admin/CMS credentials must never reach GitHub.
- **Revert:** n/a (policy). If a secret ever leaks: rotate it immediately — deleting the commit is not enough.

### VPS upgraded again (by owner)
- RAM 2 → 4 GB, disk 40 → 60 GB (root fs auto-grew: 58 GB, 42 GB free). 2 vCPU.

### Project repo connected: github.com/piosteiner/art_history
- **What:** cloned the repo to `/var/www/arthistory-api` (the server checkout *is* the repo). Layout: `backend/` (Node app), `server-docs/` (this documentation, moved from `~/server-docs`; `~/server-docs` is now a symlink), `scripts/`.
  Push auth via a repo-scoped SSH deploy key `~/.ssh/art_history_deploy` (ssh alias `github-art_history` in `~/.ssh/config`; remote `git@github-art_history:piosteiner/art_history.git`).
- **Workflow:** every change → update this changelog → `scripts/save.sh "message"` (commit, pull --rebase, push). The pre-commit hook in `scripts/githooks/` (enabled via `core.hooksPath`) blocks `.env`/key files and credential-looking lines — the repo is public.
- **Why:** off-server backup of code and docs; single history for backend + frontend.
- **Revert:** remove the deploy key in GitHub → Settings → Deploy keys and delete `~/.ssh/art_history_deploy*` and the `github-art_history` block in `~/.ssh/config`.

### Firewall enabled (ufw)
- **What:** `ufw default deny incoming`, allow `OpenSSH` + `Nginx Full` (80/443), enabled. Removed stale pre-existing rules for ports 5000 and 3001.
- **Why:** app ports 3000–3003 were bound to 0.0.0.0 and reachable directly from the internet, bypassing nginx/TLS. Verified all sites still respond via their HTTPS hostnames afterwards.
- **Revert:** `sudo ufw disable` (or `sudo ufw allow <port>` to reopen a single port).

### DNS records added (by owner)
- `api.arthistory.piogino.ch` and `admin.arthistory.piogino.ch` → A 83.228.207.199. Verified resolving.

### VPS upgraded (by owner, Infomaniak)
- 1 → 2 vCPU, 20 → 40 GB disk (RAM unchanged at 2 GB). Root filesystem auto-grew to 39 GB on reboot (23 GB free, 43% used).

### Baseline
- Server inventory surveyed and recorded in README.md.
