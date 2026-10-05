# Frontend

Static site for https://arthistory.piogino.ch: Vite + TypeScript, no UI framework, MapLibre GL JS for the map.
It reads the public API at `https://api.arthistory.piogino.ch/v1` ([reference](../backend/docs/api.md)).

```sh
cd frontend
npm install
npm run dev      # http://localhost:5173, /v1 is proxied to the live API (it only sends CORS headers for the real site)
npm run build    # type-check + build into dist/
npm run prerender  # after build: per-entry pages, sitemap (reads the live API)
npm test         # browser tests (Playwright) against the dev server → live API; locally: PW_CHANNEL=msedge npm test
```

Optional: copy `.env.example` to `.env.local` and set `VITE_MAPTILER_KEY` for MapTiler tiles. Without a key the
map uses OpenFreeMap (free, no key).

## Layout
| File | |
|---|---|
| `src/api.ts` | the **only** module that calls `fetch`; one function per endpoint, responses cached in memory |
| `src/types.ts` | response shapes, taken from real responses |
| `src/router.ts` | path routes with the History API: `/` explore (state in the query), `/artists`, `/artists/vincent-van-gogh`, `/graph/…`; own links are handled without reloads, Ctrl/middle click still opens tabs; old `#/…` links are converted |
| `scripts/prerender.mjs` | after the build: one page per entry (`/artists/vincent-van-gogh/index.html`) with its own title, description, preview image (Open Graph) and schema.org data, list pages, `sitemap.xml`, `robots.txt`, and `404.html` = the app shell for addresses without a page (network views, entries newer than the last build) |
| `src/html.ts` | `html\`\`` template that escapes values; `trusted()` only for the API's sanitized `*_html` fields; image figure with credit + licence |
| `src/map.ts` | MapLibre setup; one entity's presence stops + route + associations, all places, presence in a time window |
| `src/catalog.ts` | one search for pickers, list pages and the header: accent-insensitive, every word must match the name, the details or a hidden field (type, birthplace, nationality, made in …); matches are highlighted and a hidden field that matched is named ("Type: **wood**block print"). List pages and the header add the API's typo-tolerant name matches as "Similar names". Also the sort options with section headings per type (remembered per type) |
| `src/selection.ts`, `src/picker.ts` | explore page: per type all / none / chosen entries ("Show" dropdowns); stored in the URL (`#/?artists=a,b&movements=none&from=1888&to=1889`) and remembered in localStorage |
| `src/timeline.ts` | SVG timeline of lifespans/periods: window by dragging across the bars, clicking a bar or typing from/to years; zoom (− / + / Fit, Ctrl+wheel, pinch, keys) and pan (◀ ▶, dragging the year axis, sideways wheel, arrow keys) |
| `src/views/graph.ts` | network graph (`#/graph/<type>/<slug>?depth=&categories=`) with d3-force: click = details, double-click = recenter, Ctrl+click = new tab |
| `src/theme.ts` | Auto / Light / Dark toggle (follows the system by default); maps use the matching base map |
| `tests/` | Playwright smoke tests (desktop + phone); run in the Pages workflow before every deploy |
| `src/views/` | explore (map + timeline), list, detail (all types), graph |
| `public/` | copied as is: `CNAME`, `health.html` (CORS round-trip check) |

## Privacy
`/privacy` (`src/views/privacy.ts`, Swiss FADP Art. 19 / FMG Art. 45c): the site sets **no cookies** (images load
with `crossorigin="anonymous"`, so Wikimedia neither gets nor sets cookies; MapLibre fetches MapTiler without them) and
only keeps preferences in localStorage (`arthistory:*`). When a third-party service, a stored value or the API's
log retention (14 days) changes, update that page and its date. No consent banner is needed while this holds.

## Map rule
Presence (was physically there) and association (e.g. influenced by the culture of Japan) come from the API's
`properties.layer`: presence = filled dots joined by the `route` line, association = hollow rings in another colour,
never on the route. Don't hard-code relationship type lists.

