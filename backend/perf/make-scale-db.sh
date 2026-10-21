#!/bin/bash
# The performance test database scale_test: the latest nightly backup, migrated, every entry cloned K times
# (perf/scale.sql — new names from today's words, wired like the originals), all derived data computed.
#   backend/perf/make-scale-db.sh        # K = 9 → ten times today's data
#   K=4 backend/perf/make-scale-db.sh    # five times
# Replaces an existing scale_test (never another database). Takes ≈ 10 minutes at K = 9. Then: npm run perf.
set -euo pipefail
cd "$(dirname "$0")/.."
K="${K:-9}"
DB=scale_test
BACKUP="$(ls -t "$HOME"/backups/arthistory/arthistory-*.sql.gz | head -1)"

echo "→ $DB from $BACKUP, K = $K"
sudo -u postgres dropdb --if-exists "$DB"
../scripts/restore.sh "$BACKUP" "$DB" > /dev/null
DB_NAME="$DB" npm run -s migrate | tail -1
sudo -u postgres psql -X -q -d "$DB" -v K="$K" -f perf/scale.sql
# the clones were written without triggers: everything queued once and computed (as superuser — no timeout); the
# lists' rows are computed by the server's worker when perf/run.js starts it
sudo -u postgres psql -X -q -d "$DB" -c 'SELECT refresh_quality_full()' -c 'SELECT refresh_quality()' > /dev/null
sudo -u postgres psql -X -At -d "$DB" -c "SELECT type || ' ' || count(*) FROM entity_index GROUP BY type ORDER BY type"
echo "✓ $DB ready"
