-- 040 — Previews of entries, for hover popovers on [[type/slug]] links (like Wikipedia's page previews).
-- One row per entry of every type: name, a short subtitle (dates, maker, kind, where), the main image and the text the
-- preview's excerpt is cut from (src/routes/entities.js shortens it to the first sentences). The API asks this view
-- for exactly the entries a page links, so the popovers need no further requests.
--
-- A view, not a table: always current, nothing to keep in sync. The API asks for a handful of (type, slug) pairs; a
-- filter on a UNION ALL view is applied to each branch, where the unique slug indexes serve it. LATERAL … LIMIT 1
-- fetches each entry's main image (the images_<type>_idx partial indexes are ordered by position).
-- concat_ws() skips NULLs, so a missing part leaves no dangling separator; nullif(…, '') turns "nothing at all" into NULL.
CREATE VIEW entry_previews AS
  SELECT 'artist'::entity_type AS type, a.slug, a.name,
         nullif(concat_ws('–', a.birth_label, a.death_label), '') AS subtitle,
         img.url AS image_url, a.biography_md AS text_md
    FROM artists a
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.artist_id = a.id ORDER BY i.position, i.id LIMIT 1) img ON true
  UNION ALL
  -- "Katsushika Hokusai, c. 1831 · woodblock print"
  SELECT 'artwork', w.slug, w.title,
         nullif(concat_ws(' · ', nullif(concat_ws(', ', c.name, w.created_label), ''), w.kind), ''),
         img.url, w.description_md
    FROM artworks w
    LEFT JOIN artists c ON c.id = w.creator_id
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.artwork_id = w.id ORDER BY i.position, i.id LIMIT 1) img ON true
  UNION ALL
  -- "museum · Paris · founded 1793"
  SELECT 'institution', t.slug, t.name,
         nullif(concat_ws(' · ', t.kind, p.name, 'founded ' || t.founded_label), ''),
         img.url, t.description_md
    FROM institutions t
    LEFT JOIN places p ON p.id = t.place_id
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.institution_id = t.id ORDER BY i.position, i.id LIMIT 1) img ON true
  UNION ALL
  -- "poet, monk · 1886–1942"; families and orders: their active period
  SELECT 'person', t.slug, t.name,
         nullif(concat_ws(' · ', nullif(array_to_string(t.occupations[1:3], ', '), ''),
                          coalesce(nullif(concat_ws('–', t.birth_label, t.death_label), ''), t.active_label)), ''),
         NULL, t.description_md
    FROM people t
  UNION ALL
  SELECT 'movement', t.slug, t.name, nullif(concat_ws(' · ', t.kind::text, t.period_label), ''), NULL, t.description_md
    FROM movements t
  UNION ALL
  -- "settlement · Provence"
  SELECT 'place', t.slug, t.name, concat_ws(' · ', t.kind::text, p.name), NULL, t.description_md
    FROM places t LEFT JOIN places p ON p.id = t.parent_id
  UNION ALL
  SELECT 'polity', t.slug, t.name, nullif(concat_ws(' · ', t.kind, t.period_label), ''), NULL, t.description_md
    FROM polities t
  UNION ALL
  -- a term's short definition is its preview text (the glossary popovers show it too)
  SELECT 'term', t.slug, t.name, t.category::text,
         img.url, coalesce(t.definition, t.description_md)
    FROM glossary t
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.glossary_id = t.id ORDER BY i.position, i.id LIMIT 1) img ON true
  UNION ALL
  SELECT 'source', t.slug, t.name, nullif(concat_ws(' · ', replace(t.kind::text, '_', ' '), t.year::text), ''), NULL, t.description_md
    FROM bibliography t;

COMMENT ON VIEW entry_previews IS 'Per entry: name, subtitle, main image and preview text (Markdown) — for hover previews of [[links]].';
