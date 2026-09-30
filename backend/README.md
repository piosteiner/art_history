# Backend — arthistory-api

Node/Express API (`/v1/...`) and server-rendered admin panel (root of the admin host) in one pm2 process,
backed by PostgreSQL + PostGIS. Listens on `127.0.0.1:3004` behind nginx.

Status: Phase 5 — admin panel at https://admin.arthistory.piogino.ch/ (the database is the source of truth);
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
  `SameSite=Strict`, `Secure`; non-GET requests must carry the admin site's `Origin` (or, if the browser sends none,
  `Sec-Fetch-Site: same-origin`); `Referrer-Policy: same-origin` so browsers do send it. Old `/admin/…` URLs 301 to `/…`.
  Dev: http://admin.localhost:3005/ (routing is by hostname; browsers resolve `*.localhost` to 127.0.0.1). 10 failed logins / 15 min per IP.
  Every failed login is a 401 on `POST /login`; fail2ban (jail `arthistory-admin`) bans the IP for 1 h after 5 in 10 min.
- Markdown fields: CodeMirror 6 editor with live styling (`src/admin/editor/`, bundled by `npm run build:admin` into
  `static/editor.js`, git-ignored; `npm run dev` and `deploy.sh` build it). Preview = `POST /preview`, rendered by the
  same `renderMarkdown()` as the API. The hidden textarea stays in the form, so saving works without JS too.
- Place forms: map picker (`src/admin/editor/map.js`, Leaflet + Geoman + OSM tiles, bundled to `static/map.js`/`map.css`):
  click/drag the pin, draw/edit area polygons, search via `GET /geocode` (server-side proxy to OSM Nominatim, 1 req/s).
- Search: every box is typo-tolerant — one scoring rule in `src/admin/match.js` (pg_trgm). Pickers for references use
  `GET /lookup` (`src/admin/editor/autocomplete.js`). `/search` (top bar) finds entities by name, other names/identifiers and full text
  (Postgres FTS, English stemming, `"phrase"`/`-exclude`/`or`), and relationships by label/notes/sources.
- History: "revert…" undoes one save (preview with field-level conflict choices, dry run, then apply), "restore this
  version…" resets an entity to a past state (`src/admin/revert.js`, `revert-ui.js`, migration 009). Reverts are
  changes too (audit_log.reverts / restores) and can be reverted.
- Live connection (`src/admin/live.js` + `editor/live.js`, WebSocket `/live`): presence of other users per entry and
  field. Existing entries: one shared working copy per entry (`collab.js` + `editor/collab.js`, Yjs, table `live_docs`),
  co-edited live with cursors, Publish writes it into the real table. New entries: per-user drafts (`admin_drafts`).
- Users: `npm run admin:user -- <name>` (asks for the password; also resets it and logs out that user's sessions).
- Every write runs in a transaction tagged with the user → the `audit_log` trigger records who changed what
  (History pages). Edits use optimistic locking (the form carries `updated_at`; a concurrent save is refused).

## Content
- The database is the source of truth. `npm run export` (or `export:dev`) writes it to `../content/` as YAML for a
  readable snapshot in git; `npm run import` still bulk-loads YAML (see `../content/README.md`). Deploys don't import.
- `npm test` — unit tests (`test/*.test.js`, Node's built-in runner).
- `npm run test:e2e` — the admin panel in a headless browser against `arthistory_test` (see `test/e2e/README.md`);
  `deploy.sh` runs both before touching production.
