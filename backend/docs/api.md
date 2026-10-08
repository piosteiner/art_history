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

### Glossary (`/v1/glossary`, type `term`)
`name` (+ the name fields below), `category` (technique · architecture · material · iconography · style · format ·
other; filter `?category=`), `definition` (short, plain text), `description_html`, `images`/`image_url`, related
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
  Hiroshige / utagawahiroshige). List results are ordered by it (artists: `sort_name` first).
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

### Provenance (artworks)
The detail of an artwork has **`provenance`**: its owners in order, as the sources record them —
`[{position, owner: {type, slug, name} | null, owner_label, owner_name, acquired, ended, method, direct, label, certainty,
place: {slug, name} | null, period, end_basis, notes_html, sources}]`.
- `acquired` / `ended` are dates (`ended` only when a source records it); `method`: creation · commission · inheritance ·
  purchase · auction · gift · bequest · exchange · confiscation · forced_sale · restitution · unknown;
  `direct`: the handover from the previous owner is documented (false = possibly someone in between).
- `period` is **computed**: from the acquisition to … — `end_basis` says what:
  `recorded` (the step's own `ended`) · `implied` (the next owner's acquisition — show it differently, e.g. "(implied)")
  · `ongoing` (the current holder: open end) · `unknown` (nothing after it: only the acquisition, no invented end).
- Each step also appears as derived relationships: `owned_by` (artwork → owner), `kept_in` (artwork → place, category
  `presence`: part of the artwork's **route on the map**), `transferred_to` (previous owner → next owner, category
  `provenance`, label = the method; certainty `possible` when not documented as direct). People who owned something
  have the role `owner`.

## Search
`GET /v1/search?q=edo` — top 20 matches across all types: `{type, slug, name, kind, period, score}`.

## Vocabulary
`GET /v1/vocabulary` — relationship types: `code, label, inverse_label, category, is_physical_presence, is_symmetric,
subject_types, object_types, description, derived`. `category` is meant for map/graph layers and legends. `derived: true`
= computed, never entered as a relationship: `creator` (an artwork's main creator, graph only), `owned_by`, `kept_in`,
`transferred_to` (from the provenance).

## Map (GeoJSON, `[longitude, latitude]`)
- `GET /v1/map/<type>/:slug` — one entity's places. Point features with `properties.layer`:
  `presence` (was physically there) or `association` (e.g. influenced by the culture of Japan — **not** travel),
  plus one `LineString` with `layer: "route"`: the dated presence stops in chronological order.
  An artwork's stops include `kept_in` (where it was with each owner, from the provenance) — its journey from owner
  to owner.
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
