# Backend — arthistory-api

Node/Express API (`/v1/...`) and server-rendered admin panel (`/admin/...`) in one pm2 process,
backed by PostgreSQL + PostGIS. Listens on `127.0.0.1:3004` behind nginx.

Status: Phase 2 done — PostgreSQL schema live; `GET https://api.arthistory.piogino.ch/v1/health` checks the DB.

Data model & roles: [docs/data-model.md](docs/data-model.md)

## Run
- Production: pm2 process `arthistory-api` (`ecosystem.config.js`). Deploy: `./deploy.sh`.
- Development: `npm run dev` (port 3005, auto-reload). Never edit and test against the live process.
- Config: secrets in `~/.config/arthistory/backend.env` (outside the repo) — see `.env.example` for the names.

## Database
- Schema changes: add `db/migrations/NNN_name.sql`, run `npm run migrate:dev`, test, commit, then `./deploy.sh` (runs `npm run migrate`).
- `npm run migrate -- --status` lists applied/pending migrations.
- psql: `psql -h localhost -U arthistory_owner arthistory` (passwords come from `~/.pgpass`).
- First-time setup of a database: `db/setup.sh <dbname>`.
