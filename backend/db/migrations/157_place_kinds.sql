-- 157 — Finer kinds of places (owner, 2026-10-29, the places plan step B). "site" had become the kind of everything
-- the Wikidata review couldn't name: cities, provinces, streets, mountains, cemeteries. New kinds (an enum keeps them a
-- closed list; values are added in a file of their own — a new enum value can be used only once committed, 158):
--   continent       Europe, Asia …
--   district        a part of a city: an arrondissement of Paris, a sestiere of Venice, a London district
--   street          a street or a square (Rue du Bac, Bedford Square)
--   natural         a mountain, lake, river, island, valley (Schafberg, Alpilles)
--   archaeological  an archaeological site (Susa, Lascaux)
-- "site" stays for what is none of these (a cemetery, a park, a garden); regions are any administrative unit — what
-- kind exactly is said by places.designation (158): "canton of Switzerland", "province of Italy".
ALTER TYPE place_kind ADD VALUE IF NOT EXISTS 'continent';
ALTER TYPE place_kind ADD VALUE IF NOT EXISTS 'district';
ALTER TYPE place_kind ADD VALUE IF NOT EXISTS 'street';
ALTER TYPE place_kind ADD VALUE IF NOT EXISTS 'natural';
ALTER TYPE place_kind ADD VALUE IF NOT EXISTS 'archaeological';
