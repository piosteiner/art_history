# piogino-matterhorn — server docs

Infomaniak VPS Lite, Satigny CH · Ubuntu 22.04 · public IP 83.228.207.199
Every change to this server is recorded in [CHANGELOG.md](CHANGELOG.md) (newest first). Lives in the art_history repo at `/var/www/arthistory/server-docs` (symlinked from `~/server-docs`), pushed to GitHub with `scripts/save.sh`.

## Resources
2 vCPU · 4 GB RAM (+1 GB swap) · 60 GB disk (upgraded 2026-09-23 from 1 CPU / 2 GB / 20 GB)

## Services
| Project | Path | Runtime | Port (local) | Public hostname | Data |
|---|---|---|---|---|---|
| adenai-map (pm2: adenai-cms) | /var/www/adenai-map/server | Node/Express, pm2 | 3001 | adenai-admin.piogino.ch | files |
| calorie-tracker-api | /var/www/calorie-tracker-api | Node/Express, pm2 | 3000 | api.calorie-tracker.piogino.ch | MySQL `calorie_tracker` |
| quiz-platform (pm2: quiz-backend) | /var/www/quiz-platform | Node/Express+socket.io, pm2 | 3002 | quiz.piogino.ch | SQLite |
| obs-remote-media-controller (pm2: obs-remote-backend) | /var/www/obs-remote-media-controller/backend | Node/Express+socket.io, pm2 | 3003 | api.piogino.ch (sub-path) | SQLite |
| file-converter (systemd: file-converter-api) | /var/www/file-converter/server | Flask/Gunicorn, systemd | 5000 | api.piogino.ch (frontend: converter.piogino.ch, GitHub Pages) | files |
| arthistory (pm2: arthistory-api) | /var/www/arthistory/backend | Node/Express, pm2 | 3004 | api.arthistory / admin.arthistory.piogino.ch | PostgreSQL `arthistory` (+ `arthistory_dev`; tests: `arthistory_test`, `_1`, `_2` on :3006/:3008/:3009 while they run) |
| arthistory test environment (pm2: arthistory-test) | /var/www/arthistory/backend (same code) + site in /var/www/arthistory-test/site | Node/Express, pm2 | 3010 | test.arthistory / admin.test.arthistory / api.test.arthistory.piogino.ch | PostgreSQL cluster `18/test` (:5433) `arthistory`, reset nightly — see "Test environment" |
| justone (static) | /var/www/justone/public | nginx only (no process) | — | justone.piogino.ch (TLS pending DNS, 2026-11-09) | localStorage in the browser only |

