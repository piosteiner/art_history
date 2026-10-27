-- 139 — A name can be a former one: role "former" beside original | translation | romanization | alternative (owner,
-- 2026-10-27: the "Staatliche Museen Preußischer Kulturbesitz" is not an alternative name of the Staatliche Museen zu
-- Berlin but the name they had before). names_valid() is what the CHECK constraints of every `names` column call;
-- replacing it widens them all at once, and every stored array stays valid.
CREATE OR REPLACE FUNCTION public.names_valid(n jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(n) = 'array' AND coalesce((
    SELECT bool_and(jsonb_typeof(e) = 'object'
                    AND jsonb_typeof(e->'text') = 'string' AND btrim(e->>'text') <> ''
                    AND (e - 'text' - 'lang' - 'role' - 'status') = '{}'
                    AND public.lang_tag_ok(e->>'lang')
                    AND e->>'role' IN ('original', 'translation', 'romanization', 'alternative', 'former')
                    AND (e->>'status' IS NULL OR (e->>'role' = 'translation' AND e->>'status' IN ('official', 'common', 'own'))))
    FROM jsonb_array_elements(n) e), true) $$;
