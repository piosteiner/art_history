-- 235 — A term in further categories (owner 2026-11-06: "maybe we should be able to give a word more than one
-- category"). The main category stays one and does the work — an artwork's type is looked up among object types, a
-- literary kind among genres, "designated as" takes heritage designations, era names are filed under calendars; all
-- rules and checks read it alone. also_in only adds where a term is shown and found when browsing (mappō: religion,
-- also politics). An array of the enum with a GIN index: "in category X" = category = X OR also_in @> ARRAY[X].
ALTER TABLE glossary ADD COLUMN also_in term_category[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT glossary_also_in_not_main CHECK (NOT (category = ANY (also_in)));
CREATE INDEX glossary_also_in_idx ON glossary USING gin (also_in);
COMMENT ON COLUMN glossary.also_in IS 'Further categories a term is shown under when browsing (235); the main category alone does the work.';

-- the main category taken into also_in by mistake drops out of it (instead of refusing the save)
CREATE FUNCTION glossary_also_in_clean() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.also_in := coalesce((SELECT array_agg(DISTINCT c ORDER BY c) FROM unnest(NEW.also_in) c WHERE c <> NEW.category), '{}');
  RETURN NEW;
END $$;
CREATE TRIGGER glossary_also_in_clean BEFORE INSERT OR UPDATE OF also_in, category ON glossary FOR EACH ROW EXECUTE FUNCTION glossary_also_in_clean();
