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

Against the backend's dev server instead of the live API (frontend and backend changes tested together, before
either is deployed): `API_TARGET=http://localhost:3005 npm run dev` (or `npm test`; also settable in `.env.local`).
The prerender reads `API_BASE` the same way (`API_BASE=http://localhost:3005/v1 npm run prerender`).

Optional: copy `.env.example` to `.env.local` and set `VITE_MAPTILER_KEY` for MapTiler tiles. Without a key the
map uses OpenFreeMap (free, no key).

## Layout
| File | |
|---|---|
| `src/api.ts` | the **only** module that calls `fetch`; one function per endpoint, responses cached in memory |
| `src/types.ts` | response shapes, taken from real responses; `tests/api-types.spec.ts` checks every endpoint against them (JSON Schema generated from this file), so a changed API fails the tests |
| `src/router.ts` | path routes with the History API: `/` explore (state in the query), `/artists`, `/artists/vincent-van-gogh`, `/graph/…`; own links are handled without reloads, Ctrl/middle click still opens tabs; old `#/…` links are converted; each history entry keeps its scroll position (back/forward and reload return there once the view has grown tall enough) |
| `scripts/prerender.mjs` | after the build: one page per entry (`/artists/vincent-van-gogh/index.html`) with its own title, description, preview image (Open Graph) and schema.org data, list pages, `sitemap.xml`, `robots.txt`, and `404.html` = the app shell for addresses without a page (network views, entries newer than the last build) |
| `src/html.ts` | `html\`\`` template that escapes values; `trusted()` only for the API's sanitized `*_html` fields; image figure with credit + licence |
| `src/zoom.ts` | the enlarged image (lightbox): wheel zooms smoothly towards the pointer (eased per frame), drag pans, two fingers pinch, double-click fit / 2.5×, + − 0 keys; never off its edges or below fit. A click beside the image (or Escape, ×) closes — a click on it no longer does |
| `src/map.ts` | the map views: one entity's presence stops + route + associations, all places, presence in a time window, chosen entries, crossed paths, sites, events (re-exports what pages need from the two below) |
| `src/map-core.ts` | MapLibre setup, light/dark restyle, shared helpers (sources, popups, route arrows) |
| `src/map-provenance.ts` | an artwork's provenance on a map: numbered stops, direct / undocumented / implied segments, unplaced steps, `provenanceInWindow` |
| `src/catalog.ts` | one search for pickers, list pages and the header: accent-insensitive, every word must match the name, the details or a hidden field (type, birthplace, nationality, made in …); matches are highlighted and a hidden field that matched is named ("Type: **wood**block print"). List pages and the header add the API's typo-tolerant name matches as "Similar names". Also the sort options with section headings per type (remembered per type) |
| `src/selection.ts`, `src/picker.ts` | explore page: per type all / none / chosen entries ("Show" dropdowns); stored in the URL (`#/?artists=a,b&movements=none&from=1888&to=1889`) and remembered in localStorage |
| `src/timeline.ts` | SVG timeline of lifespans/periods: window by dragging across the bars, clicking a bar or typing from/to years; zoom (− / + / Fit, Ctrl+wheel, pinch, keys) and pan (◀ ▶, dragging the year axis, sideways wheel, arrow keys) |
| `src/views/graph.ts` | network graph (`#/graph/<type>/<slug>?depth=&categories=`) with d3-force: click = details, double-click = recenter, Ctrl+click = new tab |
| `src/theme.ts` | Auto / Light / Dark toggle (follows the system by default); maps swap to the matching base map in place (`THEME_EVENT`; `src/map-core.ts` carries its sources and layers into the new style), the page isn't re-rendered |
| `tests/` | Playwright smoke tests (desktop + phone); run in the Pages workflow before every deploy |
| `src/views/` | explore (map + timeline), list, detail (all types: `detail.ts` the page, `detail-facts.ts` the fact rows per type and their sources, `detail-sections.ts` provenance, relationships, backlinks, crossed paths), graph, `numbers.ts` the provenance-number lookup |
| `public/` | copied as is: `CNAME`, `health.html` (CORS round-trip check) |

