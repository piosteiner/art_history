#!/bin/bash
# Nightly backup of the production database (systemd: arthistory-backup.timer). Manual run: scripts/backup.sh
#  1. pg_dump (plain SQL, gzip) → ~/backups/arthistory/arthistory-YYYY-MM-DD.sql.gz, kept KEEP_DAYS days
#  2. verify: restore into a scratch database and compare row counts with production, then drop it
#  3. off-site: if the data changed since the last push, encrypt (gpg, AES256) and push to the private GitHub
#     repo cloned at ~/backups/arthistory-offsite — its git history holds every version.
# Secrets: ~/.config/arthistory/backup-passphrase (outside any repo). Docs: server-docs/README.md → Backups.
set -euo pipefail
umask 077
DB=arthistory
LOCAL_DIR="$HOME/backups/arthistory"
OFFSITE_DIR="$HOME/backups/arthistory-offsite"
PASSPHRASE_FILE="$HOME/.config/arthistory/backup-passphrase"
KEEP_DAYS=14
CHECK_DB=arthistory_backup_check
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

install -d -m 700 "$LOCAL_DIR"
DUMP="$LOCAL_DIR/$DB-$(date +%F).sql.gz"

# 1. Dump. --exclude-extension: postgis/pg_trgm/unaccent are created by setup-database.sql on restore.
#    gzip -n (no timestamp) keeps identical data byte-identical.
pg_dump -h localhost -U arthistory_owner --exclude-extension='*' "$DB" | gzip -9 -n > "$DUMP.tmp"
mv "$DUMP.tmp" "$DUMP"
echo "dump: $DUMP ($(du -h "$DUMP" | cut -f1))"

# 2. Verify: a backup is only as good as its last successful restore.
counts() {
  psql -X -h localhost -U arthistory_owner -d "$1" -Atc "
    SELECT table_name || ' ' || (xpath('/row/n/text()',
             query_to_xml(format('SELECT count(*) AS n FROM %I', table_name), false, true, '')))[1]
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'spatial_ref_sys'
    ORDER BY table_name"
}
drop_check() { sudo -u postgres psql -X -q -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS $CHECK_DB"; }
drop_check
trap drop_check EXIT
"$SCRIPTS/restore.sh" "$DUMP" "$CHECK_DB" > /dev/null
if ! diff <(counts "$DB") <(counts "$CHECK_DB"); then
  echo "✗ verify failed: row counts differ between $DB and the restored dump"; exit 1
fi
echo "verify: restored and row counts match ($(counts "$DB" | awk '{s += $2} END {print s}') rows)"

find "$LOCAL_DIR" -name "$DB-*.sql.gz" -mtime +"$KEEP_DAYS" -delete

# 3. Off-site. The hash ignores psql's \restrict lines, which carry a random key in every dump.
if [ ! -d "$OFFSITE_DIR/.git" ]; then
  echo "✗ off-site repo missing at $OFFSITE_DIR (see server-docs/README.md → Backups)"; exit 1
fi
HASH=$(gunzip -c "$DUMP" | grep -v '^\\\(un\)\?restrict ' | sha256sum | cut -d' ' -f1)
if [ "$HASH" = "$(cat "$LOCAL_DIR/.offsite-hash" 2>/dev/null)" ]; then
  echo "off-site: data unchanged since the last push — nothing to do"; exit 0
fi
gpg --quiet --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --output "$OFFSITE_DIR/$DB.sql.gz.gpg" "$DUMP"
git -C "$OFFSITE_DIR" add "$DB.sql.gz.gpg"
git -C "$OFFSITE_DIR" commit --quiet -m "$DB $(date +%F)"
git -C "$OFFSITE_DIR" push --quiet origin HEAD
echo "$HASH" > "$LOCAL_DIR/.offsite-hash"
echo "off-site: pushed $(git -C "$OFFSITE_DIR" log -1 --format=%h)"
