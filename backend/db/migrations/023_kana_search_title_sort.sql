-- 023 — Kana readings searchable in Latin letters; sorting by the title; one function for the "other" search text.
--
-- Kana (unlike kanji) turn into Latin letters by fixed rules — Hepburn: うたがわ → utagawa, しゃ → sha, っ doubles the
-- next consonant (ほっかいどう → hokkaidou). kana_romaji() applies them, so a furigana reading or a name written in kana
-- is found by typing it in Latin letters. Long vowels are written out (とうきょう → toukyou); the search text also
-- carries a shortened form (tokyo), as people usually type it.
CREATE FUNCTION kana_romaji(s text) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  r text := translate(s, 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ', 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ');  -- katakana → hiragana
  pair text[];
BEGIN
  IF r IS NULL OR r !~ '[ぁ-ゖ]' THEN RETURN NULL; END IF;  -- no kana: nothing to add
  -- two-character syllables (きゃ kya, しゅ shu, ふぁ fa …) before single ones; FOREACH … SLICE 1 walks the pairs
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['きゃ','kya'],
    ['きゅ','kyu'],
    ['きょ','kyo'],
    ['ぎゃ','gya'],
    ['ぎゅ','gyu'],
    ['ぎょ','gyo'],
    ['にゃ','nya'],
    ['にゅ','nyu'],
    ['にょ','nyo'],
    ['ひゃ','hya'],
    ['ひゅ','hyu'],
    ['ひょ','hyo'],
    ['びゃ','bya'],
    ['びゅ','byu'],
    ['びょ','byo'],
    ['ぴゃ','pya'],
    ['ぴゅ','pyu'],
    ['ぴょ','pyo'],
    ['みゃ','mya'],
    ['みゅ','myu'],
    ['みょ','myo'],
    ['りゃ','rya'],
    ['りゅ','ryu'],
    ['りょ','ryo'],
    ['しゃ','sha'],
    ['しゅ','shu'],
    ['しょ','sho'],
    ['ちゃ','cha'],
    ['ちゅ','chu'],
    ['ちょ','cho'],
    ['じゃ','ja'],
    ['じゅ','ju'],
    ['じょ','jo'],
    ['ぢゃ','ja'],
    ['ぢゅ','ju'],
    ['ぢょ','jo'],
    ['しぇ','she'],
    ['ちぇ','che'],
    ['じぇ','je'],
    ['ふぁ','fa'],
    ['ふぃ','fi'],
    ['ふぇ','fe'],
    ['ふぉ','fo'],
    ['てぃ','ti'],
    ['でぃ','di'],
    ['とぅ','tu'],
    ['どぅ','du'],
    ['うぃ','wi'],
    ['うぇ','we'],
    ['うぉ','wo'],
    ['つぁ','tsa'],
    ['ゔぁ','va'],
    ['ゔぃ','vi'],
    ['ゔぇ','ve'],
    ['ゔぉ','vo'],
    ['あ','a'],
    ['い','i'],
    ['う','u'],
    ['え','e'],
    ['お','o'],
    ['か','ka'],
    ['き','ki'],
    ['く','ku'],
    ['け','ke'],
    ['こ','ko'],
    ['が','ga'],
    ['ぎ','gi'],
    ['ぐ','gu'],
    ['げ','ge'],
    ['ご','go'],
    ['さ','sa'],
    ['し','shi'],
    ['す','su'],
    ['せ','se'],
    ['そ','so'],
    ['ざ','za'],
    ['じ','ji'],
    ['ず','zu'],
    ['ぜ','ze'],
    ['ぞ','zo'],
    ['た','ta'],
    ['ち','chi'],
    ['つ','tsu'],
    ['て','te'],
    ['と','to'],
    ['だ','da'],
    ['ぢ','ji'],
    ['づ','zu'],
    ['で','de'],
    ['ど','do'],
    ['な','na'],
    ['に','ni'],
    ['ぬ','nu'],
    ['ね','ne'],
    ['の','no'],
    ['は','ha'],
    ['ひ','hi'],
    ['ふ','fu'],
    ['へ','he'],
    ['ほ','ho'],
    ['ば','ba'],
    ['び','bi'],
    ['ぶ','bu'],
    ['べ','be'],
    ['ぼ','bo'],
    ['ぱ','pa'],
    ['ぴ','pi'],
    ['ぷ','pu'],
    ['ぺ','pe'],
    ['ぽ','po'],
    ['ま','ma'],
    ['み','mi'],
    ['む','mu'],
    ['め','me'],
    ['も','mo'],
    ['や','ya'],
    ['ゆ','yu'],
    ['よ','yo'],
    ['ら','ra'],
    ['り','ri'],
    ['る','ru'],
    ['れ','re'],
    ['ろ','ro'],
    ['わ','wa'],
    ['ゐ','i'],
    ['ゑ','e'],
    ['を','o'],
    ['ん','n'],
    ['ゔ','vu'],
    ['ぁ','a'],
    ['ぃ','i'],
    ['ぅ','u'],
    ['ぇ','e'],
    ['ぉ','o'],
    ['ゃ','ya'],
    ['ゅ','yu'],
    ['ょ','yo'],
    ['ゎ','wa'],
    ['ゕ','ka'],
    ['ゖ','ke']] LOOP
    r := replace(r, pair[1], pair[2]);
  END LOOP;
  r := regexp_replace(r, 'っch', 'tch', 'g');                       -- まっちゃ → matcha
  r := regexp_replace(r, 'っ([bcdfghjkmnpqrstvwxyz])', '\1\1', 'g'); -- ほっかいどう → hokkaidou
  RETURN replace(replace(r, 'っ', ''), 'ー', '');                   -- a stray small tsu, the long-vowel mark
