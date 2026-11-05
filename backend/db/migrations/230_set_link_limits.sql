-- 230 — Links to a set may end by themselves (owner 2026-11-05: "an optional end date or a maximum number of joins,
-- chosen when you make the link"):
--   expires_at  the end of the day the owner chose (Europe/Zurich) — after it no one new joins
--   max_joins   at most this many people join with it; `joined` counts them
-- Turned off by hand (ended_at), expired or full: the same for whoever comes with it — no one new joins; who joined stays.
--
-- Postgres: a function over the table's row type can be called like a column — `l.usable` for a link `l` (a
-- "computed field"): one definition of "may someone still join with it", used by every query. The CHECK keeps the
-- count within the limit even if two people join at the same moment (the join takes the row with UPDATE … WHERE
-- l.usable, so the second one finds it full).

ALTER TABLE study_set_links
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN max_joins  integer CHECK (max_joins >= 1),   -- the upper bound: the set's limits (routes/site-sets.js)
  ADD CONSTRAINT study_set_links_within_max CHECK (max_joins IS NULL OR joined <= max_joins);
COMMENT ON COLUMN study_set_links.expires_at IS 'No one new joins after this moment (230); NULL: no end date.';
COMMENT ON COLUMN study_set_links.max_joins IS 'At most this many join with the link (230); NULL: no limit.';

CREATE FUNCTION usable(l study_set_links) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT l.ended_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now()) AND (l.max_joins IS NULL OR l.joined < l.max_joins)
$$;
COMMENT ON FUNCTION usable(study_set_links) IS 'May someone still join with this link (230): not turned off, not expired, not full — l.usable.';

-- why a link no longer lets anyone in: off | expired | full | NULL (usable)
CREATE FUNCTION closed_because(l study_set_links) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN l.ended_at IS NOT NULL THEN 'off' WHEN l.expires_at <= now() THEN 'expired'
              WHEN l.max_joins IS NOT NULL AND l.joined >= l.max_joins THEN 'full' END
$$;

GRANT EXECUTE ON FUNCTION usable(study_set_links), closed_because(study_set_links) TO arthistory_admin;
