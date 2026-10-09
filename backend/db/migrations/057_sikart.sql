-- 057 — SIKART (the lexicon of SIK-ISEA, the Swiss Institute for Art Research) lives in the research portal now:
-- record links point there (the address Wikidata's P781 uses), and the lexicon is a source of the bibliography, so
-- values taken from a SIKART record are cited with it (src/admin/sikart.js). A scholarly lexicon: reliability
-- "scholarly" — above museums' websites and Wikidata.
UPDATE authorities SET name = 'SIKART (SIK-ISEA)', url_template = 'https://recherche.sik-isea.ch/sik:person-{id}/in/sikart'
WHERE code = 'sikart';
INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container)
VALUES ('sikart', 'web', 'SIKART Lexikon und Datenbank', 'SIKART', 'https://recherche.sik-isea.ch/', 'scholarly',
        'Schweizerisches Institut für Kunstwissenschaft (SIK-ISEA)')
ON CONFLICT (slug) DO NOTHING;
