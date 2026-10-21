# Changelog

Format: date — what — why — how to revert.

## 2026-10-21

### Fix: the duplicate check weighs only its candidate pairs (migration 123) — the admin dashboard loads again
- **What:** `possible_duplicate` in `quality_issues_live` fetches the candidate pairs with their facts first (subquery
  with `OFFSET 0`) and only then runs `dup_maybe()` / `dup_score()`. The planner had joined `dup_facts` with itself
  (489,434 same-type pairs, all through `dup_maybe`) before narrowing to the 6,146 candidates: 124 s for the check,
  130 s for all findings → `refresh_quality()` over the admin role's 30 s statement timeout on every try since the
  night of 20/21 October (stored findings stale since 23:41), and the dashboard, computing them live, failed with 500
  after 30 s. Now: check 7 s, all findings 11 s, refresh 14 s (measured on a restored copy); the same 58 findings.
- **Why:** owner: the admin page wasn't reachable (the dashboard at `/`; other pages worked).
- **Revert:** redeploy the previous commit; recreate the branch of `quality_issues_live` as in 093;
  `DELETE FROM schema_migrations WHERE name = '123_duplicate_check_pairs_first.sql';`

## 2026-10-20

### Start map: provenance maps cached (migration 122)
- **What:** `src/routes/map.js` keeps every artwork's provenance map in memory with the data version it was computed
  at (the change counter `quality_changes`, 058; migration 122 lets the API role read it). An artwork's own map is
  always current; `/v1/map/provenances` (the start map's overview) serves cached maps — possibly from before the last
  change — and a warm-up recomputes them one artwork at a time after changes and after a start. E2E
  `start-map-data.spec.js`.
- **Why:** with 120 more works (≈ 100 ms of database time each) the overview's four parallel requests took 6–10 s and
  ran into the API role's 5 s statement timeout ("timeout: Service Unavailable" on the start map; frontend tests).
- **Revert:** revert the commit (no data changed); `REVOKE SELECT ON SEQUENCE quality_changes FROM arthistory_api;`
  delete `122_…` from `schema_migrations`.

### Data: five museums in France and Italy, 20 works each, and 20 works in place — with their provenance
- **What:** (production; works and people created as user pio with `scripts/from-wikidata.js`, provenance imported as
  YAML — source import) 120 works, 559 provenance steps, every step cited with the source's own words:
  - **Louvre** (129 steps, after its collection records — `collections.louvre.fr` JSON with “Historique”, previous
    owners, Jabach/Napoleon inventories): Mona Lisa (Salaì 1518, Francis I, the Crown, 1793, Peruggia's theft
    1911–1913 and the Uffizi's custody), Venus de Milo (the find 1820, Marcellus, Rivière, Louis XVIII), Victory of
    Samothrace, Code of Hammurabi (Elamite booty, Susa 1901, partage), Wedding at Cana (Campo Formio 1797, Austria's
    claim 1815, Le Brun's painting in exchange), Vermeer's Astronomer (sales 1713–1881, Rothschild, seized 1940,
    restituted 1946, dation 1983), Leonardo's St John (Charles I, Commonwealth sale, Jabach, Louis XIV), Caravaggio,
    Van Dyck's Charles I (Verrue, Lassay, du Barry, Louis XVI), Michelangelo's Dying Slave (Strozzi, Montmorency,
    Richelieu, seized 1792), David, Delacroix, Géricault (Bullock's tour 1820–21, the 1824 sale), Ingres, Van Eyck.
  - **Musée d'Orsay** (145, its “Historique – Provenance”, read in the Internet Archive — the museum refuses this
    server): L'Origine du monde (Khalil-Bey, Hatvany, Soviet looting 1945, Lacan, dation 1995), Olympia (Monet's
    subscription 1890), the Angelus (Secrétan sale, American Art Association, Chauchard), Van Gogh's Bedroom
    (Matsukata, sequestered 1944, kept under the 1959 settlement with Japan), Caillebotte bequest, Camondo, Quinn …
  - **Uffizi** (77, its pages + Italian Wikipedia): Medici and Della Rovere (1631), Napoleonic spoliations and 1815
    returns (Venus de' Medici, Madonna with the Long Neck), Simone Martini's Annunciation (exchanged 1799), Uccello
    (Bartolini Salimbeni → Lorenzo 1484), the Medusa with two readings (1598 / 1608, sources disagree).
  - **Galleria Borghese** (94, its catalogue's “Provenienza” with the 1693/1700/1790/1833 inventories): Scipione
    Borghese's seizure of the Cavalier d'Arpino's pictures (1607), Raphael's Deposition taken from Perugia (1608),
    Domenichino's Diana (the painter imprisoned), Correggio's Danaë (Charles V, Rudolf II, Swedish booty, Christina,
    Orléans …), the 1833 fideicommissum, the State's purchase 1902; Bernini's Proserpina back from the Ludovisi 1908.
  - **Pinacoteca di Brera** (65, its pages + Italian Wikipedia): Napoleonic suppressions, Raphael's Sposalizio (forced
    gift to Lechi 1798, Sannazzari, Ospedale Maggiore, Beauharnais), Mantegna's Dead Christ, Hayez, Caravaggio.
  - **20 works in place** (49, Italian/French Wikipedia): Last Supper, Scrovegni (Lamentation), Masaccio's Trinity,
    Arezzo, Camera degli Sposi, Contarelli, Cornaro, Pio Monte (“not to be sold at any price”, 1613), Siena, Frari
    Assunta (Accademia 1818–1919); Lascaux (found 1940, State 1972), Orangerie Water Lilies (gift 1922), Hall of
    Mirrors ceiling, Chartres, Vence, Chagall's Opéra ceiling, Saint-Sulpice, Rude, Moissac, Sainte-Chapelle.
  New: about 230 people, institutions and places (mostly from Wikidata; French royal collection, Roberto Strozzi,
  Lorenzo Nasi by name), 60 bibliography entries. Fixes along the way: Louvre departments `part_of` the Louvre;
  locations Wikidata gave movable sculptures removed; the artificial “mythological paintings by Botticelli” group
  removed; 109 Wikidata citations of values replaced by the museums' own deleted; Bramante's Christ at the Column on
  loan from Chiaravalle. Not possible yet: Lascaux's date (≈ 21,000 years BP) — dates before 4713 BCE don't fit
  Postgres dates; given in the description.
- **Why:** owner: “take 5 major museums in France and Italy and add 20 artworks from each with provenance … be as
  precise as possible … also choose 20 artworks with fixed location in France and Italy”.
- **Revert:** History page (audit log, 20 October, user pio and source import); the import folders are reproducible
  from the scratchpad specs.

### Provenance: a gift under duress (migration 121)
- **What:** `acquisition_method` value `forced_gift` — given under duress, no price (Raphael's Marriage of the Virgin:
  Città di Castello "practically forced" to give it to General Lechi, 1798); in the step form, import, API, site ("forced
  gift", counted as taken). E2E `provenance-methods.spec.js`.
- **Why:** the Brera provenances; owner: create the options a provenance needs.
- **Revert:** leave the value unused (enum values can't be dropped); delete `121_forced_gift.sql` from `schema_migrations`.

### Provenance: four acquisition methods and five historical currencies (migration 120)
- **What:** `acquisition_method` gets `find` (found or excavated), `partage` (division of excavation finds — the
  Louvre's "partage après fouilles"), `spoils_of_war` (taken in war, a war contribution under a treaty — the Louvre's
  "conquête militaire") and `in_lieu` (accepted in payment of a tax, French "dation"); in the step form, the import,
  the API and the site (labels "found", "partage of finds", "spoils of war", "in lieu of tax"; spoils of war counts as
  taken). `currencies`: LIV (livre tournois), SCU (Roman scudo), DUC (Venetian ducat), FIOR (Florentine florin), PIA
  (Ottoman piastre) — codes only, no rates (pinned). E2E `provenance-methods.spec.js`.
- **Why:** owner: the French and Italian museums' provenances must be recorded exactly — "if there is something we
  can't recreate, create the option to do so".
- **Revert:** values can't be dropped from an enum: leave them unused, or recreate the type; `DELETE FROM currencies
  WHERE code IN ('LIV','SCU','DUC','FIOR','PIA');` delete `120_…` from `schema_migrations`.

### Changelog: notices for unpublished entries and unsaved drafts; spell check language recognised
- **What:** an unpublished entry's edit page says "Saved, but not published — not on the site" with "Publish now"
  (`POST /changelog/<id>/publish`); the list names the saved-but-unpublished entries and this account's autosaved
  drafts not saved yet ("Unsaved changes"); the roadmap board lists its unsaved drafts too. The bullets' field is now
  the Markdown editor (as artworks' descriptions): spell check language recognised from the text (EN/DE, switch in
  the toolbar), `[[` completion, and its preview shows the bullets as on the site (`POST /changelog/preview`).
- **Why:** owner: a message when there are unpublished saves/changes; the automatic language detection for the spell check.
- **Revert:** revert the commit.

### Changelog and roadmap: deleting needs a confirmation page
- **What:** "Delete this entry…" / "Delete this item…" open a page of their own that shows what will be deleted
  (day, title, status, the bullets); only "Yes, delete" (`confirm=yes`) deletes — a POST without it redirects to that
  page. Replaces the browser dialog of the commit before (easy to click through, depends on the script). E2E
  `changelog.spec.js`.
- **Why:** owner: deleting a changelog entry must ask first, to prevent accidental deletion.
- **Revert:** revert the commit.

### Changelog and roadmap: autosave, history and restore (migration 119); a deleted entry restored
- **What:** table `form_drafts` — the changelog and roadmap forms send what is typed as a draft of the account 1.5 s
  after typing pauses (also when the tab is hidden), restored with a banner when the form is opened again, removed on
  Save (`editor/formdrafts.js`). Edit pages show their history; "restore this version…" / "restore as before…" in
  every history (also /history and `/roadmap/history`) bring back an entry with its bullets or a roadmap item, a
  deleted one under its old id; lists show "Recently deleted"; deleting asks first. Saving now edits bullets in place
  instead of deleting and re-inserting them all. History labels and links for the three tables. Fix: the history read
  the roadmap's text column `area` as a geography (/history failed once roadmap items had an area). The entry of
  2026-09-29, deleted by accident at 20:21 UTC, restored from the audit log as it was before (published, 3 bullets).
- **Why:** owner: an entry deleted by accident; wants them in the history and saves while typing, for the roadmap too.
- **Revert:** revert the commit; `DROP TABLE form_drafts;` delete `119_form_drafts.sql` from `schema_migrations`.

### Public changelog and roadmap (migration 118)
- **What:** tables `changelog_entries`, `changelog_items` (kind neu/verbessert/behoben/inhalt/technik, optional link to
  a roadmap item), `roadmap_items` (status jetzt/naechstes/spaeter/erledigt, area, notes, position, done_on), all
  audited. CMS `/changelog` (an entry = day, optional title, one "Kind: text" line per bullet, preview, draft/published)
  and `/roadmap` (four columns, drag order, move buttons; "✓ Erledigt" writes a linked bullet into today's entry,
  starting a draft entry if needed) — `src/admin/routes/changelog.js`, `src/changelog.js`. API `/v1/changelog`
  (`?kind=`, paging), `/v1/changelog/feed.xml` (RSS), `/v1/roadmap`. Site `/changelog`, `/roadmap` (German), footer
  links, prerendered. Seeded as drafts: 22 entries 2026-09-23 – 2026-10-20 written from the commit history, 14 roadmap
  items from the open to-dos (all unpublished, to review and publish in the CMS). Tests: `changelog.test.js`,
  E2E `changelog.spec.js`, site test.
- **Why:** owner: a changelog for patches and daily updates as bullet points, and a "what I'm working on" list.
- **Revert:** revert the commits; `DROP TABLE changelog_items, changelog_entries, roadmap_items;` delete
  `118_changelog_roadmap.sql` from `schema_migrations`.

### The Markdown editor: the adenai tools, find and replace, autosave for pages (migration 117)
- **What:** the CMS editor's toolbar gets the adenai editor's tools — [[ ]] entry link, web link, heading cycling
  (#/##/###), numbered list, task, highlight (Ctrl+Shift+H), spoiler, quote, callout boxes (▣ Box: note, info, tip,
  important, warning, quote, example, question, to do), table, divider — and find/replace (Ctrl+F,
  `@codemirror/search`). The forms render everywhere: `src/md-extras.js` (==mark==, ||spoiler||, tasks, `> [!type]`
  callouts) shared by `src/markdown.js` and `src/pages.js`; site styles. Pages autosave as drafts per account and part
  (table `page_drafts`, every 1.5 s pause, also when the tab is hidden), restored on reopening with "Discard draft";
  Save publishes. Unit tests `md-extras.test.js`, E2E `pages.spec.js`.
- **Why:** owner: autosave for the Markdown editor, and all the tools of the adenai CMS editor.
- **Revert:** revert the commits; `DROP TABLE page_drafts;` delete `117_page_drafts.sql` from `schema_migrations`.

### Pages read and edited by chapter; .md download and upload (migration 116)
- **What:** chapters = a page's top-level headings (`splitChapters()` in `src/pages.js`). CMS: an outline beside the
  editor, one chapter (or the introduction, or the whole text) edited at a time and put back in its place, a stale save
  refused with the edit kept; "Download .md" / "Upload .md" with a warning when the page changed in the CMS since the
  last download (table `page_downloads`). API `/v1/pages/<slug>` = introduction + chapter list, `?chapter=`, `?full=1`.
  Site: `/dokumentation` overview with chapters, `/dokumentation/<chapter>` with its own contents beside it and
  previous/next; all prerendered once published. E2E `pages.spec.js`, site test.
- **Why:** owner: the documentation is too long to edit and read in one piece; it is written both in the CMS and in Obsidian.
- **Revert:** revert the commits; `DROP TABLE page_downloads;` delete `116_page_downloads.sql` from `schema_migrations`.

### Page images converted to WebP on upload (migration 115)
- **What:** dependency `sharp` (0.35.5, as the adenai map); every page image upload becomes WebP — quality 82, longest
  side ≤ 1600 px, EXIF rotation applied, other metadata dropped, animated GIFs stay animated, an already smaller WebP kept;
  the name stays as embedded. Columns `page_images.width`, `height`, `original_bytes`; the site's `<img>` gets width/height.
- **Why:** owner: save as much storage as possible with the documentation's images.
- **Revert:** revert the commit (uploads stored as sent again); `ALTER TABLE page_images DROP COLUMN width, DROP COLUMN height,
  DROP COLUMN original_bytes;` delete `115_page_image_sizes.sql` from `schema_migrations`.

### Pages: the project documentation on the site (migration 114)
- **What:** tables `pages` (audited) and `page_images` (bytea); `src/pages.js` renders Obsidian Markdown (`![[image]]`,
  `==mark==`, task lists, tables, coloured spans, ruby) behind a sanitize-html allowlist; API `/v1/pages/<slug>` and its
  images by name; CMS "Pages" (`src/admin/routes/pages.js`: the Markdown editor with its own preview, images uploaded
  several at once, dropped on or pasted into the text — `editor/uploads.js` —, history). Site `/dokumentation` with
  contents (`src/views/page.ts`), footer link "Projekt Dokumentation", prerendered once published. The page
  `projekt-dokumentation` starts empty and unpublished. E2E `pages.spec.js`, site test.
- **Why:** owner: the documentation on the site for transparency and as proof of the work, edited in the CMS.
- **Revert:** `DROP TABLE page_images, pages;` delete `114_pages.sql` from `schema_migrations`; revert the commits.

### Search: did you mean, collection filters, plain-language queries, infinite scroll; numbers linked only when shared (migration 113)
- **What:** materialized view `search_words` + `search_suggest()` (fuzzystrmatch + pg_trgm), `GET /v1/search/suggest`;
  `/v1/search/text` `in` / `not_in` (an artwork's current collection); `provenance_number_kinds.scope`,
  `provenance_number_peers()` / `provenance_record_peers()`, `shared` + `id` on numbers and records, `/v1/provenance-numbers?of=`.
  Site: `src/query.ts` reads `-word`, `-"…"`, `"…"`, "but not in …", "except", "without", "nicht in", "ohne" … (list
  pages, pickers, header, search page; the reading shown); a typo corrected (nothing found → the correction, with
  "search for … instead"; few → "did you mean"); the search page loads more while scrolling instead of pages; a
  provenance number is a link only when another work shares it. E2E `search-suggest.spec.js`, site tests.
- **Why:** owner (2026-10-20): "244" linked in every royal inventory was confusing; no pages to click through;
  "gauguin but not in kunsthaus zürich"; "hokusia" → Hokusai.
- **Revert:** restore `refresh_quality()` from 111, `DROP FUNCTION search_suggest, provenance_number_peers,
  provenance_record_peers; DROP MATERIALIZED VIEW search_words; ALTER TABLE provenance_number_kinds DROP COLUMN scope;`
  delete `113_search_suggest_number_scope.sql` from `schema_migrations`; revert the commits.

### Periods: artists beside works (migration 112)
- **What:** view `movement_artists` (artists linked to a style/movement directly or through their works, phases
  rolled up); `/v1/periods` sends `artists` per period (life, via, the link's dates, lane places) and `creator_slug`
  per work. Site: a Works | Artists switch on /periods (`?show=artists`) — each artist a thin lifespan row under the
  period, their works of it as dots, a life outside the span outlined red and listed, a year window lists the artists
  alive then. E2E `periods.spec.js`, site test.
- **Why:** owner: see how the artists' lives sit in the periods.
- **Revert:** `DROP VIEW movement_artists;` delete `112_movement_artists.sql` from `schema_migrations`; revert the commit.

### The search fields stored (migration 111)
- **What:** Table `entry_search_fields_stored` — the view `entry_search_fields` (110) stored, brought up to date by
  `refresh_quality()` after every change (only changed rows written, like `graph_links`); `entry_search_fields_json()`
  reads it (the artworks' fields for a list: 0.9 s → 0.01 s). The admin's lists read it too, or the view itself while
  it is behind a change just made (`quality.current()`). Not a materialized view: since Postgres 17 a refresh runs
  with search_path = pg_catalog and the older functions the fields use don't qualify their tables (093).
- **Why:** with the fields computed per request the artworks list went over the API role's 5 s statement timeout under
  load ("Service Unavailable" in the site's tests).
- **Revert:** redeploy the previous commit; restore `refresh_quality()` without the block and
  `entry_search_fields_json()` reading the view (110); `DROP TABLE entry_search_fields_stored;`
  `DELETE FROM schema_migrations WHERE name = '111_entry_search_fields_stored.sql';`

### One search definition for the admin and the site (migration 110)
- **What:** View `entry_search_fields` — per entry the fields a search finds besides the name (label, text, match,
  tier, shown): artworks' artist, date, type and materials (term names in every language), medium, made in, state,
  series, **now in / formerly in** (museums, view `artwork_holders`); artists' and people's filed as, dates, birthplace,
  nationality (people also kind, occupations, roles); institutions' place, polity and "works by" an artist; sources'
  authors, title, publisher; events, terms, polities, places, movements. Functions `person_roles()` (was SQL in
  entities.js), `country_words()`, `polity_words()`, `place_and_country()`, `entry_search_fields_json()`.
  Admin lists (`fieldSearchSql()` in `src/admin/match.js`): every word in the name, other names, slug or a field;
  names first; museums' hits under "Now in the collection" / "Formerly in the collection"; the matched fields shown as
  the reason; nothing found → "Similar names" (typo-tolerant names). API lists: `search_fields` per item (artworks
  no longer send `term_names` in lists). Site: matches against `search_fields` (its own field definitions in
  `catalog.ts` removed); fields marked `shown` count as visible. Test `fieldsearch.spec.js` compares the admin's
  hits and groups with the site's rules applied to the API's lists for ten queries.
- **Why:** owner: "prado" in the admin's artworks didn't find the works in (or once in) the Prado — the two searches
  had drifted apart.
- **Note:** the artworks list API takes ≈ 1.9 s instead of ≈ 1.4 s (the fields of ~190 works); a misspelt artist name
  no longer finds the artist's works in the admin (typo tolerance is for names, as on the site).
- **Revert:** redeploy the previous commit; `DROP FUNCTION entry_search_fields_json(entity_type, bigint); DROP VIEW
  entry_search_fields; DROP FUNCTION person_roles(bigint), country_words(jsonb), polity_words(entity_type, bigint, text),
  place_and_country(text, jsonb); DELETE FROM schema_migrations WHERE name = '110_entry_search_fields.sql';`

### Data: mumok and the Academy's picture gallery, 20 works each, with the provenance they publish
- **What:** (production, as user pio) mumok: 20 works (Gerstl, Kokoschka, Magritte, Kandinsky, Léger, Moholy-Nagy, Calder,
  Gleizes, Balla, Schmidt-Rottluff, Dubuffet, Delvaux, Schwitters, Christo, Nitsch, Lam, Brauner, Masson, Vasarely,
  Campendonk) — 3 from Wikidata, 17 written from the mumok's online collection (title, German title, date, technique,
  size, inventory number, link; each field cited); provenance as far as published: the year of acquisition and the
  credit line (a gift of the Kamm family, of Ernst Ploil, of the artist Masson; Christo's Packed Coast on loan from the
  Austrian Ludwig Foundation since 1981), the steps noting that earlier owners are not published. Bronze casts of
  editions left out (as the prints at the Albertina). Academy of Fine Arts, picture gallery: its 20 highlights
  (Bosch's Last Judgment, Rubens, Rembrandt, Van Dyck, Botticelli, Titian, Cranach, Murillo, Guardi, Ruisdael …) — 17
  from Wikidata, 3 from the Academy's "Sammlung online" (with its CC BY 4.0 images); provenance after its field
  "Provenienz": 15 from the bequest of Count Lamberg-Sprinzenstein (1822), gifts of Prince Johann II of Liechtenstein
  (1882, 1889) and of Heinrich Adam Füger (1878), the Titian bought from Kunsthandlung Pisko (1907), Maria Theresa
  commissioned by the Academy (1759). New: some 25 artists and people, the Austrian Ludwig Foundation; mumok renamed
  "mumok – Museum moderner Kunst Stiftung Ludwig Wien" (Wikidata's "Mumok"); places and addresses of both added.
- **Why:** owner: "add them anyway" (the provenance these museums publish is short).
- **Revert:** History page (audit log, 20 October, user pio and source import).

## 2026-10-19

### Data: 80 works of four Vienna museums with their provenance (KHM, Albertina, Leopold Museum, Belvedere)
- **What:** (production, as user pio) 20 works each, made with `scripts/from-wikidata.js` (title, date, creator,
  museum, inventory number, size, material, image), their provenance imported as YAML (export → steps added → import of
  only those files, `CONTENT_DIR`): KHM 111 steps (Bruegel's Months, Vermeer's Art of Painting with Hitler and the
  Munich Collecting Point, Giorgione, Raphael, Caravaggio, Velázquez, Bosch, Rubens, Tintoretto, Parmigianino, Dürer),
  Albertina 144 steps (Dürer's drawings from Imhoff's Kunstbuch via Rudolf II, the Treasury and the Court Library to
  Duke Albert, his heirs and the Republic in 1919; Bruegel, Bosch, Michelangelo, Raphael, Rembrandt, Klimt, Schiele),
  Leopold Museum 122 steps (Schiele, Klimt, Gerstl, Kirchner, Moser: dealers, Nazi-era seizures, restitutions,
  exchanges with the Belvedere, auctions with lot numbers; Wally's 2010 settlement as an event), Belvedere 78 steps
  (11 Klimts after the Belvedere's online Klimt catalogue of July 2026 — the Kiss, Judith, Fritza Riedler, Adam and Eve …
  —, read in the Internet Archive's copies because sammlung.belvedere.at refuses this server; the Beethoven Frieze,
  Amalie Zuckerkandl and The Embrace after the decisions of the Kunstrückgabebeirat; Schiele, Monet, Van Gogh after the
  Belvedere's provenance lists; Death and the Maiden and Segantini's Evil Mothers only with the acquisition, noted as
  such; the Beethoven Frieze now "at the Vienna Secession, on loan", the Belvedere's number 5987 kept). Every step cited with
  the museum's page and its own wording in the note (new sources: KHM Online-Sammlung, Albertina Sammlungen Online,
  Leopold Museum Online Sammlung, AEIOU "Albertina", KHM 2016, Wikipedia "Leopold Wilhelm", US Attorney SDNY 2010).
  New: about 110 people, artists, institutions and places from Wikidata (collectors, dealers, the Habsburg line, the
  Imperial Treasury, the Court Library = Austrian National Library, Belvedere, Dorotheum …), 5 by name (Habsburg imperial
  collection, Czernin Picture Gallery, Frederik Muller & Cie, Neue Galerie Vienna, Salzburger Landesgalerie). Renamed:
  the State of Salzburg (was `salzburg`; the city now has the slug), Catharina Bolnes, the Landauer Zwölfbrüderhaus.
- **Why:** owner: "add the most famous art museums of Vienna … 20 artworks of each museum with their complete provenance".
  mumok and the Academy's gallery are still open: mumok publishes only the acquisition (year and credit line), the
  Academy's site doesn't answer this server.
- **Revert:** History page (audit log, 19–20 October, user pio and source import); the import batches are reproducible
  from the scratchpad specs.

### YAML round trip fixed (migrations 108, 109; export, import)
- **What:** The export wrote `public_id` quoted (node-postgres reads bigint as text) and the import refused it — now a
  number, and the import also takes the old quoted form. 108: `check_inventory_number()` asks for the row an
  `INSERT … ON CONFLICT (slug)` will update (the BEFORE INSERT trigger saw a fresh id and found the work's own inventory
  number). 109: `fill_person_names()` leaves the name parts of an existing entry as the file has them. `import --verbose`
  names what it inserts or updates. Test `yaml-roundtrip.spec.js` (export → import, nothing changed). Also: the as-of test
  uses Zurich's date (it failed between 22:00 and 24:00 UTC).
- **Why:** found importing the Vienna provenances: the import could not take back its own export.
- **Revert:** redeploy the previous commit; recreate the two trigger functions from 048 / 066;
  `DELETE FROM schema_migrations WHERE name IN ('108_inventory_number_upsert.sql', '109_person_names_upsert.sql');`

### Museums list: an artist's works there (migration 107)
- **What:** Views `artwork_holders` (institutions holding a work now / before) and `artwork_artists`; artwork lists'
  `holders` read from the first, institution lists have `artists_held` [{slug, name, now, before}]. Site: searching an
  artist in the museums list shows the museums with their works, most first, "12 works by …" linked to
  `/artworks?artist=…&institution=…` (there now, then formerly).
- **Why:** owner: "if you search for an artist in the museum section you should be shown the museums with artworks of
  that artist with a number of total held artworks".
- **Revert:** redeploy the previous commit; `DROP VIEW artwork_holders, artwork_artists;`
  `DELETE FROM schema_migrations WHERE name = '107_artwork_holders.sql';`

### Start map layers with pickers; institutions' closing date (migration 106)
- **What:** `institutions.dissolved` (+ label, citable, Wikidata P576, admin "Closed / dissolved"); artwork lists have
  `holders`; `/v1/map/sites` has `from_year`/`to_year`; start views accept `institutions=` and `events=` (slugs, all,
  none, auto). Site: Museums and Events pickers with "auto", artworks on the timeline until today, provenance ends on
  the start map, previews in a start view's introduction.
- **Why:** owner's requests of 19 October.
- **Revert:** redeploy the previous commit; `ALTER TABLE institutions DROP COLUMN dissolved, DROP COLUMN dissolved_label;`
  `DELETE FROM citable_fields WHERE entity_type = 'institution' AND field = 'dissolved';` recreate the three featured
  functions/view from 069; `DELETE FROM schema_migrations WHERE name = '106_institution_dissolved_layers.sql';`

### Data: the Prado provenances with records; three series
- **What:** (production, as user pio) The Prado's inventory entries, sightings, catalogues and exhibitions moved from
  the steps' text into provenance records (104): 76 records on 24 steps of 16 works — year, palace, room as the
  inventory writes it, number, the Prado's doubts ("¿nº 411?", "¿Real Alcázar, 1666?") as certainties; the step
  numbers and further places they replace dropped, the labels shortened. Series: "Pinturas negras" (Wikidata
  Q1988253, imported; 14 parts — Saturn and the Dog in it), "El Dos de Mayo de 1808 en Madrid" (new: the Second and
  Third of May as 1 and 2), the Hall of Realms battle series completed (12 parts, the Prado, attribution, dates).
  Also: Charles V's "created in Augsburg" dated 1548; outdated Wikidata citations of replaced values removed.
- **Why:** owner: the Black Paintings as a series; the provenances recreated with the records.
- **Revert:** History page (audit log, user pio, 19 October); records: `DELETE FROM provenance_records` for these steps.

### Several artworks' provenance in one request (`/v1/map/provenances`)
- **What:** `GET /v1/map/provenances?artworks=slug,…` (≤ 300) → `{data: {slug: provenance}}` (`provenanceRoute()` in
  `src/routes/map.js`, four at a time). The site's start map uses it for its overview instead of one map request per
  artwork; the overview is drawn at once with routes by date and the provenances replace them when they come
  (start page usable after ≈ 4 s instead of ≈ 11 s here). Test in `provenance-records.spec.js`; the frontend's
  overview test waits for the provenance legend.
- **Why:** with ~110 artworks the start page queued ~110 requests (≈ 11 s here, more from far away); the Pages tests
  (run in the US against the live API) timed out at "Loading…" and the site was no longer published.
- **Revert:** revert the commit (the old site keeps working: it doesn't call the endpoint).

### Provenance periods with an end known only as "or later" (migration 105)
- **What:** `provenance_periods` (patched as it stands): an end given as "… or later" (an open range) now counts from
  its earliest day — `coalesce(upper(r), lower(r) + 1)` — for a recorded end, an end implied by the next acquisition
  and a step with only an end. Before, `upper()` of the open range was NULL, `GREATEST()` skipped it, and the period
  collapsed to the year of acquisition. 28 of 607 steps change (e.g. Bernheim-Jeune "9 March 1909–1912 or later",
  La Petite Irène's restitution "27 March 1946 – 8 June 1949 or later"): their periods, the coverage, the map, the
  encounters. Test in `provenance-records.spec.js`.
- **Why:** found by the new check `provenance_record_outside` (104): the Prado's inventory entries of 1747–1818 lay
  "outside" the Royal Collection's period "until 1819 or later".
- **Revert:** redeploy the previous commit; recreate the view with the three expressions back to `upper(…)`;
  `DELETE FROM schema_migrations WHERE name = '105_provenance_period_open_ends.sql';`

### Provenance records (migration 104)
- **What:** Table `provenance_records` (enum `provenance_record_kind`): the evidence under a step — inventory entries,
  catalogues, exhibitions, sightings, documents — with date, place, room, number, `number_certainty` ("¿nº 411?"),
  `certainty` of the whole entry ("¿Real Alcázar, 1666?"), document, note; audit trigger. View
  `provenance_numbers_all` (step numbers + record numbers) for the number lookups (admin `/provenance/numbers`,
  `/v1/provenance-numbers`: + `certainty`, `recorded`, `document`). `provenance_stops()` (091) with the records'
  places where they change (map, travel distance). `search_documents` extended with the records (GIN index
  `provenance_records_search_idx`). Check `provenance_record_outside` (a record dated outside its holder's period).
  Admin: `src/admin/provenance-records.js` — records on the step's edit page (add / edit / remove), listed under the
  step on the artwork page (folded above three); History and revert/restore know the table. API: `records` per step.
  YAML: `records` per step (export + import, replaced as a whole when different). Site: records under the step, the
  doubts tagged. Tests: `provenance-records.spec.js`, frontend "provenance records (API 104)". Also: the schema smoke
  test clears events (it failed once an event had a place). Dev: 087's search objects re-created (dev only had lost
  `search_method()`, the search indexes and `search_documents`).
- **Why:** owner: the Prado's provenances are lists of inventory entries — until now flattened into text, numbers
  without their year, doubts lost.
- **Revert:** redeploy the previous commit; `DROP TABLE provenance_records CASCADE; DROP TYPE provenance_record_kind;
  DROP VIEW provenance_numbers_all;` recreate `provenance_stops` from 091, `search_documents` from 087 and
  `quality_issues_live` from its last definition (the migration appended one part to each);
  `DELETE FROM schema_migrations WHERE name = '104_provenance_records.sql';`

### Data: 20 masterpieces of the Prado with their provenance; `scripts/from-wikidata.js`
- **What:** New tool `backend/scripts/from-wikidata.js [--dry-run] [--prefer-lang=es] [--links] [--skip=…] [--trust-type]
  <type> Q… [Q…:slug]` — creates entries from Wikidata items as "+ from Wikidata…" + "Create" would (every value
  cited W, first image, authority numbers, the form's own `saveEntity`, now exported from `routes/entries.js`); with
  `--links` the suggested relationships. A similar name among ours is never taken for the item (one with its own item
  → a new entry; one without → reported "undecided"). Test `fromwikidata.spec.js` (fixtures Q140/Q141).
  Data (production, as user pio): Las meninas, the Garden of Earthly Delights, both Majas, the 2nd and 3rd of May,
  the Surrender of Breda, the Triumph of Death, the Family of Charles IV, Las hilanderas, the Descent from the Cross,
  the Seven Deadly Sins, Charles V at Mühlberg, the Triumph of Bacchus, the Forge of Vulcan, the Nobleman with his
  Hand on his Chest, Dürer's Self-portrait (1498), the Three Graces, the Dog, Fra Angelico's Annunciation — plus Saturn
  (existing) completed. Title, date, measurements, type and medium after the Prado (cited M, Wikidata's dates and sizes
  replaced), a short description, deposits of Patrimonio Nacional as `on_loan`. Provenance after the Prado's
  "Procedencia" (read in the Internet Archive's copies — museodelprado.es blocks this server): 86 steps, each cited
  with the Prado page and the Spanish wording in the citation note; royal inventories as places + inventory numbers;
  the Duke of Alba's confiscation as possessor; Escorial deposits with the 1936 Junta and the 1943 decree as events.
  New: some 95 entries — depicted people, owners, 8 palaces as site places, the Spanish royal collection, El Escorial,
  Patrimonio Nacional, movements, events (from Wikidata where an item exists; 7 by name) — 51 flagged "to complete";
  the source "Museo del Prado, Colección".
  Corrected after the import: the Triumph of Death's creator (a similar-name candidate gave Jan instead of Pieter
  Bruegel), Charles Aeschimann's Wikidata item (given Charles V's, reset), wrong depicted people (Mary Quinn Sullivan,
  Mary Magdalene → the Virgin Mary), a Wikidata category "1795–1820 in Western fashion" (removed), the Siege of Breda
  (place → event), Dürer's "Italian Renaissance" (removed), the Majas' sitters (possible, identification disputed).
- **Why:** owner: the 20 most important works of the Prado with full entries and provenance.
- **Revert:** data — History page (audit log, user pio, 19 October); the script — revert the commit.

## 2026-10-18

### Data: provenances for 10 of the 23 artworks without one (import, production)
- **What:** from the museums' published records, every step cited: Le Phare de Honfleur (Kunsthaus Zürich, item 2206,
  13 steps — Depeaux, Drouot 1901, Bernheim-Jeune, Grimthorpe, Christie's 1906, Hugo and Martha Nathan, Bottenwieser,
  Adolf and Walter A. Jöhr, the Kunsthaus 1975; research there ongoing); Bridge in the Rain and Flowering Plum Orchard
  (Van Gogh Museum: Theo, Jo van Gogh-Bonger and Vincent Willem van Gogh, the foundations, the Stedelijk loan; on loan
  at the museum); Self-Portrait Dedicated to Paul Gauguin (Harvard Art Museums: Gauguin, Vollard and Cassirer as
  "possible", Tschudi, his widow, the Neue Staatsgalerie, the 1938 confiscation EK 16554, Fischer Lucerne 1939 lot 45,
  Wertheim, the Fogg 1951); Sunflowers (National Gallery: Jo van Gogh-Bonger, V. W. van Gogh, Leicester Galleries, the
  Courtauld Fund 1924, transferred 1961); The Starry Night (Wikidata's owned-by statements — without references — and
  MoMA's credit line). From credit lines only: The Great Wave (Met: Mrs. H. O. Havemeyer, bequest 1929), Rocks at
  Belle-Île (Cincinnati, bought 1985), The Interior of the British Institution Gallery (Yale: Paul Mellon), The Route
  from Saint-Germain to Marly (McNay: the Oppenheimers' gift, via pubhist). 12 new entries "to complete". Not found or
  not reachable (bot protection: Prado, MoMA's page, Brooklyn, the Met's page, MFA Boston, McNay, Hermitage): Saturn,
  Edge of the Forest, Sudden Shower, the Onchi portrait, Pine Trees in the Snow; no provenance to give: the Bauhaus
  building, the Mirror Room, the Priest Kūya (in its temple), prints without a particular impression.
- **Why:** owner: provenance for the artworks without one, from the museums' websites.
- **Revert:** History → the change sets (source import, 18 October 2026) → Revert.

### Periods timeline: the works on the period bars, outliers marked
- **What:** `/v1/periods` gives each work `places` (where it was made — the provenance's creation stop, 091: recorded,
  else where the artist lived or worked then — the places above it and its country) and `made_in`. The page draws the
  works as dots on the period bars, in the lane of the region where they were made (else Europe as a whole, else the
  period's first lane); a work dated wholly outside the bar's span is a hollow red dot and listed under the timeline
  ("Dated outside their period"). The separate "In the collection" lane is gone.
- **Why:** owner: see where the works lie within the periods, and find outliers.
- **Revert:** `git revert` the commit.

### Frontend tests: brought up to today's data (the Pages build had failed since 10:56)
- **What:** frontend/tests/site.spec.ts — Heiliger Sebastian's creation is placed now (Niklaus Weckmann worked in Ulm,
  from the Wikidata review of 18 October 2026, 10:00): its maps show a stop "1" and one unplaced step instead of two;
  the overview's legend names 12 routes before "+ N more" (18 more works have a provenance since the Kunsthaus
  import); the gap test finds its marker by its text (the live data has gaps of its own). All 116 pass.
- **Why:** the Pages workflow runs these against the live API; two builds failed on them, so the site had not been
  updated since this morning (the "planned" provenance tag, the periods page).
- **Revert:** `git revert` (the old expectations fail against the current data).

### Periods timeline: the page (frontend)
- **What:** `/periods` (frontend/src/views/periods.ts, menu "Periods"): one lane per region (Europe, then the European
  regions, then the others), styles with their phases indented, approximate limits fading out, drafts (not yet
  reviewed) outlined dashed; "In the collection": the span of each period's works with a dot per work (links to the
  work). A clicked bar or a dragged / typed window lists the periods active then and the collection's works of those
  years with their most specific period. Regions, phases and the window are kept in the address. The timeline
  component (timeline.ts) gained optional fades, drafts, dots, indented rows, thin bars and keeping the rows' order.
  The API's lane order uses a boundary's label point too (Germany, Austria have only a boundary code). Test in
  frontend/tests/site.spec.ts.
- **Why:** owner: a timeline of the art-historical periods (steps 2 and 3).
- **Revert:** `git revert` the frontend commit (the API stays harmless).

### Periods timeline: API and data
- **What:** migration `100_movement_works.sql` — view `movement_works`: a movement's artworks (associated directly, or
  through their artist if made while it lasted; a style collects its parts). `101_movement_drafts.sql` — view
  `movement_drafts` (the movements marked "to complete", for the API role, which may not read `auto_created`). Route
  `GET /v1/periods` (src/routes/periods.js): lanes (places, Europe first), every movement with dated "active in" spans —
  each span with `fuzzy` start/end from its label —, its parent, `reviewed`, and its works. E2E `periods.spec.js`.
  Data (import, 18 October 2026): place Europe (Q46); 21 new entries (Romanesque, Gothic with Early / High / Late /
  International Gothic, Renaissance, Early and Late Renaissance, Mannerism, Early / High / Late Baroque, Dutch Golden
  Age painting, Biedermeier, Jugendstil, Expressionism, Muromachi and Meiji periods); periods corrected (Rococo had
  Wikidata's inception "1730–1739", Baroque "1501–1759", Romanticism "1701–1800", Impressionism "1860–1869" …), kinds
  (style / movement / period) and parts; 47 dated spans in Europe, Italy, France, Belgium, the Netherlands, Germany,
  Austria and Japan, each cited — the Getty AAT's scope notes (data.getty.edu, ODC-By) or Wikidata's start and end
  times; the 44 movements touched marked "to complete" for review.
- **Why:** owner: a timeline of the art-historical periods, regional where the sources say so.
- **Revert:** `DROP VIEW movement_works, movement_drafts`, `git revert`; the data: History → the change set (source
  import, 18 October 2026) → Revert.

### Data: Kunsthaus Zürich provenances completed from the Sammlung Online (import, production)
- **What:** of the Kunsthaus's 54 works here, 50 have a record online; 28 already matched it line by line. Imported from
  the records (fetched 18 October 2026, one request every 2 s): the 15 works without provenance (Walpurgisnacht, Mönche
  am Feuer, Meule au soleil, Die Sintflut mit der Arche Noah, Branches de marronnier en fleur, Le cattive madri, Bain au
  soir d'été, Genfersee bei Sonnenuntergang, Das Jungfraumassiv von Mürren aus, Schwarzer Fleck, Dorfeingang mit
  Windmühle, La Chambre d'écoute, Genfersee mit Mont-Blanc, Bei Netstal, Études de bras et de mains) and 3 works that
  had only part of it (Le Garçon au gilet rouge and La Route de Saint-Germain: Bührle onwards only; Femme à tête de
  roses: one step) — 124 steps, each citing the record (source 2, the page, its footnote). The conventions of the
  earlier Kunsthaus imports: the artist line implied; "Verbleib unbekannt" a gap (the next step not direct; the first
  step after the artist direct only if dated within the artist's lifetime or the estate); the last open-ended loan to
  the Kunsthaus = `on_loan` (set on 5 works); earlier loans as custodian steps; auctions as agents with lot numbers,
  "zurück" = not sold; ERR / Munich CCP numbers; prices; "wohl" = probable; labels in English. La Route de
  Saint-Germain: the ERR seizure (listed before) put after Paul Rosenberg, from whom it was taken. Created, "to
  complete": 54 entries (people with years of birth and death from the records, institutions). Not imported: Le Bol
  blanc (the record's provenance is not published online); 4 works without a record link (Le Phare de Honfleur, Le
  Bassin aux nymphéas le soir, Au piano, Prozession in Valencia).
- **Why:** owner: complete the incomplete Kunsthaus provenances from the museum's website.
- **Revert:** History → the change sets (source import, 2026-10-18) → Revert.

### DoME as a reference record
- **What:** migration `099_dome_authority.sql` — authority `dome` (Database of Modern Exhibitions 1905–1915, Universität
  Wien; Wikidata P7944, `https://exhibitions.univie.ac.at/person/{id}`) for artists and people, and its bibliography
  entry. Test in authorities.spec.js. The exhibitions are not imported: no licence for reuse found, the site blocks
  automated access (Anubis), Wikidata has only 35 of its exhibitions (P8185).
- **Why:** owner's request — link our artists to their exhibitions 1905–1915.
- **Revert:** `DELETE FROM entry_identifiers WHERE authority = 'dome'; DELETE FROM authorities WHERE code = 'dome'`.

### Dates: ranges as people write them
- **What:** `src/fuzzy-date.js` — a text none of the forms takes is tried as a range of two of them: "1900-1905",
  "1900–1905", "1900 - 1905", "1900 to 1905", "c. 1900–c. 1905", "March 1900 – May 1905", "1880s–1890s", "c. 965/"; open
  "from 1900", "1900–" (periods only), "until 1905", "–1905"; "500 BCE" as the labels write it. Every date that parsed
  before parses as before (an invalid recognised form keeps its message); "1900-05" stays May 1900. Unit tests in
  test/fuzzy-date.test.js, e2e test/e2e/dates.spec.js.
- **Why:** the Wikidata review of Pola Gauguin failed on the polity "Kingdom of Denmark" ("c. 965/": a circa start, no
  end) and refused everything; "1900-1905" in forms was refused.
- **Revert:** `git revert` the commit (stored ranges are plain dateranges — nothing to migrate).

### A museum authority's provenance is "ongoing" at its museums
- **What:** migration `098_institution_holds.sql` — function `institution_holds(owner, museum)` (the museum itself, or an
  institution it is part of, 097); `provenance_periods` uses it for "ongoing", the quality check `provenance_last_owner`
  for "ends with …, but the work is at …". A provenance ending with the Bayerische Staatsgemäldesammlungen while the
  work is at the Neue Pinakothek no longer ends "unknown" (a gap up to today) nor is reported. Test: partof.spec.js.
- **Why:** the Munich works are owned by the authority, kept in its museums.
- **Revert:** a migration restoring both views from 097 (`pg_get_viewdef` before 098 = 084/093) and `DROP FUNCTION institution_holds`.

### Relationship "part of" / "includes" between institutions
- **What:** migration `097_institution_part_of.sql` — relationship type `part_of` (institution → institution): a museum of
  a museum authority (the Pinakotheken, Sammlung Schack, Museum Brandhorst ⊂ Bayerische Staatsgemäldesammlungen). The
  Wikidata review of an institution suggests it from P361. Test: partof.spec.js.
- **Why:** the Munich museums and their authority could not be modelled.
- **Revert:** `DELETE FROM relationships WHERE relationship_type = 'part_of'; DELETE FROM relationship_types WHERE code = 'part_of'`, `git revert`.

### Fix: "Someone saved this record while you were editing" on artworks nobody else had touched
- **What:** `saveEntity` (src/admin/routes/entries.js) checks the version — and locks the row — at the start of the
  transaction instead of in the final UPDATE. Before, an artwork whose stored type or material had no glossary term yet
  (e.g. "woodcut" on `l-univers-est-cree`) could never be saved: the save creates the term, its trigger
  `glossary_relink_artworks` (071) touches the artworks using that word — this one too, bumping `updated_at` — and the
  UPDATE's `updated_at = version` then found no row. Rolled back, so the next try failed the same way. Test in
  terms.spec.js (a real concurrent save is still refused).
- **Why:** 2 × 422 on POST /artworks/l-univers-est-cree (11:12, 11:17 UTC).
- **Revert:** `git revert` the commit.

### Planned provenance: future dates allowed, with a reminder after the day
- **What:** migration `096_provenance_planned.sql` — column `provenance.check_after` (the last day of a step's latest
  future date; backfilled for the steps already dated after today, e.g. "Fleurs dans une coupe", Sotheby's New York,
  18 Nov 2026). The provenance form accepts future dates again (the refusal added this morning is gone) and sets it.
  Admin: the step is tagged "planned · check after …"; once the day is over the artwork page and the dashboard ask
  "did it happen?" with **Went as planned** (`POST /provenance/:id/confirm`, clears it) or edit the step (saving it
  with past dates clears it too); upcoming ones are listed on the dashboard. Public API: `planned_until` on provenance
  steps, the frontend shows a "planned" tag. YAML: `check_after` (content.js export, import.js).
- **Why:** a future step is an announced event (an auction), not a typo — keep it and remind to check the outcome.
  The first deploy stopped at the migration ("cannot CREATE INDEX … pending trigger events": the backfill fires
  deferred triggers) and rolled back, production untouched; the index is now created before the backfill.
- **Revert:** `git revert` the commit; `ALTER TABLE provenance DROP COLUMN check_after` (the column is unused otherwise).

### Fix: a provenance date in the future broke /v1/artworks and the artwork's admin page
- **What:** migration `095_provenance_future_dates.sql` — `provenance_coverage()` builds an artwork's "life" range only
  when it starts before tomorrow (before, `daterange()` raised "range lower bound must be less than or equal to range
  upper bound" for a start after today, and every list reading `provenance_completeness` failed with it: 12 × 500 on
  `/v1/artworks`, 7 × on `/artworks/fleurs-dans-une-coupe` since 08:41 UTC, when a step with ended "18 November 2026" was
  added). The provenance form now refuses dates in the future ("lies in the future — check the year"). Also
  `enrich.js`: the Enrich page no longer fails when the Metagrid search errors (`candidates` missing). e2e test in
  `provenance.spec.js`.
- **Why:** one mistyped year took down the public artwork list.
- **Revert:** a migration restoring the 078 function body (not needed: identical results where 078 worked).


### Admin editor: a selected name and "[" make a link
- **What:** `backend/src/admin/editor/editor.js` — typing "[" over a selection turns it into `[[text]]` and opens the
  `[[` suggestions searched for it; picking an entry keeps the text as written (`[[artist/katsushika-hokusai|Hokusai]]`).
  An input handler, so it works for "[" on any keyboard layout. e2e test in `test/e2e/links.spec.js`.
- **Why:** owner: linking names written without a link took retyping them (same feature in the Adenai editor).
- **Revert:** remove `bracketOverSelection` from the editor's extensions; `npm run build:admin` via `deploy.sh`.

### Adenai CMS: classic CMS retired; players' proposals
- **What:** adenai-cms redirects `/` to `/v2/` (classic `admin-interface/{index.html,css,js,images}` removed); v2 has
  Media, History (`/api/changelog/history`) and Overview with exports (`/api/protocols/export`, CMS login).
  New private file `adenai-map/server/data/pending-entries.json` (entries players propose on the map, mode 600,
  git-ignored, `/api/pending`) added to `scripts/backup.sh`.
- **Why:** owner: one CMS; players create entries from the minutes that the DM confirms.
- **Revert:** revert the adenai-map commits; the classic files are in its git history.

## 2026-10-17

### Adenai: session minutes (private, on this server)
- **What:** `adenai-map/server/data/protocols.json` (+ `protocol-settings.json`, `protocols-deleted.json`; mode 600,
  git-ignored) written by the CMS route `/api/protocols`; added to `scripts/backup.sh` (encrypted off-site).
- **Why:** owner: campaign minutes behind a password; `public/data` is world-readable, so they must not go there.
- **Revert:** remove the route from `server.js`; the files stay on disk and in the backup.

### Adenai: nightly off-site backup, journeys moved into the repo
- **What:** `adenai-backup.{service,timer}` (04:30 UTC, units in `adenai-map/server/config/systemd/`) runs
  `server/scripts/backup.sh`: each `uploads/optimized/*.webp` encrypted once (gpg AES256, passphrase
  `~/.config/adenai/backup-passphrase`) plus `config/users.js` and `.env`, pushed to the private repo
  `piosteiner/adenai-backups` cloned at `~/backups/adenai-offsite` (SSH alias `github-adenai-backups`). Restore:
  `scripts/restore-backup.sh`. Journeys moved from `server/data/journeys.json` (kept as `…migrated-2026-10-17`) to
  `public/data/journeys.json`.
- **Why:** media and journeys existed only on this server (one manual tarball from 2026-10-12).
- **Revert:** `sudo systemctl disable --now adenai-backup.timer`; journeys: revert the adenai-map commit.

### Adenai CMS: data cache, image cleanup (42 → 17 MB)
- **What:** adenai-cms answers reads of `public/data/*.json` from memory (`server/lib/github-cache.js`, one shared
  GitHub client in `server/lib/github.js`), gzip on; deleted the 84 `uploads/optimized/*-original.webp` (1200 px copies
  of `*-large.webp` made by a pipeline bug; `media-library.json` now points `sizes.original` at the large file) and a
  stray temp upload.
- **Why:** owner: the CMS felt slow (every read waited 0.2–0.6 s for GitHub); storage for many more images.
- **Revert:** `git revert` the adenai-map commits; the deleted files were duplicates (same image, 1200 px).

### Disk cleanup (23 → 18 GB used)
- **What:** removed 6 unused VS Code server versions (`~/.vscode-server/cli/servers`, the 2 running kept), the npm cache,
  two 127 MB quiz crash-loop logs from 2026-09-23, `/var/www/obs-remote-media-backend.retired-2026-10-12` (its 10 images
  not in the new backend are in `obs-remote-media-controller/backend/orphaned-uploads-2026-10-12/`), the
  `/var/www/gif-converter` placeholder, and disabled snap revisions; `snap set system refresh.retain=2`.
- **Why:** owner: free space; all of it unused or re-downloadable.
- **Revert:** nothing to restore; VS Code and npm download again on demand; the retired backend is in its GitHub repo.

### Nightly content snapshot installed
- **What:** `arthistory-export.{service,timer}` copied from `server-docs/config/systemd/` to `/etc/systemd/system/`,
  enabled (04:00 UTC). First snapshot run by hand before (523 files, everything since 2026-10-09).
- **Why:** the content export was prepared but never installed, so content/ changes piled up uncommitted.
- **Revert:** `sudo systemctl disable --now arthistory-export.timer`, remove both units, `daemon-reload`.

### Converter API: conversion progress
- **What:** `/api/convert` and `/convert/gif-to-webm` take a `job` id; ffmpeg runs with `-progress pipe:1` and writes
  `temp_uploads/progress_<job>.json`, read by new `GET /api/progress/<job>`. Preview WebMs get `-g 10`.
- **Why:** owner: conversions looked stuck with no percentage. A file, not memory, because gunicorn has 2 workers.
- **Revert:** `git revert` the file-converter commit "GIF tool: progress in percent…" and restart the service.

### Swap 1 → 4 GB, swappiness 10
- **What:** `/swapfile` grown to 4 GB; `/etc/sysctl.d/99-swappiness.conf` sets `vm.swappiness=10`.
- **Why:** three crashes today, most likely memory (Chromium on top of the VS Code server); swap turns a spike into
  slowness instead of a crash. Normal use (~1.2 GB for all sites) is unaffected.
- **Revert:** `swapoff /swapfile && fallocate -l 1G /swapfile && mkswap /swapfile && swapon /swapfile`; delete the sysctl file.

### Journal kept 14 days
- **What:** `/etc/systemd/journald.conf.d/retention.conf` with `MaxRetentionSec=14day` (journal 2.1 GB → 136 MB).
- **Why:** the privacy statements say server logs are deleted after 14 days; nginx (rotate 14) and PM2 (retain 5)
  already were, the journal (converter logs file names there) was unlimited.
- **Revert:** delete the file, `systemctl restart systemd-journald`.

### Privacy statements on every public site; piogino.ch moved to GitHub Pages
- **What:** FADP privacy pages on piogino.ch, converter, adenai (`datenschutz.html`), meetup, calorie-tracker,
  obs-media-control, quiz and the Hunt Train builder (arthistory already had one). Fonts and libraries self-hosted
  instead of Google Fonts/CDNs where possible. piogino.ch: repo `piosteiner/piogino.ch` cloned at `/var/www/piogino.ch`,
  served by GitHub Pages; DNS at Infomaniak: four A records 185.199.108–111.153, `www` CNAME `piosteiner.github.io`
  (the old Infomaniak Starter hosting is no longer used). New deploy keys + SSH aliases: `github-piogino-ch`,
  `github-Meetup-Scheduler`, `github-calorie-tracker`, `github-Light-Trains-bot-command-generator`; clones in /var/www.
  Quiz (not in git): stopped storing typed passwords in localStorage; backup of the old files in
  `/var/www/quiz-platform/backups/2026-10-17-privacy/`.
- **Why:** owner: every non-admin site needs a privacy statement under Swiss law that matches what it really does.
- **Revert:** per repo `git revert`; DNS: A record back to 128.65.195.180 (old hosting).

### File converter renamed, runs from its git repo
- **What:** backend runs from the `piosteiner/file-converter` clone at `/var/www/file-converter/server` (own `.venv`);
  systemd `gif-converter` → `file-converter-api`; nginx site `gif-converter` → `api.piogino.ch` (holds all of
  api.piogino.ch, `/obs/` included); GitHub repo `webapp-file-converter` → `file-converter`, push via deploy key
  `~/.ssh/file_converter_deploy` (SSH alias `github-file-converter`). Old non-git copy `/var/www/gif-converter` deleted;
  repo `gif-to-webm-converter` archived. Services table: adenai and OBS rows corrected to their real paths.
- **Why:** owner: the backend had no git; the project is a general file converter, not only GIF.
- **Revert:** rename the unit and nginx site back (`daemon-reload`, `nginx -t && systemctl reload nginx`); the code is
  the repo, nothing else was lost.

### Row-level security: accounts limited to collections (migration 094)
- **What:** table `editor_scopes`, `editor_institutions()`, `may_edit_artwork()`; ROW LEVEL SECURITY with policies on
  `artworks`, `provenance`, `artwork_numbers`, `images` (reads unaffected; accounts without a scope unaffected).
  `npm run admin:scope -- <user> <institution slug …> | --clear` (`scripts/admin-scope.js`); admin messages for a
  refused save. E2E `editor-scopes.spec.js`. No account has a scope yet.
- **Why:** owner: ready for other museums or co-editors — each changes only its collection, enforced by the database.
- **Revert:** `ALTER TABLE artworks|provenance|artwork_numbers|images DISABLE ROW LEVEL SECURITY;` drop the policies
  (`DROP POLICY … ON …`), `DROP FUNCTION may_edit_artwork, editor_institutions; DROP TABLE editor_scopes;` delete
  `094_editor_scopes.sql` from `schema_migrations`; revert the commit.

### Duplicate check from candidate pairs (migration 093)
- **What:** materialized view `dup_name_keys` (names + sound keys, GIN trigram index), view `dup_candidate_pairs`;
  check `possible_duplicate` weighs only those pairs; `refresh_quality()` refreshes the view first. Measured on
  production: the check 3.8 s → 0.5 s, a whole refresh (after every save) 2.4–5 s → 1.6 s.
- **Why:** pg_stat_statements showed refresh_quality() as the most expensive statement by far.
- **Revert:** restore `quality_issues_live` and `refresh_quality()` from `092`/`088`, `DROP VIEW dup_candidate_pairs;
  DROP MATERIALIZED VIEW dup_name_keys;` delete the migration row; revert the commit.

### Names that sound alike in the duplicate check (migration 092)
- **What:** extension `fuzzystrmatch`; `name_sound_key()` (Double Metaphone), `names_sound_alike()` (+ Levenshtein);
  `dup_maybe()` and `dup_score()` use them ("names sound alike"). On production one new pair: Louis / Louise Cahen
  d'Anvers (87 % similar, no dates) — "not the same" dismisses it. E2E `sound-alike.spec.js`.
- **Why:** owner: "Rochlitz" / "Rochlits", Kunsthaus vs. Wikidata spellings.
- **Revert:** `dup_maybe()` / `dup_score()` from `048`… (as before 092), `DROP FUNCTION names_sound_alike, name_sound_key;`
  `DROP EXTENSION fuzzystrmatch;` delete the migration row; revert the commit.

### Spatial history (migration 091)
- **What:** `provenance_stops()` (the map's provenance stops, moved from `src/routes/map.js` into SQL),
  `artwork_travel()` (ST_Length of the line through them), `encounters()` (ST_DWithin + overlapping periods),
  `place_clusters()` (ST_ClusterDBSCAN in EPSG:3857). API: `travel` on artworks, `/v1/map/encounters`,
  `/v1/map/clusters`. E2E `spatial.spec.js`.
- **Why:** owner: travel distance per work; "who was near whom" in the database instead of the browser; clusters.
- **Revert:** revert the commit (map.js back to its own stops), `DROP FUNCTION place_clusters, encounters, artwork_travel,
  provenance_stops;` delete the migration row.

### Prices over time — baseline only (migration 090)
- **What:** extension `btree_gist`; tables `currencies` (16, with the fixed legal conversions), `exchange_rates`,
  `price_indices` (empty — 📌 pinned until a cited source is chosen) with exclusion constraints on their periods;
  `price_value()`, view `provenance_prices`; `provenance.price_currency` references `currencies`; API `price.chf_today`
  (null for now).
- **Why:** owner: build the baseline, pin the data.
- **Revert:** `ALTER TABLE provenance DROP CONSTRAINT provenance_price_currency_fkey; DROP VIEW provenance_prices;
  DROP FUNCTION price_value, index_on, rate_on; DROP TABLE price_indices, exchange_rates, currencies;` delete the
  migration row; revert the commit.

### pg_stat_statements (server: PostgreSQL configuration)
- **What:** `shared_preload_libraries = 'pg_stat_statements'` (+ max 2000, track top, no utility statements) in
  `/etc/postgresql/18/main/conf.d/arthistory.conf` (copy: `server-docs/config/postgresql/arthistory.conf`), Postgres
  restarted (a few seconds, 09:2x UTC); `CREATE EXTENSION pg_stat_statements` in `arthistory` and `arthistory_dev`
  (as postgres); `GRANT pg_read_all_stats TO arthistory_owner`. `setup-database.sql` creates it (and btree_gist,
  fuzzystrmatch) on restores.
- **Why:** owner: see which queries are slow before data growth makes it a problem.
- **Revert:** remove the four lines from the config, `sudo systemctl restart postgresql`, `DROP EXTENSION
  pg_stat_statements` (as postgres), `REVOKE pg_read_all_stats FROM arthistory_owner`.

## 2026-10-16

### Citable versions: entries as of a date (migration 089)
- **What:** functions over `audit_log`: `rows_as_of(table, ts, filter)`, `entry_row_id()` (also deleted entries),
  `entry_log()`, `entry_versions()`, `changed_fields()`, `history_since()`, `public_row()` — SECURITY DEFINER, content
  only (the API role still has no access to `audit_log`). API: `?as_of=<date or moment>` on every detail
  (`src/routes/history.js`: the entry's fields, relationships, provenance as recorded then; the changes since) and
  `GET /v1/history/<plural>/<entry>` (its versions). E2E `as-of.spec.js`.
- **Why:** owner: use more of Postgres — a citation can point to the version it quotes, however the entry is corrected later.
- **Revert:** `DROP FUNCTION entry_versions, entry_log, entry_row_id, rows_as_of, changed_fields, public_row,
  audited_table, history_since;` delete `089_as_of.sql` from `schema_migrations`; revert the commit.

### Network questions: paths, hands in a window, shared hands (migration 088)
- **What:** table `graph_links` (the `edges` view stored, rewritten by `refresh_quality()` after each change);
  `entry_path()` (breadth-first, jsonb "seen" map), `hands_network(daterange)`, `shared_hands()` (recursive CTE, UNION
  + SEARCH BREADTH FIRST). API `/v1/network/path`, `/hands`, `/shared-hands` (`src/routes/network.js`). E2E `network.spec.js`.
- **Why:** owner: use more of Postgres — "how are these two connected?", "through whose hands 1933–1945?", "which
  works went through the same hands?".
- **Revert:** `DROP FUNCTION entry_path, hands_network, shared_hands; DROP TABLE graph_links;` then restore
  `refresh_quality()` from `058`/`086` (without the graph lines); delete `088_network.sql` from `schema_migrations`;
  revert the commit.

### Full-text search over names and texts (migration 087)
- **What:** text search configurations `search_simple/en/de/fr` (unaccent + stemmer), `search_vector()`,
  `search_query()`, `search_headline()`, `md_plain()`; GIN expression indexes on the ten entry tables and
  `provenance`; view `search_documents`. API `GET /v1/search/text` (ranked, `<mark>` passages, `matched_in`).
  E2E `search-text.spec.js`.
- **Why:** owner: use more of Postgres — the search found names only, not what the texts and provenance say.
- **Revert:** `DROP VIEW search_documents;` drop the `*_search_idx` indexes, the functions and the four configurations;
  delete `087_full_text_search.sql` from `schema_migrations`; revert the commit.

### Biography × provenance: conclusions from lives and whereabouts, contradictions as errors (migration 086)
- **What:** view `provenance_inferences` (narrowed by a death, from the estate, travelled — PostGIS distances;
  `presence_core()` drops the uncertain first/last year of a stay given in years), checks `holder_after_death`,
  `holder_before_birth`, `acquired_before_creation`, `created_where_artist_was_not` (errors) and
  `provenance_date_narrowable` (info). API `inferences` per provenance step; admin shows them as "derived". On
  production: Tournesols, L'Offrande, Nature morte aux fleurs et à l'idole narrowed to before Gauguin's death
  (8 May 1903); four works "travelled" from Gauguin in the South Seas to Paris; no contradictions. E2E
  `provenance-inferences.spec.js`.
- **Why:** owner: connect the artist's biography with the provenance (Gauguin was in the South Seas when Tournesols
  was sold in Paris).
- **Revert:** `git revert`, deploy; quality_issues_live from 085 (pg_get_viewdef before 086), `DROP VIEW
  provenance_inferences; DROP FUNCTION presence_core(daterange);`.

### Public numbers: addresses /<type>/<number>/<slug> (migration 085)
- **What:** `public_id` for every entry (one sequence across all types, from 100001; existing entries numbered in
  creation order — 496 on production), deferred uniqueness across tables, `public_id_history` + `entry_by_public_id()`
  (merged entries' numbers lead on), `entity_index.public_id`. API: entries by number (with or without a name), 301 to
  the right type / the kept entry, `/v1/entries/:number`, `public_id` + `path` in details and `public_id` in lists,
  search, previews, references. Admin: `/<type>/<number>` redirects to the entry's page, which shows the number and
  links the public address. YAML: `public_id` first in each file, kept on import (sequence moved past). E2E `public-ids.spec.js`.
- **Why:** owner: hybrid addresses like museums use — "we are aware of the challenge and aiming for a big database …
  potentially all the artworks of many museums and collections".
- **Revert:** `git revert`, deploy; then 082/084's `entity_index` (without the column), drop the functions, triggers,
  `public_id_history`, the columns and the sequence.

### Data: seizures recorded as possession without title; La Petite Irène's contradicting readings
- **What:** role possessor for those who seized a work or held it after the seizure, until the restitution: La Petite
  Irène (ERR, Göring, Rochlitz), Au piano, étude de bras (ERR), Femme s'essuyant (ERR, Göring, Hans Wendland, Galerie
  Fischer — the 1949 restitution to Kann's estate shows none of them held good title). La Petite Irène: Rochlitz
  exchanged for "a Florentine tondo"; Irène's ownership and Béatrice Reinach's custody marked disputed, with Léon
  Reinach's version (a gift from her grandmother, 1926 or earlier) as another reading of Béatrice's step; Bührle's
  collection card (13 August 1949) as another reading of his purchase (21 October 1949); both cite the Kunsthaus record.
- **Why:** owner: represent what actually happened; the contradiction the Kunsthaus can't resolve.
- **Revert:** History → the change set (source admin, user pio).

### Provenance as it happened: looters hold without title; contradicting readings; exchanged for (migrations 083/084)
- **What:** 083: role `possessor`. 084: `provenance.alternative_to` (another source's reading of a step, trigger
  `provenance_alternative_valid`), `exchanged_for_artwork_id` / `exchanged_for_text`; `provenance_periods` leaves
  alternatives out; `edges`: possessors `held_by` "possessor — held without title" (no `owned_by`), derived
  `exchanged_for`; checks: alternatives not counted, new `provenance_seizure_as_owner`. Admin: role, "Another reading
  of", "Exchanged for" in the step form; "⚠ taken from its owner — held without title" and "another reading" lines in
  the table; reordering keeps alternatives outside the order. API: `alternatives` (with sources), `exchanged_for`.
  YAML: `alternative_of` (index), `exchanged_for`, `exchanged_for_text`, role `possessor`. E2E `provenance-possession.spec.js`.
- **Why:** owner, on La Petite Irène: seizures must not read as ownership ("I don't want to appear to be trivializing
  looting and crimes"); the Kunsthaus states a contradiction it can't resolve; "exchanged for" wanted.
- **Revert:** `git revert`, deploy; then the views from 082 (pg_get_viewdef before 084), drop the trigger, function,
  columns, the `exchanged_for` vocabulary row (083's enum value stays, unused).

### Provenance of Renoir, "La Petite Irène" entered; events in a provenance are moments (migration 082)
- **What:** Data (production, one admin transaction as user pio, script kept out of the repo): the 15 steps of the
  Kunsthaus Zürich's provenance of BU 0090 (collection.kunsthaus.ch item 586963, research status 22 July 2025) —
  commission, the disputed ownership Irène Sampieri-Camondo / custody Béatrice Reinach, the Musées nationaux, ERR
  seizure at Chambord, Göring, Léon Reinach's claim (event), Rochlitz's exchange, seizure by Monuments Officers Howe and
  Moore, Munich CCP no. 8035, restitution, Werner Feuz as agent ("via"), Bührle (CHF 240,000), estate, foundation (inv.
  no. 90). Every step cites the Kunsthaus page (M), plus literature (L) and archival documents in words (T). New
  entries, flagged "to complete": 8 people, 2 institutions, 4 places (Chambord, Hohenschwangau, Munich, Clarens), and
  the bibliography's first books (Yeide 2009, Dauberville 2007, Howe 1946, Die Sammlung Emil Bührle 2021); further
  numbers Dauberville I.506 and Bührle 2021 no. 173 with sources; `on_loan_since_label` "Dauerleihgabe" → "2021".
  Migration 082: `provenance_periods.end_basis = 'point'` for an event without an end (was: an end implied by the next
  acquisition — the claim read "10 August 1941–10 March 1942"). Test in `provenance-cases.spec.js`.
- **Why:** owner: try the system on an important provenance.
- **Revert:** data — History page (audit log) or delete the steps (`DELETE FROM provenance WHERE artwork_id =
  entity_id('artwork', 'irene-cahen-danvers-la-petite-irene')`) and the new entries; 082 — recreate the view from 077,
  `DELETE FROM schema_migrations WHERE name = '082_provenance_event_point.sql';`

### Relationship picker: one choice per label, A–Z; depicted artworks and events are depictions
- **What:** Admin (`core.js` `pickerOptions`, `relFromForm`): types with the same label in the same direction are one
  option — "depicts" (depicts + depicts_person), "created in" (+ _polity), "located in" (+ _polity) — and the target's
  kind picks the type on save; options sorted A–Z per direction; `housed_at` no longer offered (unused; the Collection
  field and the provenance cover it — an existing one keeps its choice); `houses` explained ("— as its building").
  API: `edgeCategory()` (entities.js, used by graph.js) — `depicts` to an artwork or an event has category `depiction`
  in an entry's relationships and in the graph, and is in the graph whenever `depicts_person` is (default); depicted
  places stay `association` (map). No data changed. Test `relpicker.spec.js`; `people.spec.js` picks "depicts".
- **Why:** owner: "depicts" appeared twice in the list (person/artist vs place/artwork/event); options weren't sorted;
  a depicted painting or event showed nowhere in the network.
- **Revert:** revert the commit (no migration).

### Admin artwork lists find works by their artist; the site has a search page
- **What:** Admin list pages for artworks (`routes/entries.js`): `?q=` also matches the creator and co-creators (the
  same fuzzy score on the artist's names, `match.js`); title matches first (best first), then a heading "Works by a
  matching artist" and the artist's works A–Z; every row names its creators. Site: `/search?q=…&type=…`
  (`src/views/search.ts`) — Enter in the header search opens it unless a hit was chosen with the arrow keys; cards
  with image, dates, details, type label and why it matched, type buttons with counts; `findAll()` in `src/search.ts`
  is shared with the header (which ends with "All N results for …"). `search/index.html` prerendered (noindex),
  robots.txt `Disallow: /search`. Tests: backend `search.spec.js` (artworks list), frontend "search page: …", header
  test (Enter after ArrowDown).
- **Why:** owner: searching "gauguin" in the admin's artworks only found titles; Enter in the site's search should
  lead to a results page, as in most searches.
- **Revert:** revert the commit (no migration).

### Sources for further numbers (migration 081); unpublished sources show their kind
- **What:** `citations.number_id` (→ `artwork_numbers`, cascade) as a fourth target (`citations_one_target` replaces
  `citations_check1`), `citation_status.number_id`, `number_citation_docs()` for the YAML. Admin: a marker after each
  further number on the artwork page, a button with its badges in the numbers' table on the edit page (dialog after
  the form, `citations.trigger()`); `forNumbers()`, key `num:<id>`. API: `numbers[].sources`; YAML `numbers[].sources`
  (export + import). Site: markers after each number. Markers: a source still in the working copy now shows its kind
  (W, M, L …, dotted outline) instead of "+ …" — the "…" looked cut off, and "+" said "no source" though one was logged.
  Tests: `numbers.spec.js` (new test), frontend "a work on loan …"; flaky "step with further places" map test now
  measures at rest.
- **Why:** owner: the markers of Object type / Medium looked cut off ("+ …") and could lead to logging a source twice;
  further numbers had no source marker.
- **Revert:** redeploy the previous commit; `DROP FUNCTION number_citation_docs(bigint); DELETE FROM citations WHERE
  number_id IS NOT NULL;` then recreate citation_status as in 050 (drop and recreate with its dependants
  `field_sourcing`, `quality_issues_live`), `ALTER TABLE citations DROP CONSTRAINT citations_one_target, DROP COLUMN
  number_id, ADD CHECK (… three targets = 1);` `DELETE FROM schema_migrations WHERE name = '081_number_citations.sql';`

### Searches ignore special letters, ligatures, typographic apostrophes and dashes (migration 080)
- **What:** `f_unaccent()` now also normalises compatibility forms (NFKC: ligatures "ﬁ", full-width letters) and maps
  ’ ‘ ʼ ` ´ to ' and the dashes ‐ ‑ ‒ – — ― to -; the migration reindexes the 20 indexes built on it (and on `dup_names`/
  `type_doubt`). `unaccent` already spelled out æ, ø, ß, ł, œ, đ, þ. The bibliography `?author=` filter folds accents
  too. The browser side (admin editor pickers, materials, [[ suggestions; public site lists, pickers, header search)
  shares one `fold()` with the same rules: `backend/src/fold.js` and `frontend/src/fold.ts` (before, the site only
  dropped accents: "soren" didn't find Søren, "gross" not Groß). Tests: `test/fold.test.js`, e2e `folding.spec.js`,
  frontend "list search ignores accents…".
- **Why:** owner: "irene" should find Irène, and similar cases. é/è/ê already worked in the database searches.
  Not folded on purpose: German transliteration (Mueller ≠ Müller) — would need its own rule (offered to the owner).
- **Revert:** redeploy the previous commit, then restore the old function and reindex:
  `CREATE OR REPLACE FUNCTION f_unaccent(text) … RETURN public.unaccent('public.unaccent'::regdictionary, $1);` (as in 004) + 080's
  REINDEX loop; `DELETE FROM schema_migrations WHERE name = '080_search_folding.sql';`

### Provenance gaps shown where they belong (migration 079)
- **What:** `provenance_gap_anchor(artwork, before, after, gap)`: the step a gap is shown after — the last step between
  its two owners whose dated start is on or before the gap's first day (e.g. an agent at an auction where the work
  wasn't sold), else the owner before it. Admin table and API (`show_after` on gap segments) use it; the site places
  gap lines by it. Test in `provenance-coverage.spec.js`.
- **Why:** owner: in "Carrière aux environs de Pontoise" the gap 1975–1980 (after the unsold Hôtel Rameau auction of
  4 June 1975, which splits 1964–1980 in two) was listed above the auction, next to 1964–1975.
- **Revert:** redeploy the previous commit; `DROP FUNCTION provenance_gap_anchor(bigint, int, int, daterange);`
  `DELETE FROM schema_migrations WHERE name = '079_provenance_gap_anchor.sql';`

### Frontend: the place popup in a time window explains the markers' numbers
- **What:** `map.ts` presencePopup — an artwork with numbered steps at the place is listed as on its marker ("steps 3,
  6, 9 of 11", then each holder by its number; `stepsAtPlace` in `map-provenance.ts`, shared with the marker popup)
  instead of plain "kept in" lines; everyone else as before. `openPresenceAt` finds the place from its data (nearest
  within 30 px), not from what is painted — a click right after drawing came before the circles were rendered.
- **Why:** owner: since the marker opens the place popup, the numbers on it were no longer explained.
- **Revert:** revert the commit.

### Frontend: in a time window, a numbered stop opens the place's popup
- **What:** `drawProvenance` takes `onStop`; on the start map in a time window a click on an artwork's numbered stop
  opens the popup of the place circle under it (everyone there, the artwork's steps, "At the same time here") instead
  of the stop's own popup — the two overlapping things open one popup (`openPresenceAt`, a 28 px box around the stop;
  the stop's own popup when no circle is there). Test fixed: "artwork map: the provenance in chain order" measured a
  line while the map was still animating (now waits until it stops) — it failed now and then since before.
- **Why:** owner: the numbered marker covered the place circle, whose popup has the possible encounters.
- **Revert:** revert the commit.

### Admin: create an entry from a [[link]] being typed; readable suggestions in dark mode
- **What:** `editor/editor.js` — when nothing has exactly the typed name, the `[[` suggestions end with "＋ Create
  “James Cook”…": a small box asks for the type (remembered for next time), then `POST /lookup/create`
  (`routes/dashboard.js`) makes a minimal entry marked "to complete" — or returns the existing one of that type and
  name — and the link replaces the typed text. `[[person/james-cook` offers "＋ Create person “James Cook”" directly
  (name from the slug). A place is looked up with the place finder (first OpenStreetMap hit, as "+ find a place…").
  The suggestion list uses the panel's colours (CodeMirror's light default made unselected options unreadable in
  dark mode). e2e `linkcreate.spec.js`.
- **Why:** owner: create linked entries like in Obsidian; bright text on bright ground in the suggestions.
- **Revert:** redeploy the previous commit.

### Frontend: in a time window, an artwork that stayed in one place keeps its legend entry and numbered stop
- **What:** `frontend/src/map.ts` — `buildRoutes` skipped an artwork whose provenance has no segment in the window
  (no colour, no legend entry); now it gets its colour (a Point feature for the legend only — the line layers get only
  lines). `showPresence` draws the artworks' steps in the window as numbered stops (`drawProvenance` with the stops
  only, prefix `win-prov`, cleared with the other overlays), as without a window. Test in `site.spec.ts`.
- **Why:** owner: Dalí + "Carrière aux environs de Pontoise" in 1926–1927 — the painting (with Vollard in Paris) didn't
  appear in the legend and had no provenance marker.
- **Revert:** revert the commit.

### Frontend: lists and the header search are fetched again after 5 minutes
- **What:** `frontend/src/api.ts` keeps API responses in memory for 5 minutes (before: for the page's whole lifetime);
  `src/search.ts` reloads its index of every entry after 5 minutes likewise. Test in `site.spec.ts` (fake clock).
- **Why:** owner: searching "gau" found 3 of 63 artworks — the tab had loaded the list before 10 artworks (most of them
  Gauguin's) were added; a fresh load finds 13 of 73.
- **Revert:** revert the commit (GitHub Pages republishes).

## 2026-10-15

### Provenance coverage: gaps and time periods without a known holder (migration 078)
- **What:** view `provenance_spans`, function `provenance_coverage()`, view `provenance_completeness` (multiranges:
  life − documented − presumed = gaps; gaps name the holders before/after and undated candidates; 1933–1945 flagged).
  API: `provenance_coverage` on artworks (detail: segments; lists: summary), filter `?provenance_gap=1933-1945|any`,
  map `gaps` (beside the features and on each segment). Admin: a coverage bar above the provenance, gap lines in the
  table, research page `/quality/provenance-gaps` (longest silence in 1933–1945 first). E2E `provenance-coverage.spec.js`.
- **Why:** owner: highlight missing links and time periods in the provenance and on the map.
- **Revert:** `git revert`, deploy; `DROP VIEW provenance_completeness; DROP FUNCTION provenance_coverage(bigint);
  DROP VIEW provenance_spans;`.

### Provenance: every case the Kunsthaus documents (migrations 076/077)
- **What:** from a survey of the Kunsthaus Zürich's 4,151 provenances (20,666 lines): steps without a holder (role
  `event`: claims, settlements between others, collections dissolved); `theft` on custody steps + check
  `provenance_stolen`; `transfer`; several places per step (`provenance_places`, map stops and `kept_in` for each);
  RM prices (2–4 letters); roles `publisher`, `foundry`, `trustee`; numbers of a step (`provenance_numbers`, kinds lot,
  stock, EK, ERR, Munich, Linz, Alt-Aussee, Lugt …; admin `/provenance/numbers`, API `/v1/provenance-numbers`);
  authority `lugt` (link format not checkable from the server — the site is a JavaScript app); a step's `event_id`;
  dates "between X and Y", "13.VI.1913", "1.7.1949". Admin form, table, YAML (`further_places`, `numbers`, `event`),
  API, map. E2E `provenance-cases.spec.js`; unit tests for the dates.
- **Why:** owner: "do all 10 — a big focus on provenance".
- **Revert:** `git revert`, deploy; then 075's `provenance_periods`, 074/075's `edges` and `quality_issues_live`
  (pg_get_viewdef before 077), drop `provenance_places`, `provenance_numbers`, `provenance_number_kinds`,
  `provenance.event_id`, the lugt authority row; restore `provenance_check1` and the 3-letter currency check (076's
  enum values stay, unused).

### Data: Gauguin provenances checked line by line against the Kunsthaus records
- **What:** Idylle à Tahiti: Knoedler's 1934–36 consignment not sold (Phillips traded the painting to Newhouse);
  Tournesols: Bührle, his estate and the foundation passed on directly (no gap in the source), "inv. no. 46", a note on
  the two Walter Feilchenfeldts; L'Offrande: Thannhauser until 10 October 1929 (its stock book, the footnote — the line
  says 1928), Bignou and Reid until February 1930 (was one day); L'Univers est créé: printed 1921 by Pola Gauguin;
  La Brodeuse: one place label.
- **Why:** owner: are all Gauguin provenances correct and shown correctly?
- **Revert:** History → the change set (source import) → Revert.

### Provenance: a settlement doesn't end the ownership; no handover "via" itself (migration 075)
- **What:** `provenance_periods`: the next step that ends an owner's period skips settlements; `via` leaves out agents that
  are the holder of the step itself. E2E in `provenance-custody.spec.js`.
- **Why:** owner's review of the Gauguin works on the site: the foundation showed "1960–24 June 2025, end implied" for La
  Route montante; Knoedler bought Idylle à Tahiti "via M. Knoedler & Co.".
- **Revert:** `git revert`, deploy; then 074's `CREATE OR REPLACE VIEW provenance_periods`.

### Data: the Gauguin works with the new provenance fields (production)
- **What:** not sold: the 1933 Frederik Muller auction (La Route montante), the 1975 Hôtel Rameau auction (Carrière aux
  environs de Pontoise); La Route montante: settlement step of the foundation, 24 June 2025 (cited); provenance status
  with the Kunsthaus records cited — La Route montante D, Nature morte au couteau A ("kein NS-verfolgungsbedingt
  entzogenes Kulturgut"), Nature morte aux fleurs et à l'idole C; the status sentences removed from the step notes;
  L'Univers est créé designed 1893–1894 (the Noa Noa block); copy_after: Judith Gérard's copy → Van Gogh's
  Self-portrait, dedicated to Paul Gauguin (new, Q3643629, to complete), Bridge in the Rain → Sudden Shower over
  Shin-Ōhashi Bridge, Flowering Plum Orchard → Plum Park in Kameido.
- **Why:** owner: points 1–6 applied to the Gauguin works.
- **Revert:** History → the change set (source import) → Revert.

### Provenance: custody beside the ownership, unsold auctions, the 1933–1945 gap over undated steps, settlement, status A–D, design dates, copies (migrations 073/074)
- **What:** 073: `acquisition_method` `settlement`. 074: `provenance.not_sold`; `provenance_periods` takes the next /
  previous step of the ownership chain (owner, dealer, estate) — custodians and agents no longer end an owner's period
  or stand in as owners (204 → 180 derived handovers on production); handovers say `via` their agents; `held_by`
  "not sold"; view `provenance_gaps` and a `provenance_gap_1933_1945` check over the possible span of every handover
  not documented as direct, dated or not (4 → 30 findings, one per stretch); settlement answers a forced sale;
  `artworks.provenance_status` (BAK A–D) + note, `artworks.conceived` (used by the creator-life check), both citable;
  relationship type `copy_after`. Admin: "not sold" in the step form, "held alongside the owner" / "via …" in the
  table, the new artwork fields. API: `in_chain`, `not_sold`, `via` per step; `provenance_status`, `conceived`,
  `provenance_category` (lists). YAML: `not_sold`, `settlement`, the two fields. E2E `provenance-custody.spec.js`.
- **Why:** owner's review of the Kunsthaus Gauguin provenances (points 1–6).
- **Revert:** `git revert`, deploy; then restore the previous definitions of `provenance_periods`, `edges`,
  `provenance_chain`, `quality_issues_live` (from 063/064/068/069 — pg_get_viewdef before 074), drop `provenance_gaps`,
  the new columns, type `provenance_status` and the `copy_after` row (the enum value can't be dropped; it is unused).

### Data: the Kunsthaus Zürich's Gauguin works with their provenance (import, production)
- **What:** the 12 works of the collection's search "gauguin": 9 new — La Barrière (1981/0002), L'Univers est créé
  (Gr.2003/0154, woodcut printed 1921 by Pola Gauguin, co-creator "printer"), Le Bol blanc (1986/0002), Nature morte
  aux fleurs et à l'idole (1995/0007), Carrière aux environs de Pontoise (1981/0005, owned by the Vereinigung Zürcher
  Kunstfreunde, on loan since 1981), Idylle à Tahiti (BU 0045), La Route montante (BU 0048), Nature morte au couteau
  (BU 0178), Judith Gérard's copy after van Gogh's self-portrait for Gauguin (BU 0174); 2 updated — L'Offrande (was at
  the foundation with its "47": now Kunsthaus BU 0047 on loan since 2021, 47 as the foundation's further number; the
  two Wikidata citations of the old values removed) and La Brodeuse (Mette Gauguin) (loan label "2021"); Tournesols
  sur un fauteuil left as it is (has its provenance). 97 provenance steps, each cited with the record and its
  footnote; same one-off scripts as the Bührle import plus listed corrections (custodian deposits, joint dealers,
  unsold auctions, the source's "32.2.1891" read as February 1891); research findings as step notes (Semmel: a
  persecution-related sale, settlement 2025; Alfred Gold: BAK category C; Meirowsky). Le Bol blanc: no provenance
  published — two steps from its credit line. Created, "to complete": 2 artists, 32 people (16 with Wikidata), 14
  institutions; 6 places via OpenStreetMap (Béziers, Uster, Düsseldorf, Versailles, Cologne, Meudon).
- **Why:** owner: the Gauguin works of the Kunsthaus with their provenance — to see where the provenance tool falls short.
- **Revert:** History → the change set (source import) → Revert; or delete the 9 new artworks (numbers above) and the
  entries created with them (`auto_created.created_at` 2026-10-15).

### Privacy page updated; rate-limit addresses forgotten after 10 minutes
- **What:** `frontend/src/views/privacy.ts` (dated 15 October 2026): new section "Short links to a view" (what is stored,
  nothing about the visitor, IP in memory ≤ 10 minutes for the rate limit, links kept); images may also come from
  museums' open-access image servers (Met, Art Institute of Chicago, Cleveland, Rijksmuseum, SMK …), not only
  Wikimedia; "never sent to us" qualified; data abroad names those museums. `backend/src/routes/v1.js`: the
  short-link rate limiter drops an address 10 minutes after its last link (sweep every minute) — before, an address
  stayed until the next restart, which the page would have misstated.
- **Why:** owner asked whether the privacy page needs an update after the short links (072).
- **Revert:** redeploy the previous commit.

### Short addresses for long selections on the start map (migration 072)
- **What:** table `shared_views` (code, query, created, last used; not audited, anonymous) and
  `save_shared_view(q)`: code = first 8 hex digits of the query's SHA-256 (one more on a clash), the same query the same
  code. API `POST /v1/views` (text/plain; canonical query: keys sorted, `v`/`featured`/`all` dropped; ≤ 20 000
  characters; 60 new links per 10 min and address) opens its transaction `READ WRITE` — the API role stays read-only
  by default and may insert only here; `GET /v1/views/:id` follows renamed entries (`current_featured_query`).
  Frontend: `replaceQuery` stores a query longer than 300 characters 0.8 s after the last change and shows `/?v=<code>`;
  `/?v=` opens the stored selection (unknown code: a note and "show everything").
- **Why:** owner: a selection of 54 artists made a 1 007-character address. "All except" was rejected (new entries
  would change a shared link's meaning; small selections are the usual case).
- **Note:** the site's smoke tests (run against the live API) store their own test selection once — always the same code.
- **Revert:** redeploy the previous commit (frontend and backend); `DROP FUNCTION save_shared_view(text);
  DROP TABLE shared_views;` `DELETE FROM schema_migrations WHERE name = '072_shared_views.sql';` — short links then stop working.

### Admin: Start views get the slug from the title, cleaned as you type
- **What:** `editor/slug.js` works for every field marked `data-slug-field` besides the entry forms' `#f-slug`;
  the Start views form marks its slug field (following the title on a new view only, like entries). e2e in `featured.spec.js`.
- **Why:** owner: slug generation and formatting like elsewhere.
- **Revert:** redeploy the previous commit.

### Type and materials of artworks are glossary terms with translations (migrations 070, 071)
- **What:** 070: glossary category `object type`. 071: `term_by_name()`, `artworks.kind_term_id` (FK), join table
  `artwork_materials`, triggers `artworks_link_terms` / `artworks_material_links` (link names to terms, store the term's
  main name), `glossary_relink_artworks` (renames, new names), `artwork_term_names()` (every name of an artwork's terms
  incl. those its medium mentions); starter terms in English and German (oil painting, painting, sculpture, woodblock
  print, pastel; oil paint, canvas, copper, paper, ink, pastel crayon, wood, gold, cardboard); existing values linked
  (on production: Ölgemälde → oil painting, Painting → painting; 6 values left to sort out); quality check
  `unlinked_term`; object types / materials need no description. Admin: suggestions in every language, the medium
  helper knows the German names, new single words become flagged terms, type and materials link to the glossary,
  batch page `/quality/batch/terms` (replace by terms / move to the medium / make a term). API: `kind_term`,
  `material_terms`, `term_names`; `?kind=` / `?material=` by any name. Frontend: search matches every name; type and
  materials link to the glossary.
- **Why:** owner: museums give type, medium and materials in English or German — a search for "woodblock print"
  should find the Holzschnitte too.
- **Tested:** migrations on a restored copy of production; unit 40, e2e 160 passing (new `terms.spec.js`, glossary fixtures).
- **Revert:** redeploy the previous commit, then as owner: `DROP TRIGGER glossary_relink_artworks ON glossary;
  DROP TRIGGER artworks_link_terms ON artworks; DROP TRIGGER artworks_material_links ON artworks; DROP TABLE
  artwork_materials; ALTER TABLE artworks DROP COLUMN kind_term_id;` re-create 068's `quality_issues_live`; drop the
  functions; the starter terms may stay; `DELETE FROM schema_migrations WHERE name IN ('070_…', '071_…');` (the
  enum value stays — Postgres can't drop one).

## 2026-10-15

### Admin: spell check re-run when a text's language changes (Firefox)
- **What:** `editor/editor.js` — after the language (lang attribute) of a Markdown editor changes, spell checking is
  turned off and on again, so Firefox checks the text anew with the new dictionary instead of only on the next focus.
- **Why:** owner (Firefox): the editor showed DE but words were still checked as English. Firefox also needs the
  German dictionary installed (right-click in the field → Languages); otherwise it stays with English whatever the page says.
- **Revert:** redeploy the previous commit.

## 2026-10-14

### Curated start views (migration 069, `GET /v1/featured`, admin "Start views")
- **What:** table `featured_views` (audited) with `featured_query_refs()`, `current_featured_query()` (old slugs →
  current), BEFORE trigger, one more step in `record_slug_change()`, intro in `markdown_columns`, view
  `featured_view_problems`. API `GET /v1/featured` (published, ordered; query read through `current_featured_query`).
  Admin `/featured` (`routes/featured.js`): paste a site URL (normalized: commas readable, `patrons` → `people`, the
  site's `featured`/`all` dropped), preview link, problems listed, publishing refused while there are problems, drag
  order; a notice on the Quality page. E2E `featured.spec.js`.
- **Why:** frontend request (frontend/README.md → "Curated start views"): the home page shows curated views.
- **Revert:** `git revert`, deploy; then `CREATE OR REPLACE FUNCTION record_slug_change()` with 042's body, `CREATE OR
  REPLACE VIEW markdown_columns` without featured_views, `DROP TABLE featured_views CASCADE`, drop the three functions.

### Admin: endless lists
- **What:** the lists (and the history pages) load the next page by themselves when you scroll near the end
  (`src/admin/editor/infinite.js`: IntersectionObserver, rows of the next page appended, its pager taking over; a
  MutationObserver picks up lists swapped by the live search). The page links stay for a reload / without scripts —
  "← previous / more →" for alphabetical lists, "newer / older" for the history. E2E `infinite.spec.js`.
- **Why:** owner: scroll through all entries without pages.
- **Revert:** `git revert`, deploy.

### Admin: batch pages — Wikidata items with dates and "to complete" filter; images for artworks without one
- **What:** `/quality/batch/wikidata`: each entry with what we know (dates, works held, why it was created), each hit
  with its years from Wikidata (one `wbgetentities` for the page, `getEntitiesBatch()`); an exact name is no longer
  pre-selected when the years contradict ours ("dates differ"); `?only=auto` = entries created automatically (also
  the batch link of the `auto_created` check). New `/quality/batch/images`: artworks without an image, every keyless
  image source searched by title + artist, 3 hits each (only hits sharing a word with title/artist), Add returns
  there. Links on the Quality page. Commons titles without their hidden QuickStatements text. E2E in
  `queue.spec.js`, `imagesearch.spec.js`.
- **Why:** owner's improvement list of 2026-10-14 (167 entries to complete, 24 artworks without an image).
- **Revert:** `git revert`, deploy.

### Provenance research: flags on holders (068) and links for 1933–1945
- **What:** migration 068: `provenance_flag` (people, institutions, artists), `holder_flag()`, check `flagged_holder`
  in `quality_issues_live` (058's view, extended from production's definition). Admin: "Provenance flag…" in the
  edit form; ⚑ on flagged holders in the provenance; "Research 1933–1945" under the provenance — holders of the period
  with links to Lost Art (name searched), Proveana, ERR (Jeu de Paume) owners, Getty Provenance Index.
  E2E in `provenance.spec.js`.
- **Why:** owner's improvement list of 2026-10-14 — the 1933–1945 gaps need looking up; the owner keeps the list
  of names to watch.
- **Revert:** `git revert`, deploy; then `CREATE OR REPLACE VIEW quality_issues_live` without the two flagged_holder
  branches, `DROP FUNCTION holder_flag`, drop the three columns.

### API compressed; inventory constraint validated (067); creation from the workplace; reference records on the edit page
- **What:**
  - nginx `api.arthistory.piogino.ch`: `gzip_proxied any`, `gzip_types application/json application/geo+json`
    (the artworks list 51 KB → 10 KB). Copy in `server-docs/config/nginx/arthistory`.
  - Migration 067: `VALIDATE CONSTRAINT artworks_inventory_needs_institution` (The Great Wave fixed; 016 added it NOT VALID).
  - Provenance map: the creation's place, failing a recorded or dated one, is the artist's one undated "worked in"
    place (`place_basis: artist_workplace`, "probably").
  - Admin: reference records are added and removed on the edit page under the Wikidata id (like further numbers);
    the entry's page lists them with the GND / SIKART comparisons.
- **Why:** owner's improvement list of 2026-10-14.
- **Revert:** nginx: remove the three gzip lines from the api server block, `sudo nginx -t && sudo systemctl reload nginx`;
  067: `ALTER TABLE artworks DROP CONSTRAINT artworks_inventory_needs_institution, ADD CONSTRAINT … NOT VALID` (016's
  definition); the rest: `git revert`, deploy.

### Admin: "Yes, it still does" on a source whose value changed
- **What:** an outdated citation ("The value changed since — does the source still support it?") has a button that
  records the current value as the cited one (`cited_value = field_value(…)`, as when published) and, for dated
  sources (web page, Wikidata), sets accessed to today. `POST /citations/:id/confirm`, `citations.confirm()`; in place
  like add/remove (`editor/cites.js`). E2E in `citations.spec.js`.
- **Why:** owner: there was no way to answer yes and clear the warning (only remove).
- **Revert:** `git revert` this commit, deploy.

### Admin: further numbers entered on the edit page
- **What:** an artwork's further numbers (048) are added and removed on its edit page, under the inventory number
  (inputs inside the entry's form that belong to two small forms after it, `form="…"` — saved at once, not part of
  the shared working copy); its page lists them with a link there. `numbers.section` / `listSection` / `formsAfter`,
  `ctx.afterField` in `forms.js`; `?back=edit` redirects. E2E in `numbers.spec.js`.
- **Why:** owner: numbers belong with the inventory number on the edit page.
- **Revert:** `git revert` this commit, deploy.

### Artwork maps: the provenance in the chain's order, with how sure each part is
- **What:** `/v1/map/artworks/:slug` has a new member `provenance` (FeatureCollection): a stop per step with a place
  (`place_basis` recorded / holder_seat / created_in / artist_residence, `precision`), segments between them (`direct`,
  `implied`, `between` = steps without a place), `unplaced`. Built from `provenance_chain` in position order with
  `row_number()` / `lag()`; the creation's place = `created_in`, else the artist's single dated place then.
  `features` unchanged. E2E checks in `provenance.spec.js`; docs/api.md.
- **Why:** owner: show the creation and every step however patchy — dates are often missing, the order never is.
- **Revert:** `git revert` this commit, deploy (the frontend ignores a missing `provenance`).

### Fix: map route with an open-start stop ("until 1912") drawn last
- **What:** `/v1/map/<plural>/:slug` orders stops and the route by the range (`ORDER BY period`) instead of
  `lower(period)`, so an open start sorts first (−∞) rather than last (NULL). E2E check in `provenance.spec.js`.
- **Why:** Heiliger Sebastian's route looped Zürich → Frankfurt because "Albert Julius Ullmann, until 1912" came last.
- **Revert:** `git revert` this commit, deploy.

### Given and family names; artists and people sorted by family name (migration 066)
- **What:** `given_name`, `family_name` for artists and people, `sort_name` ("Filed as") for people too;
  `split_person_name()` + trigger `fill_person_names` (insert, or a changed name, when both fields are empty);
  existing entries filled (audit source `migration`); `person_sort_key()` for `entity_index.sort_key` and every order
  of artists/people (`src/sortkey.js`). Admin: the three fields in the Name section with hints. API: the three fields
  in lists and details; artists ordered by `sort_key` like everything else (docs/api.md).
- **Why:** owner: sort people by family name, not first name.
- **Left for the owner (not split, by design):** Japanese names (order varies in our spellings): Asai Chū, Eikō Hosoe,
  Hasegawa Tōhaku, Itō Jakuchū, Maruyama Ōkyo, Onchi Kōshirō, Tōshūsai Sharaku, Utagawa Kuniyoshi, Yukio Mishima;
  Kōshō; Baron Louis van der Heyden à Hauzeur, Charles III of Spain, José de Salamanca y Mayol, Thomas Harvey of
  Catton. Hokusai and Hiroshige keep their "Filed as".
- **Revert:** restore `entity_index` (definition before 066), drop the triggers and functions, the columns; revert.

## 2026-10-14

### Admin: spell check language of Markdown texts recognised (English / German) (no schema change)
- **What:** `src/textlang.js` `guessLang()` (shared with the browser bundle): counts common function words of each
  language (+ umlauts as a hint), ignoring [[links]], link targets and code; undecided for short or mixed texts.
  `editor/editor.js`: the editable area gets `lang` = the guess (on load and after a pause in typing), a toolbar
  button EN / DE shows it and switches it by hand for that field (then no more automatic changes); the preview gets
  the same `lang`. Unit test `textlang.test.js`, e2e `spelling.spec.js`.
- **Why:** owner: descriptions are written in English or German; the page said `lang="en"` for all of them.
- **Note:** the checking itself is the browser's: Firefox and Safari pick the dictionary by `lang` (German dictionary
  installed); Chrome / Edge check against every language enabled in their settings (add German there).
- **Revert:** redeploy the previous commit.

## 2026-10-13

### Fix: no dates, no lifespan (migration 065)
- **What:** the generated `lifespan` of artists and people is NULL when birth and death are both missing (was the
  unbounded range `(,)`). `ALTER COLUMN … SET EXPRESSION`; GiST indexes rebuilt.
- **Why:** reported by the frontend instance: `relationships[].entity.period` came as an object full of nulls for
  undated people (72 entries, mostly from the Bührle import) — the frontend's API-types test, run before every Pages
  deploy, failed. Also semantic: `(,)` overlapped every period, so range checks treated such people as everyone's
  contemporaries.
- **Revert:** `ALTER TABLE artists/people ALTER COLUMN lifespan SET EXPRESSION AS (daterange(lower(birth), upper(death)))`.
- **Tested:** dry run on prod (0 unbounded left, dated people unchanged); e2e `people.spec` + full suite.

### Data: 20 works of the Bührle Collection with their Kunsthaus provenance (import, production)
- **What:** 20 works picked at random (seed 20261013) from the Kunsthaus Zürich online collection's Bührle search (198
  with BU numbers; the 3 we had left out): BU 0003, 0014, 0016, 0030, 0033, 0037, 0061, 0063, 0079, 0096, 0117, 0121,
  0123, 0136, 0140, 0145, 0152, 0172, P.11, P.19. Read from the collection's Solr index (`/solr/published`:
  `provenance_ss`) and item pages (footnotes per line, dimensions, catalogue raisonné); parsed by a one-off script
  (dates incl. "frühestens ab"/"spätestens ab"/"mindestens bis"/"höchstens bis", roles Kunsthändler/Sammler/Auktion/
  Vermittler, methods incl. Beschlagnahme/Verwahrung/Restitution, "wohl" → probable, joint holders, estates, heirs,
  prices with German/Swiss thousands separators), reviewed line by line, loaded in one transaction (audit source
  `import`, user pio). Per work: creator/attribution ("Workshop of", "Circle of", "Swabia [Ulm?]"), date, kind,
  medium, dimensions, BU inventory number at the Kunsthaus on loan since 2021, the foundation's number and the
  catalogue raisonné as further numbers, fields cited with the Kunsthaus record; 177 provenance steps, each cited with
  the record and its footnote (≤ 400 characters). Created, "to complete": 12 artists, 58 people, 19 institutions (33
  with a Wikidata id — accepted only when name and birth year agree); 14 places via OpenStreetMap (Venice, Bern,
  Basel, Lucerne, Geneva, Brussels, Budapest …, with parent regions where missing).
- **Why:** owner: provenance and relationships for 20 random Bührle works, like Tournesols sur un fauteuil.
- **Review:** the quality checks flag 3 undocumented changes of owner 1933–1945 among them; 56 new entries without a
  Wikidata id → Quality → "Find Wikidata items for these…"; all new entries → Enrich.
- **Revert:** History → the change set (source import) → Revert; or delete the 20 artworks (BU numbers above) and the
  entries created with them (`auto_created.created_at` 2026-10-13).

### Provenance: period labels as they read (migration 064); Tournesols sur un fauteuil entered
- **What:** 064 — a step with an undated acquisition but a recorded end: period `(,end]`, "until 17 November 1928"
  (was blank); acquired within a span ("between 1901 and 28 October 1904", "… or earlier"): "until <end>"; the
  implied artist line before such a step: "1901 – by 28 October 1904".
  Data (production, as SQL in one transaction, audit source `sql`, user pio): Tournesols sur un fauteuil (BU 0046)
  now has the Kunsthaus Zürich provenance — 11 new steps before the 3 recorded (Vollard as dealer, 200 FRF; Léo and
  Gertrude Stein jointly; Vollard again by exchange; whereabouts unknown; Halvorsen; Galerie Thannhauser, ca. USD
  18,000; Josef Stránský and his estate; Wildenstein & Co.; Sam Salz; Oskar Homolka "26 March 1952 or later";
  Walter Feilchenfeldt sen.), each cited with the Kunsthaus record and its footnote's reference; Bührle's estate as
  Bührle in the role estate; the loan as the implied last line. Created, "to complete" (with Wikidata ids):
  8 people, Galerie Thannhauser, Wildenstein & Co.; places Berlin, Los Angeles.
  Noted on the Feilchenfeldt step: the Kunsthaus names Walter Feilchenfeldt (*1939), but the dealer in 1952 was his
  father (1894–1953; Wikidata Q2544162 vs. Q107177051).
- **Why:** owner: the Tournesols provenance as the first complete example of the model.
- **Revert:** 064: restore the views from 063. Data: revert the change set in History (source sql), or delete the
  11 steps (positions 0–10) and the created entries.

### Provenance: roles, joint owners, prices, one-sided dates, the artist and the loan as implied lines (migration 063)
- **What:** enum `holder_role` + `provenance.role`; table `provenance_co_owners` (+ view `provenance_co_owners_x`,
  audited, quality trigger); `price`, `price_currency`, `price_note`; `held_by` (derived) for agents/custodians,
  `commissioned` now derived from a provenance step with the method commission (none were stored); the lender's step is
  ongoing during a loan; view `provenance_chain` = implied first line (the artist, from creator + creation date) +
  recorded steps + implied loan line. Admin: role, joint owners (3 pickers), price on the step form; the chain on the
  artwork page (implied lines in italics, not editable). API: `provenance[]` gains `kind`, `implied`, `role`,
  `co_owners`, `price` (docs/api.md). YAML: `role`, `co_owners`, `price`. Fuzzy dates: "26 March 1952",
  "… or later" / "not before" / "at the earliest", "… or earlier" / "by" / "at the latest", "after …", "before …"
  (open ranges). Wikidata P88 "commissioned by" → the first provenance step (cited P88), not a relationship.
- **Why:** owner: provenance vs. relationships, going through the Kunsthaus provenance of "Tournesols sur un
  fauteuil" (17 lines: dealers, an estate, two owners at once, prices, "at the earliest"/"at least until", a loan).
- **Known limit:** "revert/restore from history" doesn't restore a step's joint owners (the table isn't in revert.js
  yet); "Change type…" refuses an entry that is a joint owner (it says so).
- **Revert:** drop the view `provenance_chain`, restore `edges` and `provenance_periods` (definitions before 063),
  `DROP VIEW provenance_co_owners_x; DROP TABLE provenance_co_owners;` drop the columns role, price, price_currency,
  price_note and `TYPE holder_role`; `DELETE FROM relationship_types WHERE code = 'held_by'`;
  `UPDATE relationship_types SET derived = false WHERE code = 'commissioned'`; revert the commit.
- **Tested:** dry run on prod (Tournesols: implied artist + 3 steps + implied loan); e2e `provenance-roles.spec`, unit
  tests for the dates, full suite.

### Fix: stored quality findings keyed per entry (migration 062)
- **What:** `quality_issues` primary key (check_id, issue_key) → (check_id, issue_key, entity_type, entity_id);
  `refresh_quality()` takes each finding once (DISTINCT ON) and matches on all four.
- **Why:** a possible duplicate is one finding on both entries (two rows, same issue_key): since 058 the refresh failed
  ("ON CONFLICT DO UPDATE command cannot affect row a second time") whenever two entries looked alike — pages then
  waited 5 s and computed the checks live. Production had no such pair yet; a test run did. Acks stay per
  (check_id, issue_key). Regression test in `quality.spec`.
- **Revert:** revert the commit; `ALTER TABLE quality_issues DROP CONSTRAINT quality_issues_pkey, ADD PRIMARY KEY (check_id, issue_key)`
  (fails while a duplicate pair is stored) and the 058 version of `refresh_quality()`.

### Sorting: titles without their leading article, natural order (migration 061)
- **What:** `strip_article(key, lang)` (the title's language picks the articles: en, de, fr, it, es, pt, nl; without a
  language only unambiguous ones — not English "I", not "de"/"des"; elided L'/un'/'t too) and
  `entry_sort_key(type, name, ruby, names, lang)` — articles dropped for titles (artworks, institutions, movements,
  events, sources, glossary), kept for people and places ("Le Corbusier", "La Paz"). `entity_index.sort_key` uses it.
  ICU collation `sort_natural` (`und-u-kn`: accents with their letter, case-insensitive order, "No. 2" before "No. 10")
  instead of the database's byte order (C.UTF-8) — applied at the queries (`src/sortkey.js`: API lists, related lists,
  search, map, graph, admin lists, pickers, quality). The admin list shows the sort key under a name only when it is a
  romanization. The API's `sort_key` (used by the frontend for its lists) carries the new key.
- **Why:** owner: ignore articles in sorting; byte order put "Zürich" before "abbey" and "Édouard" after "Zurbarán".
- **Revert:** restore the view `entity_index` with `name_sort_key(...)` (its definition before 061) and
  `DROP FUNCTION entry_sort_key(entity_type, text, text, jsonb, text), strip_article(text, text); DROP COLLATION sort_natural;`
  (without CASCADE — entity_index has dependent views); revert the commit.
- **Also:** dev's views `entity_index`, `provenance_periods`, `edges`, `quality_issues_live` were dropped by a mistaken
  `DROP … CASCADE` while re-applying 061 on dev, and recreated from production's schema (`pg_dump --schema-only -t …`).

### Admin: more control over the comparisons' suggestions (GND, SIKART, RKD, LC, BnF, KulturNav, NLK, Wikidata)
- **What:** each relationship suggestion has its own choice: add · create (a place found in OpenStreetMap; **a new
  artist or person** we don't have — minimal, "to complete", with the record's GND number) · **another of ours**
  (a picker; `data-lookup="artist,person"` now allowed: value "type/slug"; the picked entry does *not* get the
  record's number or Q-id — it may be a stand-in, e.g. the region for a village) · skip. Relationships we already have: **"cite <source> for it"** (ticked) — also on Wikidata's
  suggestions. Sections whose values all went into the merged rows say so instead of "Nothing to compare".
  `src/admin/targets.js` (pickedTarget), `gnd.apply` (choices `rel.<i>` = add|new-artist|new-person|other|skip,
  `relto.<i>`, `citerel.<i>`), `wikidata.apply` (`other`, `citerel`), citations not duplicated.
- **Why:** owner: no way to create an entry we don't have from the authority files' suggestions; little control.
- **Revert:** revert the commit.
- **Tested:** e2e `enrich-control.spec` (cite existing, link a place by hand, create a person with its GND number;
  Wikidata: cite existing, link another) + full suite.

### Admin: Europeana and Smithsonian in the image search only with own API keys too
- **What:** like DigitaltMuseum: no fallback to the demo keys (`api2demo`, `DEMO_KEY`); the source appears once
  `EUROPEANA_KEY` / `SMITHSONIAN_KEY` is set in `~/.config/arthistory/backend.env`.
- **Why:** Europeana's terms of use (API section): Personal API keys are "for individual, non-production use", Project
  keys for production — this site needs a (free) Project key; api.data.gov's DEMO_KEY is for exploring before signing up.
  Content use was already as the terms ask: only open rights statements, with licence, credit and source link.
- **Revert:** revert the commit.

### Admin: DigitaltMuseum in the image search only with an own API key
- **What:** `imagesearch.js` offers DigitaltMuseum only when `DIMU_KEY` is set (no fallback to the "demo" key any more).
- **Why:** owner noticed: DigitaltMuseum gives keys only to museums/organisations with an agreement, and its API docs say
  the "demo" key is for testing — not for a site's everyday use. Europeana carries much of the Norwegian/Swedish museum
  content too.
- **Revert:** revert the commit (or set `DIMU_KEY` in `~/.config/arthistory/backend.env` once a key is granted).

## 2026-10-12

### Admin: KulturNav, National Library of Korea, ArCo on the Enrich page; SMK and DigitaltMuseum in the image search (migration 060)
- **What:** 060 adds the authorities `kulturnav` (P1248) and `nlk` (P5034) with bibliography sources. Readers
  `kulturnav.js` (persons: birth/death by the day with places, VIAF/ULAN/LC) and `nlk.js` (lod.nl.go.kr SPARQL: years,
  birthplace — "경기도 안산" → 안산시 in Korea —, Korean name and hanja/art names) → `records.js`, which now also offers
  **other names** (ticked ones appended to the names; the Enrich page merges those of all sources with Wikidata's and
  the Japan Search reading). Place lookups take a country hint (OpenStreetMap otherwise found 안산 = Anshan, China).
  `arco.js`: Italy's Catalogo generale (dati.beniculturali.it, CC BY) — the works it catalogues for a person, found
  through the Wikidata item; information only. `imagesearch.js`: SMK (public domain, IIIF) and DigitaltMuseum (only CC0 /
  PDM / CC BY / CC BY-SA; `DIMU_KEY`, demo key until then).
- **Not built (unreachable from this server):** Prado and Biblioteca Nacional de España, Gallica, Finna (bot
  protection), Taiwan's National Palace Museum (no answer), Korea's e-museum (needs a data.go.kr key), Paris Musées
  (needs an account token), Fondazione Zeri (502 all day).
- **Why:** owner: more countries' databases.
- **Revert:** delete the `kulturnav`/`nlk` identifiers and authorities, the two bibliography rows if uncited,
  `DELETE FROM schema_migrations WHERE name = '060_nordic_korean_authorities.sql'`; revert the commit.
- **Tested:** live (Munch in KulturNav, Kim Hong-do in the NLK, Canova's 180 works in ArCo, Hammershøi at SMK, Munch in
  DigitaltMuseum); e2e `enrich-world.spec`, `imagesearch.spec`.

### Fix: deploy tests crowded out the live site's database connections
- **What:** pool sizes configurable (`DB_ADMIN_POOL_MAX`, `DB_API_POOL_MAX`; production keeps 3 / 5); the e2e test
  servers run with 2 / 2 (`test/e2e/env.js`). Role limits raised (`sudo -u postgres psql`): `arthistory_admin` and
  `arthistory_api` CONNECTION LIMIT 10 → 16 (also in `db/setup-roles.sql`). `max_connections` stays 30.
- **Why:** at 14:55 a deploy's tests failed and the live admin logged "too many connections for role
  arthistory_admin": since today two test servers run side by side, each with an admin pool and the quality listener
  (058), all on the same role as production (limit 10). Measured after the fix, a full run peaks at 7/16 admin,
  4/16 api, 13/30 connections in all.
- **Revert:** `ALTER ROLE arthistory_admin CONNECTION LIMIT 10; ALTER ROLE arthistory_api CONNECTION LIMIT 10;` (as
  postgres) and revert the commit — or run the tests one at a time (`E2E_WORKERS=1`).

### Admin: image search in Rijksmuseum, Europeana, Smithsonian, Japan Search; Japan Search on the Enrich page
- **What:** `imagesearch.js`: four more sources, each only with reusable rights — Rijksmuseum (search API → Linked Art
  object → visual item → digital object, only "downloadbaar", IIIF resized), Europeana (`reusability=open`: CC0, PDM,
  CC BY, CC BY-SA), Smithsonian Open Access (CC0 media), Japan Search (PDM, CC0, CC BY, CC BY-SA). Europeana and the
  Smithsonian take `EUROPEANA_KEY` / `SMITHSONIAN_KEY` from `~/.config/arthistory/backend.env` (free; demo keys until
  then — placeholders in `backend/.env.example`). `japansearch.js`: on the Enrich page of an artwork with a Japanese
  title, the impressions in Japanese collections (holder, rights, link — never taken as ours) and the reading offered
  as furigana word by word.
- **Why:** owner: more art databases.
- **Revert:** revert the commit.
- **Tested:** live (Nachtwacht in the Rijksmuseum, Hodler in Europeana, Hokusai in the Smithsonian and Japan Search; the
  reading of 名所江戸百景 亀戸梅屋舗); e2e `imagesearch.spec` (only free records of each), `japansearch.spec`.

### Admin: new bibliography entries from an ISBN or DOI
- **What:** `src/admin/booklookup.js` + `GET /bibliography/new/lookup?id=…` (box on the new-source form): an ISBN →
  Open Library (`/api/books?jscmd=data`), a DOI → Crossref (`/works/<doi>`): kind, title, subtitle, authors/editors as
  "Surname, Given", container, volume, issue, pages, place, publisher, year, ISBN/DOI → the new-entry form (draft), slug
  "surname-year"; where it came from in metadata.sources. An ISBN/DOI already in the bibliography opens that entry.
- **Why:** on the "ideas later" list; owner asked for it with the other databases.
- **Revert:** revert the commit.
- **Tested:** live (a book by ISBN; an article and a lexicon entry by DOI); e2e `booklookup.spec`.

### Admin: Metagrid, the Library of Congress, the BnF and RKD on the Enrich page (migration 059)
- **What:** 059 adds the authorities `bnf` (P268), `idref` (P269), `hls` (P902), `dodis` (P701), `fotoch`; RKD's
  links point at rkd.nl/en/explore; bibliography sources `lc`, `bnf` (institution) and `rkd` (scholarly).
  `src/admin/metagrid.js`: the person searched by name in Metagrid (api.metagrid.ch); a concordance containing one of
  our numbers is taken as the same person, otherwise candidates (same dates first, one alone pre-selected); ticked
  numbers → reference records; other databases listed as links. `src/admin/records.js`: a person's record → the GND-
  shaped comparison (dates, born/died in — places also by Wikidata id —, numbers); used by SIKART and the new readers
  `lc.js` (id.loc.gov JSON-LD, EDTF dates), `bnf.js` (data.bnf.fr SPARQL), `rkd.js` (data.rkd.nl, CIDOC-CRM: about
  seven requests per person, remembered). All in `authority.SOURCES` → Enrich compares them and has `/…/lc`, `/…/bnf`,
  `/…/rkd` pages like the GND's.
- **Why:** owner: more databases, Swiss ones above all; Metagrid fills the numbers the comparisons need.
- **Revert:** `DELETE FROM authorities WHERE code IN ('bnf','idref','hls','dodis','fotoch')` (after deleting their
  `entry_identifiers`), the three bibliography rows if uncited, `DELETE FROM schema_migrations WHERE name = '059_more_authorities.sql'`; revert the commit.
- **Tested:** live reads for Hodler (LC, BnF, RKD, Metagrid: 8 of our authorities in his concordance); e2e
  `enrich-more.spec` (Metagrid pick → 4 numbers; SIKART + RKD + LC + BnF: birth cited by all four, death by the two that
  agree, one born-in cited by three).

### Admin: Enrich page and the Quality queue
- **What:** *Enrich…* (`/<type>/<slug>/enrich`, `src/admin/enrich.js`): Wikidata, the GND and SIKART on one page, one Apply in
  one transaction (audit source `enrich`). Date fields several sources give are one row (grouped by date range); the
  picked value is cited by every source that gives it. The rest per source with its usual controls; a relationship two
  sources suggest is created once and cited by both (`gnd.apply` looks for it with any period first); numbers Wikidata
  offers too are offered once. Sources without a number link to "Find on Wikidata…" / "Find in SIKART…". GND/SIKART
  comparison logic and tables moved to `src/admin/authority.js` (shared). Buttons: "Enrich…" on every entry and on
  "to complete" entries.
  *Quality queue* (`quality.js`, `routes/queue.js`): info groups folded; "Work through these →" per group → the entry
  with a queue bar (its findings of that check, how to fix, **Next issue →**, Back to the list) → `/quality/next`;
  "Enrich…" on rows of checks it helps with. Batch pages: `/quality/batch/wikidata` (best Wikidata hits per entry
  without an id, exact names pre-selected, linked in one go) and `/quality/batch/cite` (weakly sourced entries with a
  GND/SIKART number: agreeing values cited in one go).
- **Why:** owner: one pass instead of three per entry; work through the findings without going back to the list.
- **Revert:** revert the commit (no migration).
- **Tested:** e2e `enrich.spec` (Wikidata + GND: one row per date, cited by both; one relationship cited by both; no
  source), `queue.spec` (folded, next, end of list, both batch pages) + full suite.

### Admin: data-quality findings stored, refreshed after changes (migration 058)
- **What:** the checks view is now `quality_issues_live`; `quality_issues` is a table with the last result,
  updated by `refresh_quality()` (only changed rows). A deferred constraint trigger on every content table bumps the
  sequence `quality_changes` and sends `NOTIFY quality_changed` at commit; the server LISTENs (own connection,
  `arthistory-quality`) and refreshes 0.5 s later, and once at start. The Quality page and dashboard wait for a pending
  refresh (max 5 s, else computed live); an entry page reads the table, or its own checks live while a refresh is due.
  Not a materialized view: PG 17+ builds those with a restricted search_path, which our functions don't survive.
- **Why:** owner: faster pages. Quality page / dashboard ~1 s → a few ms; entry page −0.3 s. Refresh ~0.45 s, in the
  background.
- **Revert:** drop the triggers `quality_changed` (all tables), the functions `quality_changed()`, `refresh_quality()`,
  `quality_fresh()`, the tables `quality_issues`, `quality_refresh`, the sequence `quality_changes`; then
  `ALTER VIEW quality_issues_live RENAME TO quality_issues;` `DELETE FROM schema_migrations WHERE name = '058_quality_stored.sql';`
  and revert the commit.
- **Tested:** dry run on prod (534 = 534 findings, triggers on 24 tables); dev: fresh → change → stale → refresh → fresh,
  admin role can't write the table; e2e quality (page brought up to date before showing) + full suite.

### Admin: answers of outside services remembered for 15 minutes
- **What:** `src/admin/remember.js` (`memo()`: per process, in memory, concurrent requests share one fetch, failures not
  kept, at most 500 entries). Used by Wikidata (replaces its own 10-minute cache), the GND (lobid), SIKART and Nominatim.
- **Why:** owner: Apply of a comparison fetched the record again — slower, and it could differ from what was reviewed.
  Our own values are still read fresh on Apply.
- **Revert:** revert the commit.
- **Tested:** unit (`test/remember.test.js`), e2e sikart/authorities/wikidata/city/places.

### Admin: index.js split into route files (no change in behaviour)
- **What:** `src/admin/index.js` (2,100 lines, 67 routes) → `index.js` (middleware, login, mounting order, error page),
  `core.js` (shared: `send`, `withTx`, `friendly`, history tables, relationship forms, `findEntity`, `notFoundPage`,
  `pluralParam`, `formContext` …) and `routes/` — revert, dashboard, relationships, citations, compare, provenance,
  wikidata, entries, tools — mounted in the old order. Each route file registers `router.param('plural', pluralParam)`
  (param handlers don't reach sub-routers). Imports generated from what each file uses, checked with ESLint `no-undef`.
- **Why:** owner: easier and safer changes.
- **Revert:** revert the commit.
- **Tested:** full unit + e2e suite (128).

### Tests: end-to-end specs in two workers, each on its own database and server
- **What:** created the databases `arthistory_test_1` and `arthistory_test_2` (`db/setup.sh`, owner `arthistory_owner`).
  `test/e2e/env.js` gives each Playwright worker a shard (database + server port: :3006, :3008, :3009); `global-setup.js`
  prepares them side by side; specs use `API`/`BASE` from `helpers.js` instead of a fixed port. Default 2 workers
  (`E2E_WORKERS`, max 3); the tests use the minified admin bundle (`build:admin:test`).
- **Why:** owner: faster test runs (every deploy runs them). Full suite 4.4 → 3.2 min. With 2 CPUs the run is CPU-bound:
  3 workers were no faster than 2.
- **Revert:** `E2E_WORKERS=1` (one after another, one database), or revert the commit;
  `sudo -u postgres dropdb arthistory_test_1` / `arthistory_test_2`.

### Admin: GND/SIKART comparison — every item a choice, ticked by default; missing places created from OpenStreetMap
- **What:** on "Compare with the GND/SIKART" every row has its own tick: agreeing values (`cite.<field>`, ticked: cited),
  relationships (ticked), reference records (ticked when new). A place the record names that we don't have — by GND
  number or name — is looked up in OpenStreetMap (`placefinder.settlementByName`, Nominatim, settlements): ours under
  another name ("Genf" → our Geneva, by Wikidata id or name within 50 km) or offered as a new place, created on Apply like
  the city found on save (`createPlaceFrom` in index.js: names, Wikidata point, parent region). With the GND, a created
  place gets its GND number. No migration.
- **Why:** owner: Hodler's places of birth and death (Bern, Genf) could not be taken, and items could not be chosen one by one.
- **Revert:** revert the commit (places created meanwhile stay — ordinary entries).
- **Tested:** e2e (`sikart.spec`: Genf → new Geneva with Q71, an agreeing value unticked → not cited; `authorities.spec`:
  defaults ticked, Giverny not found); live Nominatim for Genf, Giverny, Gurzelen.

## 2026-10-09

### Admin: SIKART (SIK-ISEA) — portal links, find by name, compare (migration 057)
- **What:** 057 points SIKART reference records at the new research portal (`recherche.sik-isea.ch/sik:person-{id}/in/sikart`)
  and adds the bibliography source `sikart` (scholarly). Pasted portal or old sikart.ch links give the number.
  `src/admin/sikart.js` reads one record from the portal's API (`api.recherche.sik-isea.ch`, `SIKART_BASE`): birth/death
  and places parsed from the biographical note, GND/VIAF numbers, Heimatort/citizenship (shown only). The GND comparison
  page in index.js is now shared (`COMPARE`): "Compare with SIKART…" takes dates (cited), adds born/died-in relationships
  to our places (cited), and GND/VIAF as reference records; "Find in SIKART…" (no number yet) searches by name, "This one"
  stores the number and opens the comparison. Artists and people only.
- **Why:** owner: integrate the SIK-ISEA research portal. Facts only — the portal publishes no terms for its API, so
  lexicon texts and images stay links; requests are single records on demand.
- **Revert:** `UPDATE authorities SET name = 'SIKART', url_template = 'https://www.sikart.ch/KuenstlerInnen.aspx?id={id}' WHERE code = 'sikart';`
  (the `sikart` source can stay, or delete it with its citations); revert the commit.
- **Tested:** unit (`test/sikart.test.js`), e2e (`sikart.spec`, fixtures for search and record), live record of Ferdinand Hodler
  read through the module; dry run on prod (rolled back).

### Admin: the fields an error is about are marked in red — also for the database's rules
- **What:** `RULE_FIELDS` (index.js): which fields each database rule concerns (inventory number ↔ institution, loan,
  dimensions, parent …) — `errorKeysOf` marks them like "field: message" errors. A thicker red frame and red label;
  "Marked in red: …" links under the messages; `editor/errors.js` opens a collapsed group, scrolls to the first marked
  field and focuses it.
- **Why:** owner: an error message should show where the field is.
- **Tested:** e2e (errors.spec).
- **Revert:** redeploy the previous commit.

### Fix: Change type failed for artists and into places / movements (migration 056)
- **What:** `convert_entry` re-created with `array_append(cols, '…')` instead of `cols || '…'` (Postgres read the
  untyped literal as an array: "malformed array literal"). Nothing had changed when it failed (rolled back).
- **Why:** owner: changing Andrew W. Mellon and Robert Sterling Clark from artists to people failed. 055's tests only
  covered institution → person.
- **Tested:** dry run of both real conversions on prod (rolled back: everything comes along, nothing dropped); e2e
  (types.spec: artist → person, institution → movement).
- **Revert:** redeploy the previous commit (055's function returns).

### The wrong kind of entry: warned, and moved to another type (migration 055)
- **What:** `type_doubt()` (name heuristic) → hint in the live box of new entries and quality check `type_doubtful`;
  `wikidata.typesOf()` (a Wikidata item's class) → a warning on the review page with the way to the right type, and a
  confirmation on Create (`type.ok`). `convert_entry()` + table `entry_moves`; admin "Change type…" (preview =
  rolled-back run), redirects of old addresses in admin and API, [[links]] rewritten.
- **Why:** owner: Henry Clay Frick was created as an institution (Wikidata Q93709 is a human); the only entry the
  heuristic flags on production.
- **Tested:** dry run on prod (rolled back); e2e (types.spec).
- **Revert:** redeploy the previous commit; as owner drop `convert_entry`, `entry_moves`, `type_doubt` and re-create
  052's `quality_issues`. Conversions are reverted from the history.

### Relationship "founded" / "founded by" (migration 054)
- **What:** relationship type `founded` (artist, person, institution → institution, movement; category membership;
  co-founders: one relationship each, label "co-founder"); the Wikidata comparison suggests founders from P112
  ("founded by") on institutions and movements. Tests: `reset.sql` now also empties the tables that point at entries
  by (type, id) — `entry_identifiers`, `citations`, `slug_history`, `wikidata_reviews`, `auto_created`,
  `quality_acks` (and `events`): with ids restarting at 1, old rows had attached to new entries.
- **Why:** owner: Thomas Gilcrease founded the Gilcrease Museum.
- **Tested:** e2e 123 passing (founded.spec).
- **Revert:** redeploy the previous commit; as owner `DELETE FROM relationship_types WHERE code = 'founded'` (after
  deleting such relationships).

### Authority files: reference records and a GND comparison (migration 053)
- **What:** tables `authorities` (ULAN, GND, VIAF, SIKART, RKD, Library of Congress — url template, number pattern,
  Wikidata property, entity types) and `entry_identifiers` (UNIQUE (authority, value): a number names one entry;
  trigger `check_identifier()`), merge and delete handle them; bibliography source `gnd` (institution). Admin:
  "Reference records" on entry pages (number or the record's link — the number is taken from it); the Wikidata
  comparison brings the numbers (also for new entries, `wd.ids`); a number another entry has = certain duplicate.
  "Compare with the GND" (`src/admin/gnd.js`, lobid.org): birth/death, founded/city; relationships born/died/worked in,
  collaborated with — matched by GND number or name (a target found by name gets the number); taken values cited with
  the GND and the record, agreeing values cited at once. API `identifiers`; YAML `identifiers:`.
- **Why:** owner: integrate Getty ULAN and the DNB. Getty's data services refused requests from this server (403) —
  ULAN is links only for now.
- **Tested:** dry run on prod (rolled back); live lobid record of Kandinsky read through the module; e2e (authorities.spec).
- **Revert:** redeploy the previous commit; as owner drop `entry_identifiers`, `authorities`, `check_identifier()`,
  re-create 049's `delete_entity_relationships` and `merge_entries`; the `gnd` source stays unless deleted.

### Admin: the quick select of sources remembers the exact page
- **What:** `citations.recentSources()` returns one chip per source *and page* (`DISTINCT ON (source_id, url)`, the
  latest citation of each); the chip sends that citation's id (`pick`) and `citations.add()` copies its source and
  page (a page typed now wins; accessed = today). Chips of web sources show the end of the page's address
  ("…/item/752012").
- **Why:** owner: a chip of the Kunsthaus collection cited the website, not the object's page.
- **Tested:** e2e 120 passing (citations.spec: a page chip cites the same page).
- **Revert:** redeploy the previous commit.

### Fix: menus of optional values always saved their first value (title status, a source's reliability / reading status)
- **What:** enum menus of nullable columns get an empty first choice (`formContext` → `enumsNullable`; for the title
  "original — not a translation"); readable names for the title statuses; label "Title: original or translation".
  Data (prod, by hand, source `sql`): `title_status` emptied for the two artworks the bug had set to "official"
  (*Das Jungfraumassiv von Mürren aus*, *La Route de Saint-Germain près de Marly* — original-language titles); the
  reliability of *galerie-das-20-jahrhunderts* emptied (derived again: website → institution; it had become
  "database").
- **Why:** owner: the title could not be set back to "original". A `<select>` without an empty option sends its first
  value — since 049 (reliability) and 052 (title status) every save set them.
- **Tested:** e2e (translations.spec: saving leaves both empty).
- **Revert:** redeploy the previous commit.

### Admin: sources without reloading, quick select of recent sources, "also for" several fields
- **What:** `editor/cites.js` (dialogs moved out of `sortable.js`): add / remove via fetch (`X-Requested-With: fetch`) —
  the server answers with the affected markers rendered anew (`freshMarkers()`), they replace the old ones and the
  dialog stays open; without script the forms still post and reload. Quick select: chips of the sources used recently
  by the user and those cited on this entry (`citations.recentSources()`), one click adds one (with the page typed);
  refreshed in every dialog after an add. "Also for": checkboxes of the entry's other fields with a value — one source
  for several fields at once (`citations.add` loops; on the edit page `expect` per field). The dialog shows the KHIST
  short form ("Wildenstein 1964, S. 12") like the API.
- **Why:** owner: the page reloaded after every source; a source just added should be quick to reuse.
- **Tested:** e2e 118 passing (citations.spec: no reload, chips, also-for, remove in place).
- **Revert:** redeploy the previous commit.

### Tests: log in once per run instead of once per test (4:48 → 3:45)
- **What:** `test/e2e/global-setup.js` logs both test users in once and stores their sessions
  (`$TMPDIR/arthistory-e2e/session-<user>.json`); the `userA` / `userB` fixtures start each test in a fresh browser
  context with that session (`helpers.js` → `asUser`) instead of the login form (scrypt on purpose: ~0.9 s per test).
  The logout test logs in itself (it ends its session). Two tests that relied on starting at the dashboard now open it.
- **Why:** owner: the 117 e2e tests took 4.8 min; ~1 min of it was logging in.
- **Revert:** revert the commit.

### Admin: real drag and drop for provenance steps (floating copy + placeholder)
- **What:** `editor/sortable.js`: the dragged step stays in place (hidden), a floating copy of its row follows the
  pointer and a dashed placeholder moves through the list; release = the step takes the placeholder's place; Esc
  cancels. Pointer listeners on the window — moving the captured element itself had lost the pointer after one place
  in Firefox. Tests in Chromium and Firefox (`sortable.spec.js`, `sortable.firefox.spec.js`, cases in
  `sortable-cases.js`).
- **Server:** Playwright's Firefox (v1543) downloaded to `~/.cache/ms-playwright/firefox-1543` for the e2e tests
  (no system packages). Remove: `rm -rf ~/.cache/ms-playwright/firefox-*` and delete `sortable.firefox.spec.js`.
- **Why:** owner: an item could only be moved one place.
- **Revert:** redeploy the previous commit.

### Admin: source markers on the edit page too
- **What:** the edit page renders each citable field's sources dialog after the form (forms can't nest);
  `editor/sortable.js` (`initCiteTriggers`) puts a button with the same badges next to the field's label (in a
  `.label-row`, the label itself unchanged) and, on adding a source, sends the field's current form values (`expect`).
  `POST /citations`: unchanged from the published values → cited at once; changed in the working copy → a pending
  citation (`citations.add(…, {pending})`), settled when published (as Wikidata's).
- **Why:** owner: sources while editing, not only on the entry's page.
- **Tested:** e2e 115 passing (citations.spec: edit page, unchanged → cited, changed → pending → published).
- **Revert:** redeploy the previous commit.

### Frontend: translation status — own ones in [brackets], official ones preferred and marked (no server change)
- **What:** `src/html.ts` `displayName` (official translation in the title's language preferred to a common/own title;
  own → [brackets]), `otherNames` (brackets, "official" tag, the replaced title listed), `titleStatusLine`; artwork page
  line under the heading with the source marker; `sources.names` on "Also known as"; cards/search/prerender use the
  same title. Test "picker names" gets 15 s for its new tab (failed three times under load).
- **Why:** owner: backend migration 052 (names[].status, title_status).
- **Tested:** two new e2e tests; full suite 54/54; `vite build` ok. Live data has only `common` translations so far.
- **Revert:** revert the commit.

## 2026-10-08

### Translations: official, common or own (migration 052)
- **What:** names entries may carry `status` (official | common | own; common is the default and not stored; only on
  role translation — `names_valid()` re-created to say so); line syntax `text | lang | translation, own`; enum
  `translation_status`, `artworks.title_status` (the title itself is a translation); citable fields `title_status` and
  `names` (an official translation gets a source), `weakly_sourced` asks only where something claims to be official;
  info check `title_translation` (a held work whose title is a common / own translation). Admin: "Title is a
  translation" select, a second menu next to "translation" in the names editor; Wikidata sets `common` for an English
  label over a title in another script. API: `names[].status`, `title_status`.
- **Why:** owner: whose translation a title is matters (official vs. own).
- **Tested:** unit tests (names), e2e 114 passing (new translations.spec); dry run on prod (rolled back).
- **Revert:** redeploy the previous commit; as owner drop the column, the enum, the two citable fields (and their
  citations), re-create 022's `names_valid` and 049's `quality_issues`.

### Admin: adding sources made usable — a dialog, visible markers, paste a link
- **What:** the sources panel is a centred dialog (position: fixed — inside tables it was cut off at the right edge;
  backdrop click, Esc and "close" close it; one at a time); missing sources show an orange "+", a legend under the
  fields explains the markers; adding a source: paste the page's link → the website's bibliography source is found by
  host or created (kind web, reliability institution, named as given or after the host), the citation keeps the page
  and today's date; or pick a bibliography source; page/no. and note; more: website name, accessed, free text.
  Autocomplete lists claim Esc only while open.
- **Why:** owner: only the automatic Wikidata citations worked — no source had been added by hand (the logs showed no
  attempt reaching the server).
- **Revert:** redeploy the previous commit.

### Admin: Quality and History back in line with the menu
- **What:** the tools group follows the other three groups (separator line, normal link colour) instead of sitting
  muted at the far right.
- **Why:** owner: too far away and barely visible.
- **Revert:** redeploy the previous commit.

### Admin: reorder provenance steps by drag and drop
- **What:** `editor/sortable.js` (generic: `[data-sortable=url]`, `.sort-item`, `.drag-handle`; pointer events, so
  mouse, pen and touch alike; keyboard ↑/↓ on the focused handle); the provenance table has one `<tbody>` per step
  and a ⠿ handle; `POST /artworks/:slug/provenance/order` (ids, checked against the steps) → `provenance.reorder()`;
  the page reloads so periods are recomputed. The ↑/↓ buttons are gone (the route stays).
- **Why:** owner: the arrows were finicky.
- **Revert:** redeploy the previous commit.

### Frontend: sources for facts — markers and citation popovers (no server change)
- **What:** `src/cite.ts` + `views/detail.ts` (`withSources`, `FIELD_FACT`): markers P/L/M/D/W/T after fact rows,
  relationships and provenance steps; popover with the citations best first (link to the exact page / Wikidata item,
  accessed date, full reference from `bibliography`, note), outdated ones muted and without marker. Replaces the
  provenance "Sources:" line (it rendered the new citation objects wrongly since migration 049). Popovers
  (`glossary.ts` `show`) now work on any element; a click inside the opening element no longer closes it.
- **Why:** owner: backend migrations 049–051 (sources per field, relationship, provenance step).
- **Tested:** new e2e test (order, outdated, full reference, text note), provenance test with a citation; full suite 52/52;
  checked live on la-route-de-saint-germain-pres-de-marly (W on fields, M on the Bührle step).
- **Revert:** revert the commit.

### Sources: 33 wrong Wikidata citations from the backfill removed (migration 051)
- **What:** 049's backfill cited every field of entries carrying a "Wikidata Q… (retrieved …)" note — also values
  changed by hand later (e.g. the Bührle works' institution and loan). 051 keeps a backfilled field citation only if
  an accepted Wikidata decision backs it or the value is unchanged since the entry was created from Wikidata; 33 of 209
  removed (dry run on prod first).
- **Why:** found checking the live API after step 2.
- **Revert:** redeploy the previous commit (the removed rows are in audit_log, restorable from the history).

### Sources, step 2: free text as citations, sources in the API and the YAML (migration 050)
- **What:** `citations.text` (free text, no reliability) and `citations.url` (the exact page of a website source); the
  relationship and provenance "Sources" boxes write text citations (no more `metadata.sources`); existing lines
  converted: Wikidata notes → Wikidata citations, Kunsthaus object pages → new source "Kunsthaus Zürich, Sammlung
  online" (bibliography, web, institution) with url and accessed date, the rest → text; `metadata.sources` removed.
  Markers on provenance steps; the add form takes a page url or a source in words. SQL `text_sources()`,
  `citation_doc()`, `citation_docs()`, `field_citation_docs()`. API: `sources` per field, relationship (derived ones:
  their provenance step's) and provenance step; full references in `bibliography`. YAML: `sources:` per entry and on
  relationships / provenance steps, export and import (`src/citations-io.js`). Fixed on the way: the YAML import
  rejected `numbers:` (048) as an unknown field.
- **Why:** owner: step 2 of sources for facts.
- **Tested:** migration dry run on prod (rolled back); YAML round trip on dev; e2e 112 passing.
- **Revert:** redeploy the previous commit; the converted lines are citations now (`text_sources()` lists them per
  row) — as owner drop the functions and the two columns after copying texts back into metadata if needed.

### Sources: values Wikidata agrees with are cited when comparing
- **What:** `wikidata.apply` → `citations.citeAgreeing()`: fields where Wikidata has the same value get a (settled)
  Wikidata citation, unless one exists — so entries entered before (e.g. from YAML) get sources by comparing them.
- **Why:** owner's example (The Starry Night): its values match Wikidata but had no source.
- **Revert:** redeploy the previous commit.

### Sources for facts: citations per field and relationship (migration 049)
- **What:** enum `source_reliability`, `bibliography.reliability` (+ `source_reliability()`), table `citable_fields`
  (data), view `entity_rows`, `field_value()`, table `citations` (field / relationship / provenance step ← bibliography
  source or Wikidata item, locator, accessed, cited value, pending), views `citation_status`, `field_sourcing`; quality
  checks `citation_outdated`, `weakly_sourced`; `merge_entries` moves citations; deleting an entry also deletes its
  citations and its `wikidata_reviews` (orphans removed). Backfill from Wikidata notes and accepted reviews (213 on
  prod in the dry run). Admin: source markers next to values and relationships (W / M / L / P / ? / !), add and remove
  sources there; Wikidata comparison and new-from-Wikidata cite automatically (pending until published); source form:
  "Reliability as a source".
- **Why:** owner: transparency — where each fact comes from, so weak sources (Wikidata) can be replaced by better
  ones (museum, catalogue raisonné) later.
- **Tested:** smoke test; migration dry run on prod (rolled back); e2e 110 passing (new citations.spec).
- **Revert:** redeploy the previous commit; as owner drop `citations`, `citation_status`, `field_sourcing`,
  `entity_rows`, `citable_fields`, `field_value`, `source_reliability()`, the column and the enum; re-create 048's
  `quality_issues`, `merge_entries` and 041's `delete_entity_relationships`.

### Frontend: loans and further numbers on the artwork page (no server change)
- **What:** "Collection" as a credit line when `on_loan`: the provenance's last owner, "on loan to the <institution> since
  <on_loan_since>" ("Foundation E.G. Bührle Collection, on loan to the Kunsthaus Zürich since 2021"; "the" left out
  before names starting with "The"). Under "Inventory no." (now with its institution in brackets when there are more)
  one row per `numbers` entry: its `label`, else "Inventory no." (with the institution) or "Catalogue no." (with the
  source, linked). `src/views/detail.ts` collectionFact/numberFacts.
- **Why:** owner: backend migration 048 (numbers, on_loan, on_loan_since).
- **Tested:** e2e test with a sample loan; checked live on le-garcon-au-gilet-rouge.
- **Revert:** revert the commit.

### Data: the three Bührle works — at the Kunsthaus, on loan, owner in the provenance
- **What (prod, by hand, source `sql`):** *Le garçon au gilet rouge*, *Tournesols sur un fauteuil*, *La Route de
  Saint-Germain près de Marly*: institution Foundation E.G. Bührle Collection → Kunsthaus Zürich (the BU numbers are
  the Kunsthaus's), on loan since 2021; further numbers: the Foundation's Inv.-Nr. (18, 46, 99) and the catalogue
  raisonné number with a label (Rewald 658, Wildenstein 602, Brame/Lorenceau 204); provenance from the Kunsthaus pages:
  Emil Georg Bührle (purchase 1948 / 1952 / 1953) → Nachlass (28.11.1956) → Foundation (gift, 1960), each citing the
  page. Kunsthaus: kind museum, place Zürich; Foundation: kind foundation, place Zürich.
- **Why:** owner: holder and owner were mixed up (the Foundation as institution with the Kunsthaus's numbers).
- **Revert:** from the history (one change set), or by hand.

### Artworks: further numbers and loans (migration 048)
- **What:** table `artwork_numbers` (number + institution / bibliography source / label; history, revert, merge);
  `institution_number_free()` + triggers on `artworks` and `artwork_numbers`: an institution's number once across both
  (advisory lock); catalogue numbers unique per source. `artworks.on_loan`, `on_loan_since`(+label); quality:
  `provenance_last_owner` skips loans, new `loan_owner`. `dup_facts.numbers` (`artwork_number_keys()`), `dup_score`:
  any shared number +100, two numbers in one catalogue −100; `merge_entries` keeps shared numbers once and the
  duplicate's main number as a further one. Admin: "Further numbers" section on artwork pages, loan fields in the
  form. API: `numbers`, `on_loan`, `on_loan_since`. YAML: `numbers:`, `on_loan`, `on_loan_since`.
- **Why:** owner: Bührle works — Kunsthaus "BU 0099" and the Foundation's "99", catalogue raisonné numbers, and the
  Foundation (owner) vs the Kunsthaus (holder since 2021).
- **Tested:** smoke test; e2e (numbers.spec). Note: while checking syntax, `require('./scripts/import.js')` ran the
  import against production once; it failed before writing (columns not there yet) and rolled back — verified in
  audit_log that nothing was written.
- **Revert:** redeploy the previous commit; as owner drop `artwork_numbers` and the two triggers/functions, the three
  `artworks` columns, and re-create 047's `dup_facts`, `dup_maybe`, `dup_score`, `quality_issues` and 044's `merge_entries`.

### Frontend: the menu in the admin panel's groups (no server change)
- **What:** Explore · Network | Artworks · Artists · People · Institutions | Events · Movements · Places · Polities |
  Glossary · Bibliography (`src/main.ts` NAV, `span.nav-group` with a dividing line; no lines below 1000 px, where groups wrap).
- **Why:** owner: the site should follow the admin menu's structure.
- **Revert:** revert the commit.

### Admin: the menu grouped — collection · context · reference · tools
- **What:** `html.js` menu in groups (Artworks, Artists, People, Institutions | Events, Movements, Places, Polities |
  Glossary, Bibliography | Quality, History on the right, muted), thin lines between groups; the menu has its own row
  under title, search and login (one line on desktop); on phones the groups stack as rows.
- **Why:** owner: the menu looked unsorted.
- **Revert:** redeploy the previous commit.

### Admin: a draft sent just before Create no longer comes back
- **What:** `editor/live.js`: on submit, if the last draft message isn't confirmed yet, the form waits for the
  server's "saved" (at most 1 s) and then submits.
- **Why:** drafts go over the websocket, the save over its own request; a draft stored after the save had deleted it
  reappeared as "unsaved draft" (seen as a flaky e2e test, live.spec, under load).
- **Revert:** redeploy the previous commit.

### Frontend fix: a map popup no longer opens a link preview on top of itself (no server change)
- **What:** popovers (`src/glossary.ts`, `src/previews.ts`) open on focus only right after a key press (`byKeyboard()`).
  MapLibre focuses a popup's first link when a click opens it; that focus opened the preview at once.
- **Why:** owner: clicking a place on the start map showed the place's preview over the popup.
- **Tested:** e2e regression (click, then focus by script → no preview; Tab → preview); full suite 50/50.
- **Revert:** revert the commit.

### Admin: a bright text cursor in dark mode
- **What:** CSS token `--caret` (dark in light mode, `#fffaf2` in dark mode) for `caret-color` of inputs and text areas,
  and for CodeMirror's own drawn cursor (`.cm-cursor`, 2px) in the Markdown editor.
- **Why:** owner: the cursor was dark and hard to see on the dark admin pages (CodeMirror draws a black one by default).
- **Revert:** redeploy the previous commit.

### Frontend: events on the public site (no server change)
- **What:** type `event` everywhere: nav, router, header search, list page (`/events`, kind filter), detail page (date,
  place, part of / parts, participants with roles, concerns, works depicting it, map of its area / spot / city, link to
  the start page with its years), start page layer `/v1/map/events` (toggle, time window, centre dots for areas) and
  timeline group, graph category and node colour, event stops in map popups, prerender + schema.org `Event`.
- **Why:** owner: backend migrations 046/047 added events; show them on the site.
- **Tested:** 3 new e2e tests with sample events (none live yet); full suite 49/50 — "picker names" (new tab) failed once
  under load, passes alone 3×; `vite build` ok.
- **Revert:** revert the commit (Pages republishes).

### Events: a new entry type (migrations 046, 047)
- **What:** enum value `event` (046); table `events` (kind, parent_id, period, place_id, location, area, names,
  description, Wikidata, images via `images.event_id`), triggers like every entity table; event branches in
  `entity_index`, `content_links`, `markdown_columns`, `entry_previews`, `dup_facts` (+ `dup_score` distance rule),
  `site_geo`, `quality_issues` (+ check `event_without_place`), `entity_exists`/`entity_id`/`entity_home_place`;
  `images.entity_type`/`entity_id` re-expressed with `ALTER COLUMN … SET EXPRESSION`. Relationship types: `depicts`
  widened to events, new `participated_in` (role in label) and `concerns`. Admin: Events in the menu, form (kind
  suggestions, map picker), `[[event/…]]` links, Wikidata (P585/P580/P582, P276, P625, P361; P710 participants,
  P921 concerns; events recognised as targets of "depicts"). API `/v1/events`, `/v1/map/events`, events on an
  entity's map; previews.
- **Why:** owner: events such as the Great Fire of Meireki (depicted on a handscroll) and the Bührle trial (Lausanne,
  1970) as context — the glossary has no time or place.
- **Tested:** smoke test; e2e 106 passing (new events.spec). **Revert:** redeploy the previous commit; as owner drop
  table `events` (CASCADE drops `images.event_id`), restore the views/functions from 036/040/042/043/044/045 and the
  two relationship types (delete `participated_in`, `concerns`; `depicts` without event). The enum value stays
  (Postgres can't drop one) — harmless.

### Duplicates: different inventory numbers in one collection count against (migration 045); Vienna cleaned up
- **What:** `dup_score()` re-created with one more rule: same institution, two different inventory numbers → −100.
  Data (prod, by hand, source `sql`): Austria created (country AT, outline from Natural Earth); Vienna moved into it;
  the region "Wien" (AT-9) — the same city-and-state pattern as Oslo, from before that fix — deleted.
- **Why:** the first run of the new check flagged Monet's two water lily panels at the Kunsthaus (same size, dates,
  painter; 1952/0010 vs 1952/0064) — two objects. And Vienna/Wien.
- **Tested:** e2e (duplicates.spec). **Revert:** redeploy the previous commit and re-create 044's `dup_score`; the data
  change from the history pages.

### Duplicates: hard rules, evidence-based warnings, "not the same", merge (migration 044)
- **What:** unique indexes `artworks_inventory_unique` (institution + inventory number) and `places_boundary_unique`;
  view `dup_facts`, functions `dup_names`, `names_similarity`, `dup_maybe`, `dup_score`, `duplicate_candidates`; the
  quality check `possible_duplicate` now weighs evidence (names, creator, dates, dimensions, places, identifiers)
  instead of name similarity alone. Admin: live "Already here?" box on new-entry forms (`POST /:plural/new/duplicates`,
  `editor/duplicates.js`, a rolled-back insert); Create stops at score ≥ 70 until each candidate is ticked "it's a
  different one" (stored in `quality_acks`); unique-index hits shown as "already exists". `merge_entries()` + page
  `/:plural/:slug/merge` (preview = rolled-back run), "Merge…" on entry pages and on quality rows, "Not the same" there.
- **Why:** owner: duplicate places (Oslo) and, with growing data, duplicate artworks — names alone can't decide
  ("Untitled").
- **Tested:** smoke test; rolled-back scoring/merge cases on dev; e2e 103 passing (new duplicates.spec).
  **Revert:** redeploy the previous commit; as owner drop `merge_entries`, `json_empty`, `duplicate_candidates`,
  `dup_score`, `dup_maybe`, re-create 043's `quality_issues`, then drop `dup_facts`, `names_similarity`, `dup_names`
  and the two indexes. Merges themselves are reverted from the history.

### Places: no second "Oslo" — cities that are their own region go into the country
- **What:** `placefinder.draftFor()` never takes a place or Natural Earth region with the same name as the new place
  as its parent (Oslo, Berlin, Vienna, Hamburg are cities and counties/states at once). `autocreate`: a region
  created from Natural Earth gets its country as parent when we have it. Data (prod, by hand): Norway got
  `country_code`/`boundary_code` `NO` (it had no outline, so nothing was found inside it); the auto-created region
  "Oslo" (NO-03) deleted; the city `oslo-2` → `oslo`, parent Norway (Munch Museum stays in it).
- **Why:** owner: saving the Munch Museum created two Oslos.
- **Tested:** e2e (places.spec, city.spec). **Revert:** redeploy the previous commit; the data change is in audit_log
  (source `sql`) and can be reverted from the history pages.

### Admin: an institution's country or region is narrowed down to its city
- **What:** `cityFor()` also looks up the city at an institution's exact location when its place is only a country or
  region (kind `country`/`region`), not just when it is empty. A new city is created inside the country (parent by
  outline), so Munch Museum → Oslo → Norway. Hint of the place field updated.
- **Why:** owner: the Munch Museum, saved with place "Norway", skipped the city.
- **Tested:** e2e (city.spec). **Revert:** redeploy the previous commit.

### Images for people (migration 043)
- **What:** `images.person_id` (fifth arm of the exclusive arc, partial indexes like the others); generated
  columns `images.entity_type`/`entity_id` replace the CASE over the arms in the quality view, `images.js` and the
  history page. People get the image section, image search, Wikidata P18 images, list thumbnails; API `image_url`
  (list) / `images` (detail) for people; `entry_previews` shows a person's main image.
- **Why:** owner: the Wikidata comparison for Hans Wendland didn't offer his portrait — people had no images at all.
- **Tested:** smoke test; e2e (wikidata.spec: a person's portrait from Wikidata, API, previews). **Revert:** redeploy the
  previous commit; as owner delete person images, drop `entity_type`/`entity_id`/`person_id`, restore 027's
  `images_check`, and re-create 040's `entry_previews` and 037's `quality_issues`.

### [[links]] follow slug changes (migration 042)
- **What:** `current_links(md)` rewrites every `[[type/old-slug…]]` (own words and pages kept; `[[old-term]]` without
  type too) to the entry's current slug via `slug_history`. Used (1) by `record_slug_change()`: a rename rewrites
  all Markdown columns (view `markdown_columns`) in the same transaction, history source `slug rename`; (2) by
  `BEFORE INSERT OR UPDATE OF <md column>` triggers (`correct_old_links()`), so a stale working copy or an old YAML
  snapshot saved later doesn't bring the old slug back. The migration corrected existing texts once.
  `linkNames()` resolves old slugs too, so the editor preview of an unsaved working copy doesn't show them as missing.
- **Why:** owner: links store the slug as text — after a rename they broke, and once a new entry took the old slug
  they would silently point at it.
- **Tested:** smoke test; rolled-back rename on dev; e2e 96 passing. **Revert:** redeploy the previous commit; as
  owner drop the `*_old_links` triggers, `correct_old_links()`, `current_links()`, view `markdown_columns`, and restore
  041's `record_slug_change()` (texts already rewritten stay rewritten — they are correct).

## 2026-10-07

### Changing a slug: emptied slugs follow the title; old addresses redirect (migration 041)
- **What:** table `slug_history` filled by `AFTER UPDATE OF slug` triggers on every entity table (an INSERT releases
  a slug that is in use again; deleting an entry removes its old slugs); API detail and admin pages answer an old slug
  with a 301 to the current one. Admin (`editor/slug.js`): on an existing entry the slug follows the title once the
  field has been emptied by hand — checked when the title changes, so a slug emptied earlier in the shared working
  copy (filled in after the page loads) follows too.
- **Why:** owner: emptying the slug of an existing entry didn't regenerate it.
- **Tested:** smoke test; e2e 95 passing. **Revert:** redeploy the previous commit; as owner drop the triggers,
  `record_slug_change()`, `release_old_slug()`, `slug_history`, and restore 021's `delete_entity_relationships()`.

### Admin: the slug back right before the title / name
- **What:** `sectionsOf()` places the slug row immediately before the row with the title/name (removed from
  "Identifiers").
- **Why:** owner: the slug is made from the title, so it belongs next to it.
- **Tested:** e2e (editor.spec). **Revert:** redeploy the previous commit.

### Admin: live search in the search bars
- **What:** `backend/src/admin/editor/livesearch.js`: `form[data-live]` re-fetches the page in the background as you type
  (debounced, older requests aborted) and swaps its `[data-live-results]` regions; the address bar follows. On: entry
  lists, the full search page, the quality filters, the Wikidata search (450 ms). The image search updates on a
  source change only; the place search stays on Enter (OSM's usage policy forbids search-as-you-type). The header
  "Search everything" shows a dropdown of matches (/lookup, keyboard, Enter = full search page).
- **Why:** owner: live search/filter in all search bars.
- **Tested:** e2e 93 passing (livesearch.spec: no page load, address, dropdown).
- **Revert:** redeploy the previous commit.

### Frontend: previews on every internal link (no server change)
- **What:** `src/previews.ts` — the popover of `[[links]]` on all links to entries (fields, relationship lists, map
  popups, graph panel), from `GET /v1/previews`: links collected by a MutationObserver on `#app` as views render, unknown
  ones fetched in one request per 100 (a detail's `entries` count as known); one document-level listener for hover
  (250 ms pause), focus and tap (entry pages only: first tap shows, second follows). Not on header, breadcrumbs,
  previous/next, buttons, list cards, explore pickers, the page's own link.
- **Why:** owner: previews like Wikipedia's for all entries, not only `[[links]]`.
- **Tested:** e2e new desktop + phone tests passing; full suite 46/47 (the failing test, "picker names", passes alone —
  timing under load).
- **Revert:** revert the commit (Pages republishes).

### API: `GET /v1/previews` — previews of any internal links in one request
- **What:** `previewsOf(refs)` (from 040's `entryPreviews`) exposed as `/v1/previews?refs=type/slug,…` (max. 100, all
  types; missing entries left out).
- **Why:** owner: previews on every internal link (fields, relationships, lists), not only on [[links]] in texts.
- **Tested:** e2e (names.spec). **Revert:** redeploy the previous commit.

### Previews of linked entries on hover, like Wikipedia's (migration 040)
- **What:** view `entry_previews` (one row per entry of every type: name, subtitle from dates / maker / kind / city,
  main image, the text to cut the preview from; a term's is its definition). The detail API adds `entries`
  `{"type/slug": {type, slug, name, subtitle, image_url, excerpt}}` for the `[[type/slug]]` links in its texts (one
  query, `(type, slug) IN unnest(…)`); `markdown.previewText()` makes the excerpt (first paragraph, links as names,
  footnotes dropped, cut after a sentence ≤ 300 chars). Frontend: `a.entry-link` gets a popover like the glossary's —
  name, type, subtitle, excerpt, "Open →", the image on the right (on top on phones; dropped when it fails to load).
- **Why:** owner: hover previews for all `[[…]]` links, not only glossary terms.
- **Tested:** unit 31 passing (new `previewText` test); frontend e2e new test passing, one unrelated failure
  ("remembered time window", fails without this change too). Migration not yet run on a database when written.
- **Revert:** redeploy the previous commit, then `DROP VIEW entry_previews;` (nothing else depends on it).

### Admin: the city of an exact location is found (and created) when saving (no schema change)
- **What:** `placefinder.cityAt()` — our settlement whose outline contains the point (PostGIS `ST_Covers`, no request);
  else Nominatim: a reverse lookup names the city in its address (at city zoom the object may be a borough —
  Manhattan for the Guggenheim), the city itself is then searched by name and country; that city among ours (same
  Wikidata id, or same name within 50 km, `ST_DWithin`); else a new place drafted like the place finder's (names,
  Wikidata point, parent: our place containing it, else the Natural Earth region, created with it). `saveEntity`:
  an institution with a location and no place gets its city; a work that doesn't move (location/area changed, no
  place of creation) gets `created_in` the city, dated like the work. Not marked "to complete"; the save message says
  so ("Its city was set from the location — 1 new place created"). Lookup failures only mean no city.
  `wikidata.createEntry` got a `flag` option. Fixtures: Nominatim `/reverse` and city search; `city.spec.js`.
- **Why:** owner: entering the Guggenheim shouldn't mean entering New York by hand.
- **Tested:** live Nominatim dry run (Guggenheim → New York Q60 in New York State; Kunsthaus → Zurich Q72); unit 30, e2e 89 passing.
- **Revert:** redeploy the previous commit.

### Admin: entry forms in sections (no schema change)
- **What:** `src/admin/forms.js` SECTIONS — every type's form in sections with slim titles (e.g. artwork: Title and
  names · Who and when · Object · Where it is · Description · Identifiers) and a line of jump links; short fields in
  pairs on screens ≥ 900 px; rarely needed groups behind a button, open when they hold a value or an error:
  series, an artwork's "Where it stands" (also opened by typing an immovable object type; series by a whole's type),
  an institution's exact location, Metadata. Slug moved to Identifiers (still follows the title). Unplaced fields land
  in "More". Bibliography: a section whose fields the kind hides is hidden too. Opening a group re-measures its map.
  All hints stay visible (owner: clean input first time matters more than length).
- **Why:** owner: many fields; easier to read and fill, all on one page, not much longer.
- **Effect:** artwork form 3237 → 2522 px, institution 2087 → 1550 px (1280 px wide window).
- **Tested:** unit 30, e2e 86 passing (forms.spec: sections, pairs, map in an opened group, bibliography sections).
- **Revert:** redeploy the previous commit.

### Frontend: an artwork's web page, prominent (API migrations 038/039)
- **What:** `frontend/src/views/detail.ts` — "View at <collection, else the link's domain> ↗" with "link accessed
  7 October 2026" in the artwork's actions row; without images a panel in place of the gallery ("no freely licensed
  image … View at … ↗"), and on narrow screens (map first) the link at the top as well. Styles `.web-link`,
  `.web-top`, `.web-panel`; types `web_url`, `web_url_accessed`. Tests: two desktop (site.spec), one phone (mobile.spec).
- **Why:** owner: the link to the work prominently, with the day it was added — the way to see works without a free image.
- **Revert:** revert the commit (GitHub Pages republishes).

### Artwork web page: the day the link was added (migration 039)
- **What:** `artworks.web_url_accessed` (date), kept by the BEFORE trigger `artworks_web_url_accessed`
  (`set_web_url_accessed()`): today on a new or changed link, unchanged on a resave, NULL without a link; a manual
  value is ignored. Existing links backfilled from audit_log (the change that set the current link). Admin shows
  "· added 7 October 2026"; API detail `web_url_accessed`; hidden from history diffs and revert (follows `web_url`).
- **Why:** owner: show when a link was added — museum pages move; like "accessed on" in a citation.
- **Frontend** (done the same day, see above): on the artwork page, a prominent link near the top/image —
  "View at <institution name, else the link's domain> ↗" with "link accessed 7 October 2026" in small type.
  When `images` is empty, show it in place of the image (a panel: "No free image — see the work at … ↗").
  Open in a new tab (`rel="noopener"`).
- **Tested:** trigger cases on dev (add / resave / remove); e2e 83 passing (forms.spec: date in admin and API, manual value refused).
- **Revert:** redeploy the previous commit; `DROP TRIGGER artworks_web_url_accessed ON artworks; DROP FUNCTION
  set_web_url_accessed(); ALTER TABLE artworks DROP COLUMN web_url_accessed;`
  `DELETE FROM schema_migrations WHERE name = '039_web_url_accessed.sql';`

### Admin: slug fixed with draft banners; series fields behind a button; artwork web page (migration 038)
- **What:** (1) `editor/slug.js` found its field with `querySelector('input[name=slug]')` — the first match, which is
  the hidden input of the "unsaved changes — Discard" banners (`index.js` draftBanner / unpublished banner). With a
  draft (saved continuously, so nearly always) the slug neither followed the title nor was cleaned. Now
  `getElementById('f-slug')`. (2) An artwork's "Part of", "Number in it", "Number of parts" sit in a `<details>`
  behind "Part of a series…" (`forms.js` GROUPS), open when one has a value. (3) `artworks.web_url` (CHECK http(s)):
  the work's page at its museum/collection — admin field "Web page", API detail `web_url`, Wikidata P973 suggestion,
  hint in an artwork's empty Images section.
- **Why:** owner: slug generation "doesn't work anymore"; series fields rarely needed; a link to the work when there is
  no free image.
- **Frontend to-do:** link `web_url` on artwork pages ("View at the museum ↗"), prominently when `images` is empty.
- **Tested:** the slug test fails with the old selector and passes with the fix; unit 30, e2e 83 passing.
- **Revert:** redeploy the previous commit; `ALTER TABLE artworks DROP COLUMN web_url;`
  `DELETE FROM schema_migrations WHERE name = '038_artwork_web_url.sql';`

## 2026-10-06

### Series and other wholes: parts of artworks; publishers (migration 037)
- **What:** `artworks.parent_id`, `part_number`, generated `part_sort`, `parts_count`; trigger `no_parent_cycle()`
  on artworks, places, movements, polities; relationship `published`; quality info check `part_missing_data`.
  Admin: "Part of" / "Number in it" / "Number of parts", a part's line ("No. 21 of 46 in …", previous/next), a whole's
  "Parts" grid with missing numbers, "add a part" and "+ New part" (prefilled). API: `part_of`, `part_number`,
  `previous_part`, `next_part`, `parts`, filter `?part_of=`. Wikidata: P179 + P1545.
- **Why:** owner: prints in series like the Thirty-six Views of Mount Fuji.
- **Tested:** smoke test; e2e 80 passing.
- **Revert:** redeploy the previous commit; as owner drop the four triggers and `no_parent_cycle()`, the new columns,
  and the `published` type (after its relationships); re-create 036's quality view.

### Bibliography with citations after the KHIST guide (migrations 035, 036)
- **What:** entity type `source`, table `bibliography` (kinds book … archival, all parts of a reference, reading status);
  `src/bibliography.js` (full entries and sigla after the Leitfaden of the Kunsthistorisches Institut UZH 2021 §§ 8–9,
  German abbreviations; `CITATION_LANG=en` switches to English ones); `src/markdown.js`: `[[source/slug|page]]` →
  footnotes with short references, adjacent ones combined, own notes `^[…]`, "Ebd.", list "Literatur"/"Quellen".
  `content_links` and the quality view re-created (sources needn't have relationships). Admin "Bibliography" (fields
  per kind, generated citation on the page, sigla and reading statistics in the list, `[[source/` completion).
  API `/v1/bibliography` (siglum, citation, stats), `bibliography` map in every detail.
- **Why:** owner: cite sources properly without retyping them; browse what has been read.
- **Tested:** unit 30 (the guide's examples reproduced exactly; footnotes, ebd.); smoke test; e2e 79 passing.
- **Revert:** redeploy the previous commit; as owner re-create 031's `content_links` and 034's quality view,
  `DROP TABLE bibliography; DROP TYPE source_kind, reading_status` (the enum value `source` can stay).

### Exact locations without extra places: institutions and immovable artworks (migration 034)
- **What:** `institutions.location` + `address`; `artworks.location` + `area` (immovable works); view `site_geo`;
  presence relationships may point at institutions; `depicts` at artworks; new `houses` (building → institution);
  quality info check `institution_without_place` (nearest settlement suggested). Map routes use `site_geo` (features:
  `institution`/`artwork` and the city as `place`); new `/v1/map/sites`. Admin: map picker for institutions and
  artworks, labels/hints (the city vs the exact spot; immovable works only), object type suggestions (building,
  garden, bridge …). Wikidata: an institution's P625/P6375 become its own location/address, P131 its city — the
  building-place creation from earlier today is replaced (no such places existed); artworks take P625.
- **Why:** owner: the Kunsthaus belongs at its exact spot without a fake "Kunsthaus" place; Cabaret Voltaire vs
  Schauspielhaus (same city ≠ same venue); museums whose buildings are artworks (Tokyo National Museum).
- **Tested:** smoke test; e2e 77 passing.
- **Revert:** redeploy the previous commit; as owner drop `site_geo`, re-create 033's quality view, restore the
  vocabulary rows, `DELETE FROM relationship_types WHERE code = 'houses'` (after its relationships), drop the new columns.

### Quality: "outside its parent region" with a 5 km tolerance (migration 033)
- **What:** the check uses `ST_DWithin(outline, point, 5000)` instead of `ST_Covers`.
- **Why:** New York lay 2 km outside the simplified Natural Earth coastline of the USA — a false alarm.
- **Revert:** redeploy the previous commit (re-create 032's quality view).

### Places without hand-made geometry: Natural Earth boundaries, derived markers, place finder (migration 032)
- **What:** table `boundaries` (Natural Earth, public domain: 237 countries, 4313 first-level regions; loaded by
  `npm run boundaries`), `places.boundary_code` (FK; countries filled by a trigger from `country_code`), geometry rule
  now point OR area OR boundary code, view `place_geo` (marker/outline, own or derived), quality view re-created
  (`outside_parent_area` via place_geo; new info checks `parent_suggestion`, `boundary_available`). API places:
  `location`/`area` = what to draw, `boundary_code`, `geometry_source`; map routes use `place_geo`. Admin: "+ find a
  place…" (`src/admin/placefinder.js`: Nominatim for finding only — 1 req/s shared with the map picker — kind, names,
  country/boundary code, point from Wikidata when there is an item, parent by `ST_Covers` or a Natural Earth region
  created with it); typing a country/region name as a place's parent creates it with its outline.
- **Why:** owner: setting a point for Japan or Paris by hand was counterintuitive.
- **Tested:** smoke test; e2e 75 passing (fixture boundaries and Nominatim). Licences: Natural Earth public domain;
  OSM outlines (ODbL) deliberately not stored.
- **Revert:** redeploy the previous commit; as owner `DROP VIEW place_geo`, re-create 031's quality view, restore
  `places_check` as `location IS NOT NULL OR area IS NOT NULL` (after giving code-only places a point),
  `ALTER TABLE places DROP COLUMN boundary_code; DROP TABLE boundaries; DROP FUNCTION places_default_boundary CASCADE`.

### Wikidata: exact places for institutions (no schema change)
- **What:** `src/admin/wikidata.js` — an institution with coordinates (P625) is offered a **building** place: an
  existing building of ours within 100 m (PostGIS `ST_DWithin`, nearest by `<->`), or a new one named by its street
  address (P6375, monolingual text → "Heimplatz 1") at the exact point, inside the settlement. "Located in" (P131) is
  resolved upwards to a settlement (`settlementOf`: Kreis 1 → Zürich; several values → the settlement among them),
  also for the parent of a compared building/site. The settlement is created with it when missing, or linked by name
  (gets the Q-id). `createEntry` now sets a new place's parent. Fixtures Q110–Q114 + e2e test.
- **Why:** owner: Wikidata's P131 for the Kunsthaus Zürich is the city district "Kreis 1" — exact places wanted.
- **Tested:** against live Wikidata (Q685038 → "Heimplatz 1" at 47.37028, 8.54806 in Zurich); unit 25, e2e 72 passing.
- **Revert:** redeploy the previous commit.

### Provenance (migration 031)
- **What:** table `provenance` (artwork, position, owner as exclusive arc artist/person/institution/place or
  description, acquired, method enum `acquisition_method`, documented-direct flag, place, optional recorded end,
  certainty, notes, sources). View `provenance_periods` computes each owner's period with window functions (`lead`/`lag`)
  and marks its end recorded / implied / ongoing / unknown. View `edges` (replaces `graph_edges`) = relationships +
  derived `creator`, `owned_by`, `kept_in` (map route), `transferred_to`; read by the graph, map, entity pages, admin.
  `owned_by` became derived (the one existing row — Bührle — moved into `provenance`); Wikidata no longer suggests
  P127 as `owned_by`. Quality checks `provenance_gap_1933_1945`, `provenance_forced_transfer`, `provenance_last_owner`.
  Admin: "Provenance" section on artworks (add / edit / reorder / remove; history + revert). API: artwork `provenance`,
  `derived` / `end_basis` on relationships and graph edges, owner role from provenance. YAML: `provenance:` per artwork.
- **Why:** owner: provenance sources record events whose durations are only implied — store what is recorded, compute
  the rest and mark it; ownership feeds the network and the artwork's route on the map.
- **Frontend to-do:** show `provenance` on artwork pages (mark `end_basis: implied` and `direct: false`); draw
  derived edges with `end_basis: implied` dashed/faded; the map route of artworks now has `kept_in` stops;
  new derived types `kept_in`, `transferred_to` (categories `presence`, `provenance`) come via `/v1/vocabulary`.
- **Tested:** migration on a restored copy of production; schema smoke test; unit 25, e2e 71 passing (new `provenance.spec.js`).
- **Revert:** redeploy the previous commit, then as owner: move provenance steps back into `owned_by` relationships if
  any were added, `DROP VIEW edges, provenance_periods; DROP TABLE provenance; DROP TYPE acquisition_method;` re-create
  029's `graph_edges` and 030's `content_links` / `quality_issues`, `DELETE FROM relationship_types WHERE code IN
  ('kept_in', 'transferred_to'); UPDATE relationship_types SET derived = false WHERE code = 'owned_by';`
  `DELETE FROM schema_migrations WHERE name = '031_provenance.sql';`

### [[links]] to any entry, with completion (migration 030)
- **What:** `[[type/slug]]` / `[[type/slug|own words]]` link artists, artworks, places … in every Markdown text (bare
  `[[slug]]` stays a glossary term). `src/markdown.js` renders `<a class="entry-link" data-entry="type/slug">` to the site's
  address and loads only the linked names (`linkNames`). View `content_links`, and `glossary_links` re-defined on top of
  it; quality check `broken_link` (quality view re-created). Admin: typing `[[` in the editor suggests entries of every
  type (`[[place/…` narrows the type), "Mentioned in" on every entry. API: `mentioned_in` on every detail except terms.
- **Why:** owner: link any content like in Obsidian, with suggestions while typing.
- **Frontend to-do:** style `a.entry-link` (and `.missing`, as for glossary links). The links already point at the
  site's own pages. Optionally show `mentioned_in` ("Mentioned in") on detail pages.
- **Tested:** unit 25, e2e 69 passing (new `links.spec.js`), schema smoke test.
- **Revert:** redeploy the previous commit, then as owner re-run 027's `CREATE OR REPLACE VIEW quality_issues …` and
  `glossary_links` definitions, `DROP VIEW content_links;`, `DELETE FROM schema_migrations WHERE name = '030_entry_links.sql';`
  (texts with `[[type/slug]]` would then show as plain text).

### Admin: co-creators next to the creator
- **What:** an artwork's page shows all creators in one row (main creator, then co-creators with part, certainty and
  an edit link) with a short "+ Add co-creator" form (artist, part, certainty); co-creators are no longer repeated in
  the relationships table. The edit form names them under the creator field. No schema change.
- **Why:** owner: creators were split between a field and the relationship list, which felt redundant. The data
  model stays as it is (main creator = column, co-creators = relationships, graph edge derived), so nothing is stored twice.
- **Tested:** e2e 67 passing (`cocreators.spec.js` now adds through the new form).
- **Revert:** redeploy the previous commit.

### Main creator in the network graph (migration 029)
- **What:** `relationship_types.derived` + vocabulary entry `creator` (artwork → artist, category `collaboration`,
  derived); view `graph_edges` = relationships + one edge per `artworks.creator_id`; `/v1/graph` walks the view;
  trigger `relationships_not_derived` rejects storing derived types; the admin relationship form hides them;
  `/v1/vocabulary` returns `derived`.
- **Why:** owner: an artwork's network must show its artist (only co-creators were edges so far).
- **Frontend:** nothing needed (new edges use the existing category `collaboration`; the type comes from
  `/v1/vocabulary`, so the category filter includes it).
- **Tested:** e2e 67 passing (`cocreators.spec.js` extended: graph edges, form, trigger).
- **Revert:** redeploy the previous commit, then as owner: `DROP VIEW graph_edges; DROP TRIGGER relationships_not_derived
  ON relationships; DROP FUNCTION relationships_not_derived(); DELETE FROM relationship_types WHERE code = 'creator';
  ALTER TABLE relationship_types DROP COLUMN derived; DELETE FROM schema_migrations WHERE name = '029_graph_creator_edges.sql';`

### Several creators per artwork (migration 028)
- **What:** relationship type `co_creator` (artwork → artist, category `collaboration`; label = their part, certainty =
  how sure); SQL function `artwork_creators(id)`; API: artworks have `creators` `[{slug, name, main, role, certainty}]`
  (list + detail), an artist's `artworks` include co-created ones (`co_creator`, `role`), `?creator=` matches
  co-creators too (list filters may now use their value more than once). Wikidata: creators (P170) after the first
  are suggested as co-creators. `creator_id` stays the main creator. Docs: `backend/docs/api.md`, `data-model.md`.
- **Why:** owner: collaborations (Rubens + Brueghel) are rare but exist; relationships reuse the admin form, history,
  YAML and graph without new code.
- **Frontend to-do** (not done here):
  1. Artwork detail/subtitle: with a creator *and* an `attribution_label`, show the label linked to the creator
     ("Workshop of Rubens" → Rubens page); at the moment the label only appears when there is no creator.
  2. Show all of `creators` (e.g. "Rubens and Jan Brueghel the Elder (landscape)"; mark `certainty` ≠ attested);
     on artist pages mark co-created works (`co_creator: true`, `role`).
- **Tested:** schema smoke test (co-creator section), unit 24, e2e 67 passing (new `cocreators.spec.js`).
- **Revert:** redeploy the previous commit, then
  `DELETE FROM relationships WHERE relationship_type = 'co_creator'; DELETE FROM relationship_types WHERE code = 'co_creator';
  DROP FUNCTION artwork_creators(bigint); DELETE FROM schema_migrations WHERE name = '028_co_creators.sql';` (as owner).

### Admin: find freely licensed images (Commons, Met, Art Institute of Chicago, Cleveland)
- **What:** `backend/src/admin/imagesearch.js` + page `/<type>/<slug>/images/find` ("Find images…" in the Images
  section): searches Wikimedia Commons files (only with a licence statement), the Met (v1.1 search — `/v1/search` was
  retired by the Met on 2026-10-01 — public-domain objects, web-sized image), the Art Institute of Chicago (public
  domain, IIIF) and Cleveland (CC0); "Add" stores url, source page, licence and credit and returns to the results.
  Outgoing requests identify the site (User-Agent, AIC-User-Agent). Bases configurable for the tests.
- **Why:** owner: many artworks have no Wikidata item; only explicitly released photos are legally safe (Swiss law
  also protects simple photographs).
- **Tested:** e2e 66 passing (fixtures for all four sources).
- **Revert:** redeploy the previous commit.

### Wikidata: images for new entries are saved with Create
- **What:** the review of a new entry offers its Commons images (first pre-selected when it has none); the picks travel
  with the new-entry form (hidden `wd.images`, kept in the draft), are shown there, and are inserted by `saveEntity`
  in the same transaction as the entry (validated like the image form).
- **Why:** owner: images were only available on a second comparison after creating the entry.
- **Tested:** e2e 65 passing.
- **Revert:** redeploy the previous commit.

## 2026-10-05

### Glossary with [[links]] from texts (migrations 026, 027)
- **What:** entity type `term`, table `glossary` (name fields, category enum, short definition, description, images,
  `related_term`); view `glossary_links`; quality check `broken_glossary_link`; quality view re-created (with 024's
  names). `src/markdown.js` renders `[[slug]]` / `[[slug|words]]` as `a.glossary-link[data-term]` → `/glossary/<slug>`.
  Admin "Glossary" (category select, definition, "used in"), `[[` completion in the Markdown editor
  (`@codemirror/autocomplete`, dev dependency). API `/v1/glossary`, `used_in`, and `glossary` (linked terms with
  definitions) in every detail. YAML `glossary/`.
- **Why:** owner: own glossary for techniques, architectural elements … instead of external links; browsable online.
- **Tested:** unit 24 (link rendering); smoke test; e2e 65 passing.
- **Revert:** redeploy the previous commit; as owner drop `glossary_links`, re-create 022's quality view, remove the
  `glossary_id` arm from images (after deleting such rows), `DROP TABLE glossary; DROP TYPE term_category`.

### Further measurements per artwork: mount, frame, sheet … (migration 025)
- **What:** `artworks.other_dimensions jsonb` `[{part, cm: [h, w, d]}]` with `CHECK other_dimensions_valid()`;
  `src/dimensions.js`; admin "Further measurements" rows (part with suggestions + h × w × d, paste and unit conversion
  as for the main dimensions; main dimensions now labelled "the work itself"); entry page; API `other_dimensions`
  (same shape as `dimensions` + `part`); YAML `other_dimensions`.
- **Why:** owner: mounted works have two measurements.
- **Tested:** e2e 63 passing.
- **Revert:** redeploy the previous commit; as owner `ALTER TABLE artworks DROP COLUMN other_dimensions;
  DROP FUNCTION other_dimensions_valid`.

### Admin: paste a dimensions line; inches / mm / m converted
- **What:** `backend/src/admin/editor/dims.js`: pasting "139.38 × 85.09", "139,4 x 85,1 cm", "54 7/8 × 33 1/2 in.",
  "1394 × 851 mm" … into a dimensions box fills height/width/depth (unit dropped; metric part preferred when both are
  given); other units converted to cm (2 decimals) with a notice and "keep the original in the note"; a unit typed
  into one box is converted when leaving it.
- **Why:** owner: copying dimensions from museum pages.
- **Tested:** e2e 62 passing.
- **Revert:** redeploy the previous commit.

### Dates: "c. 1755" / "ca." / "circa" (±5 years)
- **What:** `backend/src/fuzzy-date.js` accepts circa dates (also ranges and BCE) as ±`CIRCA_YEARS` (5), label "c. 1755",
  shown as written in forms; Wikidata's circa qualifier on a year gives the same value. Form hint, docs.
- **Why:** owner: "ca. 1755" was refused; the ±5 convention was pinned since 2026-09-28.
- **Tested:** unit 23 passing; e2e.
- **Revert:** redeploy the previous commit (stored ranges stay as they are).

### Admin: materials suggested from the medium, terms used before clickable
- **What:** `backend/src/admin/editor/materials.js`: under the materials list, chips "From the medium" (known
  materials and terms in use found in the medium text, plus a few synonyms: oil → oil paint, gilt → gold leaf; in the
  order of the medium) and "Used before"; a click adds the term, typing stays possible.
- **Why:** owner: keep materials for filtering, but without typing everything twice.
- **Tested:** e2e 60 passing.
- **Revert:** redeploy the previous commit.

### Admin: unpublished changes marked per field
- **What:** the edit page carries the published values (`data-published`); `backend/src/admin/editor/unpublished.js`
  outlines every field the shared working copy changes, tags it "unpublished", shows "Published: …" and a count at
  the top; re-checked on every edit (also remote and Markdown edits — the editor fires `md-change`) and refetched from
  `/<type>/<slug>/published.json` when someone publishes or reverts. The entry page's banner names the fields.
- **Why:** owner: no way to see which changes were unpublished.
- **Tested:** e2e 59 passing (mark, unmark, published value, Markdown, other editor, banner, clearing after publish).
- **Revert:** redeploy the previous commit.

### Admin: field names and explanations per entry type
- **What:** `LABELS` / `TYPE_HINTS` in `backend/src/admin/forms.js`: an artwork's `kind` is shown as "Object type",
  places/institutions/polities/people get "Kind of …"; short explanations for object type vs. medium vs. materials and
  every kind field; materials and occupations list the terms already in use. API field names unchanged.
- **Why:** owner: kind / medium / materials were easy to confuse.
- **Tested:** e2e 58 passing.
- **Revert:** redeploy the previous commit.

### Patrons become People (migration 024)
- **What:** `ALTER TYPE entity_type RENAME VALUE 'patron' TO 'person'`, table `patrons` → `people` (constraints,
  indexes, triggers renamed; delete trigger re-created with 'person'); `notes_md` → `description_md`; new `birth`,
  `death`, generated `lifespan`, `occupations text[]`; functions naming the type re-created; `entity_index` period =
  lifespan else active; `audit_log` (table name, relationship JSON, notes_md key) and `quality_acks` keys updated.
  Vocabulary: `depicts_person` (artwork → person/artist, category depiction); people allowed in influenced_by,
  collaborated_with, associated_with, as teachers in student_of. API `/v1/people` with `roles` (patron/owner/depicted),
  filters role/occupation; `/v1/patrons…` 301 → `/v1/people…`; `types=patron` still accepted. Admin "People",
  `/patrons…` redirects. Wikidata: birth/death, occupations (P106), P180 humans → depicts_person, artists vs people by
  occupation. YAML `people/` (old `patrons/` still imports). E2E fixtures moved.
- **Why:** owner: people depicted (Hagiwara Sakutarō in Onchi Kōshirō's portrait), rulers, monks; patron as a role.
- **Tested:** smoke test; e2e 57 passing; legacy `patrons/` import dry run.
- **Revert:** restore the backup taken right before the deploy (renames + data updates; a hand revert would need the
  inverse of every step).

### API: `search_text` on every entry
- **What:** lists and details carry `search_text` = `name_alt_text()` (other names, readings, romaji of kana).
- **Why:** the frontend filters loaded lists itself; this way "utagawa" finds うたがわ there too, without a second
  Hepburn implementation in the browser.
- **Revert:** redeploy the previous commit.

### Kana readings searchable in Latin letters; sorting by the title (migration 023)
- **What:** SQL `kana_romaji()` (Hepburn), `romaji_short()`, `name_alt_text()` (search text: other names, readings,
  romaji long + short) with new `<table>_alt_trgm` indexes (replacing `<table>_names_trgm`), `name_sort_key(name, ruby,
  names)` — the title when it has Latin letters, else its romanization, else the romaji of its furigana; `entity_index`
  gets `alt_text`. Admin list search, API `?q=` and `/v1/search` use them. Wikidata: an original title (P1476) becomes
  the title only in Latin script; a Japanese one is offered as "original" among the other names.
- **Why:** owner: 歌川 with reading うたがわ wasn't found by "utagawa"; English titles for Japanese works must sort by
  the English title.
- **Tested:** smoke test; e2e 55 passing (hokkaido/hokkaidou, sort keys, Wikidata Japanese title).
- **Revert:** redeploy the previous commit; re-create 022's `name_sort_key(text, jsonb)`, `entity_index` and
  `<table>_names_trgm` indexes, then drop the 023 functions.

### E2E tests use their own sample content
- **What:** `backend/test/e2e/fixtures/content/` — a frozen copy of `content/` (as of migration 022) imported by
  `global-setup.js` instead of the live snapshot.
- **Why:** the content snapshot committed after migration 022 (real data: new institutions, The Great Wave's image …)
  made 9 specs fail and `deploy.sh` stop (production untouched). Exporting real content must never break deploys.
- **Revert:** redeploy the previous commit.

### Admin: name fields at full width, inline reading panel
- **What:** name / other-name inputs full width; language · role · Add reading · remove in a compact line below; each
  other name in its own box. "Add reading" opens a small panel under the field (Enter adds, Esc cancels) instead of
  the browser's prompt.
- **Why:** owner: the row layout was cramped and the popup clumsy.
- **Tested:** e2e (panel, Enter doesn't submit, message without a selection).
- **Revert:** redeploy the previous commit.

### Names in several languages: furigana, language tags, translations, romanizations (migration 022)
- **What:** every entity table: `<name>_lang`, `<name>_ruby` (furigana markup, name stays plain), `names jsonb`
  ([{text, lang, role}] — original / translation / romanization / alternative; replaces `alt_names`/`alt_titles`, moved
  in as alternative with history triggers off), SQL functions `ruby_plain`, `ruby_reading`, `lang_tag_ok`,
  `names_valid`, `names_text`, `name_sort_key`, trigram index per table, `entity_index` + `names`/`sort_key`, quality
  check `missing_romanization`. `src/names.js` (shared server/browser). Admin: language next to the name, "Add
  reading" button + live ruby preview, other names as rows (textarea underneath for no-JS/drafts/live copies),
  lists sorted by romanization, search over all names; slug follows the romanization when the title has no Latin
  letters. Wikidata: labels as tagged translations, P1559/P1476 as original (artworks: P1476 offered as the title
  with its language), P2125 Hepburn as romanization. API: `<name>_lang`, `<name>_ruby_html`, `<name>_reading`,
  `names`, `sort_key`; `alt_names`/`alt_titles` kept (plain). YAML: `names:` (old `alt_*` keys still import).
- **Why:** owner: original-language titles with translations; furigana for Japanese; romanized titles for
  non-Latin scripts — for every entity type.
- **Tested:** unit 22 passing (markup, tags, lines); smoke test; e2e (reading button, rows, slug from romanization,
  API fields, search, validation; Wikidata P1476 + tagged labels).
- **Revert:** redeploy the previous commit; as owner per table `ALTER TABLE … ADD COLUMN alt_names text[] NOT NULL
  DEFAULT '{}'` (artworks `alt_titles`), `UPDATE … SET alt_names = ARRAY(SELECT ruby_plain(n->>'text') FROM
  jsonb_array_elements(names) n)`, then drop `names`, `<name>_lang`, `<name>_ruby`; re-create 021's quality view
  and 019's `entity_index`. Easier: restore the backup taken right before the deploy.

### Admin: static files linked with a content hash
- **What:** `backend/src/admin/assets.js` — `admin.css`, `editor.js`, `map.js`, `map.css` are linked as
  `/static/<file>?v=<SHA-256 prefix>` (rehashed when the file changes); the map files' URLs reach the bundle via
  `data-map-js` / `data-map-css` on `<body>`.
- **Why:** after the slug deploy the browser kept the old `editor.js` (cached for 1 h) until a hard refresh.
- **Tested:** e2e 51 passing (hashed URLs present and served).
- **Revert:** redeploy the previous commit.

### Admin: slug cleaned as you type, follows the title on new entries
- **What:** `backend/src/admin/editor/slug.js` (in the editor bundle): typed slugs become lowercase, spaces → hyphens,
  accents dropped (Dürer → durer), other characters removed; a trailing hyphen is dropped when leaving the field. On a
  new entry the slug is generated from the name/title as you type until the slug is edited by hand (clearing it hands
  it back). Existing entries: cleaned, never regenerated (slugs stay stable). The server's checks are unchanged.
- **Why:** owner: no manual slug typing ("Pine Trees in the Snow" → pine-trees-in-the-snow).
- **Tested:** e2e 50 passing (follow / manual / clear / existing entry; pattern check still refuses a script-set value).
- **Revert:** redeploy the previous commit.

## 2026-10-04

### New creators/institutions from the artwork form, century dates, height-only dimensions (migrations 020, 021)
- **What:** typing a name that doesn't exist into an artwork's creator or institution creates a minimal artist /
  institution with the save (exact names link the existing entry; a near miss asks "did you mean …?" with a
  "create anyway" tick). New table `auto_created` flags them (and entries the Wikidata comparison creates) until
  published or marked complete: banner on the entry, "to complete" in lists, quality check `auto_created` (view
  re-created; the generic delete trigger also clears the flag). Dates: `13th century`, `early/mid/late …`,
  `first/second half of the …`, `13th–14th century`, `… BCE`, decades `1880s` (src/fuzzy-date.js; shown as written).
  Dimensions: height alone allowed (constraint replaced in 020), shown as "50 cm (height)" with a form hint (CSS
  `:has()`), Wikidata heights without width taken.
- **Why:** owner: refusing an unknown artist/institution was a dead end; artworks from the 13th century; sculptures
  measured by height only.
- **Tested:** unit (century parsing, 19 passing); smoke test; e2e 49 passing (auto-create, exact name, near miss,
  marks; century date round trip; height only).
- **Revert:** redeploy the previous commit; as owner `DROP TABLE auto_created`, re-create 019's quality view and 001's
  `delete_entity_relationships()`; restore the old dimensions rule only after rows with a height alone are fixed:
  `ALTER TABLE artworks DROP CONSTRAINT artworks_dimensions_check, ADD CONSTRAINT artworks_dimensions_check CHECK
  ((height_cm IS NULL) = (width_cm IS NULL) AND (depth_cm IS NULL OR height_cm IS NOT NULL))`.

## 2026-10-03

### Polities and countries (migrations 018, 019)
- **What:** new entity type `polity` (table `polities`: period, kind, parent, `country_codes` ISO list) with
  relationship types `nationality` (artist/patron), `created_in_polity` (artwork), `located_in_polity` (institution).
  SQL functions `place_country`, `entity_home_place`, `entity_country`, `entity_polities`, `entity_table`;
  `entity_exists`/`entity_id`/`entity_index` know the new type; quality view re-created (+ check
  `outside_polity_period`, polities in the completeness checks). Public API: `country` (today, derived from places),
  `polities` and (artists, patrons) `birth_place` in lists and details; filters `?country=`, `?polity=`; endpoint
  `/v1/polities`. Admin: Polities section (nav, forms, search, history, revert). Wikidata: P27 → nationality, P495 →
  created in (polity), polity period P571/P576 and ISO code P297; name matches of another type no longer skip the full
  fetch. YAML folder `content/polities/`.
- **Why:** frontend needs countries (sorting/grouping); owner: historical polities (USSR, Han dynasty) shown together
  with the country today ("Soviet Union (today Ukraine)").
- **Tested:** smoke test (inherited codes, polity fallback, code check, quality check); e2e 45 passing (polity form,
  nationality link, API fields and filters, Wikidata P27 creating a polity).
- **Revert:** redeploy the previous commit; as owner: `DROP FUNCTION entity_country, entity_polities, entity_home_place,
  place_country, entity_table; DELETE FROM relationship_types WHERE category = 'polity'` (after deleting those
  relationships), re-create 017's quality view and 004's `entity_index`, `DROP TABLE polities`. The enum value
  `polity` can stay (removing enum values isn't supported).

### Git hooks run under GitHub Desktop (`scripts/githooks/`, `.gitattributes`)
- **What:** `pre-commit` and `pre-push` start with `#!/bin/sh` (they were already POSIX); `pre-push` runs
  `check-secrets.sh` with `bash` if available, else `sh`. `check-secrets.sh` uses pipes instead of here-strings
  (`<<<`). New `.gitattributes` keeps LF endings for `*.sh` and the hooks.
- **Why:** on a Windows checkout GitHub Desktop failed with "cannot spawn scripts/githooks/pre-push": CRLF made the
  shebang `/bin/bash\r`, and its bundled Git has `sh` but no `bash`. Its bash also cannot create temp files for large
  here-strings, so the credential check silently passed big diffs; with pipes it doesn't need temp files.
  On the VPS nothing changes in behaviour (`/bin/sh` = dash runs the hooks, `bash` runs the scanner).
- **Tested:** with GitHub Desktop's Git and PATH: real push passes; a 20 000-line diff with a fake password and a
  commit adding `backend/.env` are both blocked; same results in Git Bash.
- **Revert:** `git revert` the commit (Windows users then need `git config core.autocrlf false` or Git Bash to push).

## 2026-10-02

### Several images per artwork, artist and institution (migration 017)
- **What:** new table `images` (url, source_url, license, credit, caption, position) with an exclusive arc
  (`artwork_id` / `artist_id` / `institution_id`, exactly one set, real FKs with ON DELETE CASCADE), partial indexes
  per arc, unique (entry, url), audit trigger. The existing single images were moved in as position 0, then the
  `image_*` columns of artworks/artists/institutions were dropped; the quality view's image check reads `images`.
  Admin: "Images" section on the entry page — add, edit, remove, ↑ ↓ / make main (saved immediately, audited);
  the first image is the list thumbnail and the preview. History describes image rows ("image of …"); revert/restore
  handles them like relationships (a reverted deletion brings its images back; old changes to the dropped columns are
  listed as not revertible). Wikidata: every P18 file offered on its own (add / skip / later, remembered as
  `image:<file>`); for new entries after creating them. Public API: `image_url` = main image, detail `images` list.
  YAML: `images:` list (import upserts by url, removes only with `--prune`). docs: data-model, api, content/README.
- **Why:** owner: one image is not enough, especially for 3D artworks (front, back, details).
- **Tested:** migration on dev (data moved, arc check rejects 0 or 2 owners); e2e (add / duplicate refused / make main
  / reorder / edit / remove / revert, list thumbnail, API; Wikidata 2 images; revert of a deletion restores images);
  export → import round trip on dev.
- **Revert:** redeploy the previous commit, then as owner re-add the columns and copy position-0 images back, e.g.
  `ALTER TABLE artworks ADD COLUMN image_url text, …; UPDATE artworks a SET image_url = i.url, … FROM images i
  WHERE i.artwork_id = a.id AND i.position = 0;` (same for artists, institutions), re-create the 016 quality view,
  `DROP TABLE images`. Easier: restore the backup taken right before the deploy.

### Inventory number only together with the institution (migration 016)
- **What:** `CHECK (inventory_number IS NULL OR current_institution_id IS NOT NULL) NOT VALID` on artworks — enforced
  for every insert/update from now on; existing rows not yet checked. Quality view: new error check
  `inventory_without_institution` (view re-created). Admin: hint at the field, readable message on violation. Wikidata:
  the inventory number is taken from the statement of the suggested collection (qualifier P195) and shown with it.
- **Why:** owner: an inventory number only means something within the collection that assigned it.
- **Open:** production has one such row (The Great Wave, 13695 from Wikidata, no institution) — it can't be published
  until the institution is set or the number cleared. Then: new migration
  `ALTER TABLE artworks VALIDATE CONSTRAINT artworks_inventory_needs_institution;`
- **Revert:** redeploy the previous commit; as owner `ALTER TABLE artworks DROP CONSTRAINT artworks_inventory_needs_institution`.

### Artworks: dimensions (2D/3D) and materials (migration 015)
- **What:** `artworks.height_cm/width_cm/depth_cm` (numeric(8,2), depth only with height+width), `dimensions_note`,
  `materials text[]` with a GIN index. Admin form (height × width × optional depth, decimal comma accepted; materials one
  per line), shown as "73.7 × 92.1 cm (unframed)". Public API: `dimensions` object and `materials`, filter
  `?material=`. Admin search finds materials. Wikidata comparison: height P2048 / width P2049 / depth P2610·P5524
  converted to cm (cm, mm, m, inch, foot) and materials P186 as opt-in items. YAML: `dimensions: [h, w(, d)]`.
- **Why:** owner: artworks need dimensions (incl. 3D objects) and materials.
- **Tested:** constraint checks on dev; e2e (validation, 2D→3D, page, API + filter; Wikidata 630 mm → 63 cm);
  export → import round trip unchanged.
- **Revert:** redeploy the previous commit; as owner `ALTER TABLE artworks DROP CONSTRAINT artworks_dimensions_check,
  DROP COLUMN height_cm, DROP COLUMN width_cm, DROP COLUMN depth_cm, DROP COLUMN dimensions_note, DROP COLUMN materials`.

### Images for artists and institutions (migration 014)
- **What:** `artists` and `institutions` get `image_url` (https), `image_source_url`, `image_license`, `image_credit`
  like artworks. Admin: form fields, list thumbnails and page preview (generic for every type with an image; portraits
  cropped towards the top in the square thumbnail). Wikidata comparison offers P18 (portrait / building) with license and
  credit for these types too. Public API: `image_url` in lists, all four fields in details (docs/api.md). The quality
  check "image without license or credit" covers all three tables (view re-created with `CREATE OR REPLACE VIEW`).
- **Why:** owner: previews for artists and institutions as well.
- **Revert:** redeploy the previous commit; to drop the columns as owner: `ALTER TABLE artists DROP COLUMN image_url, …`
  (same for institutions) after re-creating the view from 013.

### Admin: artwork thumbnails in the list, preview on the artwork page
- **What:** the artworks list shows a 120 px thumbnail per row (lazy-loaded; placeholder without image), the artwork
  page a 500 px preview with credit · license. `backend/src/admin/images.js` turns Wikimedia URLs (stored thumbnails
  and originals) into the needed standard width (120 px ≈ 6 KB instead of the stored 1280 px); other hosts unchanged.
  CSP `img-src` now allows any https host (image_url only requires https; scripts/styles/frames stay 'self').
- **Why:** owner: see the artworks in the list.
- **Tested:** unit test for the URL conversion; e2e test (Wikimedia intercepted); manually on dev (stored thumbnail
  and original Commons URL).
- **Revert:** redeploy the previous commit.

## 2026-09-30

### Admin: data-quality page (migration 013)
- **What:** view `quality_issues` — one SELECT per check (UNION ALL), severity error/warning/info: presence outside
  the lifespan, "born/died in" vs birth/death date, artwork outside its creator's life (`>>`/`<<`), people linked who
  never lived at the same time (`&&` on lifespans), substantial overlapping residences (range intersection `*`),
  "housed at" before founding, place outside its parent's outline (PostGIS `ST_Covers`), probable duplicates
  (pg_trgm `similarity`), missing creator/license/relationships/dates/periods/parents/descriptions/Wikidata ids.
  `quality_acks` remembers findings marked "OK" (with note). Page `/quality` (filters, counts), a box on each entry,
  dashboard counter, nav link. Runs in ~35 ms on the current data. `src/admin/quality.js`; 2 new e2e tests (36 total).
- **Why:** owner: find contradictions and gaps before they reach the public map/timeline.
- **Revert:** redeploy the previous commit; 013 can stay (or as owner: `DROP VIEW quality_issues; DROP TABLE quality_acks`
  + its schema_migrations row).

### Wikidata review: explicit decisions everywhere
- **What:** every differing field, image, reference target and relationship suggestion now offers take / keep mine
  (skip) / **decide later**. Only explicit choices are remembered (`wikidata_reviews`); "decide later" records nothing
  and asks again next time. Defaults: empty fields → take; filled fields, suggestions → decide later (quick action:
  "link where we have it / skip / decide later" for all open suggestions). Alternative names are never pre-ticked
  (Wikidata aliases are noisy); unticked names are declined only on request. Commons image URLs are stored without
  tracking parameters; the preview image is no longer lazy-loaded.
- **Why:** owner: a filled field left unticked was silently remembered as "kept"; checking own data against Wikidata
  should be a deliberate, remembered decision.
- **Revert:** redeploy the previous commit.

### Admin: compare with Wikidata — reviewed, own values first (migration 012)
- **What:** "Wikidata…" on every entry and "+ from Wikidata…" on lists (`backend/src/admin/wikidata.js`, `wikidata-ui.js`,
  `src/wikidata-time.js`). Search → review page field by field (yours | Wikidata | take?): empty fields pre-ticked,
  differing values never; dates with Wikidata precision/circa/Julian→Gregorian; alternative names as opt-in items;
  Commons image with license/credit; relationship suggestions (born/died/lived/worked in, student of, movement,
  studied at, influenced by, created in, depicts, owned/commissioned by) linking our entries by Q-id, by exact name
  (they get the Q-id) or a similar name (offered only), or creating missing ones (only if ticked). Field values go into
  the working copy (Publish still needed); new entries prefill the new-entry form. Declined values are remembered in
  `wikidata_reviews` and folded until Wikidata changes them. Changes are audited with source `wikidata`; the source
  note "Wikidata Q… (retrieved date)" goes into metadata. Outbound: www.wikidata.org and commons.wikimedia.org APIs
  (User-Agent identifies the site). CSP img-src adds upload./thumb.wikimedia.org for previews.
  Also fixed: December dates were written as "1926-12/1926" (now "1926-12").
- **Why:** owner: faster content entry, but never import blindly, and own edits take priority over Wikidata.
- **Tested:** unit tests (precisions, Julian, circa, periods); 4 e2e tests against a fixture server (new entry from
  Wikidata, suggestions link/create/skip + remembered, own value kept + remembered, artwork with creator/collection/image);
  manually against real Wikidata (Van Gogh, The Starry Night, Arles) on dev.
- **Revert:** redeploy the previous commit; 012 can stay (or as owner: `DROP TABLE wikidata_reviews` + schema_migrations row).

### End-to-end tests; deploy runs them first
- **What:** Playwright Test suite for the admin panel (`backend/test/e2e/`, 30 tests: auth/security, entities and
  relationships, search, history/revert/merge, drafts and live co-editing incl. a server restart, Markdown editor, map
  picker). Own database `arthistory_test` (created with `db/setup.sh arthistory_test`, reset every run), own server on
  :3006, users with per-run passwords in the OS temp dir; OSM tiles intercepted. Chromium headless shell in
  `~/.cache/ms-playwright` (~270 MB). `deploy.sh` now: pull → npm ci → unit + e2e tests → only then build the production
  bundle, migrate, reload (`--skip-tests` for emergencies). Unit tests limited to `test/*.test.js`.
  Small app fix found by the tests: a picker whose typed value exactly matches an entry no longer opens its list over
  the form's buttons.
- **Why:** the admin panel grew complex (live collaboration, revert/merge); regressions must be caught before production.
- **Revert:** redeploy the previous commit (deploy.sh without the test step); `sudo -u postgres dropdb arthistory_test`;
  `rm -r ~/.cache/ms-playwright`.

### Fix: OpenStreetMap tiles blocked in the admin map
- **What:** the map picker's tile layer sets `referrerPolicy: 'strict-origin-when-cross-origin'` on its tile images, so
  OSM receives `Referer: https://admin.arthistory.piogino.ch/` (origin only). The pages keep `Referrer-Policy: same-origin`.
- **Why:** OSM's tile policy requires a Referer; since the admin pages send none to other sites (2026-09-29 login fix),
  browsers got OSM's "Access blocked" tile (served with status 200). Verified: browser-like request without Referer →
  blocked tile, with our origin → real tile.
- **Revert:** redeploy the previous commit.

### Admin live connection, step 2: shared working copies with live co-editing (migration 011)
- **What:** every existing entry has one shared working copy while being edited — a Yjs document (CRDT) on the server
  (`backend/src/admin/collab.js`), relayed over `/live`, persisted to `live_docs` (bytea state, base version, dirty,
  contributors). Markdown fields merge character by character with other editors' cursors (y-codemirror.next); short
  fields sync live (last writer wins). The edit page embeds the copy's state, so editing starts at once and works
  offline (IndexedDB via y-indexeddb), merging on reconnect; an epoch per copy keeps browsers from mixing lineages.
  Save → **Publish** (validated + audited as before), after which every editor's copy follows the new version;
  "Unpublished changes by …" on view/edit pages and the dashboard; "Discard unpublished changes…" with a confirmation
  page (resets for everyone); reverts/restores rebase open copies, deletions close them. New-entry forms keep step 1's
  per-user drafts. New runtime deps: yjs 13.6, y-protocols 1.0 (MIT); dev deps y-codemirror.next, y-indexeddb (MIT).
  Shutdown persists all copies before closing sockets.
- **Why:** owner: several editors working on the same entry at the same time, nothing lost, drafts internal until published.
- **Tested (dev, two users in headless Chromium):** simultaneous typing at both ends of a biography converges; short
  field sync; remote caret; unpublished changes attributed to both; publish by one → the other notified and can publish
  without conflict; both editing while the server was down → merged after restart; reload shows the copy; discard for
  everyone; a revert rebases the other user's open copy.
- **Revert:** redeploy the previous commit (edit pages go back to per-user drafts); 011 can stay (or as owner:
  `DROP TABLE live_docs` + its schema_migrations row).

### Admin live connection, step 1: presence + continuously saved drafts (migration 010)
- **What:** WebSocket `/live` on the admin host, served by the existing pm2 process (`backend/src/admin/live.js`, `ws` 8.22
  MIT; browser side `src/admin/editor/live.js`). Upgrade accepted only on the admin host, only from the admin Origin
  (cross-site WebSocket hijacking), only with a valid session; 30 s ping heartbeat; on pm2 reload clients get 1012 and
  reconnect. Presence ("Also here: …", field tags, list badges). Edit/new forms are snapshotted every 1.5 s into
  `admin_drafts` (one per user and entry, `UNIQUE NULLS NOT DISTINCT`), kept in localStorage while offline; returning shows
  "Restore / Discard", and restoring rebases the draft on what others saved meanwhile (three-way per field, word merge
  for texts, conflicts flagged). Saving deletes the draft. nginx: `location = /live` with Upgrade/Connection headers.
- **Why:** owner: several editors — see who is where, never lose unsaved work. Step 2 (shared live working copy, Yjs)
  builds on this connection.
- **Tested (dev, two users in headless Chromium):** list badge + presence bar with field, draft in DB, presence gone on
  close, other user's save kept on restore (rebase), typing during a server restart kept locally and saved on
  reconnect, save deletes the draft. Upgrade rejected without session (401), with foreign Origin (403), other path/host (404).
  Found and fixed on the way: draft baseline taken too late; hello/draft race after reconnect (messages now in order).
- **Revert:** redeploy the previous commit; remove the `location = /live` block from the admin server block and reload
  nginx. Migration 010 can stay (or as owner: `DROP TABLE admin_drafts` + its schema_migrations row).

### Admin: word-level diffs for long texts; three-way merge when reverting
- **What:** history and revert preview show biographies/descriptions/notes (and any text ≥ 80 chars) as a word diff
  (`backend/src/admin/textdiff.js`, jsdiff 9, BSD-3 — new runtime dependency) with unchanged stretches collapsed.
  Reverting a text that was edited again since now offers "merge" (default when possible): a word-level three-way merge
  (diff3 idea) undoes only this change's words and keeps later edits; overlapping edits stay a conflict (keep / revert).
- **Why:** owner: small edits in long biographies were hard to see; whole-field conflicts forced a choice between
  losing the later edit and not reverting.
- **Tested:** unit tests (diff marking/escaping/collapsing, merge incl. overlap and identical edits); on dev a revert of a
  biography edit with a later edit elsewhere merged correctly (old words back, later edit kept).
- **Revert:** redeploy the previous commit.

### Admin: revert changes and restore versions from the history (migration 009)
- **What:** every history entry has "revert…" (undo one save — all rows of its transaction) and entity history rows have
  "restore this version…". A preview plans each row: three-way comparison per field (before / after the change / now)
  with fields changed since defaulting to "keep", deleted rows re-created with their original id (`OVERRIDING SYSTEM
  VALUE`, values via `jsonb_populate_record`), taken slugs / Wikidata ids, vanished references and relationship ends,
  and deletions of rows edited since or with newer relationships (need confirmation). Every plan is dry-run in a
  transaction that is rolled back; applying re-checks a fingerprint of the current state. Reverts are audited with
  `audit_log.reverts` (txid) / `restores` (entry) and can themselves be reverted. Code: `backend/src/admin/revert.js`,
  `revert-ui.js`; migration 009 adds the two columns, two indexes and extends `audit_row()`.
- **Why:** owner wanted undo from the history with proper conflict handling.
- **Tested (dev):** plain revert, conflict kept / reverted on purpose, deleted place with 3 relationships restored with
  the same ids, slug taken meanwhile → restored under a new slug, creation with newer relationship refused until
  confirmed, stale preview refused, restore version, revert of a restore; smoke test and unit tests pass.
- **Revert:** redeploy the previous commit; 009 can stay (or as owner: restore `audit_row()` from 006, drop the two columns).

### Migration 008: clearer inverse labels
- **What:** `member_of` → "has member" (was "member"), `owned_by` → "owner of" (was "owned"), `housed_at` → "holds / held"
  (was "held"). Display text only; codes and data unchanged.
- **Why:** owner review of all labels: the inverse is what the object's page shows, and these read awkwardly.
- **Revert:** as arthistory_owner, set the three inverse labels back and delete the `schema_migrations` row for 008.

### Migration 007: relationship vocabulary round 2; reverse types in the admin form
- **What:** `inspired_by_place` removed (unused; overlapped with `influenced_by_culture_of`), `depicts` added (artwork →
  place, category association), `owned_by` / `commissioned` / `patron_of` widened to institutions and places. Admin
  "Add relationship" also offers reverse types ("commissioned by", "birthplace of", …) grouped "From / Towards this …",
  saved in canonical direction. Docs: data-model.md, content/README.md.
- **Why:** owner feedback on the vocabulary: overlapping place types, owners/commissioners that are cities or
  churches, and commissions that couldn't be entered from the artwork's page.
- **Tested (dev):** smoke test; commission by a place entered on the artwork page stored as place → artwork; `depicts`;
  wrong target types rejected with a readable message.
- **Revert:** as arthistory_owner: `DELETE FROM relationships WHERE relationship_type = 'depicts'`, delete the `depicts`
  row, restore the old subject/object types (see migration 002), re-insert `inspired_by_place` from 002, delete the
  `schema_migrations` row for 007; redeploy the previous commit.

### Admin: typo-tolerant search everywhere + fuzzy pickers; deploy keeps dev dependencies
- **What:** one scoring rule for all admin search boxes (`backend/src/admin/match.js`): name prefix > word start >
  substring > pg_trgm `word_similarity` (also with spaces removed: "vangog" → Van Gogh), plus alternative names/titles
  (0.9×). Used by the list pages (now typo-tolerant, best match first), `/search` (alt names now fuzzy), and the new
  `GET /lookup` behind the form pickers (`src/admin/editor/autocomplete.js`: creator, institution, place, parent,
  relationship target — the latter filtered by the relationship type's allowed target types; keyboard + mouse).
  `deploy.sh` no longer runs `npm prune --omit=dev`: this checkout is also the dev environment, and pruning removed
  esbuild, breaking the next local build. Dev bundles now go to `src/admin/static-dev/` (served first by the dev
  server only), so a dev build can never replace the bundles production serves from `static/`.
- **Why:** owner: all search bars should tolerate typos.
- **Tested (dev, headless Chromium):** "hokusia" → Hokusai picked with Enter (form not submitted), existing parent shown as
  "→ France (place)", "lived in" + "pari" → only the place Paris, "influenced by" + "hirosige" → Hiroshige first.
- **Revert:** redeploy the previous commit.

### Admin: search across everything
- **What:** `GET /search` (+ a search box in the admin top bar), `backend/src/admin/search.js`: one query over all six
  entity tables — names (accent-insensitive, typo-tolerant `word_similarity`), alt names/slug/medium/Wikidata id/metadata
  (ILIKE), and biography/description/notes via Postgres full-text search (`to_tsvector('english', …)`,
  `websearch_to_tsquery`, `ts_rank`, `ts_headline` snippets) — plus relationships by label, notes and sources.
  No schema change, no new index (sequential scan is milliseconds at this size; the GIN expression index to add later
  is noted in the file). App change only; deployed with `deploy.sh`.
- **Why:** owner wanted one search over all content instead of per-type lists.
- **Revert:** redeploy the previous commit.

## 2026-09-29

### Admin: map picker for place location and area
- **What:** place forms show a Leaflet map (OpenStreetMap tiles): click/drag sets the location, Geoman tools draw/edit/cut/
  remove polygons for the area, and a search box queries OpenStreetMap Nominatim through the app (`GET /geocode`, logged-in
  only, ≤ 1 request/s, identifying User-Agent per the Nominatim usage policy) — a result can set the location or take over
  its boundary as the area. Bundle `static/map.js` + `map.css` (esbuild, git-ignored), loaded only on pages with a map.
  CSP (helmet): `img-src` now also allows `https://tile.openstreetmap.org`. Areas are stored via
  `ST_Multi(ST_CollectionExtract(ST_MakeValid(…), 3))` so hand-drawn self-intersections are repaired (import too; valid
  input unchanged — import dry run: all unchanged). New dev deps: leaflet 1.9.4 (BSD-2), @geoman-io/leaflet-geoman-free 2.20.2 (MIT).
- **Why:** owner: pick locations and draw areas on a map instead of typing coordinates/GeoJSON.
- **Tested (dev, headless Chromium):** tiles load, click moves the pin (5-decimal inputs), polygon tool → Polygon in the
  textarea without moving the pin, "Provence-Alpes-Côte d'Azur" outline → MultiPolygon, saved; PostGIS area 31,864 km²
  (official ≈ 31,400 km²). Bow-tie polygon repaired into two valid polygons; non-polygon GeoJSON rejected.
- **Revert:** redeploy the previous commit.

### Admin: Markdown editor with live styling; gzip for the admin site
- **What:** Markdown fields (biography, descriptions, notes incl. relationship notes) use a CodeMirror 6 editor
  (`backend/src/admin/editor/editor.js`): **bold**/*italic*/headings/links styled in place with dimmed markers, toolbar
  + Ctrl/⌘ B/I/K, and a Preview rendered by the server (`POST /preview` → same markdown-it + sanitize-html as the API).
  The textarea stays in the form (hidden, kept in sync) — without JS it still works. Bundle built by esbuild at deploy:
  `deploy.sh` now runs full `npm ci` → `npm run build:admin` → `npm prune --omit=dev`; the bundle is git-ignored.
  View page: Markdown values use the full column width like other fields. nginx (admin server block):
  `gzip_proxied any`, `gzip_vary on`, `gzip_types` for CSS/JS/JSON (editor bundle ~310 KB → ~100 KB on the wire).
- **Why:** owner wanted to see formatting while typing and a consistent field width.
- **Tested:** headless Chromium (Playwright, scratch dir): no JS errors, bold/italic/marker styles computed, Ctrl+B,
  toolbar italic and Ctrl+K produced `**bold** and *italic* [link text](…)` in the textarea and in the DB after Save,
  Preview shows sanitized HTML and hides the editor, light + dark screenshots.
- **Revert:** redeploy the previous commit; remove the four gzip lines from the admin server block and reload nginx.

### Admin panel: login fixed ("Forbidden: cross-site request.") and moved to the root of its host
- **What:** helmet's default `Referrer-Policy: no-referrer` made browsers send `Origin: null` on the admin's own form
  posts, so `checkOrigin` rejected every login (curl tests set `Origin` by hand and missed it). Now
  `Referrer-Policy: same-origin`, and `checkOrigin` also accepts `Sec-Fetch-Site: same-origin` when Origin is null/absent.
  The panel is now served at https://admin.arthistory.piogino.ch/ instead of `/admin/`; GET `/admin/…` → 301 to `/…`.
  Routing is by hostname (dev: `ADMIN_HOST` defaults to `admin.localhost`, i.e. http://admin.localhost:3005/). Unknown
  admin paths get the HTML 404 page. No nginx or DB change; session cookies stay valid (Path=/).
- **Why:** owner couldn't log in; the `/admin` prefix was redundant on a dedicated admin hostname (it only existed so
  dev on plain localhost could tell admin from API by path).
- **Tested on dev:** Origin exact / null + same-origin → accepted; null without Sec-Fetch-Site, cross-site → 403;
  full login → dashboard → list → logout with a temporary user (deleted afterwards); old URLs redirect; /v1 unaffected.
- **Revert:** redeploy the previous commit (`ee5f03b`) with `backend/deploy.sh`.

## 2026-09-29

### Admin: single login — nginx basic auth replaced by fail2ban
- **What:** removed `auth_basic` from the admin server block in `/etc/nginx/sites-available/arthistory` and deleted
  `/etc/nginx/arthistory-admin.htpasswd` (+ its entries in `~/.config/arthistory/admin-credentials.env`). Installed
  fail2ban 0.11.2 (apt) with one jail, `arthistory-admin`: filter matches `POST /login` answered with 401 in the admin
  access log; 5 in 10 min → REJECT on ports 80/443 for 1 h (iptables chain `f2b-arthistory-admin`); server IP exempt.
  Ubuntu's default `sshd` jail explicitly disabled in `jail.d/arthistory.local` (out of scope; key-only SSH).
  Copies: `config/fail2ban/`, `config/nginx/arthistory`.
- **Why:** owner: the browser's basic-auth dialog was clumsy (no logout, poor password-manager support, two passwords).
  fail2ban keeps the "stop brute force before it matters" role invisibly; the app's own per-IP limit stays as well.
- **Tested:** filter against sample lines (matches only 401 POSTs to /login), wrong login → 401 logged, manual ban of
  203.0.113.9 created the REJECT rule, unban removed it.
- **Revert:** re-add the two `auth_basic` lines (see the 2026-09-28 entry), recreate the htpasswd file
  (`openssl passwd -6`), `sudo systemctl reload nginx`; `sudo systemctl disable --now fail2ban` or `sudo apt purge fail2ban`.

## 2026-09-28

### Admin panel live (Phase 5) — the database is now the source of truth
- **Incident + rotation (same day):** while testing the login through nginx, curl's `%{redirect_url}` output printed the
  basic-auth credentials (curl embeds user:password in redirect URLs) into the Claude session log. The basic-auth password
  was rotated immediately (new htpasswd entry; old one verified rejected with 401). App login password was never shown.
  Lesson: never print `%{redirect_url}` (or `-v`) for requests made with `-u`/`user =`.
- **What:** `backend/src/admin/` served at https://admin.arthistory.piogino.ch/admin/ by the existing pm2 process.
  Migration 006: `admin_users` (scrypt hashes), `admin_sessions` (SHA-256 of cookie tokens), `audit_log` + `audit_row()`
  trigger (SECURITY DEFINER) on all content tables; api role can't see these tables, admin role can't write history or
  create users. nginx: `auth_basic` on the admin server block (`/etc/nginx/arthistory-admin.htpasswd`, root:www-data 640);
  site config copied to `config/nginx/arthistory`. `deploy.sh` no longer runs `npm run import`; new `npm run export`
  (DB → content/ YAML) and `npm run admin:user`. Content model moved to `backend/src/content.js` (shared by import,
  export, admin). Markdown fields are stored without trailing whitespace (import and forms agree).
- **Why:** owner decision: edit in the admin panel, database = truth, history in Postgres; YAML stays as export/bulk import.
- **Tested on dev:** login/rate-limit/Origin check, create/edit/delete with validation and friendly DB errors, optimistic
  locking, relationships add/edit/delete, history; all 44 entities re-saved through their edit forms → 0 audit rows
  (lossless round trip); export → import --dry-run → all unchanged; smoke test incl. 4 new privilege checks.
- **Revert:** redeploy commit `1163ad5` (restores the 503 placeholder and the import in deploy.sh); remove the two
  `auth_basic` lines from `/etc/nginx/sites-available/arthistory` and `sudo systemctl reload nginx`. Migration 006 can stay
  (harmless); to drop it as arthistory_owner: drop the 7 `*_audit` triggers, `audit_row()`, `audit_log`, `admin_sessions`,
  `admin_users`, type `audit_action`, and its `schema_migrations` row.

### Nightly database backups (Phase 4)
- **Live:** repo `piosteiner/art_history-backups` created by the owner (verified private: 404 without auth), cloned to
  `~/backups/arthistory-offsite`; first backup pushed via systemd; restore from a fresh GitHub clone matched production
  (row counts + entities); a second run correctly skipped the unchanged data. Passphrase is in the owner's password manager.
- **What:** `scripts/backup.sh` (dump → verify by restoring into a scratch DB and comparing row counts → encrypted off-site
  copy to the private GitHub repo `art_history-backups`, only when the data changed) and `scripts/restore.sh` (always into a
  new database). systemd `arthistory-backup.service` + `.timer` (03:30 UTC, Persistent) in `/etc/systemd/system/`
  (copies in `config/systemd/`). Local dumps in `~/backups/arthistory` (700, 14 days). New secrets outside the repo:
  `~/.config/arthistory/backup-passphrase`, deploy key `~/.ssh/art_history_backups_deploy` (+ `github-art_history-backups`
  host alias in `~/.ssh/config`). `backend/db/setup-database.sql`: default privileges skipped when `-v restore=1`
  (the dump brings its own; otherwise `schema_migrations` would become readable by admin/api after a restore).
- **Why:** off-server copy of the data at no cost; GitHub private repo instead of paid storage (owner decision).
  Dumps are ~12 KB, so the repo stays tiny. Content is also in YAML today, but admin-panel edits (Phase 5) will only live in the DB.
- **Revert:** `sudo systemctl disable --now arthistory-backup.timer && sudo rm /etc/systemd/system/arthistory-backup.* &&
  sudo systemctl daemon-reload`; optionally `rm -r ~/backups`, remove the deploy key on GitHub + `~/.ssh/art_history_backups_deploy*`.

### Open-ended periods in content ("1808/" = since 1808, still ongoing)
- **What:** the date parser accepts an open end for periods only — relationship `period`, `movements.period`,
  `patrons.active` — stored as `[1808-01-01,)` (infinite upper bound), label "since 1808". Births, deaths, creation and
  founding dates still reject it. No migration (daterange supports it natively); API already returns `to: null`.
- **Why:** an institution's current location can be a dated `located_in` too, so its map route ends where it is now.
- **Revert:** redeploy the previous commit (first remove any `…/` periods from `content/`, or the import will fail).

### Migration 005: location history for institutions that moved
- **What:** new relationship type `located_in` (institution → place, physical presence, with period).
  `institutions.place_id` stays the current location. `/v1/map/presence` accepts `types=…,institution` (default unchanged).
  Smoke test covers it; docs: `backend/docs/data-model.md`, `backend/docs/api.md`, `content/README.md`.
- **Why:** owner decision — an institution can move, so one place isn't enough. Mirrors
  `artworks.current_institution_id` + `housed_at`.
- **Revert:** as arthistory_owner: `DELETE FROM relationships WHERE relationship_type = 'located_in';
  DELETE FROM relationship_types WHERE code = 'located_in'; DELETE FROM schema_migrations WHERE name = '005_institution_locations.sql'`,
  then redeploy the previous commit.

### Checkout renamed: /var/www/arthistory-api → /var/www/arthistory
- **What:** `mv /var/www/arthistory-api /var/www/arthistory`; `~/server-docs` symlink repointed; pm2 process re-created from
  the new `backend/ecosystem.config.js` (`cwd` updated) and `pm2 save`d. The pm2 process name stays `arthistory-api`
  (it is the API process), as do the nginx log names. nginx and the Git remote are unaffected.
- **Why:** the folder holds the whole repo (backend, content, server docs, later the admin panel), not only the API.
- **Revert:** `pm2 delete arthistory-api && mv /var/www/arthistory /var/www/arthistory-api`, restore `cwd` in
  `backend/ecosystem.config.js`, `pm2 start backend/ecosystem.config.js && pm2 save`,
  `ln -sfn /var/www/arthistory-api/server-docs ~/server-docs`.

## 2026-09-24

### Art history read API + content import (Phase 3)
- **Memory check first:** 2.2 GiB of 3.8 available, swap in use 335 MB but no active swapping (vmstat si/so 0), PSI memory ≈ 0,
  no OOM kills. Largest consumers are the VS Code server (~430 MB) and Claude Code (~250 MB). No action needed.
- **API:** `GET /v1/{artists,artworks,places,movements,institutions,patrons}[/:slug]`, `/v1/search`, `/v1/vocabulary`,
  `/v1/map/{places,presence,<type>/:slug}` (GeoJSON), `/v1/graph/<type>/:slug` (nodes + edges). Reference: `backend/docs/api.md`.
  Markdown fields served as sanitized HTML (markdown-it + sanitize-html). `Cache-Control: public, max-age=60` + ETag.
- **Migration 004:** `f_unaccent()` + trigram GIN indexes (accent-insensitive fuzzy search), `range_json()` (date JSON shape),
  `entity_index` view. Applied to `arthistory_dev` and (via deploy) `arthistory`.
- **Content:** `content/**/*.yaml` (format: `content/README.md`), starter set of 44 entities around Van Gogh, Gauguin,
  Hokusai, Hiroshige and Japonisme, 58 relationships. `npm run import` (arthistory_admin role, one transaction, idempotent,
  `--dry-run`, opt-in `--prune`); `deploy.sh` now runs it after migrations.
- **New npm deps:** yaml, markdown-it, sanitize-html. `npm test` runs unit tests for the date parser.
- **Revert:** redeploy the previous commit (`git checkout a32f79d -- backend && pm2 reload arthistory-api`); data can be
  removed with `DELETE FROM relationships; DELETE FROM artworks; …` as arthistory_admin. Migration 004 is harmless to leave;
  to drop it as arthistory_owner: `DROP VIEW entity_index; DROP FUNCTION range_json, iso_date; DROP INDEX …_trgm; DROP FUNCTION f_unaccent;
  DELETE FROM schema_migrations WHERE name = '004_read_api.sql'`.

### PostgreSQL 18 + PostGIS 3.6 installed (Phase 2)
- **What:** added the official PGDG apt repo (`/etc/apt/sources.list.d/pgdg.list`, via `postgresql-common`), installed
  `postgresql-18` (18.6) and `postgresql-18-postgis-3` (3.6.4). Cluster `18/main`, port 5432, **localhost only**; pg_hba unchanged
  (local peer, 127.0.0.1/::1 scram-sha-256). ~310 MB disk.
- **Why PGDG and not Ubuntu's package:** Ubuntu 22.04 ships PostgreSQL 14, end-of-life Nov 2026.
- **Tuning:** `/etc/postgresql/18/main/conf.d/arthistory.conf` (copy: `server-docs/config/postgresql/arthistory.conf`):
  shared_buffers 256MB, effective_cache_size 1GB, work_mem 8MB, max_connections 30, jit off, slow-query log ≥ 1 s only.
- **Roles:** `arthistory_owner` (migrations/DDL), `arthistory_admin` (read/write, no DDL, 30 s timeout),
  `arthistory_api` (read-only + `default_transaction_read_only`, 5 s timeout). Passwords generated into
  `~/.config/arthistory/backend.env` and `~/.pgpass` (both 600, outside the repo).
- **Databases:** `arthistory` (production) and `arthistory_dev`, both owned by arthistory_owner, CONNECT revoked from PUBLIC.
  Extensions: postgis, pg_trgm, unaccent. Setup is scripted and idempotent: `backend/db/setup.sh <db>`.
- **Schema:** migrations 001 (core model), 002 (relationship vocabulary, 20 types), 003 (`entity_id()` lookup) applied to both DBs.
  Design: `backend/docs/data-model.md`. Smoke test: `backend/db/tests/schema_smoke.sql` (10 rule violations rejected, queries verified).
- **App:** pg pools (api: 5, admin: 3 connections); `/v1/health` now also checks the DB → `{"status":"ok","db":"ok"}`.
  `deploy.sh` now runs `npm run migrate`. Graceful shutdown closes pools on pm2 reload.
- **MySQL:** untouched.
- **Revert:** `pm2 reload` an older commit; `sudo -u postgres dropdb arthistory && sudo -u postgres dropdb arthistory_dev`;
  `sudo apt purge postgresql-18 postgresql-18-postgis-3` (deletes all Postgres data!); `sudo rm /etc/apt/sources.list.d/pgdg.list`.

## 2026-09-23

### Art history backend live (Phase 1: health check)
- **App:** `backend/` — Express 5, `GET /v1/health` → `{"status":"ok"}`. Binds `127.0.0.1:3004` only. CORS allows exactly `https://arthistory.piogino.ch`. Host routing: `/v1` only on api host, `/admin` only on admin host (placeholder 503).
  Loads secrets from `~/.config/arthistory/backend.env` (outside repo; currently empty).
- **pm2:** process `arthistory-api` from `backend/ecosystem.config.js` (max_memory_restart 300M), `pm2 save` done — the existing `pm2-ubuntu.service` restores it on boot.
- **pm2-logrotate** installed (server-wide, affects all pm2 apps' logs in `~/.pm2/logs`): max_size 10M, retain 5, compress.
- **nginx:** `/etc/nginx/sites-available/arthistory` (symlinked in sites-enabled): `api.arthistory.piogino.ch` proxies only `/v1/`; `admin.arthistory.piogino.ch` proxies `/`. Own access/error logs `/var/log/nginx/arthistory-*.log`.
- **TLS:** certbot cert `api.arthistory.piogino.ch` (SAN: admin.arthistory…), HTTP→HTTPS redirect, auto-renew via `certbot.timer`. Expires 2026-12-22 (renews automatically ~30 days before).
- **Deploy:** `backend/deploy.sh` (git pull, npm ci, pm2 reload, health probe).
- **Test page:** `health.html` in the repo root → https://arthistory.piogino.ch/health.html shows the browser CORS round-trip.
- **Revert:** `pm2 delete arthistory-api && pm2 save`; `sudo rm /etc/nginx/sites-enabled/arthistory && sudo systemctl reload nginx`; `sudo certbot delete --cert-name api.arthistory.piogino.ch`; `pm2 uninstall pm2-logrotate`.

### Secrets policy: secrets never enter the repo
- **What:** all credentials (DB passwords, admin login, session secret, API keys) live only in `~/.config/arthistory/*.env` (dir 700, files 600, user `ubuntu`) — outside the git checkout. The app will load `~/.config/arthistory/backend.env`; the repo only has `backend/.env.example` with placeholder names.
  Git hooks (`scripts/githooks/`): `pre-commit` and `pre-push` run `check-secrets.sh`, which blocks secret file names, credential-looking lines/bcrypt hashes, and **any real value present in the secrets files**. `pre-push` re-scans every outgoing commit, so `git commit --no-verify` cannot sneak a secret out. Tested all cases.
- **Why:** the repo is public; admin/CMS credentials must never reach GitHub.
- **Revert:** n/a (policy). If a secret ever leaks: rotate it immediately — deleting the commit is not enough.

### VPS upgraded again (by owner)
- RAM 2 → 4 GB, disk 40 → 60 GB (root fs auto-grew: 58 GB, 42 GB free). 2 vCPU.

### Project repo connected: github.com/piosteiner/art_history
- **What:** cloned the repo to `/var/www/arthistory-api` (the server checkout *is* the repo). Layout: `backend/` (Node app), `server-docs/` (this documentation, moved from `~/server-docs`; `~/server-docs` is now a symlink), `scripts/`.
  Push auth via a repo-scoped SSH deploy key `~/.ssh/art_history_deploy` (ssh alias `github-art_history` in `~/.ssh/config`; remote `git@github-art_history:piosteiner/art_history.git`).
- **Workflow:** every change → update this changelog → `scripts/save.sh "message"` (commit, pull --rebase, push). The pre-commit hook in `scripts/githooks/` (enabled via `core.hooksPath`) blocks `.env`/key files and credential-looking lines — the repo is public.
- **Why:** off-server backup of code and docs; single history for backend + frontend.
- **Revert:** remove the deploy key in GitHub → Settings → Deploy keys and delete `~/.ssh/art_history_deploy*` and the `github-art_history` block in `~/.ssh/config`.

### Firewall enabled (ufw)
- **What:** `ufw default deny incoming`, allow `OpenSSH` + `Nginx Full` (80/443), enabled. Removed stale pre-existing rules for ports 5000 and 3001.
- **Why:** app ports 3000–3003 were bound to 0.0.0.0 and reachable directly from the internet, bypassing nginx/TLS. Verified all sites still respond via their HTTPS hostnames afterwards.
- **Revert:** `sudo ufw disable` (or `sudo ufw allow <port>` to reopen a single port).

### DNS records added (by owner)
- `api.arthistory.piogino.ch` and `admin.arthistory.piogino.ch` → A 83.228.207.199. Verified resolving.

### VPS upgraded (by owner, Infomaniak)
- 1 → 2 vCPU, 20 → 40 GB disk (RAM unchanged at 2 GB). Root filesystem auto-grew to 39 GB on reboot (23 GB free, 43% used).

### Baseline
- Server inventory surveyed and recorded in README.md.
