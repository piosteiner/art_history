# Public read API (`/v1`)

Base URL `https://api.arthistory.piogino.ch/v1`. Read-only, JSON, CORS for `https://arthistory.piogino.ch`.
Responses are cacheable for 60 s (`Cache-Control`) and carry an `ETag`. Entities are addressed by **slug**.
Errors: `{"error": "bad_request" | "not_found" | "timeout" | "internal_error", "message": "…"}`.

## Dates
Every date is an object (or `null`):
```json
{"label": "20 February 1888–8 May 1889", "from": "1888-02-20", "to": "1889-05-08", "from_year": 1888, "to_year": 1889}
```
`to` is inclusive. BCE years are negative (`-500`); BCE ISO dates start with `-`. Open ends are `null`.
Show `label` to people, use `from`/`to` for timelines.

## Entities
Types (URL segment → `type`): `artists` → artist, `artworks` → artwork, `places` → place, `movements` → movement,
`institutions` → institution, `patrons` → patron.

### `GET /v1/<type>` — list
| Param | |
|---|---|
| `q` | name/title search: accent-insensitive, substring or fuzzy (`durer`, `hokusia`) |
| `from`, `to` | years; entities whose lifespan / creation / period overlaps (not for places) |
| `limit` (1–500, default 100), `offset` | paging; the response has `total` |
| artworks: `creator`, `institution` (slugs), `kind` · places: `kind`, `country` (ISO code) · movements, institutions: `kind` | filters |

→ `{"data": [...], "total": 4, "limit": 100, "offset": 0}`

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
  the window (for a timeline slider). Undated links are left out.
- `GET /v1/map/places[?from=&to=]` — every place with `presence_count` and `association_count` (in the window).

## Graph
`GET /v1/graph/<type>/:slug?depth=2&types=influenced_by,student_of` — the network around an entity, following
links both ways up to `depth` (1–4) hops. Default `types`: everything except place links (those are map material).
→ `{root, depth, types, truncated, nodes: [{id: "artist/…", type, slug, name, kind, depth, period}],
edges: [{source, target, type, label, category, symmetric, certainty, note, period}]}` — `id`/`source`/`target`
match, ready for d3-force or similar. At most 500 nodes (`truncated: true` beyond that).
