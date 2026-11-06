-- 238 — An institution's online collection (owner 2026-11-06: "link all online collections of a museum if they have
-- one … only one click away to search in their collection"): the address of its collection search or online
-- collection — not its front page (website_url) and not one work's page (an artwork's web_url). From Wikidata
-- (P8768 "online catalog URL") in the comparison, else entered by hand; checked to answer before it was entered.
ALTER TABLE institutions ADD COLUMN collection_url text CHECK (collection_url ~ '^https?://\S+$');
COMMENT ON COLUMN institutions.collection_url IS 'Its online collection / collection search (238) — Wikidata P8768.';
