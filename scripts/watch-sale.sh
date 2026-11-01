#!/bin/bash
# Watches an auction on Sotheby's (owner 2026-11-01): the Blaquier-Arrieta evening sale, 18 November 2026. Once a day
# it reads the sale's lot list and every lot page (robots.txt allows them; 15 s apart) and leaves one note in the CMS
# feedback inbox (/feedback, kind "content") when something is new since the day before:
#   - a lot that isn't an entry of ours yet (no artwork has the lot page as its web page),
#   - a lot withdrawn, added or gone from the list,
#   - a lot's description, provenance, exhibitions or literature changed (e.g. lot 10, which showed lot 4's provenance),
#   - the result once a lot is closed: sold (price with buyer's premium) or not sold.
# A sold lot of ours is entered in its provenance (owner 2026-11-01): Sotheby's as agent (the sale, the lot) and the buyer
# — "Private collection", Sotheby's names none — as the next owner with the price, both cited to the lot page. A lot not
# sold: Sotheby's step "not sold"; the collection's own step (its planned end) is left for the owner to review.
# The first run only takes the snapshot (and reports lots that aren't entries). State: ~/.local/state/arthistory/sale-*.json.
# A few days after the sale the timer stops itself.
#   systemd: arthistory-watch-sale.timer (daily) → arthistory-watch-sale.service; logs: journalctl -u arthistory-watch-sale
#   scripts/watch-sale.sh --dry-run   read and compare, write nothing (no note, no new snapshot)
set -euo pipefail
SALE=https://www.sothebys.com/en/buy/auction/2026/legendary-the-blaquier-arrieta-collection-evening-auction
UNTIL=2026-11-25      # the sale is on 18 November; a week after it for withdrawals and corrections
SALE_DATE=2026-11-18; SALE_LABEL='18 November 2026'; SALE_NO=N12368
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
    cache = d['props']['pageProps']['apolloCache']
    bid = lot[0].get('bidState') if lot else None
    bid = cache.get(bid['__ref'], {}) if isinstance(bid, dict) and '__ref' in bid else (bid or {})
    sold = bid.get('sold') or {}
    final = ((sold.get('premiums') or {}).get('finalPriceV2') or {})
    lots[slug] = {'lot': n, 'artist': artist, 'title': title, 'withdrawn': withdrawn,
                  **{f: txt(lot[0].get(f)) if lot else '' for f in FIELDS},
                  'closed': bool(bid.get('isClosed')), 'sold': bool(sold.get('isSold')),
                  'price': final.get('amount'), 'currency': final.get('currency') or 'USD'}
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
# results: once per lot (remembered in the snapshot); ours are entered by the shell part (results.tsv)
recorded = set((before or {}).get('recorded', []))
with open(os.path.join(dl, 'results.tsv'), 'w', encoding='utf-8') as r:
    for s, l in lots.items():
        if not (l['closed'] or l['sold']) or s in recorded: continue
        ent = ours.get(s)
        price = f"{l['currency']} {int(float(l['price'])):,}".replace(',', '’') if l['price'] else 'price not shown'
        what = f"Sold for {price} (with buyer’s premium)" if l['sold'] else 'Not sold'
        out.append(f"{what}: {name(l)}" + (f" — entered in the provenance of /artworks/{ent[0]}/{ent[1]}"
                   + ('' if l['sold'] else '; the collection’s step ends 18 November 2026 as planned — please review') if ent else ' — not an entry of ours'))
        if ent:
            r.write('\t'.join([ent[1], f"{sale}/{s}?locale=en", l['lot'], str(l['price'] or '-'), l['currency'], 't' if l['sold'] else 'f']) + '\n')
        recorded.add(s)
