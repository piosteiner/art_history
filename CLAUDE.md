# Art History — working notes for Claude

Backend + server documentation for https://arthistory.piogino.ch. This checkout (`/var/www/arthistory`) is the
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
  `admin.arthistory.piogino.ch` (panel at the root; old `/admin/…` URLs redirect). Brief/plan: see `backend/README.md`, data model: `backend/docs/data-model.md`.
- `server-docs/` — server inventory, changelog, config copies.
- `frontend/` — public site (Vite + TypeScript + MapLibre), built and published to GitHub Pages by
  `.github/workflows/pages.yml` (runs `npm test` = Playwright smoke tests first); `fetch` only in `frontend/src/api.ts`. Not deployed by `backend/deploy.sh`; see `frontend/README.md`.
- `health.html` — frontend CORS round-trip test page (now also in `frontend/public/`, served from there once Pages builds via Actions).

## Workflow
- Dev: `cd backend && npm run dev` (port 3005, DB `arthistory_dev`). Never test against the live process.
- Content: the **database is the source of truth** (admin panel, audit_log history). `npm run export` → `content/` YAML
  snapshot to commit; `npm run import` only for bulk loads (export first — import overwrites). Deploys don't import.
- Admin panel: `backend/src/admin/`; forms come from `src/content.js` (shared with import/export). Dev login:
  `npm run admin:user:dev -- <name>`, then http://admin.localhost:3005/ (host-based routing). Markdown editor:
  `src/admin/editor/` (CodeMirror 6; map picker = Leaflet + Geoman) → `npm run build:admin` → `static/editor.js`,
  `map.js`, `map.css` (git-ignored; `deploy.sh` builds them). `npm run dev` builds into `static-dev/` instead — this checkout
  is also production, so never run `npm run build:admin` by hand without deploying right after.
- Schema: new `backend/db/migrations/NNN_*.sql` (never edit applied ones) → `npm run migrate:dev` → smoke test
  `psql -h localhost -U arthistory_admin -d arthistory_dev -f db/tests/schema_smoke.sql` → commit → `backend/deploy.sh`.
- Tests: `npm test` (unit) + `npm run test:e2e` (Playwright, own DB `arthistory_test`, server :3006; `test/e2e/README.md`).
  Add an e2e test for every admin feature. Deploy: `backend/deploy.sh` (pull, npm ci, **tests**, build, migrate, pm2 reload,
  health probe; `--skip-tests` only in emergencies).

## Status (2026-10-05)
- ✅ Phase 0 housekeeping, ufw (22/80/443 only) · ✅ Phase 1 health check, nginx, TLS, pm2
- ✅ Phase 2 PostgreSQL 18 + PostGIS 3.6, roles (owner/admin/api), migrations 001–003 (+ 005 `located_in`, 2026-09-28)
- ✅ Phase 3: read API (entities, search, `/v1/map/…` GeoJSON, `/v1/graph/…`; `backend/docs/api.md`), migration 004,
  git-tracked YAML `content/` (format: `content/README.md`) + idempotent `npm run import` (run by deploy.sh), `npm test`
- ✅ Phase 4 backups: nightly `scripts/backup.sh` (systemd timer) — dump, restore-verify, gpg-encrypted push to private repo
  `art_history-backups` when data changed (server-docs/README.md → Backups). Round trip from GitHub tested 2026-09-28.
- ✅ Phase 5 admin panel (2026-09-28): migration 006 (admin_users, admin_sessions, audit_log trigger), scrypt + Postgres
  sessions (single login; fail2ban jail `arthistory-admin` since 2026-09-29), CRUD + relationships + history pages, `npm run export`. Live collaboration built 2026-09-30:
  presence + drafts (010), shared Yjs working copies per entry with Publish (011) — `src/admin/collab.js`, `editor/collab.js`.
  Wikidata comparison with review (012, `src/admin/wikidata.js`) built 2026-09-30. Data-quality page (013, view `quality_issues`) built 2026-09-30.
  Several images per artwork/artist/institution (017, table `images`, exclusive arc; `src/admin/images.js`) built 2026-10-02.
  Polities + derived countries (018/019: `polities`, `nationality`, `entity_country()`; API `country`/`polities`/`birth_place`) built 2026-10-03.
  Auto-created creators/institutions (021 `auto_created`, `src/admin/autocreate.js`), century dates, height-only dimensions (020) built 2026-10-04.
  Names in several languages (022: `<name>_lang`, `<name>_ruby` furigana `{漢字|かんじ}`, `names jsonb` with roles; `src/names.js`) built 2026-10-05.
  People instead of patrons (024: enum value renamed, `people`, roles from relationships, `depicts_person`) built 2026-10-05.
  Glossary (026/027: `glossary`, `[[slug]]` links in Markdown, view `glossary_links`, `/v1/glossary`) built 2026-10-05.
  Several creators (028: relationship `co_creator`, `artwork_creators()`, API `creators`) built 2026-10-06; frontend shows them since 2026-10-06.
  Main creator in the graph (029: derived vocabulary type `creator`, view `graph_edges`) built 2026-10-06.
  [[type/slug]] links to any entry with `[[` completion, backlinks (030: view `content_links`, check `broken_link`) built 2026-10-06.
  Provenance (031: table `provenance`, view `provenance_periods` with implied ends, view `edges` = stored + derived edges; `owned_by` derived) built 2026-10-06; frontend shows it (Provenance section, implied ends, dashed graph edges) since 2026-10-06.
  Place geometry from Natural Earth (032/033: `boundaries`, `place_geo`, `npm run boundaries`, place finder) built 2026-10-06.
  Sites (034: institution/artwork `location`, `site_geo`, presence at institutions, `houses`, `/v1/map/sites`) built 2026-10-06; frontend uses it since 2026-10-06 (venues on the map, "could have met there", museums layer).
  Bibliography (035/036: `bibliography`, `[[source/slug|S.]]` footnotes after the KHIST UZH guide, `src/bibliography.js`) built 2026-10-06; frontend shows it since 2026-10-06 (/bibliography, footnote and source popovers).
  Series (037: `artworks.parent_id` + `part_number`/`parts_count`, `no_parent_cycle()`, `published`) built 2026-10-06; frontend shows it since 2026-10-06 ("No. 21 of 36 in …", previous/next, parts grid, ?part_of=).
  Artwork web page (038: `artworks.web_url`, Wikidata P973; 039: `web_url_accessed` set by trigger) built 2026-10-07; frontend links it since 2026-10-07 ("View at … ↗" + accessed date, panel without image).
  City of an exact location found/created on save (institutions, immovable artworks; `placefinder.cityAt`, Nominatim reverse) built 2026-10-07.
  Ideas later: impressions vs. design for prints; nightly auto-export commit; ISBN/DOI lookup for sources. Revert/restore from history (009) with word diffs + three-way text merge built 2026-09-30. Map picker for places built 2026-09-29.
- Decided (2026-09-28): year-only dates = the whole year (as implemented); `visited` is the travel type (as implemented).
- 📌 Open: after the owner fixes The Great Wave's inventory number (no institution), add a migration
  `ALTER TABLE artworks VALIDATE CONSTRAINT artworks_inventory_needs_institution` (016 added it NOT VALID).
- Decided + built (2026-10-05): "c. YYYY" / "ca." / "circa" = ±5 years (`CIRCA_YEARS` in `src/fuzzy-date.js`), label as written; Wikidata circa on a year the same.
- Decided + built (migration 005): moved institutions — `institutions.place_id` = current location, dated `located_in`
  relationships = earlier locations (mirrors `current_institution_id` + `housed_at`).