## Privacy
`/privacy` (`src/views/privacy.ts`, Swiss FADP Art. 19 / FMG Art. 45c): the site sets **no cookies** (images load
with `crossorigin="anonymous"`, so Wikimedia neither gets nor sets cookies; MapLibre fetches MapTiler without them) and
only keeps preferences in localStorage (`arthistory:*`). When a third-party service, a stored value or the API's
log retention (14 days) changes, update that page and its date. No consent banner is needed while this holds.

## Accessibility
After a navigation inside the site, focus moves to the new page's `<h1>` once it has rendered (not on the first load,
not if the reader has moved focus meanwhile); "Skip to content" is the first Tab stop. With the system's reduced
motion setting there is no smooth scrolling or CSS animation and the network is shown laid out (MapLibre's flights
follow the setting by themselves). `reducedMotion()` in `src/theme.ts`.

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
patron and artwork through its dated presence stops (one `/v1/map/presence` request over all time; one colour per route
from a 12-colour palette in a stable order, named in the legend (hover/click highlights), same colour on the timeline
and in popups;
hover = highlight + name, click = stops). Clicking a place lists what happened there (who, what, when, note). Entries chosen → their routes, one colour each (same colour on
the timeline; at most 24 drawn). Time window → presence in the window, limited to the selection, plus the routes through
the stops inside the window. The full-screen button on the map (every map) enlarges the map together with its legend and layer
switches (`createMap(container, fullscreen)`; on iPhone, without a Fullscreen API, it fills the window). A remembered view (time window, picks) says so above the map, with "Start fresh". A time window is also named in a chip above the map ("Time window 1888–1889 ✕"; on a phone the timeline that set it is far below); the picks are named by the pickers' own buttons.

**Curated views** (`GET /v1/featured` → `{data: [{slug, title, intro_html, query}]}`, published only, by position then
title; backend table `featured_views`, edited in the admin panel; built 2026-10-14): `/` shows the first view with a
switcher and its intro, the others at `/?featured=<slug>` (an unknown slug shows the first), everything at `/?all`.
A view is the start map's own URL query (current slugs, only the start map's keys); changing the picks or the window
makes it your own. Without published views (or without the API) `/` shows everything.

## People
Formerly patrons (API migration 024): `/people`, type `person`, with kind, occupations, life dates (else `active`)
and derived `roles` (patron, owner, depicted). Old `/patrons/…` addresses and `patrons=` in explore links are converted.
The graph has the category `depiction` (`depicts_person`).

## Glossary
`/glossary` (A–Z with letter headings, category buttons, also as `?category=`) and `/glossary/<slug>` (definition as lead, text,
images, related terms, "Used in"). Links in any `*_html` (`a.glossary-link`) get a popover from the detail's `glossary` map
(`src/glossary.ts`: hover/focus; on touch the first tap shows it, "Read more" navigates); `missing` terms become plain
dimmed text, never dead links. Links to other entries (`a.entry-link`, `[[type/slug]]` in the admin, migration 030) go to
the site's own addresses and are followed by the router; `missing` ones become dimmed text too. Every detail page lists
its backlinks (`mentioned_in`) as "Mentioned in", a term's as "Used in".