END $$;

-- Long vowels as usually typed: toukyou → tokyo, ryuu → ryu.
CREATE FUNCTION romaji_short(s text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(regexp_replace(s, 'ou|oo', 'o', 'g'), 'uu', 'u', 'g') $$;

-- Everything an entry can be found by besides its name: the other names (+ their readings), the main name's
-- furigana reading, and every kana reading in Latin letters (long and short). One function for the admin search,
-- the API's ?q= and /v1/search, and the index below — the query must use the same expression as the index.
CREATE FUNCTION name_alt_text(ruby text, n jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH readings AS (
    SELECT public.ruby_reading(ruby) AS k
    UNION ALL
    SELECT CASE WHEN e->>'text' ~ '\{' THEN public.ruby_reading(e->>'text') ELSE e->>'text' END FROM jsonb_array_elements(n) e
  ), latin AS (SELECT public.kana_romaji(k) AS r FROM readings WHERE k IS NOT NULL)
  SELECT nullif(concat_ws(' · ', public.names_text(n), public.ruby_reading(ruby),
           (SELECT string_agg(r || ' ' || public.romaji_short(r), ' · ') FROM latin WHERE r IS NOT NULL)), '') $$;

-- Sort by the title: itself when it has Latin letters (The Great Wave off Kanagawa, Pine Trees); otherwise its
-- romanization (歌川広重 → Utagawa Hiroshige), else its furigana reading in Latin letters, else itself.
CREATE FUNCTION name_sort_key(name text, ruby text, n jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN name ~ '[A-Za-zÀ-ɏ]' THEN name ELSE coalesce(
    (SELECT public.ruby_plain(e->>'text') FROM jsonb_array_elements(n) WITH ORDINALITY AS x(e, i)
      WHERE e->>'role' = 'romanization' ORDER BY i LIMIT 1),
    public.kana_romaji(public.ruby_reading(ruby)), name) END $$;

DROP INDEX places_names_trgm;
CREATE INDEX places_alt_trgm ON places USING gin (f_unaccent(name_alt_text(name_ruby, names)) gin_trgm_ops);
DROP INDEX movements_names_trgm;
CREATE INDEX movements_alt_trgm ON movements USING gin (f_unaccent(name_alt_text(name_ruby, names)) gin_trgm_ops);
DROP INDEX polities_names_trgm;
CREATE INDEX polities_alt_trgm ON polities USING gin (f_unaccent(name_alt_text(name_ruby, names)) gin_trgm_ops);
DROP INDEX artists_names_trgm;
CREATE INDEX artists_alt_trgm ON artists USING gin (f_unaccent(name_alt_text(name_ruby, names)) gin_trgm_ops);
DROP INDEX patrons_names_trgm;
CREATE INDEX patrons_alt_trgm ON patrons USING gin (f_unaccent(name_alt_text(name_ruby, names)) gin_trgm_ops);
DROP INDEX institutions_names_trgm;
CREATE INDEX institutions_alt_trgm ON institutions USING gin (f_unaccent(name_alt_text(name_ruby, names)) gin_trgm_ops);
DROP INDEX artworks_names_trgm;
CREATE INDEX artworks_alt_trgm ON artworks USING gin (f_unaccent(name_alt_text(title_ruby, names)) gin_trgm_ops);

-- entity_index: sort_key by the new rule, plus alt_text (appended) for /v1/search.
CREATE OR REPLACE VIEW entity_index AS
  SELECT 'artist'::entity_type AS type, id, slug, name, lifespan AS period,
         nullif(concat_ws('–', birth_label, death_label), '') AS period_label, NULL::text AS kind,
         names, name_sort_key(name, name_ruby, names) AS sort_key, name_alt_text(name_ruby, names) AS alt_text
    FROM artists
  UNION ALL
  SELECT 'artwork', id, slug, title, created, created_label, kind,
         names, name_sort_key(title, title_ruby, names), name_alt_text(title_ruby, names)
    FROM artworks
  UNION ALL
  SELECT 'institution', id, slug, name, founded, founded_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM institutions
  UNION ALL
  SELECT 'patron', id, slug, name, active, active_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM patrons
  UNION ALL
  SELECT 'movement', id, slug, name, period, period_label, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM movements
  UNION ALL
  SELECT 'place', id, slug, name, NULL, NULL, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM places
  UNION ALL
  SELECT 'polity', id, slug, name, period, period_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM polities;

DROP FUNCTION name_sort_key(text, jsonb);  -- the 022 version (sorted by any romanization, even under a Latin title)
