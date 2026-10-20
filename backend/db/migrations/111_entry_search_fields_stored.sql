-- 111 — The search fields (110) stored. Computed for every artwork on every list request, the artworks list took ≈ 2 s
-- alone and over the API role's 5 s statement timeout under load (the site's tests, 2026-10-20: "Service
-- Unavailable"): the slow part is artwork_term_names() — the medium matched against every term's names. Now a table
-- keeps them, brought up to date with the data-quality findings after every change (refresh_quality(), LISTEN/NOTIFY,
-- migration 058 — half a second after a commit), like the stored graph (graph_links, 088). Only rows that changed are
-- written. (A materialized view would be the textbook choice, but since Postgres 17 a refresh runs with search_path =
-- pg_catalog, and the older functions the fields use name tables without "public." — see 093.) The view
-- entry_search_fields stays the definition: change it there, the stored copy follows. The admin's lists read the
-- view itself while the stored copy is behind (src/admin/quality.js current()).
CREATE TABLE entry_search_fields_stored (
  type entity_type NOT NULL, id bigint NOT NULL, position integer NOT NULL,
  label text NOT NULL, text text NOT NULL, match text, tier_rank integer, tier_heading text, shown boolean NOT NULL,
  PRIMARY KEY (type, id, position)
);
INSERT INTO entry_search_fields_stored SELECT * FROM entry_search_fields;
GRANT SELECT ON entry_search_fields_stored TO arthistory_api, arthistory_admin;
COMMENT ON TABLE entry_search_fields_stored IS 'entry_search_fields (110) stored; brought up to date by refresh_quality() (111)';

CREATE OR REPLACE FUNCTION entry_search_fields_json(etype entity_type, eid bigint) RETURNS jsonb LANGUAGE sql STABLE
RETURN (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('label', f.label, 'text', f.text, 'match', f.match, 'shown', CASE WHEN f.shown THEN true END,
          'tier', CASE WHEN f.tier_rank IS NOT NULL THEN jsonb_build_object('rank', f.tier_rank, 'heading', f.tier_heading) END)) ORDER BY f.position), '[]')
        FROM entry_search_fields_stored f WHERE f.type = etype AND f.id = eid);

-- brought up to date with the quality findings: refresh_quality() patched as it stands (a block after dup_name_keys)
DO $$
DECLARE
  def text := pg_get_functiondef('refresh_quality'::regproc);
  anchor text := 'REFRESH MATERIALIZED VIEW dup_name_keys;';
BEGIN
  IF position(anchor IN def) = 0 THEN RAISE EXCEPTION 'refresh_quality: % not found', anchor; END IF;
  EXECUTE replace(def, anchor, anchor || $add$
  -- the search fields (110/111): only what changed is written
  CREATE TEMP TABLE fresh_fields ON COMMIT DROP AS SELECT * FROM entry_search_fields;
  DELETE FROM entry_search_fields_stored s WHERE NOT EXISTS (SELECT 1 FROM fresh_fields f
    WHERE (f.type, f.id, f.position) = (s.type, s.id, s.position));
  INSERT INTO entry_search_fields_stored AS s SELECT * FROM fresh_fields
  ON CONFLICT (type, id, position) DO UPDATE SET label = EXCLUDED.label, text = EXCLUDED.text, match = EXCLUDED.match,
    tier_rank = EXCLUDED.tier_rank, tier_heading = EXCLUDED.tier_heading, shown = EXCLUDED.shown
  WHERE (s.label, s.text, s.match, s.tier_rank, s.tier_heading, s.shown)
        IS DISTINCT FROM (EXCLUDED.label, EXCLUDED.text, EXCLUDED.match, EXCLUDED.tier_rank, EXCLUDED.tier_heading, EXCLUDED.shown);$add$);
END $$;