**Previews on links**, like Wikipedia's (name, type, subtitle, opening sentences, image on the right): `a.entry-link` from
the detail's `entries` map (`src/glossary.ts`); every other internal link (fields, relationships, map popups, the graph
panel) from `GET /v1/previews` (`src/previews.ts`: a MutationObserver on `#app` collects the links as views render and
fetches what isn't known in one request per 100). Mouse: after a 250 ms pause; keyboard: on focus; touch: on entry pages
the first tap shows it. Not on the header, breadcrumbs, previous/next, buttons, list cards, the explore pickers or the
page's own link.

## Creators and provenance
- Several creators (migration 028): `creators` (main first). The artwork page shows them one per line with their part
  ("(landscape)") and uncertainty; an `attribution_label` ("Workshop of Rubens") stands instead of the main creator's
  name, linked to the creator. Artist pages tag co-created works; cards, pickers ("by chosen artists") and crossed paths
  count every creator (`creatorsOf()` in `src/html.ts`). `co_creator` relationships aren't repeated under Collaboration.
- Provenance (migration 031): "Provenance" on artwork pages — owners in order with method, place, notes and sources;
  a period whose end is only implied by the next acquisition (`end_basis: implied`) gets an "end implied" tag, a
  handover not documented as direct a dashed rail with "handover not documented". The derived `owned_by` / `kept_in`
  relationships aren't repeated below it; on owners' pages they carry the same tag. In the graph, implied edges are
  dashed and faded. The artwork's map route includes its `kept_in` stops without frontend changes.
- Holders' pages (collectors, dealers, museums): "Works held" — one line per artwork with every period it was held
  (the owner's own and the estate's), "commissioned" / "held, not owned" tags; then "Acquired from" / "Passed on to",
  one line per counterpart with how many works and when (`holdingsSections()` in `detail-sections.ts`). These
  `owned_by` / `held_by` / `commissioned` / `transferred_to` links aren't listed again under Provenance.
- Custody and status (API 073/074): agents and custodians (`in_chain: false`) are indented and muted on the rail —
  "held by Galerie Moos (agent)" beside the owner, never a new owner, never a "handover not documented"; `not_sold` →
  a "not sold" tag; an owner's `via` → "via Galerie Moos" in the how-line; method `settlement` with an explaining
  tooltip. The loan's lender is the last owner in the chain. `provenance_status` (Swiss Federal Office of Culture
  categories A–D for 1933–1945) stands under the Provenance heading as a lettered badge in the category's colour
  (`--prov-a`…`--prov-d`) with the label, the source's wording and its sources (not as a fact row); also without any
  steps. `conceived` makes the Date row "designed 1893–1894, printed 1921" ("cast" for bronzes, else "made").
  The artworks list filters by `provenance_category` (`?provenance=D`; shown once any work is assessed).
  `copy_after` ("copy after" / "copied in") and the graph's handovers past custodians need nothing here: labels and
  edges come from the API.
- The cases of API 076/077: `role: event` steps (no holder) are a • note on the rail in italics — their `label`, a party
  linked when the label doesn't name it — never a holder. `theft` on a custody step: "taken by …", "stolen", or
  "stolen — recovered <ended>"; no role tag. Roles `publisher` (of the chain), `foundry`, `trustee` (custody) get tags.
  `further_places`: "in Köln → Berlin (1933) → Geneva"; `numbers`: "Munich no. 4317", the number linked to
  `/provenance-numbers?number=4317&kind=munich` (`src/views/numbers.ts`, `GET /v1/provenance-numbers`; the header search
  and `/search` offer the lookup for any query with a digit); `event`: "at <event>". Prices in RM need nothing. On the map a step
  has a stop at each of its places (`part`, popup "moved here" + `part_label`), the segments between them
  (`move: true`) are drawn solid, their popup says "moved by the same holder"; segment ends are named by position.
- As it happened (API 083/084): `role: possessor` (held without good title — seized, looted, stolen, or received from
  those who took it) is indented like custody but tinted red with a red edge and dot, "taken by …" (confiscation,
  theft, forced sale) or "held by …", a red "without title" tag — never an owner; the owner's period runs on until the
  restitution (API). Holders' pages tag such works "held without title" (from the `held_by` note "possessor …").
  `exchanged_for` → "exchanged for <work>" (linked; replaces the method word "exchange"; left out when only text the
  label already says); the artwork's own outgoing `exchanged_for` relationship isn't repeated below. `alternatives` →
  a dashed box under the step: "Another reading (sources disagree): <holder> <role> <acquired – ended> <certainty>
  <sources>", method and label, notes. The graph's derived `exchanged_for` edge needs nothing here.
