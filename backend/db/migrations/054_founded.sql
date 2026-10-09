-- 054 — "founded" / "founded by": who founded an institution or a movement (Thomas Gilcrease → the Gilcrease Museum;
-- Kandinsky and Marc → Der Blaue Reiter; a society founding a museum). Co-founders: one relationship each, the label
-- may say "co-founder"; the period is the founding. Category membership: the founder belongs to what was founded
-- (the map and the graph group by category — a known one, no new layer needed). Wikidata: P112 "founded by".
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric,
                                subject_types, object_types, description, sort_order)
VALUES ('founded', 'founded', 'founded by', 'membership', false, false, '{artist,person,institution}', '{institution,movement}',
        'Founded an institution or a movement — alone or with others (one relationship per founder; label e.g. "co-founder"), dated with the founding.', 62);
