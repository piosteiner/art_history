# Backend — arthistory-api

Node/Express API (`/v1/...`) and server-rendered admin panel (`/admin/...`) in one pm2 process,
backed by PostgreSQL + PostGIS. Listens on `127.0.0.1:3004` behind nginx.

Status: Phase 1 done — `GET https://api.arthistory.piogino.ch/v1/health`.

## Run
- Production: pm2 process `arthistory-api` (`ecosystem.config.js`). Deploy: `./deploy.sh`.
- Development: `npm run dev` (port 3005, auto-reload). Never edit and test against the live process.
- Config: secrets in `~/.config/arthistory/backend.env` (outside the repo) — see `.env.example` for the names.