Shared: nginx (reverse proxy, certbot TLS; art history site config copied in `config/nginx/`), pm2 as user `ubuntu` (pm2-ubuntu.service). Both hostnames gzip JSON (`gzip_proxied any`).
Databases (both localhost only): MySQL 8 (:3306, calorie-tracker) · PostgreSQL 18 + PostGIS 3.6 (:5432, art history; tuning in `config/postgresql/`).
PostgreSQL extensions in `arthistory`: postgis, pg_trgm, unaccent, btree_gist, fuzzystrmatch, pg_stat_statements
(preloaded since 2026-10-17). Slowest statements (as arthistory_owner):
`SELECT calls, round(mean_exec_time) ms, left(query, 100) FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'arthistory') ORDER BY total_exec_time DESC LIMIT 20;`
— note that the test databases share the statistics (filter by `dbid`). `SELECT pg_stat_statements_reset();` without
arguments clears **every** database's statistics; for one: `pg_stat_statements_reset(0, (SELECT oid FROM pg_database WHERE datname = 'scale_test'), 0)`.
Slow-query log: statements over 1 s and lock waits (`conf.d/arthistory.conf`) in `/var/log/postgresql/`.
**`scripts/slow-queries.sh`** (sudo, read-only; `DAYS=1`) sums both up: statements over 1 s per day, the most frequent
ones, and the pg_stat_statements top lists.
**Request times** (2026-10-28): the API's nginx log (`/var/log/nginx/arthistory-api.access.log`, format
`arthistory_timed` in `/etc/nginx/conf.d/arthistory-timing.conf`, copy in `config/nginx/`) ends each line with
`rt=` (the whole request, s) and `urt=` (the app's part). Requests over 2 s in a time window, e.g. the nightly site build:
`sudo grep '28/Oct/2026:03:[23]' /var/log/nginx/arthistory-api.access.log | awk '{for (i = NF-1; i <= NF; i++) if ($i ~ /^rt=/ && substr($i, 4) + 0 > 2) print}'`
— `urt` near `rt`: the app was slow; `rt` much larger: the network or the client.
**Load history** (sysstat, enabled 2026-10-28: `ENABLED="true"` in `/etc/default/sysstat`, `HISTORY=28` days in
`/etc/sysstat/sysstat`; collected every 10 min by `/etc/cron.d/sysstat`): `sar -u` (CPU) · `sar -q` (load, run queue) ·
`sar -r` (memory) · `sar -d` (disks) for today, `-f /var/log/sysstat/saDD -s 03:00:00 -e 04:00:00` for another day.
**Performance budgets** (2026-10-21): database `scale_test` = the latest backup with every entry cloned nine times
(`cd backend && npm run perf:data`, ≈ 10 min, replaces only scale_test), then `npm run perf` — migrates scale_test, a server of the checkout on
:3015 against it, the times of the heavy requests, 13 admin pages (logged in as a user `perf` made per run), whole lists, one change through the worker and the global part
against `backend/perf/budgets.json` (exit 1 when over). Run before deploying changes to queries, views or the worker.

## Firewall (ufw) + fail2ban
Only 22 (SSH), 80, 443 are open. App ports are reachable only via nginx.
fail2ban 0.11 (since 2026-09-29), one jail: `arthistory-admin` — 5 failed admin logins (401 on `POST /login` in
`/var/log/nginx/arthistory-admin.access.log`) within 10 min → IP rejected on 80/443 for 1 h. The server's own IP is exempt.
Ubuntu's default `sshd` jail is **off** (key-only SSH). Config: `/etc/fail2ban/jail.d/arthistory.local`,
`/etc/fail2ban/filter.d/arthistory-admin.conf` (copies in `config/fail2ban/`).
Check: `sudo fail2ban-client status arthistory-admin` · unban: `sudo fail2ban-client set arthistory-admin unbanip <ip>`.

## DNS (managed at Infomaniak)
| Record | Type | Target |
|---|---|---|
| arthistory.piogino.ch | CNAME | piosteiner.github.io (frontend, GitHub Pages) |
| api.arthistory.piogino.ch | A | 83.228.207.199 |
| admin.arthistory.piogino.ch | A | 83.228.207.199 |
| test.arthistory.piogino.ch | A | 83.228.207.199 (test environment, 2026-10-31) |
| admin.test.arthistory.piogino.ch | A | 83.228.207.199 (test environment, 2026-10-31) |
| api.test.arthistory.piogino.ch | A | 83.228.207.199 (test environment, 2026-10-31) |
| justone.piogino.ch | A | 83.228.207.199 (Just One card generator, 2026-11-09); TLS still to issue: `sudo certbot --nginx -d justone.piogino.ch` |

## Test environment (for visitors) — set up 2026-10-31
The same CMS and site as production for people who want to try the project, reset every night:
- **Site** https://test.arthistory.piogino.ch (a build of `frontend/` with `VITE_API_BASE`, `VITE_SITE`, `VITE_TEST_ENV=1`,
  in `/var/www/arthistory-test/site`; `noindex`), **CMS** https://admin.test.arthistory.piogino.ch (one shared login
  `test`, password `TEST_LOGIN_PASSWORD` in `~/.config/arthistory/test.env`; a yellow notice on every page —
  `config.testEnv`), **API** https://api.test.arthistory.piogino.ch. nginx: `sites-available/arthistory-test` (copy in
  `config/nginx/`), one certificate for the three hosts (certbot, renewed with the others); the site's map without a
  MapTiler key (OpenFreeMap); failed logins count for the fail2ban jail `arthistory-admin` (second logpath).
