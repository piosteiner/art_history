# Content

The curated data behind arthistory.piogino.ch, as plain YAML. Git is the history and the backup;
`backend/scripts/import.js` loads it into PostgreSQL (idempotent — safe to run any number of times).

```
content/<folder>/<slug>.yaml     one entity per file; the file name is its slug (lowercase-kebab-case)
  places/  movements/  artists/  patrons/  institutions/  artworks/
```

```bash
cd backend
npm run import:dev -- --dry-run   # validate against the dev DB, write nothing
npm run import:dev                # load into arthistory_dev, check at http://127.0.0.1:3005/v1/…
npm run import                    # production (deploy.sh does this automatically)
npm run import -- --prune         # also remove relationships that were deleted from a file
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

## Fields
| Folder | Fields (all optional unless marked *) |
|---|---|
| places | `name`*, `kind`* (settlement, building, site, region, country), `location`* `[longitude, latitude]`, `parent` (place slug), `country_code` (ISO, e.g. FR), `alt_names`, `area` (GeoJSON polygon), `description_md` |
| movements | `name`*, `kind`* (period, movement, school, style), `parent` (movement slug), `period`, `description_md` |
| artists | `name`*, `sort_name`, `alt_names`, `birth`, `death`, `biography_md` |
| patrons | `name`*, `kind` (person, family, …), `alt_names`, `active`, `notes_md` |
| institutions | `name`*, `kind` (museum, academy, …), `founded`, `place` (place slug), `website_url`, `alt_names`, `description_md` |
| artworks | `title`*, `creator` (artist slug), `attribution_label`, `created`, `kind`, `medium`, `institution` (current holder, slug), `inventory_number`, `image_url` (https, hotlinked), `image_source_url`, `image_license`, `image_credit`, `alt_titles`, `description_md` |

Every entity also takes `wikidata_id` (`Q…`) and `metadata` (free-form mapping). `*_md` fields are Markdown;
the API serves them as sanitized HTML.

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

Only **physical presence** types (`born_in`, `died_in`, `lived_in`, `worked_in`, `visited`, `created_in`) are drawn
as travel routes on the map. Use `influenced_by_culture_of` / `inspired_by_place` for places someone was
influenced by but never visited.
