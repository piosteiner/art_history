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
- Admin panel: `backend/src/admin/` — pages in `routes/*.js` (mounted in order by `index.js`), shared helpers in `core.js`; forms come from `src/content.js` (shared with import/export). Dev login:
  `npm run admin:user:dev -- <name>`, then http://admin.localhost:3005/ (host-based routing). Markdown editor:
  `src/admin/editor/` (CodeMirror 6; map picker = Leaflet + Geoman) → `npm run build:admin` → `static/editor.js`,
  `map.js`, `map.css` (git-ignored; `deploy.sh` builds them). `npm run dev` builds into `static-dev/` instead — this checkout
  is also production, so never run `npm run build:admin` by hand without deploying right after.
- Schema: new `backend/db/migrations/NNN_*.sql` (never edit applied ones) → `npm run migrate:dev` → smoke test
  `psql -h localhost -U arthistory_admin -d arthistory_dev -f db/tests/schema_smoke.sql` → commit → `backend/deploy.sh`.
- Tests: `npm test` (unit) + `npm run test:e2e` (Playwright, own DB `arthistory_test`, server :3006; `test/e2e/README.md`).
  Add an e2e test for every admin feature. Changes to queries, views or the derived-data worker: `npm run perf` (budgets on 10× data, server-docs/README.md) before deploying. Deploy: `backend/deploy.sh` (pull, npm ci, **tests**, build, migrate, pm2 reload,
  health probe; `--skip-tests` only in emergencies).