- **Isolated**: pm2 `arthistory-test` (`backend/ecosystem.test.config.js`, 127.0.0.1:3010) uses its own PostgreSQL
  **cluster** `18/test` on :5433 (`conf.d/arthistory-test.conf`: 64 MB shared buffers) with its own roles and passwords
  (`test.env`, `~/.pgpass`) — it has no credentials for production's cluster, and no API keys of outside services.
- **Reset** nightly 04:30 UTC, systemd `arthistory-test-reset.timer` → `scripts/test-env.sh` (≈ 20 s): production
  dumped, restored into a fresh database, then emptied of what isn't for visitors — sessions, the owner's drafts and
  working copies (`admin_drafts`, `page_drafts`, `form_drafts`, `live_docs`), visitors' feedback, `page_downloads`,
  `editor_scopes`; production's accounts can't log in (`password_hash = '!locked'`; the history still names them);
  the owner's unpublished work removed too (owner 2026-10-31) — changelog days, roadmap items, pages and start views
  not published, citations pending a Publish, and the history's rows of everything gone (also "Recently deleted");
  the login `test` set; the process restarted; the site rebuilt. `deploy.sh` migrates the test database, reloads the
  process and rebuilds the site after production (`--site-only`).
- Run now: `sudo systemctl start arthistory-test-reset` (or `scripts/test-env.sh`) · logs: `journalctl -u
  arthistory-test-reset -n 20`, `pm2 logs arthistory-test` · new shared password: edit `TEST_LOGIN_PASSWORD` in
  `test.env`, then reset (or `echo "$PW" | ENV_FILE=~/.config/arthistory/test.env DB_PORT=5433 node scripts/admin-user.js test`).
- Remove: `sudo systemctl disable --now arthistory-test-reset.timer`, `pm2 delete arthistory-test && pm2 save`,
  `sudo pg_dropcluster 18 test --stop`, remove the nginx site (+ certificates), the fail2ban logpath, `/var/www/arthistory-test`,
  the :5433 lines in `~/.pgpass` and `test.env`.

