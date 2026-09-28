# piogino-matterhorn — server docs

Infomaniak VPS Lite, Satigny CH · Ubuntu 22.04 · public IP 83.228.207.199
Every change to this server is recorded in [CHANGELOG.md](CHANGELOG.md) (newest first). Lives in the art_history repo at `/var/www/arthistory/server-docs` (symlinked from `~/server-docs`), pushed to GitHub with `scripts/save.sh`.

## Resources
2 vCPU · 4 GB RAM (+1 GB swap) · 60 GB disk (upgraded 2026-09-23 from 1 CPU / 2 GB / 20 GB)

## Services
| Project | Path | Runtime | Port (local) | Public hostname | Data |
|---|---|---|---|---|---|
| adenai-admin (pm2: adenai-cms) | /var/www/adenai-admin | Node/Express, pm2 | 3001 | adenai-admin.piogino.ch | files |
| calorie-tracker-api | /var/www/calorie-tracker-api | Node/Express, pm2 | 3000 | api.calorie-tracker.piogino.ch | MySQL `calorie_tracker` |
| quiz-platform (pm2: quiz-backend) | /var/www/quiz-platform | Node/Express+socket.io, pm2 | 3002 | quiz.piogino.ch | SQLite |
| obs-remote-media-backend | /var/www/obs-remote-media-backend | Node/Express+socket.io, pm2 | 3003 | api.piogino.ch (sub-path) | SQLite |
| gif-converter | /var/www/gif-converter | Flask/Gunicorn, systemd | 5000 | api.piogino.ch | files |
| arthistory (pm2: arthistory-api) | /var/www/arthistory/backend | Node/Express, pm2 | 3004 | api.arthistory / admin.arthistory.piogino.ch | PostgreSQL `arthistory` (+ `arthistory_dev`) |

Shared: nginx (reverse proxy, certbot TLS; art history site config copied in `config/nginx/`), pm2 as user `ubuntu` (pm2-ubuntu.service).
Databases (both localhost only): MySQL 8 (:3306, calorie-tracker) · PostgreSQL 18 + PostGIS 3.6 (:5432, art history; tuning in `config/postgresql/`).

## Firewall (ufw)
Only 22 (SSH), 80, 443 are open. App ports are reachable only via nginx.

## DNS (managed at Infomaniak)
| Record | Type | Target |
|---|---|---|
| arthistory.piogino.ch | CNAME | piosteiner.github.io (frontend, GitHub Pages) |
| api.arthistory.piogino.ch | A | 83.228.207.199 |
| admin.arthistory.piogino.ch | A | 83.228.207.199 |

## Secrets
Never in any git repo. Art history project: `~/.config/arthistory/*.env` + `backup-passphrase` (700/600). See CHANGELOG 2026-09-23 "Secrets policy".
Admin panel: nginx basic auth `/etc/nginx/arthistory-admin.htpasswd` (root:www-data 640, SHA-512 crypt) + app users in
the `admin_users` table (scrypt). Both passwords live in the owner's password manager only.

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
