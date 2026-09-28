# Backend — arthistory-api

Node/Express API (`/v1/...`) and server-rendered admin panel (`/admin/...`) in one pm2 process,
backed by PostgreSQL + PostGIS. Listens on `127.0.0.1:3004` behind nginx.

Status: Phase 5 — admin panel at https://admin.arthistory.piogino.ch/admin/ (the database is the source of truth);
public read API (entities, search, map GeoJSON, graph) at https://api.arthistory.piogino.ch/v1/.

- Data model & roles: [docs/data-model.md](docs/data-model.md)
- API reference: [docs/api.md](docs/api.md)
- Content format & import: [../content/README.md](../content/README.md)

## Run
- Production: pm2 process `arthistory-api` (`ecosystem.config.js`). Deploy: `./deploy.sh`.
- Development: `npm run dev` (port 3005, auto-reload). Never edit and test against the live process.
- Config: secrets in `~/.config/arthistory/backend.env` (outside the repo) — see `.env.example` for the names.

## Database
- Schema changes: add `db/migrations/NNN_name.sql`, run `npm run migrate:dev`, test, commit, then `./deploy.sh` (runs `npm run migrate`).
- `npm run migrate -- --status` lists applied/pending migrations.
- psql: `psql -h localhost -U arthistory_owner arthistory` (passwords come from `~/.pgpass`).
- First-time setup of a database: `db/setup.sh <dbname>`.

## Admin panel (`src/admin/`)
Server-rendered pages, no front-end framework. Forms are generated from the field kinds in `src/content.js` — the same
definitions the import/export use, so a form save and a YAML import validate identically.
- Login: `admin_users` (scrypt hashes) + `admin_sessions` (only SHA-256 of the cookie token stored), cookie `HttpOnly`,
  `SameSite=Strict`, `Secure`; non-GET requests must carry the admin site's `Origin`. 10 failed logins / 15 min per IP.
  nginx basic auth in front (`/etc/nginx/arthistory-admin.htpasswd`).
- Users: `npm run admin:user -- <name>` (asks for the password; also resets it and logs out that user's sessions).
- Every write runs in a transaction tagged with the user → the `audit_log` trigger records who changed what
  (History pages). Edits use optimistic locking (the form carries `updated_at`; a concurrent save is refused).

## Content
- The database is the source of truth. `npm run export` (or `export:dev`) writes it to `../content/` as YAML for a
  readable snapshot in git; `npm run import` still bulk-loads YAML (see `../content/README.md`). Deploys don't import.
- `npm test` — unit tests (`test/`, Node's built-in runner).
