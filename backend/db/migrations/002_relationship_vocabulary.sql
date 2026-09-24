-- 002 — Controlled vocabulary for relationships.
-- is_physical_presence = true  → the subject was physically there; the map may draw travel routes between these.
-- is_physical_presence = false → association only (e.g. Japonisme → Japan); drawn as a distinct layer, never as travel.
INSERT INTO relationship_types
  (code, label, inverse_label, category, is_physical_presence, is_symmetric, subject_types, object_types, sort_order, description)
VALUES
  -- Presence (physical) ------------------------------------------------------
  ('born_in',   'born in',   'birthplace of',      'presence', true,  false, '{artist,patron}', '{place}', 10, NULL),
  ('died_in',   'died in',   'place of death of',  'presence', true,  false, '{artist,patron}', '{place}', 11, NULL),
  ('lived_in',  'lived in',  'home of',            'presence', true,  false, '{artist,patron}', '{place}', 12, NULL),
  ('worked_in', 'worked in', 'workplace of',       'presence', true,  false, '{artist,patron}', '{place}', 13, NULL),
  ('visited',   'visited',   'visited by',         'presence', true,  false, '{artist,patron}', '{place}', 14,
     'Short stays and journeys. Use lived_in/worked_in for longer residence.'),
  ('created_in','created in','place of creation of','presence', true,  false, '{artwork}',        '{place}', 15,
     'Origin of an artwork.'),

  -- Association with a place (non-physical) ----------------------------------
  ('inspired_by_place',        'inspired by',                  'inspired',                'association', false, false,
     '{artist,artwork,movement}', '{place}', 20, 'Inspiration without (necessarily) having been there.'),
  ('influenced_by_culture_of', 'influenced by the culture of', 'cultural influence on',   'association', false, false,
     '{artist,artwork,movement}', '{place}', 21, 'E.g. Japonisme: Van Gogh ← Japan.'),
  ('active_in',                'active in',                    'centre of',               'association', false, false,
     '{movement,institution}', '{place}', 22, 'Geographic region(s) of a movement.'),

  -- Influence ------------------------------------------------------------------
  ('influenced_by', 'influenced by', 'influenced', 'influence', false, false,
     '{artist,artwork,movement}', '{artist,artwork,movement}', 30, 'Direction: subject was influenced by object.'),

  -- Education & collaboration ---------------------------------------------------
  ('student_of',        'student of',        'teacher of',        'education',     false, false, '{artist}', '{artist}',      40, NULL),
  ('studied_at',        'studied at',        'alma mater of',     'education',     false, false, '{artist}', '{institution}', 41, NULL),
  ('collaborated_with', 'collaborated with', 'collaborated with', 'collaboration', false, true,  '{artist}', '{artist}',      50, NULL),
  ('contemporary_of',   'contemporary of',   'contemporary of',   'collaboration', false, true,  '{artist}', '{artist}',      51,
     'Known each other / moved in the same circles — not merely alive at the same time (that is derivable from lifespans).'),

  -- Membership -------------------------------------------------------------------
  ('member_of',       'member of',       'member',          'membership', false, false, '{artist,patron}', '{movement,institution}', 60, 'Formal or self-declared membership.'),
  ('associated_with', 'associated with', 'associated with', 'membership', false, false, '{artist,artwork,institution}', '{movement}', 61, 'Looser stylistic association.'),

  -- Patronage & provenance ---------------------------------------------------------
  ('commissioned', 'commissioned', 'commissioned by', 'patronage',  false, false, '{patron}',  '{artwork}',             70, NULL),
  ('patron_of',    'patron of',    'patronized by',   'patronage',  false, false, '{patron}',  '{artist,institution}',  71, NULL),
  ('owned_by',     'owned by',     'owned',           'provenance', false, false, '{artwork}', '{patron}',              80, 'Private ownership history.'),
  ('housed_at',    'housed at',    'held',            'provenance', false, false, '{artwork}', '{institution}',         81,
     'Historical holdings (with period). The current location is artworks.current_institution_id.');
