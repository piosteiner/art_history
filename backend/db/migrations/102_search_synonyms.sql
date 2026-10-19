-- 102 — Search across languages (owner, 2026-10-19: "beschlagnahmt" should find "confiscation").
-- The full-text search (087) stems in English, German and French, but it doesn't translate: a German word finds German
-- text only, and the provenance is mostly written in English. Now a table of equivalent words, and the search query
-- is rewritten with it before it runs — "beschlagnahmt" searches for beschlagnahmt | confiscation | seized | saisie …
--
--  * search_synonyms: one row per group of words that mean the same, in any language. Words of one group are
--    interchangeable both ways. A word of one word can be searched for; a phrase ("forced sale") is only searched as
--    an equivalent (a query's words aren't phrases unless quoted, so a phrase can't be recognised in it).
--  * search_synonym_rules: the rewrite rules computed from the groups, refreshed by a trigger on every change. Two
--    steps, because ts_rewrite applies its rules one after another to the whole query: had every word been rewritten
--    straight into its group, the next rule would rewrite the group's copy of its own word again — the query would
--    double with every word of the group. So step 1 turns each word into a placeholder of its group(s)
--    ('syngroup12'), step 2 turns the placeholders into all their words; no rule's result is another rule's target.
--    A word is matched as the search sees it: its lexemes in all four configurations (search_lexemes, 087); the
--    group's words are written in all four too (phraseto_tsquery), so they match whatever the text's language.
--    Changing the configurations (087) needs SELECT search_synonyms_refresh() afterwards.
--  * search_query() and search_headline() (087) rewrite their queries, so a hit's passage marks "confiscation" when
--    "beschlagnahmt" was searched (and the site's ?hl= marks it on the page).
-- Only words on the list are translated; the list is data and can grow. It isn't part of the content/ YAML export
-- (like the vocabularies), but of the database and its backups.

CREATE TABLE search_synonyms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label text NOT NULL UNIQUE,                 -- what the group means, for people: "confiscation"
  terms text[] NOT NULL CHECK (cardinality(terms) >= 2 AND array_position(terms, NULL) IS NULL),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE search_synonyms IS 'groups of equivalent search words in any language (102); the full-text search finds each by the others';
CREATE TRIGGER search_synonyms_audit AFTER INSERT OR UPDATE OR DELETE ON search_synonyms FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TABLE search_synonym_rules (
  step smallint NOT NULL CHECK (step IN (1, 2)),
  target tsquery NOT NULL,
  substitute tsquery NOT NULL
);
COMMENT ON TABLE search_synonym_rules IS 'ts_rewrite rules from search_synonyms (102): step 1 word → placeholder of its groups, step 2 placeholder → the group''s words; computed, do not edit';

-- an OR over many queries (tsquery_or is the function behind ||; strict, so the first value starts the state)
CREATE AGGREGATE search_or_agg(tsquery) (SFUNC = tsquery_or, STYPE = tsquery);

CREATE FUNCTION search_synonyms_refresh() RETURNS void LANGUAGE sql SET search_path = public, pg_temp AS $$
  DELETE FROM search_synonym_rules;
  -- step 1: every lexeme of a one-word term (in all four configurations) → the placeholders of the groups it is in
  INSERT INTO search_synonym_rules (step, target, substitute)
  SELECT 1, quote_literal(l.lexeme)::tsquery, string_agg(DISTINCT 'syngroup' || s.id, ' | ')::tsquery
  FROM search_synonyms s, unnest(s.terms) t(term), unnest(search_lexemes(t.term)) l
  WHERE t.term !~ '[[:space:]-]'
  GROUP BY l.lexeme;
  -- step 2: a placeholder → every term of its group, as a phrase, in all four configurations — each reading once
  -- (the configurations often agree: "confiscation" is 'confisc' in English and French)
  INSERT INTO search_synonym_rules (step, target, substitute)
  SELECT 2, ('syngroup' || s.id)::tsquery,
         (SELECT search_or_agg(r.q) FROM (
            SELECT DISTINCT phraseto_tsquery(c.cfg, t.term) AS q
            FROM unnest(s.terms) t(term),
                 (VALUES ('search_simple'::regconfig), ('search_en'), ('search_de'), ('search_fr')) c(cfg)) r
          WHERE numnode(r.q) > 0)   -- a term of stop words only ("aux") gives an empty query
  FROM search_synonyms s;
$$;

CREATE FUNCTION search_synonyms_changed() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM search_synonyms_refresh();
  RETURN NULL;
END $$;
CREATE TRIGGER search_synonyms_rules AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON search_synonyms
  FOR EACH STATEMENT EXECUTE FUNCTION search_synonyms_changed();

-- a query with the synonyms: both steps (the rule queries name the schema: ts_rewrite runs them as text)
CREATE FUNCTION search_synonyms_apply(q tsquery) RETURNS tsquery LANGUAGE sql STABLE PARALLEL RESTRICTED
RETURN ts_rewrite(ts_rewrite(q, 'SELECT target, substitute FROM public.search_synonym_rules WHERE step = 1'),
                  'SELECT target, substitute FROM public.search_synonym_rules WHERE step = 2');

-- 087's functions, now with the synonyms (STABLE instead of IMMUTABLE: they read the rules)
CREATE OR REPLACE FUNCTION search_query(q text) RETURNS tsquery LANGUAGE sql STABLE PARALLEL RESTRICTED
RETURN search_synonyms_apply(websearch_to_tsquery('search_simple', q) || websearch_to_tsquery('search_en', q)
    || websearch_to_tsquery('search_de', q) || websearch_to_tsquery('search_fr', q));

CREATE OR REPLACE FUNCTION search_headline(t text, q text) RETURNS text LANGUAGE sql STABLE PARALLEL RESTRICTED AS $$
  SELECT ts_headline(c.cfg, t, search_synonyms_apply(websearch_to_tsquery(c.cfg, q)),
                     'MaxFragments=2, MinWords=6, MaxWords=20, StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', FragmentDelimiter=" … "')
  FROM (VALUES (1, 'search_en'::regconfig), (2, 'search_de'), (3, 'search_fr'), (4, 'search_simple')) c(n, cfg)
  WHERE t IS NOT NULL AND to_tsvector(c.cfg, t) @@ search_synonyms_apply(websearch_to_tsquery(c.cfg, q))
  ORDER BY c.n LIMIT 1
$$;

-- The starting list: the words of provenance research, German · English · French. Left out on purpose: words that
-- mean something else in another language or in art history ("vol" = volume, "lent" = Lent, "legs", "legat" =
-- a papal legate, "don").
INSERT INTO search_synonyms (label, terms) VALUES
  ('confiscation', '{beschlagnahmt,beschlagnahme,beschlagnahmung,konfisziert,konfiszierung,confiscation,confiscated,seized,seizure,confisqué,confisquée,saisie,saisi}'),
  ('looting', '{raubkunst,raub,geraubt,plünderung,geplündert,looted,looting,loot,plunder,plundered,spoliation,spolié,spoliée,pillage,pillé}'),
  ('theft', '{diebstahl,gestohlen,entwendet,theft,stolen,volé,volée}'),
  ('forced sale', '{zwangsverkauf,zwangsverkauft,notverkauf,forced sale,vente forcée}'),
  ('persecution', '{verfolgung,verfolgt,verfolgungsbedingt,persecution,persecuted,persécution,persécuté,persécutée}'),
  ('National Socialism', '{ns,nationalsozialismus,nationalsozialistisch,nazi,nazis,national socialism,national socialist,nazisme}'),
  ('restitution', '{restitution,restituiert,rückgabe,zurückgegeben,restituted,restitué,restituée}'),
  ('purchase', '{kauf,gekauft,ankauf,erwerb,erworben,purchase,purchased,bought,acquired,achat,acheté,acquis}'),
  ('sale', '{verkauf,verkauft,sale,sold,vente,vendu,vendue}'),
  ('auction', '{auktion,versteigerung,versteigert,auction,auctioned,enchère,enchères,vente aux enchères}'),
  ('gift', '{schenkung,geschenkt,gift,donation,donated,donné,donnée}'),
  ('bequest', '{vermächtnis,vermacht,bequest,bequeathed,légué,léguée}'),
  ('inheritance', '{erbschaft,geerbt,erbe,nachlass,inheritance,inherited,estate,héritage,hérité}'),
  ('exchange', '{tausch,getauscht,exchange,exchanged,échange,échangé}'),
  ('loan', '{leihgabe,dauerleihgabe,ausgeliehen,loan,loaned,prêt,prêté}'),
  ('commission', '{auftrag,beauftragt,commission,commissioned,commande,commandé}'),
  ('dealer', '{kunsthändler,händler,dealer,art dealer,marchand,marchand d''art}'),
  -- one group: English stems "collector" and "collection" alike ('collect'), so they find each other anyway
  ('collector, collection', '{sammler,sammlerin,sammlung,collector,collection,collectionneur,collectionneuse}'),
  ('exhibition', '{ausstellung,ausgestellt,exhibition,exhibited,exposition,exposé}');
