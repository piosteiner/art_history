#!/bin/bash
# Watches a Sotheby's lot page whose provenance is wrong (owner 2026-11-01): lot 10 of the Blaquier-Arrieta sale
# (Pissarro, La Place du Théâtre-Français, 1898) shows the provenance, exhibitions and literature of lot 4 (Monet,
# Le Jardin des Tuileries). Once a day until the sale (18 November 2026) it reads both pages — robots.txt allows lot
# pages, 15 s apart — and when lot 10's lists no longer equal lot 4's, it leaves one note in the CMS feedback inbox
# (/feedback, kind "content") with what the page says now. After the sale day the timer stops itself.
#   systemd: arthistory-watch-lot.timer (daily) → arthistory-watch-lot.service; logs: journalctl -u arthistory-watch-lot
set -euo pipefail
BASE=https://www.sothebys.com/en/buy/auction/2026/legendary-the-blaquier-arrieta-collection-evening-auction
WATCH=camille-pissarro-la-place-du-theatre-francais
OTHER=claude-monet-le-jardin-des-tuileries
UNTIL=2026-11-18
PAGE=/artworks/100704/la-place-du-theatre-francais-et-lavenue-de-lopera-soleil-dapres-midi-en-hiver  # ours (feedback takes a site path)
STATE="$HOME/.local/state/arthistory"
DONE="$STATE/watch-lot-10.done"

if [[ "$(date -u +%F)" > "$UNTIL" ]]; then
  echo "past $UNTIL — stopping the timer"
  sudo -n systemctl disable --now arthistory-watch-lot.timer 2>/dev/null || true
  exit 0
fi
[ -e "$DONE" ] && { echo "already reported ($(cat "$DONE"))"; exit 0; }

DL=$(mktemp -d)
trap 'rm -rf "$DL"' EXIT
UA='Mozilla/5.0 (X11; Linux x86_64) arthistory.piogino.ch'
curl -sfL -A "$UA" "$BASE/$WATCH?locale=en" -o "$DL/watch.html"
sleep 15
curl -sfL -A "$UA" "$BASE/$OTHER?locale=en" -o "$DL/other.html"

# the lot's provenance / exhibition / literature as text (the page's Next.js data, the lot matching its own slug)
RESULT=$(python3 -I - "$DL/watch.html" "$WATCH" "$DL/other.html" "$OTHER" <<'PY'
import html, json, re, sys
def lot(path, slug):
    s = open(path, encoding='utf-8').read()
    d = json.loads(re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', s, re.S).group(1))
    lots = [v for k, v in d['props']['pageProps']['apolloCache'].items() if k.startswith('LotV2:') and 'provenance' in v]
    l = [x for x in lots if slug in json.dumps(x.get('slug'))][0]
    txt = lambda x: html.unescape(re.sub(r'<[^>]+>', '\n', x or '')).strip()
    return {k: re.sub(r'\s*\n\s*', '\n', txt(l.get(k))) for k in ('provenance', 'exhibition', 'literature')}
w, o = lot(sys.argv[1], sys.argv[2]), lot(sys.argv[3], sys.argv[4])
if w == o:
    print('SAME')
else:
    print('CHANGED\n' + w['provenance'][:1500])
PY
)
if [ "${RESULT%%$'\n'*}" = "SAME" ]; then
  echo "$(date -u +%F): lot 10 still shows lot 4's provenance"
  exit 0
fi
PROV="${RESULT#*$'\n'}"
MSG="Sotheby's has changed lot 10 (Pissarro, La Place du Théâtre-Français, 1898): its provenance is no longer that of lot 4 (Monet). It now reads:

$PROV

Lot page: $BASE/$WATCH?locale=en
To enter: the provenance, exhibitions and literature from the lot page (ask Claude)."
psql -h localhost -U arthistory_owner -d arthistory -q -v ON_ERROR_STOP=1 -v msg="$MSG" -v url="$PAGE" <<'SQL'
SELECT submit_feedback('content', :'msg', :'url', 'Sotheby''s, lot 10 — page corrected', '[]', NULL, NULL);
SQL
mkdir -p "$STATE"
date -u +%FT%TZ > "$DONE"
echo "changed — note left in the CMS feedback inbox"