## Status (2026-10-14)
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
  Hover previews of [[type/slug]] links like Wikipedia's (040: view `entry_previews`, API `entries`, `markdown.previewText`) built 2026-10-07;
  on every internal link since 2026-10-07 (`/v1/previews`, frontend `src/previews.ts`).
  Old slugs redirect (041) and [[links]] follow slug changes (042: `current_links()`, rewritten on rename and on save) built 2026-10-07/08.
  Images for people (043: `images.person_id`; generated `images.entity_type`/`entity_id`) built 2026-10-08.
  Duplicates (044: unique inventory/boundary, `dup_score()` evidence weighing, check on Create + live box, "not the same" in quality_acks, `merge_entries()` + merge page) built 2026-10-08.
  Events (046/047: `events`, `participated_in` with role, `concerns`, `depicts` → event, `/v1/events`, `/v1/map/events`) built 2026-10-08; frontend shows them since 2026-10-08 (list, page, map layer, timeline, graph).
  Further numbers + loans (048: `artwork_numbers`, `institution_number_free()` trigger across both tables, `on_loan`) built 2026-10-08.
  Sources for facts (049: `citations`, `citable_fields`, `citation_status`, Wikidata cites itself, markers on entry pages) built 2026-10-08; step 2 (050: free text as citations, `sources` in API and YAML) built 2026-10-08.
  Translation status (052: names[].status official/common/own, `artworks.title_status`) built 2026-10-08.
  Authority files (053: `authorities`, `entry_identifiers` unique per number, GND comparison via lobid.org `src/admin/gnd.js`) built 2026-10-09; ULAN links only (Getty API 403).
  Enrich page (Wikidata + GND + SIKART in one review, `src/admin/enrich.js`, `authority.js`) and Quality queue (next issue, batch Wikidata / GND citing, `routes/queue.js`) built 2026-10-12.
  More sources (059: Metagrid numbers by name; LC, BnF, RKD compared like the GND — `records.js`, `lc.js`, `bnf.js`, `rkd.js`, `metagrid.js`) built 2026-10-12.
  Image search also in Rijksmuseum, Europeana, Smithsonian, Japan Search (Europeana/Smithsonian only with own keys `EUROPEANA_KEY` — a Europeana *Project* key —, `SMITHSONIAN_KEY` in backend.env); Japan Search readings on Enrich (`japansearch.js`) built 2026-10-12.
  KulturNav, NLK (names offered), ArCo (works in Italy) on Enrich; SMK, DigitaltMuseum image search (060) built 2026-10-12 — DigitaltMuseum only with own `DIMU_KEY` (keys for museums only; "demo" is for testing).
  Sorting (061: `entry_sort_key()` drops leading articles of titles by language; ICU collation `sort_natural` — order with `COLLATE sort_natural`, helpers in `src/sortkey.js`) built 2026-10-13.
  Provenance roles (063: `holder_role`, `provenance_co_owners`, price, `held_by`, `commissioned` derived, view `provenance_chain` with implied artist/loan lines; one-sided fuzzy dates) built 2026-10-13.
  Quality findings stored (058: table `quality_issues` refreshed after commits via LISTEN/NOTIFY; **checks live in the view `quality_issues_live` — change that one**) built 2026-10-12.
  SIKART (057: portal links, "Find in SIKART…" by name, compare like the GND — `src/admin/sikart.js`, source `sikart`) built 2026-10-09.
  Wrong type: `type_doubt()`, Wikidata class check, `convert_entry()` + `entry_moves` redirects (055) built 2026-10-09.
  Given/family names (066: `split_person_name()` + trigger, `person_sort_key()`; people and artists sorted by family name, "Filed as" override) built 2026-10-14; frontend sorts by `sort_key` for every type since 2026-10-14.
  Provenance on artwork maps (API `provenance` beside `features`: stops in chain order with `place_basis` — creation at the artist's residence, else their one undated workplace (`artist_workplace`, 2026-10-14; frontend: hollow, "probably"), segments direct/implied with `between`, `unplaced`) built 2026-10-14;
  frontend draws it instead of the route on artwork pages and on the start map (chosen artworks in their colour; the overview's routes follow the provenance too; in a time window its steps dated in the window, `provenanceInWindow`) since 2026-10-14 (`drawProvenance` in `map-provenance.ts`: numbered HTML markers, unplaced steps under the map).
  Provenance flags on holders + "Research 1933–1945" links (068: `provenance_flag`, `holder_flag()`, check `flagged_holder`) built 2026-10-14.
  Batch pages: Wikidata items with dates / `?only=auto`, images for artworks without one (`/quality/batch/images`, `routes/queue.js`) built 2026-10-14.
  Curated home page (frontend 2026-10-14: `/` = first featured view + switcher, `/?featured=<slug>`, `/?all` = everything, last own view offered as "Continue") — uses the backend below; no views published yet, so `/` shows everything until the owner publishes one.
  Curated start views (069: `featured_views`, `current_featured_query()`, `featured_view_problems`; `/v1/featured`; admin `/featured`) built 2026-10-14.
  Short addresses for long start-map views (072: `shared_views`, code = SHA-256 prefix; `POST/GET /v1/views`; site shows `/?v=<code>` above 300 characters) built 2026-10-15.
  Type and materials as glossary terms with translations (070/071: `kind_term_id`, `artwork_materials`, `term_by_name()`, names stay the interface; `/quality/batch/terms`) built 2026-10-15.
  Provenance custody (073/074: chain = owner/dealer/estate, custodians/agents beside it, `not_sold`, `via`, view `provenance_gaps` for the 1933–45 check, `settlement`, `provenance_status` A–D, `conceived`, `copy_after`) built 2026-10-15; frontend shows it since 2026-10-15 (custody indented "held by …", "not sold", "via …", status badge A–D under Provenance, "designed …, printed …", list filter `?provenance=`).
  Provenance cases (076/077: role `event`, `theft`/`transfer`/`claim`/`dissolution`, `provenance_places`, `provenance_numbers` + `/provenance/numbers`, `event_id`, roles publisher/foundry/trustee, RM, Lugt, German/Roman dates) built 2026-10-15; frontend shows them since 2026-10-15 (events as • notes, "taken by … stolen — recovered", "in Köln → Berlin", numbers linked to `/provenance-numbers`, solid `move` segments on the map).
  Provenance coverage (078: `provenance_spans`, `provenance_coverage()` with multiranges, `provenance_completeness`; API coverage + `?provenance_gap=`, map gaps; admin bar, gap lines, `/quality/provenance-gaps`) built 2026-10-15; frontend shows it since 2026-10-15 (bar above the provenance, gap lines after their step, "?" markers mid-segment + gap list under the map, list toggle `?provenance_gap=1933-1945`; `src/coverage.ts`).
  Full-text search (087: `search_en/de/fr/simple` configurations, GIN expression indexes, view `search_documents`, `/v1/search/text` with `<mark>` passages), network questions (088: table `graph_links` rewritten by `refresh_quality()`, `entry_path()` BFS, `hands_network()`, `shared_hands()` recursive CTE; `/v1/network/…`) and citable versions (089: `rows_as_of()` from `audit_log`, `?as_of=` on every detail, `/v1/history/…`) built 2026-10-16; frontend since 2026-10-17 (/search = full-text with matched_in badges, passages, type chips, pages; on entry pages "How are they connected?", "Through the same hands" (artworks), "Cite this version"; ?as_of= opens a version with a banner; /provenance/1933-1945 any window; frontend/README.md → Network questions and versions).
  pg_stat_statements (server, 2026-10-17); prices baseline (090: `currencies`, `exchange_rates`/`price_indices` with exclusion constraints, `price_value()`, API `price.chf_today` — 📌 no rates/indices loaded), spatial history (091: `provenance_stops()` shared with the map, `artwork_travel()`, `encounters()`, `place_clusters()`; API `travel`, `/v1/map/encounters`, `/v1/map/clusters`), names that sound alike (092: fuzzystrmatch in the duplicate check), duplicate candidates (093: materialized `dup_name_keys`, check 3.8 s → 0.5 s), row-level security (094: `editor_scopes`, `npm run admin:scope`; no account scoped yet) built 2026-10-17; frontend since 2026-10-17 ("Travelled ≈ … km over … of … steps" under artwork maps, crossed paths from `/v1/map/encounters` on entry pages with "nearby too (≤ 50 km)" — places and the start map still use `src/encounters.ts`, numbered cluster bubbles on the start map below zoom 6 without single picks, AFRF named; `chf_today` not shown).
  Periods with artists (112: view `movement_artists` — direct links with their dates or through works, phases rolled up; `/v1/periods` `artists`, works' `creator_slug`; site /periods Works | Artists switch `?show=artists`, lifespan rows under each period with their works as dots, lives outside the span outlined red) built 2026-10-20.
  Search corrections and reach (113: `search_words` + `search_suggest()` → `/v1/search/suggest`, `/v1/search/text` `in`/`not_in`, number `scope` + `shared`, `?of=`) built 2026-10-20; site: `src/query.ts` (exclusions, phrases, "but not in …" = current collection) in every list search and /search, typo correction (auto when nothing found, "did you mean" when few), /search scrolls instead of pages, provenance numbers linked only when shared.
  Pages (114: `pages` + `page_images` bytea, `src/pages.js` Obsidian Markdown, `/v1/pages/<slug>`; CMS `/pages` with image upload/drop/paste `editor/uploads.js`; site `/dokumentation` + footer link) built 2026-10-20 — the project documentation is pasted and its images uploaded by the owner. Uploads converted to WebP (115: sharp, q82, ≤ 1600 px). Chapters (116: top-level headings; CMS outline + one chapter at a time with stale-save check, .md download/upload with `page_downloads` warning; site `/dokumentation/<chapter>` with contents and previous/next). Editor tools as in the adenai CMS (2026-10-20: [[ ]], web link, heading cycle, numbered list, task, highlight, spoiler, callout boxes, table, divider, find/replace) with `src/md-extras.js` rendering them in every text; pages autosave as drafts (117 `page_drafts`).
  Provenance events are moments (082: `end_basis = 'point'`, no implied end) built 2026-10-16.
  Relationship picker merges same-label types (depicts, created in, located in — target picks the type), A–Z, `housed_at` hidden; `depicts` → artwork/event = category depiction in entries and graph (`edgeCategory()`) built 2026-10-16.
  Admin artwork lists also match creators (title matches first, then "Works by a matching artist"); site search page `/search` (Enter in the header search, `findAll()` shared, `src/views/search.ts`) built 2026-10-16.
  Search hits open at the match (2026-10-19): provenance steps carry `id` in the detail; hits link `?hl=<marked words>` (+ `#provenance-<id>`), the entry page outlines the step and marks the words (`frontend/src/highlight.ts`).
  Search across languages (102: `search_synonyms` word groups DE/EN/FR → `search_synonym_rules` via trigger, two-step `ts_rewrite` in `search_query()`/`search_headline()`; 20 provenance groups to start; admin page `/search-words` with "Try a word" and shared-word warnings, `routes/search-words.js`) built 2026-10-19.
  Start map layers with pickers (106: `institutions.dissolved`; API artwork `holders` now/before, sites `from_year`/`to_year`; site: Museums and Events pickers with "auto" — linked museums / events in the window or the chosen entries' span —, artworks on the timeline until today, provenance ends marked on the start map, start-view intro previews, museum search in artwork lists now → before) built 2026-10-19.
  Artwork fate (103: `fate` destroyed / partly_destroyed / lost + `fate_date`, `fate_note`, citable; API `fate`) and a source on the new-entry form (section "Source" → `citations.citeNew()`: one source for every field filled in) built 2026-10-19.
  Sources for further numbers (081: `citations.number_id`, `numbers[].sources` in API/YAML; edit page: `citations.trigger()` button, dialog after the form); markers show unpublished sources by kind (dotted) built 2026-10-16.
  Searches fold accents, special letters (æ ø ß ł), ligatures, ’ and dashes alike in DB (080 `f_unaccent`), admin and site (`backend/src/fold.js` = `frontend/src/fold.ts` — keep them equal) built 2026-10-16.
  Provenance as it happened (083/084: role `possessor` = held without title, beside the chain; `alternative_to` = another source's reading, left out of all computations; `exchanged_for`; check `provenance_seizure_as_owner`) built 2026-10-16; frontend shows it since 2026-10-16 (possessors indented in red, "taken by …" + "without title" tag, also on holders' pages; "Another reading (sources disagree)" boxes under their step; "exchanged for …").
  Public numbers (085: `public_id` across all types from 100001, `entry_by_public_id()`, `public_id_history`; API `/<plural>/<number>[/<name>]`, `/v1/entries/:number`, `path`; admin shows the number) built 2026-10-16; frontend uses it since 2026-10-16 (pages at `/<plural>/<number>/<slug>`, old slug addresses and renamed slugs move to `path`, links numbered where `api.ts` has seen the number, static pages + sitemap at the new addresses with forwarding pages at the old ones; frontend/README.md → Public numbers).
  Biography × provenance (086: view `provenance_inferences` narrowed/from_estate/travelled, `presence_core()`, checks for contradictions; API `inferences` per step) built 2026-10-16; frontend shows it since 2026-10-16 ("derived" lines in italics under their step, "≈ 14,393 km" on the segment into the step and in the stop's popup).
  Provenance records (104: `provenance_records` — inventory entries, catalogues, exhibitions, sightings with date, place, room, number and the source's doubts; `provenance_numbers_all`, map stops, search, check `provenance_record_outside`; admin `src/admin/provenance-records.js` on the step's edit page — NB `src/admin/records.js` is the authority-file records, unrelated) built 2026-10-19; frontend shows them since 2026-10-19.
  New entries from Wikidata by script (`backend/scripts/from-wikidata.js`: as "+ from Wikidata…" + Create, `--links`, similar names never taken) built 2026-10-19; 20 Prado masterpieces with the Prado's provenance entered with it.
  One search definition (110: view `entry_search_fields` — label/text/match/tier/shown per entry; admin lists via `fieldSearchSql()` in `src/admin/match.js`, API lists send `search_fields`, the site's `catalog.ts` matches them — change search fields in the view only) built 2026-10-20.
  Changelog + roadmap (118: `changelog_entries`/`changelog_items` with kinds, `roadmap_items` with status columns; CMS `/changelog` "Kind: text" lines, `/roadmap` — done → today's entry; API `/v1/changelog`, RSS, `/v1/roadmap`; site `/changelog`, `/roadmap`, German) built 2026-10-20; history 23.9.–20.10. and 14 roadmap items seeded as unpublished drafts. Autosave drafts (119 `form_drafts`, `editor/formdrafts.js`), history + restore (`/changelog/restore/<audit id>`, `/roadmap/restore/…`, "Recently deleted") built 2026-10-20.
  Acquisition methods find / partage / spoils_of_war / in_lieu (120) and forced_gift (121), historical currencies LIV, SCU, DUC, FIOR, PIA (120) built 2026-10-20 — for 120 works of the Louvre, Orsay, Uffizi, Borghese, Brera and 20 works in place in France/Italy, imported with 559 cited steps the same day (server-docs/CHANGELOG.md). Open: dates before 4713 BCE (Lascaux) don't fit Postgres dates.
  Check artwork_without_web_page (124: every artwork should have its museum page, `web_url`) built 2026-10-21.
  Incremental derived data (125, step 1 of the scaling plan): triggers `derived_touch()` → `derived_queue`, worker `process_derived()` per batch (search fields, findings, duplicates by fingerprint `dup_entries`/`dup_keys`/`dup_pairs`), global part `refresh_quality_global()` ≤ every 30 s, nightly `refresh_quality_full()` → `derived_drift`; pages never compute checks live — built 2026-10-21 (backend/docs/data-model.md → Data quality). Step 2 (126, 2026-10-21): `graph_links` per change (owner = relationship ends / the work `artwork_id`), API reads it (relationships, graph, presence, encounters, inferences — a moment behind; e2e `settled()`), `provenance_inferences` filterable by work. Step 3 (127, 2026-10-21): list rows stored (`entry_list_rows`, worker `refreshLists()` with `listRows()` from `src/routes/entities.js`) — the site keeps loading whole lists (fast now; server-side paging only beyond tens of thousands). Step 4 (2026-10-21): presence answers cached per data version (+ warmed), `backend/perf/` budgets (`npm run perf:data`, `npm run perf` — 22 budgets on 10× data), `scripts/slow-queries.sh`. Step 5 (128, 2026-10-21): a failing entry is set aside (`derived_failures`, dashboard/Quality notice), the worker retries every minute; `src/cache.js` = whole answers cached per data version (presence, `/v1/periods`). Step 6 (129, 2026-10-21): admin at 10× — list search one pass (`fieldSearchSql`), `provenance_completeness_stored`, Quality page ≤ 100 per check, entry pages from `graph_links`; `npm run perf` = 35 budgets incl. 13 admin pages.
  Groups of works (131/132, 2026-10-22): a whole's kind in the glossary category `group of works` (series, versions, cycle, pair) — `artwork_is_group()`, slim admin form (`editor/artworkform.js`), checks `group_parts_missing`, no web page asked; site "Version 2 of 3", lists "Versions · 3 parts". Bedroom in Arles = series of three versions (2026-10-22).
  Thumbnails of museum-hosted images via `/v1/thumb` (sharp → WebP, cached in `backend/var/thumbs`, only URLs of `images`; site `thumb()` in `html.ts`) and further measurements as glossary terms (133/134: category `mounting` — frame, mount …; article "frame") built 2026-10-22. Series: 36 Views of Mount Fuji, Sunflowers (Arles) 2026-10-22.
  Spell check language of Markdown texts recognised as you type (EN/DE, `src/textlang.js`, toolbar switch) built 2026-10-14.
  City of an exact location found/created on save (institutions, immovable artworks; `placefinder.cityAt`, Nominatim reverse) built 2026-10-07.
  Ideas later: impressions vs. design for prints. Nightly export commit prepared 2026-10-14, not installed (`scripts/export-commit.sh`, server-docs/README.md → Content snapshots). ISBN/DOI lookup for sources built 2026-10-12 (`booklookup.js`: Open Library, Crossref). Revert/restore from history (009) with word diffs + three-way text merge built 2026-09-30. Map picker for places built 2026-09-29.
- Decided (2026-09-28): year-only dates = the whole year (as implemented); `visited` is the travel type (as implemented).
- 📌 Pinned (owner, 2026-10-17): historical exchange rates and price indices for `price_value()` (090) — needs a reliable,
  citable source per currency/country (e.g. Swiss Federal Statistical Office CPI, national banks); tables and API are ready.
- 📌 Open (raise this whenever we review improvements): API keys the owner hasn't applied for yet — Europeana (*Project*
  key), Smithsonian, DigitaltMuseum (museums only — ask), Paris Musées and Korea's e-museum (not built until keys exist).
  Where to apply and what each adds: `server-docs/README.md` → "API keys for outside data". Without keys the image search
  skips those sources.
- Decided + built (2026-10-05): "c. YYYY" / "ca." / "circa" = ±5 years (`CIRCA_YEARS` in `src/fuzzy-date.js`), label as written; Wikidata circa on a year the same.
- Decided + built (migration 005): moved institutions — `institutions.place_id` = current location, dated `located_in`
  relationships = earlier locations (mirrors `current_institution_id` + `housed_at`).
