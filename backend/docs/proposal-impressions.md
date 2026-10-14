# Proposal: impressions vs. design (prints) — not built

Status: proposal for the owner to decide (2026-10-14). Nothing here is migrated.

## The problem
An `artworks` row is one object: one `current_institution_id`, one `inventory_number`, one provenance. A print is
different: *The Great Wave* is one **design** (Hokusai, c. 1831, No. 1 of the *Thirty-six Views*), of which hundreds of
**impressions** survive — the Met's, the British Museum's, the Rijksmuseum's — each with its own inventory number,
provenance, state, condition and images. Today the entry can hold only one of them (or none: the Great Wave has no
institution), and a second impression would be a duplicate the quality checks flag.

The same shape fits casts of a sculpture (Degas' *Petite danseuse*: wax original + bronze casts), photographs (negative
→ prints) and editions of books.

## Options

**A. Reuse `parent_id`** (impression = a "part" of the design). No new column, but it mixes two meanings: an
impression isn't a part ("No. 21 of 36" would count impressions), and the design's own `parent_id` is already its series.

**B. A separate link `artworks.design_id`** → the design (recommended). Two different questions get two different
columns: `parent_id` = "what whole is this a part of" (design → series), `design_id` = "what is this a copy of"
(impression → design). An impression has its own holder, number, provenance, images; what it shares with the design
(title, creator, creation date, series, texts) is read from the design unless the impression says otherwise.

**C. A table `impressions`** beside `artworks`. Cleanest separation, but every feature built for artworks
(provenance, images, citations, map, numbers, duplicates, history) would have to learn a second type. Too costly.

## B in detail (draft migration `0NN_impressions.sql`)
```sql
CREATE TYPE copy_kind AS ENUM ('impression', 'cast', 'print', 'copy');   -- a photograph's print; a later copy

ALTER TABLE artworks
  ADD COLUMN design_id  bigint REFERENCES artworks ON DELETE RESTRICT,   -- deleting a design with impressions: refuse
  ADD COLUMN copy_kind  copy_kind,
  ADD COLUMN copy_label text,                                            -- "first edition, early impression", "state 2 of 3", "cast 7/20"
  ADD CONSTRAINT artworks_design_check CHECK (design_id <> id),
  ADD CONSTRAINT artworks_copy_kind_needs_design CHECK ((design_id IS NULL) = (copy_kind IS NULL)),
  -- an impression isn't also a part of a series: the design is
  ADD CONSTRAINT artworks_copy_not_part CHECK (design_id IS NULL OR parent_id IS NULL);
CREATE INDEX artworks_design_idx ON artworks (design_id);

-- one level only: an impression of an impression is an impression of the design
CREATE FUNCTION design_is_not_a_copy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.design_id IS NOT NULL AND EXISTS (SELECT 1 FROM artworks d WHERE d.id = NEW.design_id AND d.design_id IS NOT NULL) THEN
    RAISE EXCEPTION 'link to the design itself, not to another impression' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artworks_design_is_not_a_copy BEFORE INSERT OR UPDATE OF design_id ON artworks
  FOR EACH ROW EXECUTE FUNCTION design_is_not_a_copy();

-- What an impression shows: its own value, else the design's (coalesce per column — the view the API reads)
CREATE VIEW artworks_effective AS
SELECT a.id, a.slug, a.design_id, a.copy_kind, a.copy_label,
       coalesce(a.title, d.title)             AS title,
       coalesce(a.creator_id, d.creator_id)   AS creator_id,
       coalesce(a.created, d.created)         AS created,
       coalesce(a.parent_id, d.parent_id)     AS parent_id,      -- the series the design belongs to
       a.current_institution_id, a.inventory_number               -- never inherited: they are the impression's own
       -- … the other columns the same way
FROM artworks a LEFT JOIN artworks d ON d.id = a.design_id;
```
`title` and `creator_id` would have to become nullable for impressions (they inherit), e.g. a CHECK
`design_id IS NOT NULL OR title IS NOT NULL` instead of `NOT NULL`.

What the rest would do:
- **API:** a design's detail gets `impressions: [{slug, copy_label, institution, inventory_number, image}]`; an
  impression's gets `design: {slug, title}` + `copy_kind`, `copy_label`. Lists: a filter `?designs_only=true` so a
  print appears once.
- **Map:** each impression has its own provenance and site. A design's map could show where all its impressions are
  now (one dot per holder) — the Great Wave would light up museums worldwide.
- **Quality:** `copy_differs` (an impression's own creator or date contradicts the design's), `copy_of_copy` (blocked
  by the trigger anyway), the duplicate check (044) compares impressions only with the same institution's.
- **Wikidata:** where impressions are separate items they usually point to the design with "based on" (P144) — the Wikidata
  comparison maps P144 to `design_id`.
- **Frontend:** a design page lists its impressions (holder, number, image); an impression page says "Impression of
  *The Great Wave* (design, c. 1831) · early impression"; the series grid shows designs.

Postgres to learn from it: a self-referencing FK with a different meaning from `parent_id`, CHECK constraints across
columns, a BEFORE trigger for a rule a CHECK can't express (it looks at another row), and an "inheritance by coalesce"
view.

## To decide
1. B (separate `design_id`) — or A/C?
2. Should impressions without their own image or holder exist at all, or only once a museum's impression is entered?
3. Do the existing three prints (Great Wave, Plum Park, Sudden Shower) stay designs, with impressions added below them?
