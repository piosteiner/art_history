#!/bin/bash
# Watches an auction on Sotheby's (owner 2026-11-01): the Blaquier-Arrieta evening sale, 18 November 2026. Once a day
# it reads the sale's lot list and every lot page (robots.txt allows them; 15 s apart) and leaves one note in the CMS
# feedback inbox (/feedback, kind "content") when something is new since the day before:
#   - a lot that isn't an entry of ours yet (no artwork has the lot page as its web page),
#   - a lot withdrawn, added or gone from the list,
#   - a lot's description, provenance, exhibitions or literature changed (e.g. lot 10, which showed lot 4's provenance).
# The first run only takes the snapshot (and reports lots that aren't entries). State: ~/.local/state/arthistory/sale-*.json.
# A few days after the sale the timer stops itself.
#   systemd: arthistory-watch-sale.timer (daily) → arthistory-watch-sale.service; logs: journalctl -u arthistory-watch-sale
#   scripts/watch-sale.sh --dry-run   read and compare, write nothing (no note, no new snapshot)
set -euo pipefail
SALE=https://www.sothebys.com/en/buy/auction/2026/legendary-the-blaquier-arrieta-collection-evening-auction
UNTIL=2026-11-25      # the sale is on 18 November; a week after it for withdrawals and corrections
PAGE=/artworks        # where the note points on our site (feedback takes a site path)
STATE="$HOME/.local/state/arthistory"
SNAP="$STATE/sale-$(basename "$SALE").json"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

if [[ "$(date -u +%F)" > "$UNTIL" ]]; then
  echo "past $UNTIL — stopping the timer"
  sudo -n systemctl disable --now arthistory-watch-sale.timer 2>/dev/null || true
  exit 0
fi
mkdir -p "$STATE"
DL=$(mktemp -d)
trap 'rm -rf "$DL"' EXIT
UA='Mozilla/5.0 (X11; Linux x86_64) arthistory.piogino.ch'
get() { curl -sfL -A "$UA" "$1" -o "$2"; sleep 15; }

