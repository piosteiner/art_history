-- 005 — Institutions that moved.
-- institutions.place_id stays the *current* location (one map pin, simple joins). Earlier locations are
-- located_in relationships with a period — the same split as artworks.current_institution_id + housed_at.
-- Physical presence: an institution's moves can be drawn as a route like an artist's travels.
INSERT INTO relationship_types
  (code, label, inverse_label, category, is_physical_presence, is_symmetric, subject_types, object_types, sort_order, description)
VALUES
  ('located_in', 'located in', 'location of', 'presence', true, false, '{institution}', '{place}', 16,
     'Location history (with period) for institutions that moved. The current location is institutions.place_id.');