## Secrets
Never in any git repo. Art history project: `~/.config/arthistory/*.env` + `backup-passphrase` (700/600). See CHANGELOG 2026-09-23 "Secrets policy".
Admin panel: WebSocket `/live` (presence, drafts) proxied by nginx with Upgrade headers. Accounts in the `admin_users` table (scrypt) with a role (220): members (the site only — study sets, quiz results; also by sign-up at `/signup` while the CMS's Accounts page has it open), editors (the CMS), admins (also the Accounts page). The owner's password lives in their password manager only; a member who forgets theirs gets a new one from an admin (no e-mail is kept). NB fail2ban counts members' failed logins too — many people behind one address (a school) share the 5 tries.

## Source books (private)
`/home/ubuntu/books` (700, outside the repo; since 2026-10-30): PDFs of the owner's books, read with Claude and cited
before Wikipedia — Mason, *History of Japanese Art* (chapters + front/back matter), Portal, *Korea: Art and
Archaeology* (scan, OCR). Under copyright: never into the repo or a public page; not in the backups.
Also course materials: `War and Peace FS19/` (Thomsen lecture) and `art-and-totalitarianism/` (seminar Beatrice/Marinho,
UZH HS 2024 — readings, programmes, slides, the owner's notes and paper; downloaded 2026-11-07 from the owner's shared
Google Drive folder, 37 files, 461 MB).

## API keys for outside data (open to-do)
Sources of the admin panel's image search that need a key of our own — without it the source is not offered
(`src/admin/imagesearch.js`). Keys go into `~/.config/arthistory/backend.env` (never into the repo), then
`pm2 reload arthistory-api`. Status 2026-10-13: **none applied for yet** — the owner will apply later.

| Source | What it adds | Where to apply | Variable | Notes |
|---|---|---|---|---|
| Europeana | images from European museums and archives (open licences only) | https://pro.europeana.eu/page/get-api | `EUROPEANA_KEY` | ask for a **Project key** (production use, free) — Personal keys are "non-production" only (terms of use, API section) |
| Smithsonian Open Access | CC0 images from the Smithsonian museums | https://api.data.gov/signup/ | `SMITHSONIAN_KEY` | instant, free; the DEMO_KEY is for exploring only |
| DigitaltMuseum | ~300 Norwegian and Swedish museums | KulturIT support portal, via https://dok.digitaltmuseum.org/en/api | `DIMU_KEY` | keys only for museums/organisations with an agreement — ask whether a research project qualifies; "demo" is for testing only |
| Paris Musées | CC0 images of the 14 Paris city museums | https://apicollections.parismusees.paris.fr/ (account → token) | — | not built yet: needs the token first |
| National Museum of Korea (e-museum) | Korean collections | https://www.data.go.kr/ (open API "e뮤지엄", in Korean) | — | not built yet: needs the key first |


- `boundaries` — country and first-level region outlines from **Natural Earth** (public domain; 50m countries,
  10m admin-1, simplified ~1 km), loaded by `cd backend && npm run boundaries` (as owner; idempotent upsert, downloads
  ~44 MB from github.com/nvkelso/natural-earth-vector). Not part of migrations or YAML; included in the database
  backup. Re-run after a fresh database setup, or to update the data. Dev: `npm run boundaries:dev`; tests load
  `test/e2e/fixtures/boundaries.geojson`.

## Backups (art history database)
Nightly at ~03:30 UTC, systemd `arthistory-backup.timer` → `scripts/backup.sh` (units: `config/systemd/`):
1. `pg_dump` of `arthistory` (plain SQL, gzip) → `~/backups/arthistory/arthistory-YYYY-MM-DD.sql.gz` (everything but the
   bytes of `private_images`) + `arthistory-private-images-YYYY-MM-DD.sql.gz` (the owner's reference images, ~300 MB, a
   hard link to the day before when unchanged), kept 14 days. Since 2026-11-07; older dumps hold the images themselves.
2. **Verify:** both restored into a scratch database (`arthistory_backup_check`), row counts compared with production, dropped.
3. **Off-site:** only when the data changed — encrypted with gpg (AES256, passphrase in `~/.config/arthistory/backup-passphrase`,
   **also kept in the owner's password manager**), cut into parts of 95 MB (`arthistory.sql.gz.gpg.00`, `.01` …;
   `private-images.sql.gz.gpg.00` … only when the images changed — GitHub refuses a file over 100 MB) and pushed to the
   private GitHub repo `piosteiner/art_history-backups` (clone: `~/backups/arthistory-offsite`, deploy key
   `~/.ssh/art_history_backups_deploy`, SSH alias `github-art_history-backups`) — **the latest version only**, as a new root
   commit each time (2026-11-07: keeping every version grew the repo by 100–400 MB a day; the pushes had failed since
   4 November, when the dump passed 100 MB). The 14 local days are the history.

Check: `systemctl list-timers arthistory-backup` · `journalctl -u arthistory-backup -n 20` · run now: `sudo systemctl start arthistory-backup`.
Not backed up (and not needed): the dev database; code, content YAML and docs are in this Git repo. Other projects' databases are not included.

**Restore** (never overwrites — always into a new database):
```bash
scripts/restore.sh ~/backups/arthistory/arthistory-2026-11-07.sql.gz arthistory_restored        # local copy (loads the images file beside it)
git -C ~/backups/arthistory-offsite pull --quiet                                                 # the latest off-site copy
scripts/restore.sh ~/backups/arthistory-offsite/arthistory.sql.gz.gpg.00 arthistory_restored     # the parts are joined (images beside it too)
```
To make it live: `pm2 stop arthistory-api`, then as postgres `ALTER DATABASE arthistory RENAME TO arthistory_broken;
ALTER DATABASE arthistory_restored RENAME TO arthistory;`, `pm2 start arthistory-api`, check `/v1/health`.
On a **new server**: install Postgres 18 + PostGIS, clone both repos, run `backend/db/setup.sh arthistory_dev` (creates the
roles with new passwords + `~/.pgpass`), put the passphrase into `~/.config/arthistory/backup-passphrase` (600), then
`scripts/restore.sh <file> arthistory` — straight into the production name, since it doesn't exist yet.

## Content snapshots (YAML in git) — installed 2026-10-17
Nightly at ~04:00 UTC, systemd `arthistory-export.timer` → `scripts/export-commit.sh` (units: `config/systemd/`):
`backend/scripts/export.js` writes the production database to `content/` (YAML); when that changed, `content/` alone is
committed ("Content snapshot YYYY-MM-DD (nightly export)") and pushed — the content's history readable in the public repo,
beside the encrypted backups. Other uncommitted work in this checkout is not committed (pull with `--autostash`); the
git hooks run as usual. A failed pull (someone changed `content/` by hand) stops it: see the journal, resolve, run again.
Install (as ubuntu, in `/var/www/arthistory`, after `git pull`):
```bash
command -v node                      # must be on systemd's default PATH (/usr/bin, /usr/local/bin); else set Environment=PATH= in the unit
scripts/export-commit.sh             # once by hand: the first snapshot (content/ was last exported 2026-10-09)
sudo cp server-docs/config/systemd/arthistory-export.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now arthistory-export.timer
```
Check: `systemctl list-timers arthistory-export` · `journalctl -u arthistory-export -n 20`. Revert: `sudo systemctl disable --now
arthistory-export.timer`, remove both units, `daemon-reload`.

## Query statistics (monthly) — installed 2026-11-07
On the 1st at ~05:00 UTC, systemd `arthistory-query-stats.timer` → `scripts/query-stats.sh` (units: `config/systemd/`): the
slow-queries report of the past month (`scripts/slow-queries.sh`: the log's statements over 1 s, pg_stat_statements' most
expensive) written to `logs/query-stats-<YYYY-MM>.txt` (git-ignored), then `pg_stat_statements_reset()` — so each month's
report measures that month's code (the statistics had never been reset before; the code review of 2026-11-07 found a
query that no longer existed at the top). Run now: `scripts/query-stats.sh` (`--keep`: no reset). Check:
`systemctl list-timers arthistory-query-stats` · `journalctl -u arthistory-query-stats -n 20`. Revert: `sudo systemctl
disable --now arthistory-query-stats.timer`, remove both units, `daemon-reload`. Installed by the owner on 2026-11-07 with:
```
sudo cp server-docs/config/systemd/arthistory-query-stats.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now arthistory-query-stats.timer
```

