-- 245 — A name that begins with a number sorts by how the number is read (owner 2026-11-10: "El 2 de mayo de 1808 …"
-- and other titles starting with a number were listed before A). entry_sort_key() now writes a leading number out in
-- the name's language: "El 2 de mayo de 1808" → "dos de mayo de 1808" (under D), "Le 28 juillet 1830" → "vingt-huit
-- juillet 1830", "1867 Paris World's Fair" → "eighteen sixty-seven Paris World's Fair", "2nd arrondissement" →
-- "second arrondissement". Only the number at the start is read out; numbers further in keep the natural (numeric)
-- order of the collation sort_natural.
--
-- number_words(n, lang): 0–9999 in English (also for an unknown or missing language), German, French, Spanish, Italian
-- and Dutch. Years are read as people say them where that differs: English 1100–1999 and 2010–2099 as two pairs
-- ("eighteen sixty-seven", "nineteen oh nine", "twenty nineteen"), German and Dutch 1100–1999 in hundreds
-- ("achtzehnhundertsiebenundsechzig", "achttienhonderdzevenenzestig"); French, Spanish and Italian read years as
-- ordinary numbers. A leading English ordinal (1st, 2nd …) becomes first, second …; French 1er becomes premier.
-- The display is never touched — only the sort key.

CREATE OR REPLACE FUNCTION number_words(n integer, lang text) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  l text := lower(split_part(coalesce(lang, 'en'), '-', 1));
  h int; r int; t int; o int;
  en_small text[] := ARRAY['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve',
    'thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  en_tens text[] := ARRAY['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  de_small text[] := ARRAY['null','eins','zwei','drei','vier','fünf','sechs','sieben','acht','neun','zehn','elf','zwölf',
    'dreizehn','vierzehn','fünfzehn','sechzehn','siebzehn','achtzehn','neunzehn'];
  de_tens text[] := ARRAY['','','zwanzig','dreißig','vierzig','fünfzig','sechzig','siebzig','achtzig','neunzig'];
  fr_small text[] := ARRAY['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze',
    'treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
  fr_tens text[] := ARRAY['','','vingt','trente','quarante','cinquante','soixante','soixante','quatre-vingt','quatre-vingt'];
  es_small text[] := ARRAY['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce',
    'trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidós',
    'veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve'];
  es_tens text[] := ARRAY['','','veinte','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
  es_hund text[] := ARRAY['ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos',
    'ochocientos','novecientos'];
  it_small text[] := ARRAY['zero','uno','due','tre','quattro','cinque','sei','sette','otto','nove','dieci','undici','dodici',
    'tredici','quattordici','quindici','sedici','diciassette','diciotto','diciannove'];
  it_tens text[] := ARRAY['','','venti','trenta','quaranta','cinquanta','sessanta','settanta','ottanta','novanta'];
  nl_small text[] := ARRAY['nul','een','twee','drie','vier','vijf','zes','zeven','acht','negen','tien','elf','twaalf',
    'dertien','veertien','vijftien','zestien','zeventien','achttien','negentien'];
  nl_tens text[] := ARRAY['','','twintig','dertig','veertig','vijftig','zestig','zeventig','tachtig','negentig'];
  w text;
BEGIN
  IF n IS NULL OR n < 0 OR n > 9999 THEN RETURN NULL; END IF;
  -- years as they are said
  IF l IN ('en', '') OR l NOT IN ('de', 'fr', 'es', 'it', 'nl') THEN
    IF (n BETWEEN 1100 AND 1999) OR (n BETWEEN 2010 AND 2099) THEN
      r := n % 100;
      RETURN number_words(n / 100, 'en') || CASE WHEN r = 0 THEN ' hundred' WHEN r < 10 THEN ' oh ' || en_small[r + 1]
        ELSE ' ' || number_words(r, 'en') END;
    END IF;
  ELSIF l IN ('de', 'nl') AND n BETWEEN 1100 AND 1999 THEN
    r := n % 100;
    RETURN number_words(n / 100, l) || CASE l WHEN 'de' THEN 'hundert' ELSE 'honderd' END
      || CASE WHEN r = 0 THEN '' ELSE number_words(r, l) END;
  END IF;

  IF l = 'de' THEN
    IF n < 20 THEN RETURN de_small[n + 1]; END IF;
    IF n < 100 THEN
      o := n % 10; t := n / 10;
      RETURN CASE WHEN o = 0 THEN '' WHEN o = 1 THEN 'einund' ELSE de_small[o + 1] || 'und' END || de_tens[t + 1];
    END IF;
    IF n < 1000 THEN
      h := n / 100; r := n % 100;
      RETURN CASE WHEN h = 1 THEN 'ein' ELSE de_small[h + 1] END || 'hundert' || CASE WHEN r = 0 THEN '' ELSE number_words(r, 'de') END;
    END IF;
    r := n % 1000;
    RETURN CASE WHEN n / 1000 = 1 THEN 'ein' ELSE number_words(n / 1000, 'de') END || 'tausend'
      || CASE WHEN r = 0 THEN '' ELSE number_words(r, 'de') END;

  ELSIF l = 'nl' THEN
    IF n < 20 THEN RETURN nl_small[n + 1]; END IF;
    IF n < 100 THEN
      o := n % 10; t := n / 10;
      IF o = 0 THEN RETURN nl_tens[t + 1]; END IF;
      w := nl_small[o + 1];
      RETURN w || CASE WHEN w ~ 'e$' THEN 'ën' ELSE 'en' END || nl_tens[t + 1];   -- tweeëntwintig, eenentwintig
    END IF;
    IF n < 1000 THEN
      h := n / 100; r := n % 100;
      RETURN CASE WHEN h = 1 THEN '' ELSE nl_small[h + 1] END || 'honderd' || CASE WHEN r = 0 THEN '' ELSE number_words(r, 'nl') END;
    END IF;
    r := n % 1000;
    RETURN CASE WHEN n / 1000 = 1 THEN '' ELSE number_words(n / 1000, 'nl') END || 'duizend'
      || CASE WHEN r = 0 THEN '' ELSE number_words(r, 'nl') END;

  ELSIF l = 'fr' THEN
    IF n < 20 THEN RETURN fr_small[n + 1]; END IF;
    IF n < 100 THEN
      t := n / 10; o := n % 10;
      IF t IN (7, 9) THEN o := o + 10; END IF;                 -- 70–79 = soixante + 10–19, 90–99 = quatre-vingt + 10–19
      w := fr_tens[t + 1];
      IF o = 0 THEN RETURN w || CASE WHEN t = 8 THEN 's' ELSE '' END; END IF;   -- quatre-vingts
      IF (o = 1 OR o = 11) AND t <> 8 AND t <> 9 THEN RETURN w || ' et ' || fr_small[o + 1]; END IF;  -- vingt et un, soixante et onze
      RETURN w || '-' || fr_small[o + 1];
    END IF;
    IF n < 1000 THEN
      h := n / 100; r := n % 100;
      RETURN CASE WHEN h = 1 THEN 'cent' ELSE fr_small[h + 1] || ' cent' || CASE WHEN r = 0 THEN 's' ELSE '' END END
        || CASE WHEN r = 0 THEN '' ELSE ' ' || number_words(r, 'fr') END;
    END IF;
    r := n % 1000;
    RETURN CASE WHEN n / 1000 = 1 THEN 'mille' ELSE number_words(n / 1000, 'fr') || ' mille' END
      || CASE WHEN r = 0 THEN '' ELSE ' ' || number_words(r, 'fr') END;

  ELSIF l = 'es' THEN
    IF n < 30 THEN RETURN es_small[n + 1]; END IF;
    IF n < 100 THEN
      o := n % 10;
      RETURN es_tens[n / 10 + 1] || CASE WHEN o = 0 THEN '' ELSE ' y ' || es_small[o + 1] END;
    END IF;
    IF n < 1000 THEN
      h := n / 100; r := n % 100;
      IF n = 100 THEN RETURN 'cien'; END IF;
      RETURN es_hund[h] || CASE WHEN r = 0 THEN '' ELSE ' ' || number_words(r, 'es') END;
    END IF;
    r := n % 1000;
    RETURN CASE WHEN n / 1000 = 1 THEN 'mil' ELSE number_words(n / 1000, 'es') || ' mil' END
      || CASE WHEN r = 0 THEN '' ELSE ' ' || number_words(r, 'es') END;

  ELSIF l = 'it' THEN
    IF n < 20 THEN RETURN it_small[n + 1]; END IF;
    IF n < 100 THEN
      o := n % 10; w := it_tens[n / 10 + 1];
      IF o = 0 THEN RETURN w; END IF;
      IF o IN (1, 8) THEN w := left(w, -1); END IF;           -- ventuno, ventotto
      RETURN w || CASE WHEN o = 3 THEN 'tré' ELSE it_small[o + 1] END;
    END IF;
    IF n < 1000 THEN
      h := n / 100; r := n % 100;
      RETURN CASE WHEN h = 1 THEN '' ELSE it_small[h + 1] END || 'cento' || CASE WHEN r = 0 THEN '' ELSE number_words(r, 'it') END;
    END IF;
    r := n % 1000;
    RETURN CASE WHEN n / 1000 = 1 THEN 'mille' ELSE number_words(n / 1000, 'it') || 'mila' END
      || CASE WHEN r = 0 THEN '' ELSE number_words(r, 'it') END;
  END IF;

  -- English (and every other language)
  IF n < 20 THEN RETURN en_small[n + 1]; END IF;
  IF n < 100 THEN
    o := n % 10;
    RETURN en_tens[n / 10 + 1] || CASE WHEN o = 0 THEN '' ELSE '-' || en_small[o + 1] END;
  END IF;
  IF n < 1000 THEN
    r := n % 100;
    RETURN en_small[n / 100 + 1] || ' hundred' || CASE WHEN r = 0 THEN '' ELSE ' ' || number_words(r, 'en') END;
  END IF;
  r := n % 1000;
  RETURN number_words(n / 1000, 'en') || ' thousand' || CASE WHEN r = 0 THEN '' ELSE ' ' || number_words(r, 'en') END;
END $$;
COMMENT ON FUNCTION number_words IS 'A number 0–9999 in words (en, de, fr, es, it, nl; others as en), years as they are said — for sorting (245).';

-- the English ordinal of a cardinal in words: twenty-eight → twenty-eighth, twelve → twelfth
CREATE OR REPLACE FUNCTION en_ordinal_words(cardinal text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(cardinal, '(one|two|three|five|eight|nine|twelve|ty|[a-z]+)$',
    CASE substring(cardinal FROM '(one|two|three|five|eight|nine|twelve|ty|[a-z]+)$')
      WHEN 'one' THEN 'first' WHEN 'two' THEN 'second' WHEN 'three' THEN 'third' WHEN 'five' THEN 'fifth'
      WHEN 'eight' THEN 'eighth' WHEN 'nine' THEN 'ninth' WHEN 'twelve' THEN 'twelfth' WHEN 'ty' THEN 'tieth'
      ELSE substring(cardinal FROM '([a-z]+)$') || 'th' END)
$$;

-- a leading number of up to four digits, written out (an English ordinal or French 1er as such) — only when a space,
-- punctuation or the end follows ("3D Print" stays); the rest unchanged
CREATE OR REPLACE FUNCTION spell_leading_number(s text, lang text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN m IS NULL THEN s
    WHEN m[2] IN ('st', 'nd', 'rd', 'th') THEN en_ordinal_words(number_words(m[1]::int, 'en')) || m[3]
    WHEN m[2] = 'er' AND m[1] = '1' THEN 'premier' || m[3]
    ELSE number_words(m[1]::int, lang) || coalesce(m[2], '') || m[3] END
  FROM (SELECT regexp_match(s, '^(\d{1,4})(st|nd|rd|th|er)?([^0-9[:alpha:]].*|)$', 's') AS m) x
$$;

CREATE OR REPLACE FUNCTION entry_sort_key(etype entity_type, name text, ruby text, names jsonb, lang text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT spell_leading_number(CASE WHEN etype IN ('artwork', 'institution', 'movement', 'event', 'source', 'term')
    THEN strip_article(name_sort_key(name, ruby, names), lang) ELSE name_sort_key(name, ruby, names) END, lang)
$function$;

-- the stored list rows whose key began with a number: computed again by the worker
INSERT INTO list_queue (type, id) SELECT type, id FROM entry_list_rows WHERE row->>'sort_key' ~ '^[0-9]';
INSERT INTO derived_queue (type, id) SELECT type, id FROM entry_list_rows WHERE row->>'sort_key' ~ '^[0-9]';
