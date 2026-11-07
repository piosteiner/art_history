#!/bin/bash
# Nightly backup of the production database (systemd: arthistory-backup.timer). Manual run: scripts/backup.sh
#  1. pg_dump (plain SQL, gzip) in two files → ~/backups/arthistory/, kept KEEP_DAYS days:
#       arthistory-YYYY-MM-DD.sql.gz                 everything but the bytes of private_images (the owner's reference
#                                                    images, 184 — 300 MB that rarely change)
#       arthistory-private-images-YYYY-MM-DD.sql.gz  those bytes; a hard link to the day before when unchanged
#  2. verify: restore both into a scratch database and compare row counts with production, then drop it
#  3. off-site: if the data changed since the last push, encrypt (gpg, AES256), cut into parts of 95 MB (GitHub
#     refuses a file over 100 MB) and push to the private GitHub repo cloned at ~/backups/arthistory-offsite — the
#     latest version only, as a new root commit each time (2026-11-07: with history the repo grew by 100–400 MB a day
#     and pushes failed from 4 November; the 14 local days are the history). The images part is pushed only when it changed.
# Secrets: ~/.config/arthistory/backup-passphrase (outside any repo). Docs: server-docs/README.md → Backups.
set -euo pipefail
umask 077
DB=arthistory
LOCAL_DIR="$HOME/backups/arthistory"
OFFSITE_DIR="$HOME/backups/arthistory-offsite"
PASSPHRASE_FILE="$HOME/.config/arthistory/backup-passphrase"
KEEP_DAYS=14
CHECK_DB=arthistory_backup_check
PART_SIZE=95m
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

install -d -m 700 "$LOCAL_DIR"
TODAY="$(date +%F)"
DUMP="$LOCAL_DIR/$DB-$TODAY.sql.gz"
IMAGES="$LOCAL_DIR/$DB-private-images-$TODAY.sql.gz"

# 1. Dump. --exclude-extension: the extensions (postgis, pg_trgm, unaccent, btree_gist, …) are created by setup-database.sql
#    on restore. gzip -n (no timestamp) keeps identical data byte-identical. private_images: its schema in the main
#    dump, its rows (the bytes) in the second file — gzip -1 there, WebP doesn't compress.
pg_dump -h localhost -U arthistory_owner --exclude-extension='*' --exclude-table-data=private_images "$DB" | gzip -9 -n > "$DUMP.tmp"
mv "$DUMP.tmp" "$DUMP"
pg_dump -h localhost -U arthistory_owner --data-only --table=private_images "$DB" | gzip -1 -n > "$IMAGES.tmp"
# unchanged since the last dump: a hard link, so the 14 days don't hold 14 copies of 300 MB
prev=$(ls -t "$LOCAL_DIR"/$DB-private-images-*.sql.gz 2>/dev/null | grep -v "$TODAY" | head -1 || true)
if [ -n "$prev" ] && cmp -s "$IMAGES.tmp" "$prev"; then rm "$IMAGES.tmp"; ln "$prev" "$IMAGES"; same_images=1
else mv "$IMAGES.tmp" "$IMAGES"; same_images=0; fi
echo "dump: $DUMP ($(du -h "$DUMP" | cut -f1)) + images $(du -h "$IMAGES" | cut -f1)$([ "$same_images" = 1 ] && echo ' (unchanged)')"

# 2. Verify: a backup is only as good as its last successful restore (restore.sh loads the images file beside the dump).
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
IMAGES_HASH=$(sha256sum "$IMAGES" | cut -d' ' -f1)
if [ "$HASH $IMAGES_HASH" = "$(cat "$LOCAL_DIR/.offsite-hash" 2>/dev/null)" ]; then
  echo "off-site: data unchanged since the last push — nothing to do"; exit 0
fi
encrypt_parts() {   # $1 source, $2 name in the repo → <name>.00 <name>.01 … (the old parts of that name removed first)
  rm -f "$OFFSITE_DIR/$2".??
  gpg --quiet --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
      --symmetric --cipher-algo AES256 --output - "$1" | split -b "$PART_SIZE" -d -a 2 - "$OFFSITE_DIR/$2."
}
encrypt_parts "$DUMP" "$DB.sql.gz.gpg"
if [ "$IMAGES_HASH" != "$(cut -d' ' -f2 "$LOCAL_DIR/.offsite-hash" 2>/dev/null)" ] || ! ls "$OFFSITE_DIR"/private-images.sql.gz.gpg.00 > /dev/null 2>&1; then
  encrypt_parts "$IMAGES" "private-images.sql.gz.gpg"
fi
rm -f "$OFFSITE_DIR/$DB.sql.gz.gpg"   # the single file of the old layout
# the latest version only: a new root commit replaces the branch (the old objects are left for git gc, here and on GitHub)
git -C "$OFFSITE_DIR" checkout --quiet --orphan offsite-new
git -C "$OFFSITE_DIR" add -A
git -C "$OFFSITE_DIR" commit --quiet -m "$DB $TODAY"
git -C "$OFFSITE_DIR" branch -M main
git -C "$OFFSITE_DIR" push --quiet --force origin main
git -C "$OFFSITE_DIR" reflog expire --expire=now --all && git -C "$OFFSITE_DIR" gc --quiet --prune=now
echo "$HASH $IMAGES_HASH" > "$LOCAL_DIR/.offsite-hash"
echo "off-site: pushed $(git -C "$OFFSITE_DIR" log -1 --format=%h) ($(du -sh "$OFFSITE_DIR" --exclude=.git | cut -f1) in $(ls "$OFFSITE_DIR"/*.gpg.?? | wc -l) parts)"
