# Art History — working notes for Claude

Backend + server documentation for https://arthistory.piogino.ch. This checkout (`/var/www/arthistory-api`) is the
public GitHub repo `piosteiner/art_history`, running on the production VPS (Infomaniak, Ubuntu 22.04, 2 vCPU / 4 GB / 60 GB).

## Rules (from the owner — always follow)
1. **Secrets never enter this repo** — it is public. Credentials live only in `~/.config/arthistory/*.env` (700/600) and `~/.pgpass`.
   Use placeholders in `backend/.env.example`. Never bypass `scripts/githooks/` (pre-commit + pre-push secret scan).
   A leaked secret must be rotated, not just deleted.
2. **Document every server change** in `server-docs/CHANGELOG.md` (newest first: what / why / how to revert) and keep
   `server-docs/README.md` (inventory) current — then `scripts/save.sh "message"` (commit + pull --rebase + push).
3. Other projects on this server (MySQL/calorie-tracker, adenai-admin, quiz-platform, obs-remote, gif-converter) — don't touch
   unless asked; ports 3000–3003 and 5000 are taken.
4. Owner wants to learn PostgreSQL: prefer idiomatic Postgres/PostGIS (ranges, recursive CTEs, JSONB, GiST) and explain choices.

## Layout
- `backend/` — Express 5 app, pm2 `arthistory-api`, `127.0.0.1:3004`; nginx → `api.arthistory.piogino.ch` (`/v1/…`) and
  `admin.arthistory.piogino.ch` (`/admin/…`). Brief/plan: see `backend/README.md`, data model: `backend/docs/data-model.md`.
- `server-docs/` — server inventory, changelog, config copies.
- `health.html` — frontend CORS round-trip test page (served by GitHub Pages).

## Workflow
- Dev: `cd backend && npm run dev` (port 3005, DB `arthistory_dev`). Never test against the live process.
- Content: edit `content/**/*.yaml` → `npm run import:dev` → check on :3005 → commit → deploy.
- Schema: new `backend/db/migrations/NNN_*.sql` (never edit applied ones) → `npm run migrate:dev` → smoke test
  `psql -h localhost -U arthistory_admin -d arthistory_dev -f db/tests/schema_smoke.sql` → commit → `backend/deploy.sh`.
- Deploy: `backend/deploy.sh` (pull, npm ci, migrate, pm2 reload, health probe).

## Status (2026-09-24)
- ✅ Phase 0 housekeeping, ufw (22/80/443 only) · ✅ Phase 1 health check, nginx, TLS, pm2
- ✅ Phase 2 PostgreSQL 18 + PostGIS 3.6, roles (owner/admin/api), migrations 001–003
- ✅ Phase 3: read API (entities, search, `/v1/map/…` GeoJSON, `/v1/graph/…`; `backend/docs/api.md`), migration 004,
  git-tracked YAML `content/` (format: `content/README.md`) + idempotent `npm run import` (run by deploy.sh), `npm test`
- ⏭ Phase 4 backups (nightly pg_dump + off-server copy), Phase 5 schema-driven admin panel (session auth + nginx basic auth,
  markdown-it + sanitize-html)
- Open decisions awaiting owner feedback: daterange+label for fuzzy dates; `institutions.place_id` FK; `visited` instead of
  `traveled_to`; year-precision semantics.