- What the dates imply (API 086): each of a step's `inferences` is a line under it, in italics after a dotted
  "derived" tag (tooltip: not stated by a source) — `narrowed` ("by 8 May 1903 at the latest"), `from_estate`,
  `travelled`. On the artwork's map the `travelled` distance labels the segment into that step ("≈ 14,393 km", matched
  by the stops' `position`; no label when the previous place isn't on the map, as for a creation in Atuona) and every
  inference stands in that stop's popup. The narrowed window doesn't change the coverage bar yet (backend wish).
- Records (API 104, `records()` in `src/views/detail-sections.ts`): under a step, its inventory entries, catalogues,
  exhibitions and sightings — "1700 · royal inventory · Madrid, summer office · no. 286", the source's doubts as tags
  (the number, or the whole entry), numbers linked to `/provenance-numbers`; more than three folded in a `<details>`.
  Their places reach the map through the API's provenance stops (nothing to do here).
- Coverage (API 078, `src/coverage.ts`): above the provenance a bar from the creation until today — documented solid,
  presumed hatched, gaps open with a red edge (1933–1945 ones filled pale red), 1933–1945 shaded behind; each stretch's
  tooltip names the holders before / after and the candidates; caption "45% documented, gaps 60 years, 11 of them in
  1933–1945" + key. Only with a recorded provenance. In the list a gap line ("Gap 1934–1946 — no holder known ·
  possibly …") goes after the step whose `position` = `before_position` (none or unknown: first), highlighted with a
  "1933–1945" tag when `in_1933_1945`; the next step then drops its "handover not documented" label. The stretches'
  `period.label` is null: `years()` builds "1934–1946" (type `Stretch`). Map: a "? 1934–1946" marker mid-segment for a
  segment's `gaps` (red in 1933–1945, popup with candidates and sides), `provenance.gaps` listed under the map.
  Artworks list: toggle "Works with open questions 1933–1945" (`?provenance_gap=1933-1945`, from the list's
  `provenance_coverage.gap_1933_1945`, combinable with the category; works without any provenance count too, as in the
  API). `documented_percent` is null on works without provenance.

