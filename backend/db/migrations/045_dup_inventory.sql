-- 045 — Duplicates (044): two different inventory numbers in the same collection prove two objects — the water lily
-- panels at the Kunsthaus (same painter, size, dates, similar titles; 1952/0010 and 1952/0064) were shown as one.
-- dup_score as in 044, plus that rule (OR REPLACE: same signature, the view and functions using it keep working).
CREATE OR REPLACE FUNCTION dup_score(a dup_facts, b dup_facts, OUT score int, OUT reasons text[]) LANGUAGE plpgsql STABLE AS $$
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

  IF a.type = 'artwork' THEN
    IF a.institution_id = b.institution_id AND lower(btrim(a.inventory_number)) = lower(btrim(b.inventory_number)) THEN
      score := score + 100; reasons := reasons || 'same inventory number in the same collection'::text;
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

  -- created (artworks), founded (institutions), period (movements, polities) — a person's "active" is too vague
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
END $$;
