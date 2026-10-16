# Public read API (`/v1`)

Base URL `https://api.arthistory.piogino.ch/v1`. Read-only, JSON, CORS for `https://arthistory.piogino.ch`.
Responses are cacheable for 60 s (`Cache-Control`) and carry an `ETag`. Entities are addressed by **slug**.
Errors: `{"error": "bad_request" | "not_found" | "timeout" | "internal_error", "message": "…"}`.

## Dates
Every date is an object (or `null`):
```json
{"label": "20 February 1888–8 May 1889", "from": "1888-02-20", "to": "1889-05-08", "from_year": 1888, "to_year": 1889}
```
`to` is inclusive. BCE years are negative (`-500`); BCE ISO dates start with `-`. Open ends are `null` (an ongoing period, "since 1808", has `to` and `to_year` = `null`).
Show `label` to people, use `from`/`to` for timelines.
"c. 1755" (also from Wikidata's "circa") is 1750–1760: ±5 years. Dates may be as coarse as a century: "13th century" is `from: 1201-01-01, to: 1300-12-31`, "late 13th century"
1267–1300, "1880s" a decade. On a timeline draw the whole span (e.g. a faded bar) rather than a point, and sort by
`from` (or the midpoint); the `?from=&to=` filters match any overlap, so a century-dated work appears in every
window inside its century.

## Entities
Types (URL segment → `type`): `artists` → artist, `artworks` → artwork, `places` → place, `movements` → movement,
`institutions` → institution, `people` → person, `polities` → polity, `events` → event (since 2026-10-08). (`/v1/patrons…` — before migration 024 — answers
with a 301 to `/v1/people…`, also under `/map/` and `/graph/`.)

### `GET /v1/<type>` — list
| Param | |
|---|---|
| `q` | name/title search: accent-insensitive, substring or fuzzy (`durer`, `hokusia`) |
| `from`, `to` | years; entities whose lifespan / creation / period overlaps (not for places) |
| `limit` (1–500, default 100), `offset` | paging; the response has `total` |
| artworks: `creator` (main creator or co-creator), `institution` (slugs), `kind` · places: `kind`, `country` (ISO code) · movements, institutions: `kind` | filters |

→ `{"data": [...], "total": 4, "limit": 100, "offset": 0}`

Artworks also have `materials` (list; filter `?material=bronze`) and `dimensions`
(`{height_cm, width_cm, depth_cm, note, label: "73.7 × 92.1 cm"}`, `depth_cm` only for objects; a height alone —
a sculpture — has `width_cm: null` and `label: "50 cm (height)"`; `null` without data). `dimensions` are the work itself;
`other_dimensions` lists further measured parts in the same shape plus `part`:
`[{part: "mount", height_cm: 180, width_cm: 95.5, depth_cm: null, label: "180 × 95.5 cm"}]` (empty list if none).

Artworks: who made it. `creator` `{slug, name}` is the main creator (`null` if unknown). **`creators`** lists all of
them, the main one first: `[{slug, name, main, role, certainty}]`. Further creators (rare: Rubens painted the figures,
Jan Brueghel the landscape) are relationships `co_creator` (artwork → artist, labels "co-creator" / "co-creator of",
category `collaboration`; the main creator is the derived graph edge `creator`); `role` is that relationship's note ("landscape"), `certainty` attested ·
probable · possible · disputed. `attribution_label` (detail only) is free text: "Workshop of Rubens", "Attributed to …",
"Anonymous". With a creator it qualifies the creator; show it **instead of** the name, linked to the creator
("Workshop of Rubens" → Rubens). Without a creator, show it on its own.

Artworks, artists, institutions and people (since 2026-10-08) carry an `image_url`: the main image (https, hotlinked — often Wikimedia Commons;
for a smaller version replace `/NNNNpx-` in a Commons thumbnail URL with a standard width such as `/250px-`), `null`
without images. The detail adds `images`, all of them in order (the first = `image_url`):
`[{url, source_url, license, credit, caption}]` — e.g. caption "Back view" for a sculpture. Show license and credit
wherever an image is shown.

### People
Everyone relevant who isn't an artist, and groups: `kind` (person, family, dynasty, religious order …),
`occupations` (list), `birth`, `death`, `active` (groups), `description_html`, `birth_place`, `country`, `polities`,
and **`roles`** — derived from relationships: `patron` (commissioned / patron of), `owner` (of an artwork),
`depicted` (in an artwork). Filters: `?role=patron`, `?occupation=poet`, `?kind=`, `?country=`; `from`/`to` use the
lifespan (else the active period). Depictions: relationship `depicts_person` (artwork → person or artist, label
"depicts" / "depicted in", category `depiction`, part of the graph).

### Series and other wholes (migration 037)
An artwork can be part of another artwork — a print of a series, a panel of a triptych or altarpiece, a leaf of an
album. A part: `part_of` (the chain of wholes upwards, nearest first: `[{slug, title, kind, parts_count}]`),
`part_number` ("21", "left panel"), `previous_part` / `next_part` (`{slug, title, part_number}` or `null`). A whole:
`parts_count` (how many parts it has, may be `null`) and `parts` in order (`[{slug, title, part_number, kind, created,
image_url, parts}]` — `parts` > 0 for a sub-series). Lists carry `part_of: {slug, title}` and `part_number`; filter
`?part_of=<slug>`. Relationship `published` (person/institution → artwork, category `publication`): the publisher.

### Events (`/v1/events`, type `event`, migration 047)
Something that happened: the Great Fire of Meireki, a trial, an auction, an exhibition. List and detail carry `kind`
(fire, trial, exhibition, auction …), `period` (a date range like every other: `{from, to, label, from_year, to_year}`),
`place` (`{slug, name}` — the city; in the detail with its `location` marker), `part_of` (`{slug, name}` of the larger
event or `null`), `country`/`polities` (from the place), `image_url`; the list also a `location` point (exact spot,
else a point inside the area, else `null`). The detail adds `description_html`, `images`, `location` (GeoJSON point or
`null`), `area` (GeoJSON MultiPolygon or `null` — e.g. the burned districts), `parts` (`[{slug, name, kind, period}]`,
in time order) and `relationships`. Filters: `kind`, `place` (place slug), `part_of` (event slug), `country`,
`from`/`to` (overlapping the window). Sorted by date.
Relationships: an artwork `depicts` an event; artists, people, institutions `participated_in` it (the role —
defendant, judge, lender, organiser — in the relationship's `label`); an event `concerns` artists, artworks,
institutions, people, movements, places, polities. Links in texts: `[[event/slug]]`.

### Bibliography (`/v1/bibliography`, type `source`)
Sources cited in texts, formatted after the guide of the Kunsthistorisches Institut, UZH: `siglum` (the short reference,
"Busch 1993", "Kimpel und Suckale 1995", "Kat. Paris 2007", "Jacobsen 1992a") and `citation` (the full entry, HTML with
italic titles). Fields: `kind`, `authors`, `subtitle`, `year`, … (see `content/README.md`), `reading_status`
(`to_read`/`reading`/`read`), `read_on`, `primary_source`; the detail adds every field, `description_html` (notes) and
`mentioned_in` (the entries citing it). The list has `stats: {total, read, reading, to_read}`; filters `?kind=`,
`?status=read`, `?author=`.

**Citations in texts:** `*_html` may end with `<section class="footnotes"><ol class="footnote-list">…</ol></section>`
(numbered notes; references in the text as `<sup class="fn-ref" id="…"><a href="#…">1</a></sup>`, each note with a back
link `a.fn-back`) and `<section class="bibliography">` (`<h4>Literatur</h4>` / `<h4>Quellen</h4>` with
`ul.source-list > li > span.siglum + full entry`). Short references are `a.source-link[data-source]` →
`/bibliography/<slug>`. Every detail response has `bibliography: {<slug>: {siglum, citation}}` for the sources its texts
cite (popovers). The ids are unique per text, so several texts on one page don't clash.

### Type and materials of artworks (glossary terms, migration 071)
An artwork's `kind` and `materials` stay names (the term's main name, English), but each is a glossary term with
names in several languages: the detail has `kind_term` `{slug, name}` and `material_terms` `[{slug, name}]` (link
them to `/glossary/<slug>`); list and detail have `term_names` — every name of the type, the materials and the terms the
`medium` mentions, in every language (`["woodblock print", "Holzschnitt", "木版画", "paper", "Papier", …]`) — for
searching ("Holzschnitt" finds the woodblock prints). Filters `?kind=` and `?material=` take the term's slug or any of its
names in any language. A value that is no term yet is shown as it is (no `kind_term` / not in `material_terms`).

### Glossary (`/v1/glossary`, type `term`)
`name` (+ the name fields below), `category` (technique · architecture · material · iconography · style · format ·
object type · other; filter `?category=`), `definition` (short, plain text), `description_html`, `images`/`image_url`, related
terms as relationships (`related_term`), and in the detail `used_in: [{type, slug, name}]` — the entries whose texts
link the term. Lists sort A–Z by `sort_key`.

**Links in texts:** every `*_html` may contain `<a href="/glossary/<slug>" class="glossary-link" data-term="<slug>">`
(class `glossary-link missing` when the term doesn't exist yet). Every detail response has `glossary`: the terms its
texts link, `{<slug>: {name, category, definition}}` — enough for a tooltip without another request. Links to other entries
(migration 030) are `<a href="/<plural>/<slug>" class="entry-link" data-entry="<type>/<slug>">` (e.g. `/artists/katsushika-hokusai`,
`data-entry="artist/katsushika-hokusai"`; class `entry-link missing` when the entry doesn't exist), and the `href` is
the website's own address. Every detail response has **`entries`** for those links (migration 040, view
`entry_previews`): `{"<type>/<slug>": {type, slug, name, subtitle, image_url, excerpt}}` — a Wikipedia-style preview
without another request. `subtitle`: dates, maker, kind or where (artist "1760–1849", artwork "Katsushika Hokusai,
c. 1831 · woodblock print", institution "museum · Paris · founded 1793", place "settlement · Provence"); `excerpt`: the
first paragraph of its text as plain text (links as names, no footnotes), cut after a sentence within ~300 characters,
or `null`; `image_url`: the main image or `null`. Only existing entries; terms and sources are in `glossary`/`bibliography`.
Every detail response except a term's also has **`mentioned_in`** `[{type, slug, name}]`:
the entries whose texts link this one (backlinks). A term has the same thing as `used_in`.

**`GET /v1/previews?refs=artist/paul-gauguin,place/arles,term/contrapposto`** — the same previews for *any* entries
(max. 100 refs, all types incl. terms and sources), as `{data: {"type/slug": {type, slug, name, subtitle, image_url,
excerpt}}}`; entries that don't exist are left out. For popovers on every internal link of a page — fields
(artist, collection, country), relationships, lists, map popups: collect the page's `/artists/…`, `/places/…` …
links, ask once, show on hover. Cached 60 s like the rest of the API.

### Sites: institutions and immovable artworks (migration 034)
- Institutions: `location` (their own point, GeoJSON, or `null`), `address`; `place` stays the city.
- Artworks that don't move (buildings, gardens, bridges …): `location` and/or `area` — where they stand.
- Relationship `houses` (artwork → institution, dated; category `architecture`): a building and the institution it
  houses — the institution's page lists it as "housed in". `depicts` may point at an immovable artwork.
- Presence relationships (`lived_in`, `worked_in`, `visited`) may point at an institution. Map features
  (`/v1/map/presence`, `/v1/map/<type>/:slug`) then carry `institution: {slug, name}` and `place` = the city it is in;
  the point is the institution's own, else its city's. **Encounters:** same `institution` and overlapping periods =
  could have met there; only the same `place` = were in the same city at the same time.
- `GET /v1/map/sites` — institutions and immovable artworks with an exact location of their own
  (`properties: {type, slug, name, kind, address, place}`).

### Places: geometry
`location` (GeoJSON Point) is where to put the marker and `area` (MultiPolygon or `null`) the outline — the place's
own, or derived (migration 032): a country or region with only a `boundary_code` (`JP`, `JP-13`) gets the
**Natural Earth** outline (public domain) and its label point; a place with only an outline gets a point inside it.
The detail says which: `geometry_source: {location: "own"|"derived", area: "own"|"boundary"|null}`.

### Names in several languages (every type)
- `<name>` (`name`, artworks: `title`) — plain text, as before. `<name>_lang` — its language (BCP 47: `ja`, `en`, `zh-Hant`) or `null`.
- `<name>_ruby_html` — the name with furigana as `<ruby>神奈川<rp>(</rp><rt>かながわ</rt><rp>)</rp></ruby>…` (escaped, safe
  to insert), `null` without; `<name>_reading` — the full reading (`かながわおきなみうら`).
- `names` — other names in order: `[{text, lang, role, ruby_html, reading}]`, role = `original` | `translation` |
  `romanization` | `alternative`. A romanization's lang is the language in Latin script (`ja-Latn`, `zh-Latn-pinyin`).
- `sort_key` — what to sort by: the name itself when it has Latin letters (also when it is an English translation);
  for a name in another script its romanization, else its furigana reading in Latin letters (歌川広重 → Utagawa
  Hiroshige / utagawahiroshige). List results are ordered by it (artists and people: family name first, see below).
- `alt_names` / `alt_titles` — all other names as plain strings (unchanged, for older clients).
- `search_text` — everything the entry is found by besides its name: other names, furigana readings, kana readings in
  Latin letters (Hepburn, long vowels both ways: "ほっかいどう · hokkaidou hokkaido"); `""` if none. For filtering
  already loaded lists in the browser — append it to the text you match against; don't romanize client-side.
Set `lang` on elements showing a name (`<h1 lang="ja">`) so the right font and pronunciation are used. `?q=` and
`/v1/search` also match other names and readings ("kanagawa oki", "Under the Wave", "かながわ"), and kana readings typed
in Latin letters (Hepburn, long vowels either way: "utagawa", "toukyou" or "tokyo").

### Countries and polities (artists, artworks, institutions, people)
Two different things, both in lists and details:
- `country` — the country **today**, derived from the entry's place: an artist's / person's birthplace, where an
  artwork was created, where an institution is. A place without its own ISO code inherits the nearest parent's
  (Zundert → Netherlands). Without a place, it comes from the linked polities if they all lie in one modern country
  (a Han dynasty bronze → China).
  `{code: "NL", name: "Netherlands", slug: "netherlands"|null, source: "place"|"polity", place: {slug, name}|null}` or `null`.
  `slug` is the country's place entry if there is one.
- `polities` — the dated links to polities (states, empires, dynasties), in time order:
  `[{slug, name, kind, relationship: "nationality"|"created_in_polity"|"located_in_polity", period, polity_period, country_codes}]`.
  Nationality is entered by hand (an art-historical attribution) — not derived from the birthplace.
- Artists and people also have `birth_place: {slug, name, country_code}` (or `null`).

Show both together as e.g. **"Soviet Union (today Ukraine)"**: the polity's `name` + `country.name`. Don't derive "today"
from a polity's `country_codes` when there are several (the USSR covers 15 countries) — `country` already did the right thing.
Filters: `?country=NL` (today's country, ISO code) and `?polity=<slug>`.

Polities (`/v1/polities`): `kind`, `period` (when it existed), `country_codes` (modern countries on its territory;
filter `?country=UA`); the detail adds `ancestors` / `children` (Western Han ⊂ Han dynasty) and, as relationships,
everyone and everything linked to it ("nationality of" …).

### `GET /v1/<type>/:slug` — detail
An entry's former slug answers with **301** to its current address (migration 041) — follow redirects.

All fields (Markdown already rendered to sanitized HTML as `*_html`), plus:
- `relationships`: every link in both directions, from this entity's point of view —
  `{type, direction: outgoing|incoming|mutual, label, category, is_physical_presence, entity: {type, slug, name, period}, period, note, certainty, notes_html, derived, end_basis}`.
  (Van Gogh: "lived in" Arles; Arles: "home of" Van Gogh.) `derived: true` = computed from the provenance
  (`owned_by`, `kept_in`, `transferred_to`, see below); `end_basis` says where its period's end comes from.
  The main creator is not repeated here (it's in `creator` / `artworks`).
- artist: `artworks` (including co-created ones: `co_creator: true`, `role`) · institution: `artworks`, `place` · artwork: `creator`, `creators`, `attribution_label`, `institution` ·
  place: `ancestors` (Arles → France), `children`, `institutions` · movement: `ancestors`, `children`.

### Moved entries (migration 055)
An entry whose type was changed (an institution that is a person) answers its old address with a 301 to the new
one: `/v1/institutions/henry-clay-frick` → `/v1/people/henry-clay-frick`.

### Reference records (every detail, migration 053)
`identifiers`: the entry's numbers in authority files, `[{authority, name, value, url}]` — `ulan` (Getty ULAN), `gnd`
(Deutsche Nationalbibliothek), `viaf`, `sikart` (Swiss Institute for Art Research), `rkd` (RKDartists), `lc` (Library
of Congress); `url` is the record's page. Show them as "Reference records" / "Normdaten" links.

### Sources for facts (every detail, migrations 049/050)
Where each fact comes from. The detail has `sources`: `{field: [citation]}` for its fields (`birth`, `created`,
`dimensions`, `institution`, `place` … — the doc keys), every item of `relationships` and of `provenance` has
`sources: [citation]` (a derived relationship — owned by, kept in — has its provenance step's). A citation:
`{kind, reliability, text, source?, wikidata?, locator, url, accessed, note, outdated}`
- `kind`: `source` (an entry of the bibliography: `source: {slug, siglum}`; its full reference is in the response's
  `bibliography` map, like the sources its texts cite), `wikidata` (`wikidata: {item, property, url}`), `text`
  (a note in words, not verified).
- `reliability`: `database` (Wikidata, aggregators) < `institution` (museum, collection database) < `scholarly`
  (catalogue raisonné, literature) < `primary` (archive, letters); `null` for `text`. Show the best one, weaker ones as
  "also".
- `text`: the short form to show — "Busch 1993, S. 45", "Kunsthaus Zürich, Sammlung online", "Wikidata, Q45585, P2048".
- `url`: the exact page (an object page of a museum website source); `accessed`: `YYYY-MM-DD`.
- `outdated: true`: the value changed after the source was cited — show it muted or not at all.
Fields without citations have no key in `sources`.

### Translations: official, common or own (migration 052)
Every `names` item has `status`: for a translation `official` (the holding institution's or a publisher's — usually
with a source in `sources.names`), `common` (in use in the literature or on Wikidata) or `own` (the author's own),
`null` for the other roles. Artworks also have `title_status` (list and detail): `null` = the title is in its original
language; otherwise the title itself is such a translation (English titles of Japanese prints), its source in
`sources.title_status`. Convention: show own translations in [square brackets]; prefer an official title.

### Numbers and loans (artworks, migration 048)
`inventory_number` is the number of the institution where the work is now (`institution`). The detail adds `numbers`:
further numbers in order — `[{number, label, institution: {slug, name} | null, source: {slug, name} | null}]`: the
owner's inventory number when the work is on loan, former inventory numbers (`label`), catalogue raisonné numbers
(`source` = the catalogue in the bibliography). `on_loan` (list and detail): the work is lent to (deposited at) that
institution; the owner — the lender — is the last step of the provenance. `on_loan_since` (detail): a date range or `null`.
Show it like a credit line: "Foundation E.G. Bührle Collection, on permanent loan to the Kunsthaus Zürich since 2021".

### Web page (artworks)
`web_url` (detail): the work's page at the museum or collection that holds it, or another good page about it (migration
038). Link it on the artwork page — most of all when `images` is empty: then it is the way to see the work.
`web_url_accessed` (`YYYY-MM-DD`, migration 039): the day the link was added or last changed — set by the database,
shown like a citation's "accessed on …".

### Provenance coverage — where the provenance is silent (artworks, 078)
- `provenance_coverage` (detail) or `null`: the time from the creation until today as stretches
  `segments: [{kind, period, in_1933_1945, before, after, candidates, before_position, after_position, show_after}]`, in order —
  `kind` **documented** (someone demonstrably held it: a recorded period, or until the next acquisition when that
  handover is documented as direct; documented custody — a deposit, a loan — counts too), **presumed** (a holder is
  known, the edges are not), **gap** (no holder known). A gap names the holders `before` / `after` it (and their
  provenance `position`s) and `candidates`: holders known only without dates who may have held it then.
  `show_after` (079): the step to show a gap after — the last one between its owners dated before it (an agent at an
  unsold auction can split a gap), else `before_position`.
  `in_1933_1945`: the stretch touches 30 January 1933 – 8 May 1945. Also `documented_percent`, `has_provenance`,
  `gap_years`, `gap_1933_1945_years`.
- Lists: `provenance_coverage: {documented_percent, has_provenance, gap_1933_1945}`; filter
  `?provenance_gap=1933-1945` (a gap then) or `?provenance_gap=any`.
- Map (`/v1/map/artworks/:slug` → `provenance`): `gaps` (the same gaps, beside the features) and on each
  `provenance_segment` its `gaps` (those between its two stops) — draw them, e.g. a "?" with the years mid-segment;
  stops carry the step's `position`.

### Provenance status and design date (artworks, 074)
- `provenance_status` (detail): `{category: "A"–"D", code, label, note}` or `null` (not assessed) — the categories of
  the Swiss Federal Office of Culture for 1933–1945: **A** clarified, no looted art · **B** not fully clarified, no
  indications · **C** not fully clarified, indications or suspicious circumstances · **D** looted / seized as a result
  of Nazi persecution. `note`: the source's own wording. Lists have `provenance_category` ("A"–"D" or null).
- `conceived` (detail): when the design, block or model was made, if earlier than `created` — a print pulled or a
  cast made later (L'Univers est créé: block 1893–94, printed 1921 by Pola Gauguin). Show "designed 1893–94, printed
  1921"; `null` otherwise.
- Relationship `copy_after` (artwork → the work it copies; inverse "copied in").

### Provenance (artworks)
The detail of an artwork has **`provenance`**: its holders in order, as the sources record them, read as a chain —
`[{kind, implied, position, owner: {type, slug, name} | null, co_owners: [{type, slug, name}], role, owner_label, owner_name,
acquired, ended, method, direct, label, certainty, price: {amount, currency, note} | null, place: {slug, name} | null,
period, end_basis, notes_html, sources, in_chain, not_sold, via}]`.
- **The cases of 076/077:** `role` also `publisher` (holds an edition — of the chain), `foundry`, `trustee` (in trust
  or as security — custody) and `event` (no holder: a claim, a settlement between others, a collection dissolved; the
  step's `label` describes it, `owner` may name a party; `in_chain: false`, no `owned_by`, not on the map). `method`
  also `transfer`, `theft` (on a custody step: the owner keeps the title; `ended` = recovered), `claim`,
  `dissolution`. Per step: `further_places: [{slug, name, period}]` (after `place`, in order — the map has a stop for
  each, `move: true` segments between them), `numbers: [{kind, label, number}]` (kinds: lot, stock, inventory,
  catalogue, ek, err, munich, linz, aussee, lugt, other), `event: {slug, name}` or null. `price.currency` may be a
  historical code without ISO (RM). `GET /v1/provenance-numbers?number=4317[&kind=munich]` → the steps recording it:
  `{data: [{kind, kind_label, number, artwork: {slug, title}, position, owner_name, period}]}`.
- **Custody beside the ownership (074):** `in_chain: false` for agents and custodians — deposits, loans, consignments,
  auctions. They hold the work *alongside* its owner: they don't end the owner's period, and handovers go from owner
  to owner past them. Show them indented or as "held by … (deposit)" rather than as a new owner. `not_sold: true`: an
  agent that didn't sell it (bought in, withdrawn, returned). `via` (owner steps): the agents the work went through to
  this owner, e.g. "Galerie Moos" — the unsold ones aren't among them.
- `kind` (063): `creation` — **implied** first line, the artist from the creation date (computed from the creator and
  `created`; absent when the first step is a creation or commission, or names the artist) · `step` — recorded ·
  `loan` — **implied** last line, the current institution as custodian when the work is on loan (`on_loan`,
  `on_loan_since`). `implied: true` for the computed lines: no `sources`, show them differently (e.g. in italics).
- `role` (063): `owner` · `dealer` (bought it to sell) · `agent` (held on consignment, did not own it) · `estate`
  (the owner's estate: write "Estate of …") · `custodian` (held without owning: a loan, a deposit).
  `co_owners`: further owners of the same step ("Léo and Gertrude Stein"). `price`: `{amount: 18000, currency: "USD",
  note: "ca."}` (ISO 4217 currency; old ones like FRF, DEM too) or `null`.
- Dates known only from one side are open ranges with a label saying so: "26 March 1952 or later" (`to` is `null`),
  "28 October 1904 or earlier" (`from` is `null`), "after 1952", "before 1928".
- `acquired` / `ended` are dates (`ended` only when a source records it); `method`: creation · commission · inheritance ·
  purchase · auction · gift · bequest · exchange · confiscation · forced_sale · restitution · settlement (073: kept
  after an agreement with claimants — a "just and fair solution") · unknown;
  `direct`: the handover from the previous owner is documented (false = possibly someone in between).
- `period` is **computed**: from the acquisition to … — `end_basis` says what:
  `recorded` (the step's own `ended`) · `implied` (the next owner's acquisition — of the chain: custody steps don't
  count — show it differently, e.g. "(implied)")
  · `ongoing` (the current holder: open end) · `unknown` (nothing after it: only the acquisition, no invented end).
- Each step also appears as derived relationships: `owned_by` (artwork → owner), `kept_in` (artwork → place, category
  `presence`: part of the artwork's **route on the map**), `transferred_to` (previous owner → next owner, category
  `provenance`, label = the method; certainty `possible` when not documented as direct). People who owned something
  have the role `owner`. Joint owners have their own `owned_by`; agents and custodians a `held_by` instead; a step with
  the method `commission` also gives `commissioned` (owner → artwork; the patron's role `patron`).

### Names of artists and people (066)
Artists and people have `given_name`, `family_name` and `sort_name` ("filed as": an override such as "Hokusai"), each
`null` when not set; their `sort_key` is "family, given" without a leading lowercase particle ("van Gogh" →
"Gogh, Vincent"; "de La Tour" → "La Tour, Georges"), else `sort_name`, else the name. Lists are ordered by it — sort
by `sort_key` for every type, artists included (no longer `sort_name ?? name`).

## Curated start views (069)
- `GET /v1/featured` → `{data: [{slug, title, intro_html, query}]}` — the published views of the start map, ordered by
  their position, then title. `query` is the start map's own URL query (`artists=vincent-van-gogh,paul-gauguin&
  movements=none&from=1886&to=1890`: keys `artists`, `artworks`, `movements`, `polities`, `people` with slugs, `none`,
  `all` (artworks also `by-artists`), and `from`/`to` years), always with the entries' current slugs (renamed and
  merged ones followed). `intro_html` may be null. Edited in the admin panel (Start views).

## Short addresses for long views (migration 072)
`POST /v1/views` with the start map's query as the body (`Content-Type: text/plain`, e.g.
`artists=vincent-van-gogh,paul-gauguin&from=1886&to=1890`) → `201 {id, query}`: the query stored once — keys sorted,
the site's switches `v` / `featured` / `all` dropped — and its code, the first 8 hex digits of its SHA-256 (one more on a
clash). The same selection always gets the same code. At most 20 000 characters; 60 new links per 10 minutes and
address (`429` beyond). `GET /v1/views/:id` → `{id, query}`, renamed entries followed (like `/v1/featured`), `404` for
an unknown code. The site shows `/?v=<id>` instead of a query longer than 300 characters.

## Search
`GET /v1/search?q=edo` — top 20 matches across all types: `{type, slug, name, kind, period, score}`.

## Vocabulary
`GET /v1/vocabulary` — relationship types: `code, label, inverse_label, category, is_physical_presence, is_symmetric,
subject_types, object_types, description, derived`. `category` is meant for map/graph layers and legends. `derived: true`
= computed, never entered as a relationship: `creator` (an artwork's main creator, graph only), `owned_by`, `kept_in`,
`transferred_to`, `held_by`, `commissioned` (from the provenance — a commission is the provenance's first step).

## Map (GeoJSON, `[longitude, latitude]`)
- `GET /v1/map/<type>/:slug` — one entity's places. Point features with `properties.layer`:
  `presence` (was physically there) or `association` (e.g. influenced by the culture of Japan — **not** travel),
  plus one `LineString` with `layer: "route"`: the dated presence stops in chronological order.
  An artwork's stops include `kept_in` (where it was with each owner, from the provenance) — its journey from owner
  to owner. Stops and route are ordered by the period as a range: an open start ("until 1912") comes first.
- Artworks also have `provenance`: a FeatureCollection of the provenance in the **chain's order** (creation, the
  steps by position, the loan — like `provenance` on the artwork, not by date; every step, however patchy):
  - `layer: "provenance_stop"` (Point), one per step with a place: `step` / `steps` (number in the chain, of all),
    `kind` (`creation` · `step` · `loan`), `holder` `{type, slug, name}` or `holder_label`, `role`, `method`,
    `certainty`, `period`, `end_basis`, `provenance_id`, `place` `{slug, name}`, `precision` (the place's kind:
    `site` · `settlement` · `region` · `country`) and `place_basis` — how we know the place:
    `recorded` (the step's own) · `holder_seat` (an institution holder without a place: its seat; the loan) ·
    `created_in` (creation: the artwork's recorded place of creation, Wikidata P1071) · `artist_residence`
    (creation: the one place the artist is recorded at while it was made — say "probably") · `artist_workplace`
    (creation: else the artist's one undated "worked in" place — "probably" too).
  - `layer: "provenance_segment"` (LineString), between consecutive placed stops (none between two stops at the same
    point): `from_step`, `to_step`, `direct` (every handover on it documented as direct), `implied` (an end not
    recorded: creation, loan, or a place not recorded), `between` (the steps it passes over that have no place, same
    properties as a stop without the place ones).
  - `unplaced`: every step without a place (same properties), e.g. the creation when nothing says where it was made.
- `GET /v1/map/presence?from=1888&to=1889[&types=artist,person,artwork]` — who/what was physically where during
  the window (for a timeline slider); `institution` may be added to `types` (earlier locations via `located_in`). Undated links are left out.
- `GET /v1/map/places[?from=&to=]` — every place with `presence_count` and `association_count` (in the window).
- `GET /v1/map/events` — every event with a position: its area, else its exact spot, else its place's marker
  (`properties.precision`: `area` · `spot` · `place`), with `slug`, `name`, `kind`, `period`, `place`. An entity's own
  map (`/v1/map/<type>/:slug`) includes the events it took part in or depicts, as `association` stops with
  `properties.event`.

## Graph
`GET /v1/graph/<type>/:slug?depth=2&types=influenced_by,student_of` — the network around an entity, following
links both ways up to `depth` (1–4) hops. Default `types`: everything except place links (those are map material).
→ `{root, depth, types, truncated, nodes: [{id: "artist/…", type, slug, name, kind, depth, period}],
edges: [{source, target, type, label, category, symmetric, certainty, note, period, derived, end_basis}]}` — `id`/`source`/`target`
match, ready for d3-force or similar. At most 500 nodes (`truncated: true` beyond that).
An artwork's main creator is an edge of type `creator` (artwork → artist, category `collaboration`, label "creator"),
further creators `co_creator` — so artists and their works are connected in the network.
The provenance adds `owned_by` and `transferred_to` edges (collector ↔ dealer ↔ museum); `end_basis: "implied"` marks a
period whose end is only implied by the next acquisition (draw it dashed/faded). The category `provenance` can be
switched off like any other.
