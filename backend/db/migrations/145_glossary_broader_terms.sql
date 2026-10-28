-- 145 — Glossary: a category for the performing arts, and broader terms (owner, 2026-10-28).
-- Theatre is a theme of its own in Japanese art (Noh, Kyōgen, Kabuki, Bunraku — plays, masks, actors' prints) and in
-- European art (opera, ballet, dance): the category "performing arts" holds the genres, the plays depicted and things of
-- the stage. Below the categories no second fixed level: a term names its broader term instead — Yoroboshi → Noh →
-- … — as thesauri do (the Getty AAT, SKOS "broader"). One self-reference, parent_id like places, movements and events,
-- so import/export and the admin's "parent" machinery serve it; the existing no_parent_cycle() keeps chains from
-- looping. The API calls it broader / narrower (src/routes/entities.js, a recursive CTE as for places).
-- An enum value has to be committed before it can be used (as in 070): data using it comes after this migration.
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'performing arts' BEFORE 'other';

ALTER TABLE glossary ADD COLUMN parent_id bigint REFERENCES glossary (id) ON DELETE SET NULL,
  ADD CONSTRAINT glossary_parent_check CHECK (parent_id <> id);
COMMENT ON COLUMN glossary.parent_id IS 'The broader term (145): Yoroboshi → Noh. Not a category — those stay the fixed list term_category.';
CREATE INDEX glossary_parent_idx ON glossary (parent_id) WHERE parent_id IS NOT NULL;
CREATE TRIGGER glossary_no_parent_cycle BEFORE INSERT OR UPDATE OF parent_id ON glossary FOR EACH ROW EXECUTE FUNCTION no_parent_cycle();