## Start, end and fate on an artwork's map (API 103)
On an artwork's own map (`showProvenance` → `drawProvenance(…, { ends })`) the first and last placed stop are framed
and captioned: "start" (or "first known place" when the first steps have no place) and "today" (the last step is the
provenance's last and still runs) or "last known place". A destroyed or lost work (`fate`, API 103) always ends at its
"last known place"; its fate is said under the title ("· destroyed 1945") and in the "Fate" fact row with its sources.

## Series and other wholes (API migration 037)
A part's page: "No. 21 of 36 in <whole>" (the chain upwards) and previous/next links; a whole's page: a grid of its parts.
Artwork cards show "No. 21 · <series>"; sort "Series" (series title, then the number); `/artworks?part_of=<slug>` lists one
whole's parts. `published` appears as "Publication" (also a graph filter, "Publishers"). `src/series.ts`.

## Bibliography and footnotes
`/bibliography` (A–Z by short reference, reading statistics, filter by reading status `?status=`) and `/bibliography/<slug>`
(citation, notes, "Cited in"). In any `*_html`: footnote numbers `sup.fn-ref` and short references `a.source-link` get popovers
(the note's text; the citation from the detail's `bibliography` map), `src/glossary.ts`. Footnote jumps (`#…-n1`) only change
the hash: the router leaves them to the browser (no re-render); targets have `scroll-margin-top` for the sticky header.

## Names in several languages
The display name (`name`, artworks `title`) may be the original or a translation: elements showing a name get
`lang` (`*_lang`, each `names` entry's lang); detail pages add the original (`names` role `original`, with `ruby_html` furigana)
and its romanization below the title; cards show the original small. Search in pickers, list pages and the header
also matches all `names`, readings and the API's `search_text` (shown as "Other names: …"); name sorts use `sort_key`
(artists: `sort_name` first). Nothing is romanized in the frontend.

## Exact locations (API migration 034)
Stays at an institution or an immovable artwork carry `institution` / `artwork` and `place` = the city: routes and
time-window circles use the venue's own point (one circle per venue), popups name it. Crossed paths at the same venue =
"could have met there" (listed first, halo at the venue), same city only = "in the same city at the same time".
`/v1/map/sites` is the switchable "Museums and sites" layer on the start map; institution pages show the address and
their own point, immovable artworks where they stand; `houses` appears as "Buildings" (also a graph filter).

## Events (API migration 047)
`/events` (cards with date, kind, place; filter buttons by kind, `?kind=trial`) and `/events/<slug>`: date, kind, place,
"part of" and its parts in time order; "Participants" with their role ("Some Official (fire commissioner)"), "What it
concerns", "Works depicting it"; the map shows the area it covered or its spot (event colour), else only its city;
"Show on the map and timeline" opens the start page with the event's years as the window. Elsewhere a participation
reads "took part in … (defendant)", and a person's map popups name the event at a stop ("The Bührle trial, Lausanne").
Start page: an **Events** layer (switchable, on top of everything, a dot in the middle of an area so it shows on a
world map; events known only by their city sit a little off the city's dot) that follows the time window
("Events (1 in 1960–1980)"), and an "Events" group on the timeline while the layer is on. Graph: event nodes and the
`event` category (took part in, concerns). Prerendered pages and schema.org `Event` data for `/events/<slug>`.

## Translations (API migration 052)
Own translations in [square brackets] everywhere a name is shown (heading, cards, search, "Also known as");
official ones get an "official" tag. An artwork whose title is itself a common or own translation shows an official
translation in the same language instead (the stored title moves to "Also known as"); a title in its original
language stays the heading. Under the heading: "Official English title" / "Own English translation of the title" with
the source marker (`sources.title_status`, or `sources.names` for a preferred official translation). `displayName`,
`otherNames`, `titleStatusLine` in `src/html.ts`; the same rule in `scripts/prerender.mjs`.

## Sources for facts (API migrations 049/050)
`src/cite.ts`: after a sourced value (fact rows, relationships, provenance steps) a small marker with one letter per kind
of source, the most reliable first — P primary · L literature · M museum/collection · D other database · W Wikidata ·
T a note in words. Hover, keyboard focus or a tap opens the citations: short form linked to the exact page (or the
Wikidata item), accessed date, the full reference from the detail's `bibliography`, the note. `outdated` citations get
no marker and are listed last, muted ("value changed since"). Which row shows which field: `FIELD_FACT` in
`views/detail-facts.ts`; a sourced field without a row gets one of its own.

## Crossed paths
`src/encounters.ts` finds pairs at the same place with overlapping dates in the dated presence links (left out: a
work with its own artist, two works). Shown under the explore map (`src/crossings.ts`; respects the pickers and the
time window), as a yellow halo on the map, in place popups ("At the same time here") and on artist / patron / artwork /
place pages. Overlaps based on year-only or "c." dates are marked "possibly".

## Public numbers and addresses (API 085)
Entry pages live at `/<plural>/<public_id>/<slug>` (`path` in every detail). The router takes `/<plural>/<number>[/<slug>]`
and the old `/<plural>/<slug>`; `detail()` loads by number or slug and then replaces the address with `path` (an old
slug address, a renamed slug — the number decides — or `?query` / `#hash` kept). A number of another type: the API
answers with that entry (301 followed by `fetch`) and the page navigates to its own type's address. Links: `api.ts`
remembers the `public_id` of every typed reference (`{type, slug, public_id}`: relationships, provenance owners and
co-owners, backlinks, search, previews) and every list row (typed by its list) as responses arrive; `href()` builds
the numbered address when the number is known and falls back to the slug address (which redirects) otherwise —
no caller passes numbers. `guard()` follows navigations (`routeGeneration()` in `router.ts`), not the address, so a
view may replace its own address; `replaceUrl()` keeps the router's idea of the page on screen in step, so a jump to
`#note` doesn't re-render. Static pages (`scripts/prerender.mjs`): the page at `path/` (canonical, sitemap — with the
slash GitHub Pages serves a folder's page at), small forwarding pages at the old `/<plural>/<slug>/` and at
`/<plural>/<number>/` (refresh + canonical; Pages can't answer 301), numbered links on the list pages and in JSON-LD.

## Search, network questions and versions (API 087–089)
- `/search` (`src/views/search.ts`) is full-text search (`GET /v1/search/text`): one row per entry — the name linked to
  `path`, a badge for `matched_in` (name · text · provenance), `headline_html` inserted as is (escaped by the API, only
  `<mark>`), type chips (`?type=artwork`; the older plural `?type=artworks` still works), 20 per page (`?page=2`). A
  hit links to its entry with the passage's marked words as `?hl=word+word` (not for name hits), a provenance hit also
  with `#provenance-<provenance_ids[0]>`: the entry page (`src/highlight.ts`) outlines that step (`.search-target`),
  marks the words in it — or, for a text hit, all over `.detail-main` — and keeps the step or first mark in view while
  images load. The header's completion stays the quick name search (`/v1/search` + the field search of `findAll`).
- Entry pages (`src/views/detail-network.ts`): "How are they connected?" — a "Connect to…" picker over every entry
  (`findAll`), then `GET /v1/network/path` drawn top to bottom ("A — owned by → B", period, note; "No connection
  within 6 steps"). Artworks: "Through the same hands" (`/v1/network/shared-hands?depth=2`) — depth 1 grouped by holder
  ("also held by Emil Georg Bührle:", one "at the same time" line and one "at other times" line, more than 8 folded),
  depth 2 in a closed "Further: …" with "via …"; a checkbox asks again with `current=1`. "Cite this version"
  (`/v1/history/…`): newest version by default, any other from a list; the citation "“Name.” Art History, no. 100476,
  version of 16 October 2026 at 17:29:26 (Zurich time). https://…/artworks/100476/<slug>?as_of=<as_of as given, with
  microseconds> (accessed …)", a Copy button, "Open this version →". Moments are shown in Zurich time but never parsed
  back: `as_of` goes out exactly as it came.
- `?as_of=` on an entry address (`src/views/asof.ts`): the answer is the stored record, not the normal detail — a
  banner "As recorded on … — N changes since · see the current version" (or "this entry no longer exists"), the name,
  texts as entered (Markdown as text), the stored fields (dates by their `*_label`, keys and bookkeeping hidden),
  provenance steps by position (alternative readings indented, possessors red) and relationships with the other
  entries as they are now. 404 → "Not recorded yet then" (with `first_recorded`), 400 → "No such version" + the API's
  message. `ApiError.body` keeps the whole error answer for this.
- `/provenance/1933-1945` (any window: `/provenance/<from>-<to>`, `src/views/hands.ts`): `GET /v1/network/hands` —
  holders, most works first, roles as tags, possessors and flagged holders in red (`hands-flagged`), their works (6, the
  rest folded); the handovers dated in the window. Linked from the artworks list (beside "Works with open questions")
  and from an artwork's 1933–1945 status line; prerendered and in the sitemap.

## Spatial history and prices (API 090–091)
- Travel: under an artwork's provenance map, `travel` as "Travelled ≈ 2,232 km over 12 of 15 steps" (tooltip: the
  moves between different places); nothing when `travel` is null.
- Crossed paths on entry pages (`crossedPaths` in `detail-sections.ts`) come from `GET /v1/map/encounters?entity=` and
  are turned into the same `Encounter` shape (`fromApi` in `src/encounters.ts`), so they read as before. A checkbox
  "nearby too (≤ 50 km)" asks again with `within_km=50` ("Paris and Saint-Denis (≈ 12 km apart) · nearby at the same
  time"); with nothing at the same place the nearby ones are offered at once, and the section stays hidden only when
  both are empty. The browser's own `findEncounters` still serves **place pages** (the API has no place filter —
  backend wish), the start map, and any page where the API fails.
- Start map zoomed out (`showClusters` in `map.ts`, `drawClusters` in `explore.ts`): below zoom 6 and without single
  picks, `GET /v1/map/clusters?zoom=<rounded>&from=&to=` replaces the place dots (and the window's presence dots) with
  numbered bubbles — the number is stays, the tooltip the top places; a click fits the group's `bbox`. Refetched on
  `zoomend` and after every map update (a new window). They count every stay, not the selection, so they stay away when
  entries are picked; the routes stay drawn underneath.
- Prices: `chf_today` (always null until rates are loaded) is not shown; AFRF reads "French francs (before 1960)".

## Wishes for the backend
- **Maps and networks by number (085):** `/v1/map/<plural>/<number>` and `/v1/graph/<plural>/<number>` answer 404, so an
  entry opened by its number loads its map only after the entry (to learn the slug) — one round trip later.
- **Coverage from narrowed windows (086):** a `narrowed` inference ("by 8 May 1903 at the latest") could shorten its
  step's stretch on the coverage bar, but the bar's `segments` don't say which step they belong to — so it is best done
  in `provenance_coverage` itself.
- **Encounters at a place (091):** `/v1/map/encounters` filters by one entry, not by a place; place pages ("Crossed
  paths here") and the start map's list therefore still compute them in the browser. A `place=` filter (and one for a
  set of entries — the start map's selection) would let the browser's `findEncounters` go.
- **`end_basis` on map stops:** `/v1/map/…` features don't carry `end_basis` yet, so a `kept_in` stop whose end is
  only implied can't be drawn differently on the map (the detail page and the graph do mark it).
- **Bug:** `/v1/map/presence?from=-5000` answers `internal_error` (PostgreSQL dates start at 4713 BC); clamp or
  return `bad_request`. The frontend uses -3000.
- `GET /v1/map/presence?…&entities=artist/vincent-van-gogh,person/theo-van-gogh`: today the frontend filters single
  picks out of the full window response, which grows with the library.
- **Holdings with their counterparts:** a holder's `transferred_to` links don't say which artwork changed hands, so
  "Works held" can't say "from Fritz Nathan, 1948 (purchase) → to the Foundation, 1960" per work. Wish: `holdings` on
  person / institution details from `provenance_chain` — per step the artwork, role, method, price, period and the
  previous and next holder (`lag()` / `lead()` over the chain, partitioned by artwork).
- `GET /v1/map/routes?entities=…`: several entities' map data in one request (today one request per chosen entry).
- Search page `/search?q=…&type=artworks` (`src/views/search.ts`): Enter in the header search without a hit chosen by
  the arrow keys opens it (a chosen hit opens that entry; the dropdown ends with "All N results for …"). Every match of
  `findAll()` in `src/search.ts` (shared with the header: names first, then entries found by other fields — an
  artwork by its artist — then the API's similar names when nothing matched) as the list pages' cards (`card()` in
  `src/views/list.ts`, with a type label), type buttons with counts; the address follows the typing. Prerendered as
  `search/index.html` (noindex, robots `Disallow: /search`).
- Search fields (API 110): what a list search finds besides the name comes from the API (`search_fields` per list
  item, view `entry_search_fields` — the admin's lists search the same); `catalog.ts` `entries()` turns them into
  `fields` (label, text, match, tier, shown) — define new searchable facts in the view, not here.
- Large lists: pickers, list pages, the header search and `/search` load every entry of a type (`listAll` in `src/api.ts`: pages of
  500, the rest in parallel once `total` says there are more) and sort and search in the browser. When that gets slow
  they need a server-side `sort=` parameter (name, born, died, country, date, …) with paging, and search-as-you-type
  with the field matching of `src/catalog.ts` (type, birthplace, nationality …).

## Next
Missing API features go to the backend as a written request rather than client-side stitching.