## Deploy
Push to `main` (changes under `frontend/`) → `.github/workflows/pages.yml` runs the browser tests, builds and publishes
to GitHub Pages (also daily at 03:17 UTC, so new content gets its page and preview); failing tests stop the deploy (the report is attached to the run). The tests use the live, curated
content but check behaviour, not exact numbers (fixed points: Van Gogh, The Great Wave, woodblock prints).
The repository's Pages source must be **GitHub Actions**; the MapTiler key is the repository variable `MAPTILER_KEY`
(restrict it to `arthistory.piogino.ch` and `localhost` in the MapTiler dashboard; it is public in the bundle anyway).

## Countries and polities
`country` = today's country (from the entry's place), `polities` = dated, hand-entered links (nationality, made in,
historically in). Shown together as "Soviet Union 1922–1991 (today Ukraine)" (`polityWithToday` in `src/html.ts`); the
"today" part is dropped when the polity's name already contains it ("Kingdom of the Netherlands"). Without polities the
detail shows "Country of birth / of origin". Sorts by country and nationality appear once any entry has the data.

## Explore page
Nothing chosen individually → every place, sized by what the *selection* did there, plus a route per selected artist,
patron and artwork through its dated presence stops (one `/v1/map/presence` request over all time, coloured by type;
hover = highlight + name, click = stops). Clicking a place lists what happened there (who, what, when, note). Entries chosen → their routes, one colour each (same colour on
the timeline; at most 24 drawn). Time window → presence in the window, limited to the selection.

## People
Formerly patrons (API migration 024): `/people`, type `person`, with kind, occupations, life dates (else `active`)
and derived `roles` (patron, owner, depicted). Old `/patrons/…` addresses and `patrons=` in explore links are converted.
The graph has the category `depiction` (`depicts_person`).

## Names in several languages
The display name (`name`, artworks `title`) may be the original or a translation: elements showing a name get
`lang` (`*_lang`, each `names` entry's lang); detail pages add the original (`names` role `original`, with `ruby_html` furigana)
and its romanization below the title; cards show the original small. Search in pickers, list pages and the header
also matches all `names`, readings and the API's `search_text` (shown as "Other names: …"); name sorts use `sort_key`
(artists: `sort_name` first). Nothing is romanized in the frontend.

## Crossed paths
`src/encounters.ts` finds pairs at the same place with overlapping dates in the dated presence links (left out: a
work with its own artist, two works). Shown under the explore map (`src/crossings.ts`; respects the pickers and the
time window), as a yellow halo on the map, in place popups ("At the same time here") and on artist / patron / artwork /
place pages. Overlaps based on year-only or "c." dates are marked "possibly".

## Wishes for the backend
- **Encounters in SQL** (for when the library is large; also a nice PostgreSQL exercise): `GET /v1/encounters?from=&to=&types=`
  = a self-join of presence links on `place_id` with `a.period && b.period` (daterange overlap, GiST index) and
  `a.period * b.period` as the overlap; today the browser does this over the full presence list.
- **Artwork provenance on the map:** artworks only have `created_in` as presence today; where a work was kept later
  (`housed_at` an institution, `owned_by` a patron, dated) and where it is now (its institution's place) are not map
  data, so an artwork's journey can't be drawn. Wish: include them in `/v1/map/artworks/:slug` and `/v1/map/presence`
  as presence stops at the institution's / owner's place (with the provenance period; the current location undated or
  "since …").
- **Bug:** `/v1/map/presence?from=-5000` answers `internal_error` (PostgreSQL dates start at 4713 BC); clamp or
  return `bad_request`. The frontend uses -3000.
- `GET /v1/map/presence?…&entities=artist/vincent-van-gogh,person/theo-van-gogh`: today the frontend filters single
  picks out of the full window response, which grows with the library.
- `GET /v1/map/routes?entities=…`: several entities' map data in one request (today one request per chosen entry).
- Lists beyond 500 entries: pickers and list pages load `limit=500` per type and sort in the browser; beyond that
  they need a server-side `sort=` parameter (name, born, died, country, date, …) with paging, and search-as-you-type.

## Next
Missing API features go to the backend as a written request rather than client-side stitching.
