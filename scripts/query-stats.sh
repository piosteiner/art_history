#!/bin/bash
# Monthly query statistics (owner 2026-11-07, after the code review: the statistics had never been reset, so their
# top entry was a query that no longer existed). On the first of the month: the slow-queries report of the past
# month (scripts/slow-queries.sh: the log's statements over 1 s and pg_stat_statements' most expensive) is written to
# logs/query-stats-<YYYY-MM>.txt, then pg_stat_statements is reset — so every month's report measures that month's code.
#   systemd: arthistory-query-stats.timer (monthly) → arthistory-query-stats.service (units: server-docs/config/systemd/)
#   scripts/query-stats.sh          # run now: report + reset
#   scripts/query-stats.sh --keep   # report only, no reset
#   logs: journalctl -u arthistory-query-stats; the reports: ls logs/query-stats-*.txt
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
month="$(date -u -d '1 day ago' +%Y-%m)"     # the month that just ended (run on the 1st)
out="logs/query-stats-$month.txt"
{ echo "Query statistics for $month — written $(date -u '+%Y-%m-%d %H:%M UTC')"; echo
  DAYS=31 DB=arthistory scripts/slow-queries.sh
} > "$out" 2>&1
echo "report: $out ($(wc -l < "$out") lines)"
if [ "${1:-}" != "--keep" ]; then
  sudo -n -u postgres psql -X -q -d arthistory -c "SELECT pg_stat_statements_reset()" > /dev/null
  echo "pg_stat_statements reset"
fi
