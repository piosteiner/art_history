-- 130 — Long start-map views can be shared again. shared_views (072) had a unique index on the whole query; a b-tree
-- entry may hold at most 2,704 bytes (a third of a page, even compressed), and the API takes queries up to 20,000
-- characters: on 2026-10-21 a visitor's view failed with "index row size 3008 exceeds btree maximum". Now the
-- uniqueness is checked on a hash of the query — the idiom Postgres' own hint suggests. sha256() is immutable, but
-- convert_to() (text → bytes) is only stable and can't be indexed; textsend() gives the same UTF-8 bytes (the
-- database is UTF-8) and is immutable. save_shared_view() looks queries up through that hash.
CREATE FUNCTION shared_view_hash(q text) RETURNS bytea LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN sha256(textsend(q));

ALTER TABLE shared_views DROP CONSTRAINT shared_views_query_key;
CREATE UNIQUE INDEX shared_views_query_hash ON shared_views (shared_view_hash(query));

CREATE OR REPLACE FUNCTION save_shared_view(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  h text := encode(shared_view_hash(q), 'hex');   -- the same digits as before 130: sha256 of the UTF-8 bytes
  n int := 8;
  found_query text;
BEGIN
  SELECT id INTO found_query FROM shared_views WHERE shared_view_hash(query) = shared_view_hash(q) AND query = q;   -- stored before: same code
  IF found THEN
    UPDATE shared_views SET last_used = current_date
    WHERE shared_view_hash(query) = shared_view_hash(q) AND query = q AND last_used < current_date;
    RETURN found_query;
  END IF;
  LOOP
    SELECT query INTO found_query FROM shared_views WHERE id = substr(h, 1, n);
    EXIT WHEN NOT found;
    n := n + 1;                                                      -- that code is another query's: one digit more
  END LOOP;
  INSERT INTO shared_views (id, query) VALUES (substr(h, 1, n), q) ON CONFLICT (shared_view_hash(query)) DO NOTHING;
  RETURN (SELECT id FROM shared_views WHERE shared_view_hash(query) = shared_view_hash(q) AND query = q);   -- (stored a moment ago by someone)
END $$;
