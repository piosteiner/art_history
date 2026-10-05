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
Dates may be as coarse as a century: "13th century" is `from: 1201-01-01, to: 1300-12-31`, "late 13th century"
1267–1300, "1880s" a decade. On a timeline draw the whole span (e.g. a faded bar) rather than a point, and sort by
`from` (or the midpoint); the `?from=&to=` filters match any overlap, so a century-dated work appears in every
window inside its century.

## Entities
Types (URL segment → `type`): `artists` → artist, `artworks` → artwork, `places` → place, `movements` → movement,
`institutions` → institution, `patrons` → patron, `polities` → polity.

### `GET /v1/<type>` — list
| Param | |
|---|---|
| `q` | name/title search: accent-insensitive, substring or fuzzy (`durer`, `hokusia`) |
| `from`, `to` | years; entities whose lifespan / creation / period overlaps (not for places) |
| `limit` (1–500, default 100), `offset` | paging; the response has `total` |
| artworks: `creator`, `institution` (slugs), `kind` · places: `kind`, `country` (ISO code) · movements, institutions: `kind` | filters |

→ `{"data": [...], "total": 4, "limit": 100, "offset": 0}`

Artworks also have `materials` (list; filter `?material=bronze`) and `dimensions`
(`{height_cm, width_cm, depth_cm, note, label: "73.7 × 92.1 cm"}`, `depth_cm` only for objects; a height alone —
a sculpture — has `width_cm: null` and `label: "50 cm (height)"`; `null` without data).

Artworks, artists and institutions carry an `image_url`: the main image (https, hotlinked — often Wikimedia Commons;
for a smaller version replace `/NNNNpx-` in a Commons thumbnail URL with a standard width such as `/250px-`), `null`
without images. The detail adds `images`, all of them in order (the first = `image_url`):
`[{url, source_url, license, credit, caption}]` — e.g. caption "Back view" for a sculpture. Show license and credit
wherever an image is shown.

### Names in several languages (every type)
- `<name>` (`name`, artworks: `title`) — plain text, as before. `<name>_lang` — its language (BCP 47: `ja`, `en`, `zh-Hant`) or `null`.
- `<name>_ruby_html` — the name with furigana as `<ruby>神奈川<rp>(</rp><rt>かながわ</rt><rp>)</rp></ruby>…` (escaped, safe
  to insert), `null` without; `<name>_reading` — the full reading (`かながわおきなみうら`).
- `names` — other names in order: `[{text, lang, role, ruby_html, reading}]`, role = `original` | `translation` |
  `romanization` | `alternative`. A romanization's lang is the language in Latin script (`ja-Latn`, `zh-Latn-pinyin`).
- `sort_key` — what to sort by: the first romanization, else the name. List results are ordered by it (artists:
  `sort_name` first).
- `alt_names` / `alt_titles` — all other names as plain strings (unchanged, for older clients).
Set `lang` on elements showing a name (`<h1 lang="ja">`) so the right font and pronunciation are used. `?q=` and
`/v1/search` also match other names and readings ("kanagawa oki", "Under the Wave", "かながわ").

### Countries and polities (artists, artworks, institutions, patrons)
Two different things, both in lists and details:
- `country` — the country **today**, derived from the entry's place: an artist's / patron's birthplace, where an
  artwork was created, where an institution is. A place without its own ISO code inherits the nearest parent's
  (Zundert → Netherlands). Without a place, it comes from the linked polities if they all lie in one modern country
  (a Han dynasty bronze → China).
  `{code: "NL", name: "Netherlands", slug: "netherlands"|null, source: "place"|"polity", place: {slug, name}|null}` or `null`.
  `slug` is the country's place entry if there is one.
- `polities` — the dated links to polities (states, empires, dynasties), in time order:
  `[{slug, name, kind, relationship: "nationality"|"created_in_polity"|"located_in_polity", period, polity_period, country_codes}]`.
  Nationality is entered by hand (an art-historical attribution) — not derived from the birthplace.
- Artists and patrons also have `birth_place: {slug, name, country_code}` (or `null`).

Show both together as e.g. **"Soviet Union (today Ukraine)"**: the polity's `name` + `country.name`. Don't derive "today"
from a polity's `country_codes` when there are several (the USSR covers 15 countries) — `country` already did the right thing.
Filters: `?country=NL` (today's country, ISO code) and `?polity=<slug>`.

Polities (`/v1/polities`): `kind`, `period` (when it existed), `country_codes` (modern countries on its territory;
filter `?country=UA`); the detail adds `ancestors` / `children` (Western Han ⊂ Han dynasty) and, as relationships,
everyone and everything linked to it ("nationality of" …).

### `GET /v1/<type>/:slug` — detail
All fields (Markdown already rendered to sanitized HTML as `*_html`), plus:
- `relationships`: every link in both directions, from this entity's point of view —
  `{type, direction: outgoing|incoming|mutual, label, category, is_physical_presence, entity: {type, slug, name, period}, period, note, certainty, notes_html}`.
  (Van Gogh: "lived in" Arles; Arles: "home of" Van Gogh.)
- artist: `artworks` · institution: `artworks`, `place` · artwork: `creator`, `institution` ·
  place: `ancestors` (Arles → France), `children`, `institutions` · movement: `ancestors`, `children`.

## Search
`GET /v1/search?q=edo` — top 20 matches across all types: `{type, slug, name, kind, period, score}`.

## Vocabulary
`GET /v1/vocabulary` — relationship types: `code, label, inverse_label, category, is_physical_presence, is_symmetric,
subject_types, object_types, description`. `category` is meant for map/graph layers and legends.

## Map (GeoJSON, `[longitude, latitude]`)
- `GET /v1/map/<type>/:slug` — one entity's places. Point features with `properties.layer`:
  `presence` (was physically there) or `association` (e.g. influenced by the culture of Japan — **not** travel),
  plus one `LineString` with `layer: "route"`: the dated presence stops in chronological order.
- `GET /v1/map/presence?from=1888&to=1889[&types=artist,patron,artwork]` — who/what was physically where during
  the window (for a timeline slider); `institution` may be added to `types` (earlier locations via `located_in`). Undated links are left out.
- `GET /v1/map/places[?from=&to=]` — every place with `presence_count` and `association_count` (in the window).

## Graph
`GET /v1/graph/<type>/:slug?depth=2&types=influenced_by,student_of` — the network around an entity, following
links both ways up to `depth` (1–4) hops. Default `types`: everything except place links (those are map material).
→ `{root, depth, types, truncated, nodes: [{id: "artist/…", type, slug, name, kind, depth, period}],
edges: [{source, target, type, label, category, symmetric, certainty, note, period}]}` — `id`/`source`/`target`
match, ready for d3-force or similar. At most 500 nodes (`truncated: true` beyond that).