## Watching an auction (Blaquier-Arrieta sale, until 25 November 2026) — prepared 2026-11-01
Daily at ~08:13 UTC, systemd `arthistory-watch-sale.timer` → `scripts/watch-sale.sh`: Sotheby's lot list and every lot
page (12 lots, 15 s apart as robots.txt asks, ≈ 3½ min), compared with the day before
(`~/.local/state/arthistory/sale-<sale>.json`). One note in the CMS feedback inbox (`/feedback`, kind content) when there
is something: a lot that isn't an entry yet (no artwork has its page as web page), a lot new / withdrawn / gone, or a
changed description, provenance, exhibitions or literature (lot 10 shows lot 4's provenance). `--dry-run` writes nothing.
Results (owner 2026-11-01): when a lot of ours is closed, its provenance gets Sotheby's as agent ("evening sale N12368,
18 November 2026, lot N", New York) and, if sold, "Private collection" as the next owner with the price (USD, with
buyer's premium), both cited to the lot page (audit source `watch-sale`); unsold: Sotheby's step "not sold", the
collection's planned end left for the owner. Once per lot (`recorded` in the state file, and skipped when that day's
Sotheby's step exists).
After 25 November it disables its timer. Another sale: copy the script, change `SALE` and `UNTIL`.
Install: `sudo cp server-docs/config/systemd/arthistory-watch-sale.{service,timer} /etc/systemd/system/ && sudo systemctl
daemon-reload && sudo systemctl enable --now arthistory-watch-sale.timer`. Check: `journalctl -u arthistory-watch-sale -n 5`.
Remove: `sudo systemctl disable --now arthistory-watch-sale.timer`, delete both units, `daemon-reload`.
