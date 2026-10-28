-- 150 — fill_person_names() (066, 109) leaves East Asian names alone (their order varies: "Itō Jakuchū" family first,
-- "Eikō Hosoe" given first), and an entry counted as East Asian when any of its other names was Japanese, Chinese or
-- Korean. The Wikidata import adds the translations of a name (role "translation": ポール・デルヴォー for Paul
-- Delvaux), so most new artists and people from Wikidata got no given and family name and were sorted by the whole
-- name, under the given name ("Paul Delvaux" under P). Now only the entry's own names count — original and other
-- names, not translations. The existing entries are filled separately (as an audited admin change).
CREATE OR REPLACE FUNCTION names_east_asian(names jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(names) n
    WHERE n ->> 'role' IS DISTINCT FROM 'translation'
      AND (split_part(n ->> 'lang', '-', 1) IN ('ja', 'zh', 'ko') OR (n ->> 'text') ~ '[　-鿿가-힯]'))
$f$;
