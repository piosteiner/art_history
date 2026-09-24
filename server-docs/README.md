# piogino-matterhorn — server docs

Infomaniak VPS Lite, Satigny CH · Ubuntu 22.04 · public IP 83.228.207.199
Every change to this server is recorded in [CHANGELOG.md](CHANGELOG.md) (newest first). Lives in the art_history repo at `/var/www/arthistory-api/server-docs` (symlinked from `~/server-docs`), pushed to GitHub with `scripts/save.sh`.

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
| arthistory-api (pm2: arthistory-api) | /var/www/arthistory-api/backend | Node/Express, pm2 | 3004 | api.arthistory / admin.arthistory.piogino.ch | PostgreSQL `arthistory` (+ `arthistory_dev`) |

Shared: nginx (reverse proxy, certbot TLS), pm2 as user `ubuntu` (pm2-ubuntu.service).
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
Never in any git repo. Art history project: `~/.config/arthistory/*.env` (700/600). See CHANGELOG 2026-09-23 "Secrets policy".
