# Frontend

Static site for https://arthistory.piogino.ch: Vite + TypeScript, no UI framework, MapLibre GL JS for the map.
It reads the public API at `https://api.arthistory.piogino.ch/v1` ([reference](../backend/docs/api.md)).

```sh
cd frontend
npm install
npm run dev      # http://localhost:5173, /v1 is proxied to the live API (it only sends CORS headers for the real site)
npm run build    # type-check + build into dist/
npm test         # browser tests (Playwright) against the dev server → live API; locally: PW_CHANNEL=msedge npm test
```

Optional: copy `.env.example` to `.env.local` and set `VITE_MAPTILER_KEY` for MapTiler tiles. Without a key the
map uses OpenFreeMap (free, no key).

## Layout
| File | |
|---|---|
| `src/api.ts` | the **only** module that calls `fetch`; one function per endpoint, responses cached in memory |
| `src/types.ts` | response shapes, taken from real responses |
| `src/router.ts` | hash routes: `#/` explore, `#/artists` list, `#/artists/vincent-van-gogh` detail (Pages has no SPA fallback) |
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

## Map rule
Presence (was physically there) and association (e.g. influenced by the culture of Japan) come from the API's
`properties.layer`: presence = filled dots joined by the `route` line, association = hollow rings in another colour,
never on the route. Don't hard-code relationship type lists.

## Deploy
Push to `main` (changes under `frontend/`) → `.github/workflows/pages.yml` runs the browser tests, builds and publishes
to GitHub Pages; failing tests stop the deploy (the report is attached to the run). The tests use the live, curated
content but check behaviour, not exact numbers (fixed points: Van Gogh, The Great Wave, woodblock prints).
The repository's Pages source must be **GitHub Actions**; the MapTiler key is the repository variable `MAPTILER_KEY`
(restrict it to `arthistory.piogino.ch` and `localhost` in the MapTiler dashboard; it is public in the bundle anyway).

## Countries and polities
`country` = today's country (from the entry's place), `polities` = dated, hand-entered links (nationality, made in,
historically in). Shown together as "Soviet Union 1922–1991 (today Ukraine)" (`polityWithToday` in `src/html.ts`); the
"today" part is dropped when the polity's name already contains it ("Kingdom of the Netherlands"). Without polities the
detail shows "Country of birth / of origin". Sorts by country and nationality appear once any entry has the data.

## Explore page
Nothing chosen individually → every place (sized by links). Entries chosen → their routes, one colour each (same colour on
the timeline; at most 24 drawn). Time window → presence in the window, limited to the selection.

## Wishes for the backend
- `GET /v1/map/presence?…&entities=artist/vincent-van-gogh,patron/theo-van-gogh`: today the frontend filters single
  picks out of the full window response, which grows with the library.
- `GET /v1/map/routes?entities=…`: several entities' map data in one request (today one request per chosen entry).
- Lists beyond 500 entries: pickers and list pages load `limit=500` per type and sort in the browser; beyond that
  they need a server-side `sort=` parameter (name, born, died, country, date, …) with paging, and search-as-you-type.

## Next
Missing API features go to the backend as a written request rather than client-side stitching.
