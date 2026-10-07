-- 038 — An artwork's web page: its page at the museum or collection that holds it (or another authoritative page about
-- it, e.g. the artist's). The site links it — the way to see the work when we have no freely licensed image to show.
-- Plain text with a CHECK, like institutions.website_url: one link per work, no table needed.
ALTER TABLE artworks ADD COLUMN web_url text CONSTRAINT artworks_web_url_check CHECK (web_url ~ '^https?://[^\s]+$');
COMMENT ON COLUMN artworks.web_url IS 'The work''s page at its museum/collection (or another authoritative page) — linked on the site.';
