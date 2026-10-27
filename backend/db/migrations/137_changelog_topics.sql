-- 137 — The changelog's bullets get topics too: the same list as the roadmap (roadmap_areas, 136), the same bubbles and
-- colours (owner, 2026-10-27: "are the topics from the roadmap also reflected in the changelog …? — yes do 2").
-- A bullet is written "Neu [Karte]: Text" in the CMS; a bullet made from a roadmap goal marked done takes the goal's
-- topic. Renaming a topic renames it on items and bullets alike (ON UPDATE CASCADE); a topic in use by either can't be
-- deleted (ON DELETE RESTRICT).

ALTER TABLE changelog_items ADD COLUMN area text REFERENCES roadmap_areas (name) ON UPDATE CASCADE ON DELETE RESTRICT;
COMMENT ON COLUMN changelog_items.area IS 'the bullet''s topic (137), one of roadmap_areas — shared with the roadmap';

-- bullets that came from a roadmap goal: its topic
UPDATE changelog_items i SET area = r.area FROM roadmap_items r WHERE r.id = i.roadmap_item_id AND r.area IS NOT NULL;

CREATE INDEX changelog_items_area_idx ON changelog_items (area) WHERE area IS NOT NULL;
COMMENT ON TABLE roadmap_areas IS 'topics of the roadmap and the changelog with their colour (136/137); roadmap_items.area and changelog_items.area reference name';
