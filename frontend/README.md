# Frontend

Static site for https://arthistory.piogino.ch: Vite + TypeScript, no UI framework, MapLibre GL JS for the map.
It reads the public API at `https://api.arthistory.piogino.ch/v1` ([reference](../backend/docs/api.md)).

```sh
cd frontend
npm install
npm run dev      # http://localhost:5173, /v1 is proxied to the live API (it only sends CORS headers for the real site)
npm run build    # type-check + build into dist/
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
| `src/selection.ts`, `src/picker.ts` | explore page: per type all / none / chosen entries ("Show" dropdowns); stored in the URL (`#/?artists=a,b&movements=none&from=1888&to=1889`) and remembered in localStorage |
| `src/timeline.ts` | SVG timeline of lifespans/periods; drag to pick a window, click a bar to use its span |
| `src/views/` | explore (map + timeline), list, detail (all six types) |
| `public/` | copied as is: `CNAME`, `health.html` (CORS round-trip check) |

## Map rule
Presence (was physically there) and association (e.g. influenced by the culture of Japan) come from the API's
`properties.layer`: presence = filled dots joined by the `route` line, association = hollow rings in another colour,
never on the route. Don't hard-code relationship type lists.

## Deploy
Push to `main` (changes under `frontend/`) → `.github/workflows/pages.yml` builds and publishes to GitHub Pages.
The repository's Pages source must be **GitHub Actions**; the MapTiler key is the repository variable `MAPTILER_KEY`
(restrict it to `arthistory.piogino.ch` and `localhost` in the MapTiler dashboard; it is public in the bundle anyway).

## Explore page
Nothing chosen individually → every place (sized by links). Entries chosen → their routes, one colour each (same colour on
the timeline; at most 24 drawn). Time window → presence in the window, limited to the selection.

## Wishes for the backend
- `GET /v1/map/presence?…&entities=artist/vincent-van-gogh,patron/theo-van-gogh`: today the frontend filters single
  picks out of the full window response, which grows with the library.
- `GET /v1/map/routes?entities=…`: several entities' map data in one request (today one request per chosen entry).
- Lists beyond 500 entries: the pickers load `limit=500` per type; with more, they need search-as-you-type instead.

## Next
Graph view (`/v1/graph/…`, d3-force or Cytoscape). Missing API features go to the backend as a written request
rather than client-side stitching.
