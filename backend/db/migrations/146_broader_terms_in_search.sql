-- 146 — Broader terms at work (owner, 2026-10-28): a work in oak panel is found as "wood", a woodblock print as
-- "print" / "Druckgrafik". The chains themselves are data (glossary.parent_id, 145).
--   glossary_with_narrower(id): the term and every term under it — a recursive CTE downwards (CYCLE as a guard,
--     145's trigger already refuses loops).
--   artwork_term_names(): the names of a work's linked object type and materials now include those of their broader
--     terms (only the linked ones: terms found by their name in the medium stay as they were, 071).
--   derived_touch(): 'termtree' queues the works under a changed term (names, parent) — else their stored search fields
--     would drift (the nightly refresh_quality_full() compares).
--   The API's ?kind= and ?material= include the narrower terms (src/routes/entities.js).
CREATE FUNCTION glossary_with_narrower(p_term bigint) RETURNS SETOF bigint LANGUAGE sql STABLE AS $$
  WITH RECURSIVE down(id) AS (
    SELECT p_term
    UNION ALL
    SELECT g.id FROM glossary g JOIN down ON g.parent_id = down.id
  ) CYCLE id SET is_cycle USING path
  SELECT id FROM down WHERE NOT is_cycle
$$;
COMMENT ON FUNCTION glossary_with_narrower(bigint) IS 'A glossary term and all terms under it (146): oak panel, poplar panel … for "panel" and "wood".';

CREATE OR REPLACE FUNCTION artwork_term_names(p_artwork bigint) RETURNS text[] LANGUAGE sql STABLE AS $$
  WITH RECURSIVE linked(id) AS (
    SELECT w.kind_term_id FROM artworks w WHERE w.id = p_artwork AND w.kind_term_id IS NOT NULL
    UNION
    SELECT am.term_id FROM artwork_materials am WHERE am.artwork_id = p_artwork
  ), up(id) AS (                                   -- the linked terms and their broader terms
    SELECT id FROM linked
    UNION
    SELECT g.parent_id FROM glossary g JOIN up ON g.id = up.id WHERE g.parent_id IS NOT NULL
  )
  SELECT coalesce(array_agg(DISTINCT x), '{}') FROM (
    SELECT unnest(term_names(g)) AS x FROM up JOIN glossary g ON g.id = up.id
    UNION ALL
    SELECT unnest(term_names(g)) FROM artworks w JOIN glossary g ON g.category IN ('material', 'object type')
    WHERE w.id = p_artwork AND w.medium IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest(term_names(g)) nm
                  WHERE f_unaccent(w.medium) ~* ('\m' || regexp_replace(f_unaccent(nm), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'))
  ) t
$$;

CREATE OR REPLACE FUNCTION derived_touch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r jsonb; spec text; kind text; col text; spr boolean; v bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN RETURN NULL; END IF;
  FOR r IN SELECT x FROM unnest(CASE TG_OP WHEN 'INSERT' THEN ARRAY[to_jsonb(NEW)] WHEN 'DELETE' THEN ARRAY[to_jsonb(OLD)]
                                ELSE ARRAY[to_jsonb(OLD), to_jsonb(NEW)] END) x LOOP
    FOREACH spec IN ARRAY TG_ARGV LOOP
      spr := right(spec, 1) = '+';
      kind := split_part(rtrim(spec, '+'), '.', 1);
      col := split_part(rtrim(spec, '+'), '.', 2);
      IF kind = 'all' THEN
        INSERT INTO derived_queue (type, id) SELECT e.type, e.id FROM entity_index e WHERE col = '*' OR e.type::text = col;
        CONTINUE;
      END IF;
      v := (r ->> col)::bigint;
      CONTINUE WHEN v IS NULL;
      IF kind = 'prov' THEN
        INSERT INTO derived_queue (type, id) SELECT 'artwork', p.artwork_id FROM provenance p WHERE p.id = v;
      ELSIF kind = 'rel' THEN
        INSERT INTO derived_queue (type, id, spread)
          SELECT x.t, x.i, true FROM relationships x0, LATERAL (VALUES (x0.subject_type, x0.subject_id), (x0.object_type, x0.object_id)) x(t, i)
          WHERE x0.id = v;
      ELSIF kind = 'termtext' THEN
        -- a material or object type, by its names in the media of works not linked to it (artwork_term_names, 071)
        INSERT INTO derived_queue (type, id)
          SELECT 'artwork', w.id FROM artworks w
          WHERE w.medium IS NOT NULL AND r ->> 'category' IN ('material', 'object type')
            AND EXISTS (SELECT 1 FROM unnest(term_names(jsonb_populate_record(NULL::glossary, r))) nm
                        WHERE f_unaccent(w.medium) ~* ('\m' || regexp_replace(f_unaccent(nm), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'));
      ELSIF kind = 'termtree' THEN
        -- a term's names or its broader term changed (146): the works linked to it or to a term under it carry the
        -- names of all broader terms in their search fields (artwork_term_names)
        INSERT INTO derived_queue (type, id)
          SELECT 'artwork'::entity_type, w.id FROM artworks w WHERE w.kind_term_id IN (SELECT glossary_with_narrower(v))
          UNION SELECT 'artwork'::entity_type, am.artwork_id FROM artwork_materials am WHERE am.term_id IN (SELECT glossary_with_narrower(v));
      ELSIF kind = 'num' THEN
        INSERT INTO derived_queue (type, id) SELECT 'artwork', n.artwork_id FROM artwork_numbers n WHERE n.id = v;
      ELSIF left(kind, 1) = '@' THEN
        CONTINUE WHEN r ->> substr(kind, 2) IS NULL;
        INSERT INTO derived_queue (type, id, spread) VALUES ((r ->> substr(kind, 2))::entity_type, v, spr);
      ELSE
        INSERT INTO derived_queue (type, id, spread) VALUES (kind::entity_type, v, spr);
      END IF;
    END LOOP;
  END LOOP;
  PERFORM nextval('quality_changes');
  PERFORM pg_notify('quality_changed', '');  -- the same notice twice in one transaction is sent once
  RETURN NULL;
END $$;

DROP TRIGGER derived_touch ON glossary;
CREATE TRIGGER derived_touch AFTER INSERT OR UPDATE OR DELETE ON glossary
  FOR EACH ROW EXECUTE FUNCTION derived_touch('term.id+', 'termtext.id', 'termtree.id');

-- the chains set before this migration: every work once
INSERT INTO derived_queue (type, id, reason) SELECT 'artwork', id, 'full' FROM artworks;
