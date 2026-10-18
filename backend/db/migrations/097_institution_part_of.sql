-- 097 — An institution part of another: the museums of a museum authority (Alte Pinakothek, Neue Pinakothek, Sammlung
-- Schack … ⊂ Bayerische Staatsgemäldesammlungen; the Louvre ⊂ Musées nationaux), a department of a university.
-- Dated like any relationship (a museum that changed hands). The artwork's owner stays what the provenance says (often
-- the authority); artworks.current_institution_id is the museum where it is kept.
INSERT INTO relationship_types (code, label, inverse_label, category, subject_types, object_types, is_symmetric, is_physical_presence, derived, sort_order, description)
VALUES ('part_of', 'part of', 'includes', 'membership', '{institution}', '{institution}', false, false, false, 63,
        'A museum of a museum authority, a department of a larger institution (Wikidata P361) — e.g. Alte Pinakothek part of the Bayerische Staatsgemäldesammlungen.');
