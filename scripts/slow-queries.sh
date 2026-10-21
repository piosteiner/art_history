#!/bin/bash
# What is slow in production — two sources, both already collected by the server (server-docs/README.md → PostgreSQL):
#   1. the slow-query log (log_min_duration_statement = 1 s, conf.d/arthistory.conf): statements over 1 s per day and
#      the most frequent ones of the last DAYS days
#   2. pg_stat_statements: the queries with the most time in total and the slowest on average (since the last reset)
#   scripts/slow-queries.sh            # last 7 days, database arthistory
#   DAYS=1 DB=arthistory scripts/slow-queries.sh
# Needs sudo (the log and the statistics of every role are readable by postgres only). Read-only.
set -euo pipefail
DAYS="${DAYS:-7}"
DB="${DB:-arthistory}"
LOGS=(/var/log/postgresql/postgresql-18-main.log*)

since="$(date -u -d "-$DAYS days" '+%Y-%m-%d')"
# the log lines of this database's roles: "2026-10-21 14:07:50.576 UTC [728876] arthistory_admin@arthistory LOG: duration: 1752.005 ms execute <unnamed>: SELECT …"
# a statement continues on the following lines, indented with a tab (queries in the code start with a line break):
# joined onto its line first
lines() { for f in "${LOGS[@]}"; do sudo zcat -f "$f"; done |
  awk '/^\t/ { sub(/^\t+/, " "); prev = prev $0; next } { if (NR > 1) print prev; prev = $0 } END { print prev }' |
  sed -E 's/  +/ /g; s/(statement|execute [^:]*):  */\1: /' | grep -E "^[0-9-]+ [0-9:.]+ UTC \[[0-9]+\] [a-z_]+@$DB LOG: duration: " | awk -v s="$since" '$1 >= s'; }

echo "== statements over 1 s per day (log, since $since)"
lines | awk '{ n[$1]++ } END { for (d in n) print d, n[d] }' | sort
echo
echo "== the most frequent of them (count · max s · role · statement)"
lines | sed -E 's/^[0-9-]+ [0-9:.]+ UTC \[[0-9]+\] ([a-z_]+)@[a-z_]+ LOG: duration: ([0-9.]+) ms (statement|execute [^:]*): ( *-- [^-]*)?/\1\t\2\t/' |
  awk -F'\t' '{ key = $1 "\t" substr($3, 1, 110); n[key]++; if ($2 > m[key]) m[key] = $2 }
              END { for (k in n) printf "%6d  %7.1f  %s\n", n[k], m[k] / 1000, k }' | sort -rn | head -15
echo
echo "== pg_stat_statements: most time in total"
sudo -u postgres psql -X -d "$DB" -c "
  SELECT calls, round(total_exec_time / 1000) AS total_s, round(mean_exec_time) AS mean_ms, round(max_exec_time) AS max_ms,
         r.rolname AS role, left(regexp_replace(query, '\s+', ' ', 'g'), 90) AS query
  FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid JOIN pg_roles r ON r.oid = s.userid
  WHERE d.datname = '$DB' ORDER BY total_exec_time DESC LIMIT 10"
echo "== pg_stat_statements: slowest on average (at least 5 calls)"
sudo -u postgres psql -X -d "$DB" -c "
  SELECT calls, round(mean_exec_time) AS mean_ms, round(max_exec_time) AS max_ms, r.rolname AS role,
         left(regexp_replace(query, '\s+', ' ', 'g'), 100) AS query
  FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid JOIN pg_roles r ON r.oid = s.userid
  WHERE d.datname = '$DB' AND calls >= 5 ORDER BY mean_exec_time DESC LIMIT 10"
