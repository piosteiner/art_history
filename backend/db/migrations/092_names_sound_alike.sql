-- 092 — Names that sound alike (owner, 2026-10-17): the duplicate check compared names by trigrams (letters in
-- common). Spellings of one name often share few: "Rochlitz" / "Rochlits", "Meier" / "Meyer" / "Mayer", the
-- Kunsthaus's "Bernheim-Jeune" and Wikidata's "Bernheim Jeune". fuzzystrmatch (a trusted extension) brings
--   dmetaphone(word)              Double Metaphone: a key for how a word sounds (in English-trained rules, but it
--                                 copes with German and French names well enough): ROCHLITZ, ROCHLITS → RXLTS
--   levenshtein_less_equal(a, b, k)  edits between two strings, counting only up to k (cheaper than the full count)
-- name_sound_key(name): the Double Metaphone key of every word, in order; names_sound_alike(a[], b[]): some name of
-- each has the same key and is at most a few edits away (a fifth of its length, at least 1; names of 5 letters or
-- more) — the same key alone would pair "Schmidt" and "Smith", and short words have crude keys (papier, pappe → PP). Used by dup_maybe() (a candidate pair) and dup_score() (55 for people, places,
-- institutions …, 35 for titles: over the threshold of 50 only with other evidence).
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- SQL-standard bodies (BEGIN ATOMIC … END, Postgres 14+): parsed when created, every name bound to its object then —
-- so they work under any search_path (a materialized view's refresh runs with pg_catalog only, 093), and Postgres
-- knows what they depend on. A body in quotes ($$ … $$) is parsed at each first call, by the search_path of the moment.
CREATE FUNCTION name_sound_key(name text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
BEGIN ATOMIC
  SELECT string_agg(dmetaphone(w), ' ' ORDER BY n)
  FROM regexp_split_to_table(f_unaccent(name), '[^[:alpha:]]+') WITH ORDINALITY AS t(w, n)
  WHERE w <> '' AND dmetaphone(w) <> '';
END;

CREATE FUNCTION names_sound_alike(a text[], b text[]) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
BEGIN ATOMIC
  SELECT EXISTS (
    SELECT 1 FROM unnest(a) x, unnest(b) y
    WHERE x <> y AND name_sound_key(x) = name_sound_key(y)
      AND length(x) >= 5 AND length(y) >= 5
      AND levenshtein_less_equal(left(x, 250), left(y, 250), greatest(1, length(x) / 5)) <= greatest(1, length(x) / 5));
END;

CREATE OR REPLACE FUNCTION dup_maybe(a dup_facts, b dup_facts)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT names_similarity(a.names, b.names) >= 0.5 OR a.doi = b.doi OR a.isbn = b.isbn OR a.web_host = b.web_host
      OR a.numbers && b.numbers
      OR (a.institution_id = b.institution_id AND lower(btrim(a.inventory_number)) = lower(btrim(b.inventory_number)))
      OR names_sound_alike(a.names, b.names)
$function$;

CREATE OR REPLACE FUNCTION dup_score(a dup_facts, b dup_facts, OUT score integer, OUT reasons text[])
 RETURNS record
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  s real := names_similarity(a.names, b.names);
  d double precision;
  -- dimensions in cm: the same within 1 cm or 2 %, different beyond 3 cm and 5 %
  close_h boolean; far_h boolean; close_w boolean; far_w boolean;
BEGIN
  score := 0; reasons := '{}';
  IF s >= 0.999 THEN
    -- a person's or a place's full name says more than a title ("Untitled") or a book title
    score := CASE WHEN a.type IN ('artwork', 'source') THEN 50 ELSE 70 END; reasons := reasons || 'same name'::text;
  ELSIF s >= 0.5 THEN
    score := round(s * 55); reasons := reasons || format('similar name (%s %%)', round(s * 100));
  END IF;
  -- spelt differently, sounding alike (092): "Rochlitz" / "Rochlits", "Meier" / "Meyer" — for a name of a person
  -- or a place enough to ask; for titles only a hint
  IF s < 0.999 AND names_sound_alike(a.names, b.names) THEN
    score := greatest(score, CASE WHEN a.type IN ('artwork', 'source') THEN 35 ELSE 55 END);
    reasons := reasons || 'names sound alike'::text;
  END IF;

  IF a.type = 'artwork' THEN
    -- any number in common (048): an institution's inventory number — the main one or a further one, e.g. the
    -- Bührle Foundation's "99" — or a catalogue raisonné number: certain
    IF a.numbers && b.numbers THEN
      score := score + 100; reasons := reasons || 'same inventory or catalogue number'::text;
    -- the same catalogue raisonné, two numbers: two works
    ELSIF EXISTS (SELECT 1 FROM unnest(a.numbers) x, unnest(b.numbers) y
                  WHERE x LIKE 's:%' AND split_part(x, ':', 2) = split_part(y, ':', 2) AND y LIKE 's:%') THEN
      score := score - 100; reasons := reasons || 'different numbers in the same catalogue'::text;
    ELSIF a.institution_id = b.institution_id AND a.inventory_number IS NOT NULL AND b.inventory_number IS NOT NULL THEN
      -- two numbers in one collection: two objects, however alike (Monet's water lily panels at the Kunsthaus)
      score := score - 100; reasons := reasons || format('different inventory numbers (%s / %s)', a.inventory_number, b.inventory_number);
    END IF;
    IF a.creator_id IS NOT NULL AND b.creator_id IS NOT NULL THEN
      IF a.creator_id = b.creator_id THEN score := score + 20; reasons := reasons || 'same creator'::text;
      ELSE score := score - 60; reasons := reasons || 'different creators'::text; END IF;
    END IF;
    IF a.institution_id IS NOT NULL AND b.institution_id IS NOT NULL THEN
      IF a.institution_id = b.institution_id THEN score := score + 10; reasons := reasons || 'same collection'::text;
      ELSE score := score - 10; reasons := reasons || 'different collections'::text; END IF;
    END IF;
    IF a.height_cm IS NOT NULL AND b.height_cm IS NOT NULL THEN
      close_h := abs(a.height_cm - b.height_cm) <= greatest(1, 0.02 * greatest(a.height_cm, b.height_cm));
      far_h   := abs(a.height_cm - b.height_cm) >  greatest(3, 0.05 * greatest(a.height_cm, b.height_cm));
      close_w := a.width_cm IS NULL OR b.width_cm IS NULL OR abs(a.width_cm - b.width_cm) <= greatest(1, 0.02 * greatest(a.width_cm, b.width_cm));
      far_w   := a.width_cm IS NOT NULL AND b.width_cm IS NOT NULL AND abs(a.width_cm - b.width_cm) > greatest(3, 0.05 * greatest(a.width_cm, b.width_cm));
      IF close_h AND close_w THEN score := score + 20; reasons := reasons || 'same dimensions'::text;
      ELSIF far_h OR far_w THEN score := score - 40; reasons := reasons || 'different dimensions'::text; END IF;
    END IF;
    IF a.parent_id = b.parent_id AND a.part_number IS NOT NULL AND b.part_number IS NOT NULL AND a.part_number <> b.part_number THEN
      score := score - 60; reasons := reasons || format('different parts of one series (No. %s / %s)', a.part_number, b.part_number);
    END IF;
  END IF;

  -- created (artworks), founded (institutions), period (movements, polities, events) — a person's "active" is too vague
  IF a.period IS NOT NULL AND b.period IS NOT NULL AND a.type <> 'person' THEN
    IF a.period && b.period THEN score := score + 10; reasons := reasons || 'dates agree'::text;
    ELSE score := score - 30; reasons := reasons || 'different dates'::text; END IF;
  END IF;
  IF a.birth IS NOT NULL AND b.birth IS NOT NULL THEN
    IF a.birth && b.birth THEN score := score + 15; reasons := reasons || 'birth dates agree'::text;
    ELSE score := score - 50; reasons := reasons || 'different birth dates'::text; END IF;
  END IF;
  IF a.death IS NOT NULL AND b.death IS NOT NULL THEN
    IF a.death && b.death THEN score := score + 15; reasons := reasons || 'death dates agree'::text;
    ELSE score := score - 50; reasons := reasons || 'different death dates'::text; END IF;
  END IF;

  -- a city and a region of the same name (Oslo, Kyoto) are two things; so are a technique and a style
  IF a.type IN ('place', 'term') AND a.kind IS NOT NULL AND b.kind IS NOT NULL THEN
    IF a.kind = b.kind THEN score := score + 5;
    ELSE score := score - 25; reasons := reasons || format('different kinds (%s / %s)', a.kind, b.kind); END IF;
  END IF;

  IF a.point IS NOT NULL AND b.point IS NOT NULL THEN
    d := ST_Distance(a.point, b.point);
    IF a.type = 'place' THEN
      IF d < 5000 THEN score := score + 25; reasons := reasons || 'close together'::text;
      ELSIF d < 25000 THEN score := score + 10; reasons := reasons || format('%s km apart', round(d / 1000));
      ELSIF d > 100000 THEN score := score - 50; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    ELSIF a.type = 'institution' THEN
      IF d <= 300 THEN score := score + 25; reasons := reasons || 'same spot'::text;
      ELSIF d > 20000 THEN score := score - 40; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    ELSIF a.type = 'event' THEN
      IF d <= 1000 THEN score := score + 10; reasons := reasons || 'same spot'::text;
      ELSIF d > 50000 THEN score := score - 40; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    ELSIF a.type = 'artwork' THEN
      IF d <= 200 THEN score := score + 15; reasons := reasons || 'same spot'::text;
      ELSIF d > 5000 THEN score := score - 30; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    END IF;
  END IF;
  IF a.place_id IS NOT NULL AND b.place_id IS NOT NULL THEN
    IF a.place_id = b.place_id THEN score := score + 10; reasons := reasons || 'same city'::text;
    ELSE score := score - 20; reasons := reasons || 'different cities'::text; END IF;
  END IF;
  IF a.web_host = b.web_host THEN score := score + 40; reasons := reasons || 'same website'::text; END IF;

  IF a.type = 'source' THEN
    IF a.doi = b.doi THEN score := score + 100; reasons := reasons || 'same DOI'::text; END IF;
    -- a chapter has the ISBN of its book: strong, but not proof
    IF a.isbn = b.isbn THEN score := score + 40; reasons := reasons || 'same ISBN'::text; END IF;
    IF a.year IS NOT NULL AND b.year IS NOT NULL THEN
      IF a.year = b.year THEN score := score + 15; reasons := reasons || 'same year'::text;
      ELSE score := score - 40; reasons := reasons || 'different years'::text; END IF;
    END IF;
    IF cardinality(a.authors) > 0 AND cardinality(b.authors) > 0 THEN
      IF a.authors && b.authors THEN score := score + 20; reasons := reasons || 'same author'::text;
      ELSE score := score - 30; reasons := reasons || 'different authors'::text; END IF;
    END IF;
  END IF;
END $function$;

SELECT refresh_quality();
