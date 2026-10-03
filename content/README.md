# Content

The curated data behind arthistory.piogino.ch, as plain YAML.

**Since Phase 5 (2026-09-28) the database is the source of truth**: content is edited in the admin panel
(https://admin.arthistory.piogino.ch/admin/), its history is the `audit_log` table, and nightly backups protect it.
These files are a **snapshot**: `npm run export` writes the database back out here, so git shows a readable diff —
commit it when you like. Deploys no longer import them.

The import still works for bulk-loading many entities at once (write YAML, then `npm run import`), but it
overwrites fields of entities it touches — **export first**, so the files match the database, then edit and import.

```
content/<folder>/<slug>.yaml     one entity per file; the file name is its slug (lowercase-kebab-case)
  places/  movements/  polities/  artists/  patrons/  institutions/  artworks/
```

```bash
cd backend
npm run import:dev -- --dry-run   # validate against the dev DB, write nothing
npm run import:dev                # load into arthistory_dev, check at http://127.0.0.1:3005/v1/…
npm run import                    # production (deploy.sh does this automatically)
npm run import -- --prune         # also remove relationships (and images) that were deleted from a file
```
Every problem in every file is reported at once, and nothing is written unless the whole import succeeds.
A field left out of a file is cleared in the database: the file is the whole truth about its entity.

## Dates
Historical dates are fuzzy, so each one is a range at the precision you know. The label is generated
(`1853-03-30` → "30 March 1853"); add `<field>_label` to override it (`c. 1480`, `17th century`).

| Write | Means | Generated label |
|---|---|---|
| `1853` | the year | 1853 |
| `1888-02` | the month | February 1888 |
| `1853-03-30` | the day | 30 March 1853 |
| `1886-03/1888-02-20` | from … to, both inclusive | March 1886–20 February 1888 |
| `1478/1482` + `created_label: c. 1480` | somewhere in those years | c. 1480 |
| `-500` | 500 BCE (year precision only; there is no year 0) | 500 BCE |
| `1808/` | from 1808, still ongoing — only for periods (`period`, `active`, relationship `period`) | since 1808 |

## Fields
| Folder | Fields (all optional unless marked *) |
|---|---|
| places | `name`*, `kind`* (settlement, building, site, region, country), `location`* `[longitude, latitude]`, `parent` (place slug), `country_code` (ISO, e.g. FR), `alt_names`, `area` (GeoJSON polygon), `description_md` |
| movements | `name`*, `kind`* (period, movement, school, style), `parent` (movement slug), `period`, `description_md` |
| polities | `name`*, `kind` (empire, kingdom, dynasty, republic, …), `parent` (polity slug, e.g. Western Han ⊂ Han dynasty), `period` (when it existed; `1922/` = still exists), `country_codes` (modern countries on its territory, ISO: `[RU, UA, BY]`), `alt_names`, `description_md` |
| artists | `name`*, `sort_name`, `alt_names`, `birth`, `death`, `biography_md` |
| patrons | `name`*, `kind` (person, family, …), `alt_names`, `active`, `notes_md` |
| institutions | `name`*, `kind` (museum, academy, …), `founded`, `place` (place slug), `website_url`, `alt_names`, `description_md` |
| artworks | `title`*, `creator` (artist slug), `attribution_label`, `created`, `kind`, `medium` (readable, e.g. Oil on canvas), `materials` (list), `dimensions` (`[height, width]` or `[height, width, depth]` in cm), `dimensions_note`, `institution` (current holder, slug), `inventory_number`, `alt_titles`, `description_md` |

Every entity also takes `wikidata_id` (`Q…`) and `metadata` (free-form mapping). `*_md` fields are Markdown;
the API serves them as sanitized HTML.

## Images
Artworks, artists and institutions take a list of images; the first one is the main image. Only `url` is required.

```yaml
images:
  - url: https://upload.wikimedia.org/wikipedia/commons/b/b5/Great_Wave.jpg   # https, hotlinked
    source_url: https://commons.wikimedia.org/wiki/File:Great_Wave.jpg
    license: Public domain
    credit: Katsushika Hokusai
  - url: https://example.org/back.jpg
    caption: Back view
```
The import matches images by `url` per entry (order and the other fields are updated); images no longer listed are
removed only with `--prune`. Files without an `images:` key leave the entry's images alone.

## Relationships
Listed in the file of the **subject** — the entity the sentence starts with ("Van Gogh *lived in* Arles").

```yaml
relationships:
  - type: lived_in              # a code from the vocabulary — GET /v1/vocabulary
    to: place/arles             # <type>/<slug>: artist, artwork, institution, patron, movement, place
    period: 1888-02-20/1889-05-08
    label: the Yellow House     # short qualifier shown next to the link
    certainty: attested         # attested (default) · probable · possible · disputed
    notes_md: Longer note, *Markdown*.
    sources: [Letter 577]       # stored in metadata.sources
```
Rules the database enforces: the type must allow these entity types (a movement can't be `born_in`), the
target must exist, no exact duplicates. Symmetric types (`contemporary_of`, `collaborated_with`) need to be
written in only one of the two files.

Only **physical presence** types (`born_in`, `died_in`, `lived_in`, `worked_in`, `visited`, `created_in`, `located_in`) are drawn
as travel routes on the map. Use `influenced_by_culture_of` for places someone was influenced by but never visited,
and `depicts` (artwork → place) when a place is what the artwork shows.

An institution's `place` is where it is **now**. If it moved, add every location as a `located_in` relationship
with a `period` — the current one open-ended (`period: 1808/`), so the map can draw the full route
(an artwork's `institution` + `housed_at` work the same way).
