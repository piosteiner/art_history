-- 171 — What caused an artwork's fate: the event that concerns the work (relationship `concerns`, 046) and whose period
-- overlaps the fate's date — the fire in the Friedrichshain flak tower for the paintings burnt there in May 1945. One
-- function for the API's `fate.event` and the admin's closing line of the provenance (owner, 2026-10-30: a destroyed
-- work's provenance should end visibly, with its cause). Null without a fate date, or when no such event is linked.
CREATE FUNCTION fate_event(aid bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('slug', ev.slug, 'name', ev.name)
  FROM artworks w
  JOIN relationships r ON r.relationship_type = 'concerns' AND r.subject_type = 'event' AND r.object_type = 'artwork' AND r.object_id = w.id
  JOIN events ev ON ev.id = r.subject_id
  WHERE w.id = aid AND ev.period && w.fate_date
  ORDER BY lower(ev.period), ev.id
  LIMIT 1
$$;
