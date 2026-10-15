-- 072 — Short addresses for long selections on the site's start map: /?v=3f9a1c2b instead of a query naming fifty
-- artists. The site stores the query here once it gets long and shows the short address; opening it reads the query
-- back — with renamed entries followed (current_featured_query, 069), like the curated start views.
--
-- The code is derived from the query itself (the first hex digits of its SHA-256): the same selection always gets the
-- same address, and storing it twice changes nothing. Not content: no history; anonymous (no user, no IP).
CREATE TABLE shared_views (
  id         text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8,64}$'),
  query      text NOT NULL UNIQUE CHECK (length(query) BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used  date NOT NULL DEFAULT current_date        -- for clearing out links nobody opens any more, some day
);

-- Store a query (if new) → its code. 8 hex digits (4 billion codes); should two queries share a prefix, the later one
-- takes one digit more. sha256() is built into Postgres (11+); convert_to() gives the UTF-8 bytes it hashes.
CREATE FUNCTION save_shared_view(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  h text := encode(sha256(convert_to(q, 'UTF8')), 'hex');
  n int := 8;
  found_query text;
BEGIN
  SELECT id INTO found_query FROM shared_views WHERE query = q;      -- stored before: same code
  IF found THEN
    UPDATE shared_views SET last_used = current_date WHERE query = q AND last_used < current_date;
    RETURN found_query;
  END IF;
  LOOP
    SELECT query INTO found_query FROM shared_views WHERE id = substr(h, 1, n);
    EXIT WHEN NOT found;
    n := n + 1;                                                      -- that code is another query's: one digit more
  END LOOP;
  INSERT INTO shared_views (id, query) VALUES (substr(h, 1, n), q) ON CONFLICT (query) DO NOTHING;
  RETURN (SELECT id FROM shared_views WHERE query = q);              -- (someone stored the same query a moment ago)
END $$;

-- The public API stores and reads them (its role is otherwise read-only).
GRANT SELECT, INSERT ON shared_views TO arthistory_api;
GRANT UPDATE (last_used) ON shared_views TO arthistory_api;
