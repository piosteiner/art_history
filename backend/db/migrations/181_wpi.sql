-- 181: the Wildenstein Plattner Institute (WPI, New York) — the catalogues raisonnés of Gauguin, Monet, Renoir and
-- others, free online (owner 2026-10-31: "can we integrate them somehow? even if its just a source"). Its artwork
-- number as a reference record (Wikidata P14562, "https://digitalprojects.wpi.art/artworks/$1"): the Wikidata
-- comparison offers it and the work links to its catalogue entry. The catalogues as sources, cited by hand with the
-- catalogue number as the locator ("PGL0ZI (W434)", as the WPI writes it).
-- Nothing is read from the WPI automatically: its terms (wpi.art/terms-conditions, §9.4) forbid "any robot, spider,
-- scraper, or other automated means to access the Site" without written permission, and the reproduction of its
-- content (§7, §9.1) — though its site has a public API (with provenance, exhibitions, literature per work). With a
-- permission, an Enrich section could compare it like ColBase.
INSERT INTO authorities (code, name, url_template, pattern, wikidata_property, entity_types, position) VALUES
  ('wpi', 'Wildenstein Plattner Institute (catalogues raisonnés)', 'https://digitalprojects.wpi.art/artworks/{id}', '^[1-9][0-9]{0,8}$', 'P14562', '{artwork}', 16);

INSERT INTO bibliography (slug, kind, name, authors, editors, container, publisher, place, year, url, reliability, siglum) VALUES
  ('wpi-gauguin-paintings-1891-1903', 'catalogue', 'Gauguin: Catalogue Raisonné of the Paintings, 1891–1903',
   '{"Brettell, Richard R."}', '{"Wildenstein Plattner Institute"}', NULL, 'Wildenstein Plattner Institute', 'New York', '2021',
   'https://wpi.art/paul-gauguin/', 'scholarly', 'WPI Gauguin'),
  ('wpi-renoir', 'catalogue', 'Pierre-Auguste Renoir: Catalogue Raisonné Project',
   '{}', '{"Wildenstein Plattner Institute"}', NULL, 'Wildenstein Plattner Institute', 'New York', NULL,
   'https://wpi.art/category/publications/databases', 'scholarly', 'WPI Renoir')
ON CONFLICT (slug) DO NOTHING;
