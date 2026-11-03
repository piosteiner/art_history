-- 202 — The quiz's shared basis stored (perf, 2026-11-03). Every round of a game (8 per request) recomputed which works
-- and artists belong to which movement (views movement_works and movement_artists — 381 ms the latter on the perf
-- data, 10× today) and which works have a picture (pictured() in src/routes/quiz.js, 80 ms): the artist game 1.1 s, the
-- movement game 1.6 s (budgets 0.6). Now stored, refreshed with the worker's global part (at most every 30 s after a
-- change: a quiz may be that much behind). The pictured works for visitors only; an account's private images
-- (routes/site-account.js) keep their own, computed.
CREATE MATERIALIZED VIEW quiz_movement_works AS SELECT DISTINCT movement_id, artwork_id FROM movement_works;
CREATE UNIQUE INDEX quiz_movement_works_key ON quiz_movement_works (movement_id, artwork_id);
CREATE INDEX quiz_movement_works_artwork ON quiz_movement_works (artwork_id);
CREATE MATERIALIZED VIEW quiz_movement_artists AS SELECT DISTINCT movement_id, artist_id FROM movement_artists;
CREATE UNIQUE INDEX quiz_movement_artists_key ON quiz_movement_artists (movement_id, artist_id);
CREATE INDEX quiz_movement_artists_artist ON quiz_movement_artists (artist_id);
-- pictured() for visitors, as of today (keep in step with it: src/routes/quiz.js)
CREATE MATERIALIZED VIEW quiz_pictured AS
SELECT a.id, a.slug, a.public_id, a.title, a.creator_id, a.created, a.created_label, a.kind, a.names, img.url AS image_url,
         CASE WHEN img.url IS NOT NULL THEN img.credit END AS credit, CASE WHEN img.url IS NOT NULL THEN img.license END AS license,
         (SELECT er.region::text FROM entry_regions er WHERE er.entity_type = 'artwork' AND er.entity_id = a.id) AS region
  FROM artworks a
  LEFT JOIN LATERAL (SELECT i.url, i.credit, i.license FROM images i WHERE i.artwork_id = a.id ORDER BY i.position, i.id LIMIT 1) img ON true
  
  WHERE (a.kind_term_id IS NULL OR NOT artwork_is_group(a.kind_term_id)) AND img.url IS NOT NULL;
CREATE UNIQUE INDEX quiz_pictured_key ON quiz_pictured (id);
CREATE INDEX quiz_pictured_creator ON quiz_pictured (creator_id);
GRANT SELECT ON quiz_movement_works, quiz_movement_artists, quiz_pictured TO arthistory_api, arthistory_admin;

-- refreshed with the global part, after entry_regions (quiz_pictured carries the regions)
DO $$
DECLARE
  def text := pg_get_functiondef('refresh_quality_global'::regproc);
  old text := 'REFRESH MATERIALIZED VIEW CONCURRENTLY entry_regions;';
  new text := 'REFRESH MATERIALIZED VIEW CONCURRENTLY entry_regions;
  REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_movement_works;
  REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_movement_artists;
  REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_pictured;';
BEGIN
  IF position('quiz_pictured' IN def) > 0 THEN RETURN; END IF;
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'refresh_quality_global: the entry_regions refresh not found once';
  END IF;
  EXECUTE replace(def, old, new);
END $$;
