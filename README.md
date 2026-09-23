# Art History

Interactive art history website: map, timelines and influence graph over a curated dataset.

| Part | Where | Hosting |
|---|---|---|
| Frontend | *(to come)* | GitHub Pages → https://arthistory.piogino.ch |
| Backend API + admin | [`backend/`](backend/) | VPS, `/var/www/arthistory-api/backend` → https://api.arthistory.piogino.ch, https://admin.arthistory.piogino.ch |
| Server documentation | [`server-docs/`](server-docs/) | inventory + changelog of every server change |

## Working on the backend (on the VPS)
The server checkout at `/var/www/arthistory-api` **is** this repository.

- `scripts/save.sh "message"` — commit, rebase on GitHub, push (the backup).
- Secrets live only in `backend/.env` on the server (git-ignored). A pre-commit hook blocks `.env` files and credential-looking lines — this repo is public.
- After cloning elsewhere, enable the hook: `git config core.hooksPath scripts/githooks`.
