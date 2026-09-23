#!/bin/bash
# Commit everything and back it up to GitHub.
# Usage: scripts/save.sh "what changed"
set -e
cd "$(dirname "$0")/.."
[ -z "$1" ] && { echo 'usage: scripts/save.sh "commit message"'; exit 1; }
git add -A
git diff --cached --quiet && echo "nothing to commit" || git commit -m "$1"
git pull --rebase --quiet
git push --quiet origin HEAD
echo "✓ pushed $(git log -1 --format='%h %s')"
