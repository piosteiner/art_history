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
  places/  movements/  polities/  artists/  people/  institutions/  glossary/  bibliography/  artworks/
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
| `c. 1755` · `ca. 1755` · `circa 1755` | 1750–1760 (±5 years); also `c. 1755–1760`, `c. 500 BCE` | c. 1755 |
| `13th century` · `13th c.` | 1201–1300 (strict count, as Wikidata) | 13th century |
| `early` / `mid` / `late 13th century` | first / middle / last third: 1201–1233 · 1234–1266 · 1267–1300 | late 13th century |
| `first half of the 13th century` · `second half …` | 1201–1250 · 1251–1300 | as written |
| `13th–14th century` · `5th century BCE` | 1201–1400 · 500–401 BCE | as written |
| `1880s` | the decade 1880–1889 (`1200s` is refused as ambiguous) | 1880s |

## Fields
| Folder | Fields (all optional unless marked *) |
|---|---|
| places | `name`*, `kind`* (settlement, building, site, region, country), `location` `[longitude, latitude]`, `parent` (place slug), `country_code` (ISO, e.g. FR), `boundary_code` (ISO country `JP` or region `JP-13`: outline from Natural Earth), `names`, `area` (GeoJSON polygon), `description_md` — needs `location`, `area` or `boundary_code` (countries get theirs from `country_code`) |
| movements | `name`*, `kind`* (period, movement, school, style), `parent` (movement slug), `period`, `description_md` |
| polities | `name`*, `kind` (empire, kingdom, dynasty, republic, …), `parent` (polity slug, e.g. Western Han ⊂ Han dynasty), `period` (when it existed; `1922/` = still exists), `country_codes` (modern countries on its territory, ISO: `[RU, UA, BY]`), `names`, `description_md` |
| artists | `name`*, `sort_name`, `names`, `birth`, `death`, `biography_md` |
| people | `name`*, `kind` (person, family, dynasty, religious order, guild …), `occupations` (list: poet, monk, emperor …), `birth`, `death`, `active` (groups), `names`, `description_md` — everyone relevant who isn't an artist (whoever made art is an artist); "patron" is a role: `commissioned` / `patron_of` relationships. Older files in `patrons/` (with `notes_md`) still import |
| institutions | `name`*, `kind` (museum, academy, theatre, temple …), `founded`, `place` (the city, place slug), `location` `[lon, lat]` (the exact spot), `address`, `website_url`, `names`, `description_md` |
| events | `name`*, `kind` (fire, trial, exhibition, auction …), `parent` (event slug: part of a larger event), `period`, `place` (place slug: the city), `location` `[lon, lat]` (the exact spot), `area` (GeoJSON: the area it covered), `names`, `description_md` |
| glossary | `name`* (the term), `category` (technique, architecture, material, iconography, style, format, other), `definition` (1–2 sentences, plain text, max. 500), `names`, `description_md` |
| bibliography | `name`* (title), `kind` (book, catalogue, chapter, article, lexicon_entry, catalogue_entry, web, video, archival, other), `subtitle`, `authors`/`editors`/`compilers` (lists, "Surname, Given"), `container`, `container_editors`, `volume`, `issue`, `issue_date`, `volumes_total`, `edition`, `original_year`, `series`, `thesis`, `place`, `publisher`, `year`, `pages`, `pages_are_columns`, `catalogue_number`, `exhibition`, `url`, `accessed`, `uploader`, `uploaded`, `date_text`, `archive`, `shelfmark`, `isbn`, `doi`, `siglum` (override), `primary_source`, `reading_status` (to_read, reading, read), `read_on`, `description_md` (notes) |
| artworks | `title`*, `title_status` (`official` · `common` · `own`, when the title is a translation), `parent` (the series / album / triptych it is part of, artwork slug), `part_number` (21, left panel …), `parts_count` (of a whole), `creator` (artist slug), `attribution_label`, `created`, `kind`, `medium` (readable, e.g. Oil on canvas), `materials` (list), `dimensions` (`[height]`, `[height, width]` or `[height, width, depth]` in cm), `dimensions_note`, `other_dimensions` (further parts: `[{part: mount, cm: [180, 95.5]}]`), `location` / `area` (only works that don't move: buildings, gardens, bridges …), `institution` (where it is now, slug), `inventory_number` (that institution's number), `on_loan` (true: lent to that institution — the owner is in the provenance), `on_loan_since`, `numbers` (further numbers: `[{number: '99', institution: foundation-e-g-buhrle-collection}, {number: 204, source: <catalogue slug>}, {number: '1923/5', institution: …, label: former inventory number}]`), `web_url` (its page at the museum / collection — linked on the site, above all when there is no free image), `names`, `description_md` |