if not dry:
    json.dump({'lots': lots, 'recorded': sorted(recorded)}, open(snap_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n\n'.join(out))
PY
)
COUNT=$(wc -l < "$DL/lots.tsv")

# 5. results of ours into the provenance (skipped when Sotheby's step of that day is there already)
if [ "$DRY" = 0 ]; then
  while IFS=$'\t' read -r aslug url lot price cur sold; do
    psql -h localhost -U arthistory_owner -d arthistory -q -v ON_ERROR_STOP=1 \
      -v aslug="$aslug" -v url="$url" -v lot="$lot" -v price="$price" -v cur="$cur" -v sold="$sold" \
      -v day="$SALE_DATE" -v daylabel="$SALE_LABEL" -v saleno="$SALE_NO" <<'SQL'
BEGIN;
SELECT set_config('arthistory.user_id', '1', true), set_config('arthistory.source', 'watch-sale', true),
       set_config('ws.aslug', :'aslug', true), set_config('ws.url', :'url', true), set_config('ws.lot', :'lot', true),
       set_config('ws.price', :'price', true), set_config('ws.cur', :'cur', true), set_config('ws.sold', :'sold', true),
       set_config('ws.day', :'day', true), set_config('ws.daylabel', :'daylabel', true), set_config('ws.saleno', :'saleno', true) \g /dev/null
DO $$
DECLARE
  art bigint := (SELECT id FROM artworks WHERE slug = current_setting('ws.aslug'));
  day date := current_setting('ws.day')::date;
  sold boolean := current_setting('ws.sold')::boolean;
  price numeric := nullif(current_setting('ws.price'), '-')::numeric;
  src bigint := (SELECT id FROM bibliography WHERE url = current_setting('ws.url') ORDER BY id LIMIT 1);
  soth bigint := (SELECT id FROM institutions WHERE slug = 'sotheby-s');
  nyc bigint := (SELECT id FROM places WHERE slug = 'new-york-city');
  pos int;
  step bigint;
  note text;
BEGIN
  IF art IS NULL OR EXISTS (SELECT 1 FROM provenance WHERE artwork_id = art AND owner_institution_id = soth AND acquired @> day) THEN
    RETURN;
  END IF;
  note := CASE WHEN sold THEN 'Sotheby’s result: sold' || coalesce(' for ' || current_setting('ws.cur') || ' ' || price, '')
                              || ' (with buyer’s premium)'
               ELSE 'Sotheby’s result: not sold' END;
  pos := (SELECT coalesce(max(position), -1) + 1 FROM provenance WHERE artwork_id = art);
  INSERT INTO provenance (artwork_id, position, owner_institution_id, role, acquired, acquired_label, method, direct,
                          location_id, label, not_sold)
  VALUES (art, pos, soth, 'agent', daterange(day, day + 1), current_setting('ws.daylabel'), 'auction', true, nyc,
          format('evening sale %s, %s, lot %s', current_setting('ws.saleno'), current_setting('ws.daylabel'), current_setting('ws.lot')),
          NOT sold)
  RETURNING id INTO step;
  INSERT INTO citations (provenance_id, source_id, url, accessed, note) VALUES (step, src, current_setting('ws.url'), current_date, note);
  IF sold THEN
    INSERT INTO provenance (artwork_id, position, owner_label, role, acquired, acquired_label, method, direct, location_id,
                            price, price_currency, price_note, label)
    VALUES (art, pos + 1, 'Private collection', 'owner', daterange(day, day + 1), current_setting('ws.daylabel'), 'auction', true, nyc,
            price, CASE WHEN price IS NOT NULL THEN current_setting('ws.cur') END,
            CASE WHEN price IS NOT NULL THEN 'with buyer’s premium (Sotheby’s result)' END,
            'bought at Sotheby’s, ' || current_setting('ws.daylabel') || ' — the buyer is not named')
    RETURNING id INTO step;
    INSERT INTO citations (provenance_id, source_id, url, accessed, note) VALUES (step, src, current_setting('ws.url'), current_date, note);
  END IF;
END $$;
COMMIT;
SQL
  done < "$DL/results.tsv"
fi
if [ -z "$NOTE" ]; then echo "$(date -u +%F): $COUNT lots, nothing new"; exit 0; fi
MSG="Sotheby's, Blaquier-Arrieta sale ($SALE): changes since the last check ($(date -u +%F)).

$NOTE

To enter or correct: ask Claude (scripts/watch-sale.sh)."
if [ "$DRY" = 1 ]; then printf '%s\n' "$MSG"; exit 0; fi
psql -h localhost -U arthistory_owner -d arthistory -q -v ON_ERROR_STOP=1 -v msg="$MSG" -v url="$PAGE" <<'SQL'
SELECT submit_feedback('content', :'msg', :'url', 'Sotheby''s, Blaquier-Arrieta sale — changes', '[]', NULL, NULL);
SQL
echo "$(date -u +%F): $COUNT lots — note left in the CMS feedback inbox"
