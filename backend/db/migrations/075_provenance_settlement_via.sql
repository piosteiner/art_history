-- 075 — Two rules of provenance_periods (074), found in the review of the Gauguin works on the site:
--  * a settlement (073) goes on with the same owner: it doesn't end the ownership before it (the foundation owned La
--    Route montante "1960–24 June 2025, end implied" — it still does), and neither step is followed by an implied end;
--  * a handover isn't "via" the very holder it goes to (Knoedler held Idylle à Tahiti on consignment, then bought it).
-- The rest of the definition is 074's.
CREATE OR REPLACE VIEW provenance_periods AS
WITH s AS (
  SELECT p.*,
         (CASE WHEN p.owner_artist_id IS NOT NULL THEN 'artist' WHEN p.owner_person_id IS NOT NULL THEN 'person'
               WHEN p.owner_institution_id IS NOT NULL THEN 'institution' WHEN p.owner_place_id IS NOT NULL THEN 'place' END)::entity_type AS owner_type,
         coalesce(p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id) AS owner_id,
         p.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role) AS in_chain,
         nx.acquired AS next_acquired, nx.acquired_label AS next_label,
         pv.owner_artist_id AS prev_artist, pv.owner_person_id AS prev_person, pv.owner_institution_id AS prev_institution, pv.owner_place_id AS prev_place,
         coalesce(pv.ended, pv.acquired) AS prev_holding,
         first_value(p."position") OVER w AS first_position,
         (p.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role) AND nx.id IS NULL) AS is_last,
         via.names AS via
  FROM provenance p
  -- the next and the previous step OF THE CHAIN: who owned it (owner, dealer, estate). Deposits, loans, consignments
  -- and auctions (custodian, agent) happen alongside an ownership — they neither end it nor stand in for an owner.
  -- LATERAL: a subquery that may use the row it stands beside (p) — "the first chain step after this one".
  LEFT JOIN LATERAL (SELECT n.id, n.acquired, n.acquired_label FROM provenance n
                     WHERE n.artwork_id = p.artwork_id AND n."position" > p."position" AND n.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role)
                       AND n.method <> 'settlement'   -- 075: a settlement goes on with the same owner; it ends nothing
                     ORDER BY n."position" LIMIT 1) nx ON true
  LEFT JOIN LATERAL (SELECT q."position", q.owner_artist_id, q.owner_person_id, q.owner_institution_id, q.owner_place_id, q.acquired, q.ended
                     FROM provenance q
                     WHERE q.artwork_id = p.artwork_id AND q."position" < p."position" AND q.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role)
                     ORDER BY q."position" DESC LIMIT 1) pv ON true
  -- the agents between the previous owner and this one through whom it was sold (an auction, a consignment) — not
  -- those that didn't sell it
  LEFT JOIN LATERAL (SELECT string_agg(coalesce(e.name, a.owner_label), ', ' ORDER BY a."position") AS names
                     FROM provenance a
                     LEFT JOIN entity_index e ON (e.type, e.id) = ((CASE WHEN a.owner_artist_id IS NOT NULL THEN 'artist' WHEN a.owner_person_id IS NOT NULL THEN 'person'
                       WHEN a.owner_institution_id IS NOT NULL THEN 'institution' WHEN a.owner_place_id IS NOT NULL THEN 'place' END)::entity_type,
                       coalesce(a.owner_artist_id, a.owner_person_id, a.owner_institution_id, a.owner_place_id))
                     WHERE p.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role) AND a.artwork_id = p.artwork_id AND a.role = 'agent' AND NOT a.not_sold
                       -- 075: not through itself (a dealer that held it on consignment, then bought it)
                       AND (a.owner_artist_id, a.owner_person_id, a.owner_institution_id, a.owner_place_id)
                           IS DISTINCT FROM (p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id)
                       AND a."position" < p."position" AND a."position" > coalesce(pv."position", -1)) via ON true
  WINDOW w AS (PARTITION BY p.artwork_id ORDER BY p."position")
), b AS (
  SELECT s.*,
         CASE WHEN s.ended IS NOT NULL THEN 'recorded'
              WHEN s.next_acquired IS NOT NULL THEN 'implied'
              WHEN s.is_last AND (s.owner_institution_id = w.current_institution_id OR (w.on_loan AND w.current_institution_id IS NOT NULL)) THEN 'ongoing'
              ELSE 'unknown' END AS end_basis,
         (CASE WHEN s.prev_artist IS NOT NULL THEN 'artist' WHEN s.prev_person IS NOT NULL THEN 'person'
               WHEN s.prev_institution IS NOT NULL THEN 'institution' WHEN s.prev_place IS NOT NULL THEN 'place' END)::entity_type AS prev_owner_type,
         coalesce(s.prev_artist, s.prev_person, s.prev_institution, s.prev_place) AS prev_owner_id
  FROM s JOIN artworks w ON w.id = s.artwork_id
)
SELECT b.id, b.artwork_id, b."position", b.first_position, b.is_last, b.owner_type, b.owner_id, b.owner_institution_id,
       coalesce(o.name || coalesce(' (' || b.owner_label || ')', ''), b.owner_label) AS owner_name,
       b.prev_owner_type, b.prev_owner_id, b.prev_holding, b.acquired, b.acquired_label, b.ended, b.ended_label, b.method, b.direct,
       b.location_id, b.label, b.certainty, b.notes_md, b.end_basis,
       CASE WHEN b.acquired IS NULL AND b.ended IS NOT NULL THEN daterange(NULL::date, upper(b.ended))
            WHEN b.acquired IS NULL THEN NULL::daterange
            WHEN b.end_basis = 'recorded' THEN daterange(lower(b.acquired), greatest(upper(b.ended), upper(b.acquired)))
            WHEN b.end_basis = 'implied' THEN daterange(lower(b.acquired), greatest(upper(b.next_acquired), upper(b.acquired)))
            WHEN b.end_basis = 'ongoing' THEN daterange(lower(b.acquired), NULL::date)
            ELSE b.acquired END AS period,
       CASE WHEN b.acquired IS NULL AND b.ended_label IS NOT NULL THEN 'until ' || b.ended_label
            WHEN b.acquired IS NULL THEN NULL
            WHEN b.end_basis = 'recorded' AND b.acquired_label ~ '^(between|before|by|at the latest) |or earlier$' THEN 'until ' || b.ended_label
            WHEN b.end_basis = 'implied' AND b.acquired_label ~ '^(between|before|by|at the latest) |or earlier$' THEN 'until ' || b.next_label
            WHEN b.end_basis = 'recorded' AND b.ended_label IS DISTINCT FROM b.acquired_label
              THEN b.acquired_label || CASE WHEN (b.acquired_label || b.ended_label) ~ '[–-]' THEN ' – ' ELSE '–' END || b.ended_label
            WHEN b.end_basis = 'implied' AND b.next_label IS DISTINCT FROM b.acquired_label
              THEN b.acquired_label || CASE WHEN (b.acquired_label || b.next_label) ~ '[–-]' THEN ' – ' ELSE '–' END || b.next_label
            WHEN b.end_basis = 'ongoing' THEN 'since ' || b.acquired_label
            WHEN b.end_basis = 'unknown' THEN 'from ' || b.acquired_label
            ELSE b.acquired_label END AS period_label,
       b.owner_label, b.metadata, b.role, b.price, b.price_currency, b.price_note,
       b.in_chain, b.not_sold, b.via
FROM b LEFT JOIN entity_index o ON o.type = b.owner_type AND o.id = b.owner_id;

SELECT refresh_quality();