Artworks also take `provenance`: the owners in order (ownership is not a relationship since migration 031) —
```yaml
provenance:
  - owner: person/michel-monet        # artist/…, person/…, institution/… or place/…; or only owner_label
    acquired: 1926
    method: inheritance               # creation, commission, inheritance, purchase, auction, gift, bequest, exchange,
                                      # confiscation, forced_sale, restitution, unknown (default)
    place: sorel-moussel              # where the work was (place slug)
    ended: 1952                       # only if a source says so — otherwise the next acquisition implies the end
  - owner: person/emil-georg-buhrle
    acquired: 1952
    method: purchase
    direct: true                      # handover documented as direct (default false)
    label: via …                      # also owner_label, certainty, notes_md, sources (list)
```

Every entity also takes `wikidata_id` (`Q…`) and `metadata` (free-form mapping). `*_md` fields are Markdown;
the API serves them as sanitized HTML.

## Citations
In any `*_md` text, after the guide of the Kunsthistorisches Institut, Universität Zürich:
`[[source/busch-1993|55]]` → a footnote "Busch 1993, S. 55." (a bare number becomes "S. …"; anything else stays as
written: `|bes. S. 55`, `|Abb. 32`); adjacent citations → one footnote ("…, und …"); an own footnote:
`^[Vgl. [[source/busch-1993|bes. S. 55]].]`; the same source as at the end of the previous footnote → "Ebd.". After the
text: the footnotes and the full entries of everything cited ("Literatur", primary sources as "Quellen").

## Glossary links
In any `*_md` text: `[[contrapposto]]` links the glossary term with that slug (shown with its name),
`[[contrapposto|the pose]]` with your own words. Any other entry: `[[type/slug]]`, e.g. `[[artist/katsushika-hokusai]]`,
`[[artwork/the-great-wave|the Wave]]` (types: artist, artwork, institution, person, movement, place, polity, term).
Links to entries that don't exist (yet) are listed on the Quality page.
An inventory number can exist only once per institution, and a boundary code only once (the import refuses a second).
When an entry's slug changes, every link to it is rewritten to the new slug (a text imported with an old slug is
corrected on the way in).

## Names in several languages
Every entry's main name (`title` for artworks, `name` for the rest) can carry furigana and a language; other names
go in `names`, each with a language and a role (`original`, `translation`, `romanization`, `alternative` — the default).

```yaml
title: "{神奈川|かながわ}{沖|おき}{浪裏|なみうら}"   # furigana: {kanji|reading}
title_lang: ja                                     # BCP 47: ja, en, zh-Hant …
names:
  - text: Kanagawa-oki nami ura
    lang: ja-Latn                                  # romanized = the language in Latin script (ja-Latn, zh-Latn-pinyin)
    role: romanization
  - text: The Great Wave off Kanagawa
    lang: en
    role: translation
  - Great Wave                                     # plain text = an alternative name
```
The romanization is what lists sort by. Files from before (with `alt_names` / `alt_titles` lists) still import:
those become alternative names.

A translation can say whose it is: `official` (the holding institution's — cite it), `common` (in use; the default) or
`own` (yours) — `{text: Unter der Welle, lang: de, role: translation, status: own}`, in forms `Unter der Welle | de | translation, own`.

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

## Sources
Where a fact comes from (citations, migrations 049/050) — per field of an entry, and on every relationship and
provenance step (`sources:` there). Each item is a line of text (a note), a source of the bibliography or Wikidata:

```yaml
sources:
  dimensions:
    - source: van-gogh-museum-collection   # a bibliography slug
      url: https://www.vangoghmuseum.nl/…  # the exact page (optional)
      accessed: 2026-10-08
  created:
    - wikidata: Q45585
      property: P571
      accessed: 2026-10-08
    - source: faille-1970
      locator: "F 612"                     # page, catalogue number
relationships:
  - type: lived_in
    to: place/arles
    sources: [Letter 577]                  # in words
```
The import adds missing ones (lines of text replace the old lines); the export writes them all.

## Relationships
Listed in the file of the **subject** — the entity the sentence starts with ("Van Gogh *lived in* Arles").

```yaml
relationships:
  - type: lived_in              # a code from the vocabulary — GET /v1/vocabulary
    to: place/arles             # <type>/<slug>: artist, artwork, institution, person, movement, place, polity, event
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
and `depicts` (artwork → place) when a place is what the artwork shows — or an event (artwork → event).
Events: `participated_in` (artist / person / institution → event; the role in `label`: defendant, judge, lender …),
`concerns` (event → what it is about).

An institution's `place` is where it is **now**. If it moved, add every location as a `located_in` relationship
with a `period` — the current one open-ended (`period: 1808/`), so the map can draw the full route
(an artwork's `institution` + `housed_at` work the same way).
