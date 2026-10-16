-- 080 — Searches equal more than accents. unaccent() already folds é/è/ê, æ → ae, ø → o, ß → ss, ł → l, œ → oe, ligatures;
-- now also: compatibility forms (NFKC: full-width letters, superscripts), typographic apostrophes and quotes
-- (d’Anvers = d'Anvers) and dashes (Shin–Ōhashi = Shin-Ōhashi). The site's search folds the same way
-- (frontend/src/fold.ts), the admin's editor too (backend/src/fold.js).
--
-- f_unaccent is IMMUTABLE and used inside indexes (trigram and full-text): an index stores the function's results, so
-- after changing what it returns every index that uses it is rebuilt (REINDEX) — else lookups would miss rows.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
RETURN translate(public.unaccent('public.unaccent'::regdictionary, normalize($1, NFKC)), '’‘ʼ`´‐‑‒–—―', '''''''''''------');

DO $$
DECLARE i record;
BEGIN
  FOR i IN SELECT schemaname, indexname FROM pg_indexes
           WHERE schemaname = 'public' AND indexdef ~ '(f_unaccent|dup_names|type_doubt)\('
  LOOP
    EXECUTE format('REINDEX INDEX %I.%I', i.schemaname, i.indexname);
  END LOOP;
END $$;
