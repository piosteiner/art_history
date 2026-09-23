# Changelog

Format: date — what — why — how to revert.

## 2026-09-23

### Secrets policy: secrets never enter the repo
- **What:** all credentials (DB passwords, admin login, session secret, API keys) live only in `~/.config/arthistory/*.env` (dir 700, files 600, user `ubuntu`) — outside the git checkout. The app will load `~/.config/arthistory/backend.env`; the repo only has `backend/.env.example` with placeholder names.
  Git hooks (`scripts/githooks/`): `pre-commit` and `pre-push` run `check-secrets.sh`, which blocks secret file names, credential-looking lines/bcrypt hashes, and **any real value present in the secrets files**. `pre-push` re-scans every outgoing commit, so `git commit --no-verify` cannot sneak a secret out. Tested all cases.
- **Why:** the repo is public; admin/CMS credentials must never reach GitHub.
- **Revert:** n/a (policy). If a secret ever leaks: rotate it immediately — deleting the commit is not enough.

### VPS upgraded again (by owner)
- RAM 2 → 4 GB, disk 40 → 60 GB (root fs auto-grew: 58 GB, 42 GB free). 2 vCPU.

### Project repo connected: github.com/piosteiner/art_history
- **What:** cloned the repo to `/var/www/arthistory-api` (the server checkout *is* the repo). Layout: `backend/` (Node app), `server-docs/` (this documentation, moved from `~/server-docs`; `~/server-docs` is now a symlink), `scripts/`.
  Push auth via a repo-scoped SSH deploy key `~/.ssh/art_history_deploy` (ssh alias `github-art_history` in `~/.ssh/config`; remote `git@github-art_history:piosteiner/art_history.git`).
- **Workflow:** every change → update this changelog → `scripts/save.sh "message"` (commit, pull --rebase, push). The pre-commit hook in `scripts/githooks/` (enabled via `core.hooksPath`) blocks `.env`/key files and credential-looking lines — the repo is public.
- **Why:** off-server backup of code and docs; single history for backend + frontend.
- **Revert:** remove the deploy key in GitHub → Settings → Deploy keys and delete `~/.ssh/art_history_deploy*` and the `github-art_history` block in `~/.ssh/config`.

### Firewall enabled (ufw)
- **What:** `ufw default deny incoming`, allow `OpenSSH` + `Nginx Full` (80/443), enabled. Removed stale pre-existing rules for ports 5000 and 3001.
- **Why:** app ports 3000–3003 were bound to 0.0.0.0 and reachable directly from the internet, bypassing nginx/TLS. Verified all sites still respond via their HTTPS hostnames afterwards.
- **Revert:** `sudo ufw disable` (or `sudo ufw allow <port>` to reopen a single port).

### DNS records added (by owner)
- `api.arthistory.piogino.ch` and `admin.arthistory.piogino.ch` → A 83.228.207.199. Verified resolving.

### VPS upgraded (by owner, Infomaniak)
- 1 → 2 vCPU, 20 → 40 GB disk (RAM unchanged at 2 GB). Root filesystem auto-grew to 39 GB on reboot (23 GB free, 43% used).

### Baseline
- Server inventory surveyed and recorded in README.md.
