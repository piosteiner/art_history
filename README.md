# Art History

A research database and website on art history: artworks, artists and the people around them, institutions,
places, periods, events and their connections — on a map, on timelines and as a network. Every statement can carry
its sources; provenance is recorded step by step, with gaps and the years 1933–1945 marked.

- **Site:** https://arthistory.piogino.ch
- **Project documentation** (German): https://arthistory.piogino.ch/dokumentation — how and why it was built
- **Changelog, roadmap, statistics:** [/changelog](https://arthistory.piogino.ch/changelog) ·
  [/roadmap](https://arthistory.piogino.ch/roadmap) · [/statistik](https://arthistory.piogino.ch/statistik)

| Part | Where | Runs on |
|---|---|---|
| Website | [`frontend/`](frontend/) — Vite, TypeScript, MapLibre | GitHub Pages (built and tested by [`.github/workflows/pages.yml`](.github/workflows/pages.yml)) → https://arthistory.piogino.ch |
| API + editing panel (CMS) | [`backend/`](backend/) — Node.js, Express 5, PostgreSQL 18 + PostGIS | VPS → https://api.arthistory.piogino.ch, https://admin.arthistory.piogino.ch |
| Content snapshot | [`content/`](content/) — every entry as YAML, exported from the database | this repository |
| Server documentation | [`server-docs/`](server-docs/) — inventory and a changelog of every server change | this repository |

## How it works
The **database is the source of truth**: entries are edited in the CMS, every change is kept in an audit log, and
`content/` is a snapshot exported from it (`npm run export`). PostgreSQL does much of the work itself — uncertain
dates as date ranges ("c. 1480", "13th century"), recursive queries for place hierarchies and networks, PostGIS for
places and routes, full-text search in several languages, and data-quality checks as views.

Further reading:
- [`backend/README.md`](backend/README.md) — the backend and the editing panel
- [`backend/docs/data-model.md`](backend/docs/data-model.md) — the data model, table by table
- [`backend/docs/api.md`](backend/docs/api.md) — the public read API (`/v1/…`)
- [`frontend/README.md`](frontend/README.md) — the website
- [`content/README.md`](content/README.md) — the YAML format of the content snapshot

Images come from Wikimedia Commons and museums' open-access collections, each with its licence and credit.

## Working on it (on the server)
The checkout at `/var/www/arthistory` **is** this repository and also production.

- `scripts/save.sh "message"` — commit, rebase on GitHub, push.
- `backend/deploy.sh` — pull, install, run the tests (unit + end-to-end), build, migrate, reload, health check. Schema
  changes are new files in `backend/db/migrations/`; applied ones are never edited.
- `server-docs/CHANGELOG.md` records every server change: what, why, how to revert.
- **Secrets never go in this repository** (it is public). On the server they live in `~/.config/arthistory/*.env`,
  outside the checkout. Pre-commit and pre-push hooks block secret files, credential-looking lines and any real value
  from those files; after cloning elsewhere, enable them with `git config core.hooksPath scripts/githooks`.
