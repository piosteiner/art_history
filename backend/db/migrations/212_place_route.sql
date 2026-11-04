-- 212 — A road or river as a line (2026-11-04). places.area is a polygon (a city's extent); a route — the Tōkaidō through
-- its stations — is a line of its own: drawn on the series' map whose views look from it (API `routes` of a whole's
-- `parts`), on the place's own page, citable like the location.
ALTER TABLE places ADD COLUMN route geography(LineString, 4326);
COMMENT ON COLUMN places.route IS 'A road or river as a line (212): the Tōkaidō through its 53 stations. Drawn on the place''s page and on the maps of works depicting it.';
INSERT INTO citable_fields (entity_type, field, cols, position)
  SELECT 'place', 'route', '{route}', coalesce(max(position), 0) + 1 FROM citable_fields WHERE entity_type = 'place';
