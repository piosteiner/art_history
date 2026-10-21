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
**Performance budgets** (2026-10-21): database `scale_test` = the latest backup with every entry cloned nine times
(`cd backend && npm run perf:data`, ≈ 10 min, replaces only scale_test), then `npm run perf` — a server of the checkout on
:3015 against it, the times of the heavy requests, whole lists, one change through the worker and the global part
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

## Secrets
Never in any git repo. Art history project: `~/.config/arthistory/*.env` + `backup-passphrase` (700/600). See CHANGELOG 2026-09-23 "Secrets policy".
Admin panel: WebSocket `/live` (presence, drafts) proxied by nginx with Upgrade headers. One login — app users in the `admin_users` table (scrypt); the password lives in the owner's password manager only.

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
1. `pg_dump` of `arthistory` (plain SQL, gzip) → `~/backups/arthistory/arthistory-YYYY-MM-DD.sql.gz`, kept 14 days.
2. **Verify:** restored into a scratch database (`arthistory_backup_check`), row counts compared with production, dropped.
3. **Off-site:** only when the data changed — encrypted with gpg (AES256, passphrase in `~/.config/arthistory/backup-passphrase`,
   **also kept in the owner's password manager**) and pushed to the private GitHub repo `piosteiner/art_history-backups`
   (clone: `~/backups/arthistory-offsite`, deploy key `~/.ssh/art_history_backups_deploy`, SSH alias `github-art_history-backups`).
   Every version is in that repo's git history.

Check: `systemctl list-timers arthistory-backup` · `journalctl -u arthistory-backup -n 20` · run now: `sudo systemctl start arthistory-backup`.
Not backed up (and not needed): the dev database; code, content YAML and docs are in this Git repo. Other projects' databases are not included.

**Restore** (never overwrites — always into a new database):
```bash
scripts/restore.sh ~/backups/arthistory/arthistory-2026-09-28.sql.gz arthistory_restored        # local copy
git -C ~/backups/arthistory-offsite log --oneline                                                # pick a version
git -C ~/backups/arthistory-offsite show <commit>:arthistory.sql.gz.gpg > /tmp/old.sql.gz.gpg     # HEAD = latest
scripts/restore.sh /tmp/old.sql.gz.gpg arthistory_restored                                       # off-site copy
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
