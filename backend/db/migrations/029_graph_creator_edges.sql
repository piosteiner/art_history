-- 029 — The main creator in the network graph. artworks.creator_id is a column, not a relationship, so the graph
-- never showed it (co-creators, migration 028, it did). The creator becomes a vocabulary entry that is *derived*:
-- its edges are computed from creator_id by the view graph_edges and are never stored in relationships.

ALTER TABLE relationship_types ADD COLUMN derived boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN relationship_types.derived IS
  'Edges computed from a column (view graph_edges), never stored in relationships; not offered in the admin form.';

UPDATE relationship_types SET sort_order = 53 WHERE code = 'co_creator';
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric,
                                subject_types, object_types, description, sort_order, derived) VALUES
  ('creator', 'creator', 'creator of', 'collaboration', false, false, '{artwork}', '{artist}',
   'The main creator — derived from artworks.creator_id (the creator field), not entered as a relationship.', 52, true);

-- A derived type can't be stored: a second BEFORE trigger, so relationships_validate (001) stays as it is.
CREATE FUNCTION relationships_not_derived() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT derived FROM relationship_types WHERE code = NEW.relationship_type) THEN
    RAISE EXCEPTION '"%" is derived from a column and cannot be stored as a relationship', NEW.relationship_type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER relationships_not_derived
  BEFORE INSERT OR UPDATE OF relationship_type ON relationships
  FOR EACH ROW EXECUTE FUNCTION relationships_not_derived();

-- Stored relationships plus the derived edges, in the same shape. A filter on subject or object is pushed down into
-- both branches of the UNION ALL, so the graph walk still uses relationships' indexes, artworks' primary key and
-- artworks_creator_idx (creator → artworks).
CREATE VIEW graph_edges AS
SELECT subject_type, subject_id, relationship_type, object_type, object_id, period, period_label, label, certainty
FROM relationships
UNION ALL
SELECT 'artwork'::entity_type, w.id, 'creator', 'artist'::entity_type, w.creator_id, NULL::daterange, NULL::text, NULL::text,
       'attested'::certainty
FROM artworks w WHERE w.creator_id IS NOT NULL;