# 1. the lot list
get "$SALE?locale=en&lotFilter=AllLots" "$DL/sale.html"
python3 -I - "$DL/sale.html" > "$DL/lots.tsv" <<'PY'
import json, re, sys
s = open(sys.argv[1], encoding='utf-8').read()
d = json.loads(re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', s, re.S).group(1))
cards = {}
def walk(o):
    if isinstance(o, dict):
        if o.get('__typename') == 'LotCard' and o.get('slug'): cards[o['lotId']] = o
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(d)
for c in sorted(cards.values(), key=lambda c: int(re.sub(r'\D', '', c['lotNumber']['lotDisplayNumber']) or 0)):
    print('\t'.join([c['lotNumber']['lotDisplayNumber'], c['slug']['lotSlug'], (c.get('withdrawnState') or {}).get('state', ''),
                     c.get('creatorsDisplayTitle') or '', c.get('title') or '']))
PY
[ -s "$DL/lots.tsv" ] || { echo "no lots found on the sale page — its layout may have changed"; exit 1; }

# 2. every lot page
while IFS=$'\t' read -r n slug _; do get "$SALE/$slug?locale=en" "$DL/lot-$slug.html"; done < "$DL/lots.tsv"

# 3. which lot pages are web pages of our artworks
psql -h localhost -U arthistory_owner -d arthistory -At -c \
  "SELECT a.public_id || E'\t' || a.slug || E'\t' || a.web_url FROM artworks a WHERE a.web_url LIKE '$SALE/%'" > "$DL/ours.tsv"

# 4. compare with yesterday's snapshot; the note's text on stdout, the new snapshot written by python
NOTE=$(python3 -I - "$DL" "$SNAP" "$SALE" "$DRY" <<'PY'
import html, json, os, re, sys
dl, snap_path, sale, dry = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == '1'
# paragraphs and <br> are lines; inline tags (<em> …) are not
txt = lambda x: re.sub(r'[ \t]*\n\s*', '\n', html.unescape(re.sub(r'<[^>]+>', '', re.sub(r'<br\s*/?>|</p>|</div>|</li>', '\n', x or ''))).replace('\xa0', ' ')).strip()
FIELDS = ('description', 'provenance', 'exhibition', 'literature')
lots = {}
for line in open(os.path.join(dl, 'lots.tsv'), encoding='utf-8'):
    n, slug, withdrawn, artist, title = line.rstrip('\n').split('\t')
    s = open(os.path.join(dl, f'lot-{slug}.html'), encoding='utf-8').read()
    d = json.loads(re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', s, re.S).group(1))
    cand = [v for k, v in d['props']['pageProps']['apolloCache'].items() if k.startswith('LotV2:') and 'provenance' in v]
    lot = [x for x in cand if slug in json.dumps(x.get('slug'))]
    lots[slug] = {'lot': n, 'artist': artist, 'title': title, 'withdrawn': withdrawn,
                  **{f: txt(lot[0].get(f)) if lot else '' for f in FIELDS}}
ours = {}
for line in open(os.path.join(dl, 'ours.tsv'), encoding='utf-8'):
    if line.strip():
        pid, aslug, url = line.rstrip('\n').split('\t')
        ours[url.split('?')[0].rstrip('/').rsplit('/', 1)[-1]] = (pid, aslug)
before = json.load(open(snap_path, encoding='utf-8')) if os.path.exists(snap_path) else None
out = []
name = lambda l: f"Lot {l['lot']}: {l['artist']}, {l['title']}"
missing = [l for s, l in lots.items() if s not in ours]
if missing and (before is None or any(s not in before['lots'] for s, l in lots.items() if s not in ours)):
    out.append('Not yet entries of ours:\n' + '\n'.join(f"- {name(l)} — {sale}/{s}?locale=en" for s, l in lots.items() if s not in ours))
if before:
    for s, l in lots.items():
        b = before['lots'].get(s)
        if not b:
            out.append(f"New on the sale page: {name(l)} — {sale}/{s}?locale=en"); continue
        if b['withdrawn'] != l['withdrawn'] and 'Withdrawn' in (l['withdrawn'] or ''):
            out.append(f"Withdrawn: {name(l)}")
        changed = [f for f in FIELDS if b.get(f) != l[f]]
        if changed:
            ent = ours.get(s)
            out.append(f"Changed — {', '.join(changed)}: {name(l)}" + (f" (our entry /artworks/{ent[0]}/{ent[1]})" if ent else '')
                       + ''.join(f"\n  {f} now:\n    " + l[f][:1200].replace('\n', '\n    ') for f in changed if f != 'literature'))
    for s, b in before['lots'].items():
        if s not in lots: out.append(f"No longer on the sale page: {name(b)}")
if not dry:
    json.dump({'lots': lots}, open(snap_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n\n'.join(out))
PY
)
COUNT=$(wc -l < "$DL/lots.tsv")
if [ -z "$NOTE" ]; then echo "$(date -u +%F): $COUNT lots, nothing new"; exit 0; fi
MSG="Sotheby's, Blaquier-Arrieta sale ($SALE): changes since the last check ($(date -u +%F)).

$NOTE

To enter or correct: ask Claude (scripts/watch-sale.sh)."
if [ "$DRY" = 1 ]; then printf '%s\n' "$MSG"; exit 0; fi
psql -h localhost -U arthistory_owner -d arthistory -q -v ON_ERROR_STOP=1 -v msg="$MSG" -v url="$PAGE" <<'SQL'
SELECT submit_feedback('content', :'msg', :'url', 'Sotheby''s, Blaquier-Arrieta sale — changes', '[]', NULL, NULL);
SQL
echo "$(date -u +%F): $COUNT lots — note left in the CMS feedback inbox"
