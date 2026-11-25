-- 259 — Shared arrangements of the network's "Arrange" view (2026-11-24, owner): a visitor's own layout of the tree
-- around an entry — where each entry was put, what was hidden or folded away — under a short code, so a link shows
-- others the same arrangement (/graph/artists/vincent-van-gogh?view=arrange&arr=3f9a1c2b).
--
-- Like the start map's short addresses (072/130): the code is the first hex digits of a hash of the content, so the
-- same arrangement always gets the same code and storing it twice changes nothing; anonymous (no account, no IP),
-- no history. The arrangement is jsonb: Postgres stores an object normalised (keys sorted, duplicates dropped), so
-- state::text is one text per arrangement — the hash is taken over that, together with the centre.
CREATE TABLE shared_arrangements (
  id         text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8,64}$'),
  root       text NOT NULL CHECK (root ~ '^[a-z]+/[^/\s]{1,200}$'),     -- the centre, "artist/vincent-van-gogh"
  state      jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object' AND octet_length(state::text) <= 200000),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used  date NOT NULL DEFAULT current_date                         -- for clearing out links nobody opens any more
);

CREATE FUNCTION shared_arrangement_hash(root text, state jsonb) RETURNS bytea LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN sha256(textsend(root || E'\n' || state::text));
CREATE UNIQUE INDEX shared_arrangements_hash ON shared_arrangements (shared_arrangement_hash(root, state));

-- Store an arrangement (if new) → its code: 8 hex digits, one more should another arrangement have that prefix.
CREATE FUNCTION save_shared_arrangement(r text, s jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  h text := encode(shared_arrangement_hash(r, s), 'hex');
  n int := 8;
  found_id text;
BEGIN
  SELECT id INTO found_id FROM shared_arrangements
  WHERE shared_arrangement_hash(root, state) = shared_arrangement_hash(r, s) AND root = r AND state = s;
  IF found THEN
    UPDATE shared_arrangements SET last_used = current_date WHERE id = found_id AND last_used < current_date;
    RETURN found_id;
  END IF;
  LOOP
    PERFORM 1 FROM shared_arrangements WHERE id = substr(h, 1, n);
    EXIT WHEN NOT found;
    n := n + 1;
  END LOOP;
  INSERT INTO shared_arrangements (id, root, state) VALUES (substr(h, 1, n), r, s)
  ON CONFLICT (shared_arrangement_hash(root, state)) DO NOTHING;
  RETURN (SELECT id FROM shared_arrangements
          WHERE shared_arrangement_hash(root, state) = shared_arrangement_hash(r, s) AND root = r AND state = s);
END $$;

-- The public API stores and reads them (its role is otherwise read-only); the default privileges gave it SELECT.
GRANT SELECT, INSERT ON shared_arrangements TO arthistory_api;
GRANT UPDATE (last_used) ON shared_arrangements TO arthistory_api;
