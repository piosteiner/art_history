-- 090 — Prices over time: the baseline (owner, 2026-10-17: "build the baseline for it, then put a pin in it").
-- Provenance prices come in many currencies over 150 years (FRF 1904, RM 1941, USD 1958, CHF today). To compare them:
--   currencies       the codes (ISO 4217, or our own for historical ones without: RM), and the fixed legal
--                    conversions into a successor (100 old francs = 1 new franc in 1960; 6.55957 FRF = 1 EUR in 1999;
--                    10 RM = 1 DM in 1948 — for wages and prices; savings were converted at less)
--   exchange_rates   a currency's rate in another one for a period (a year, a month), with its source
--   price_indices    a country's consumer price index for a period (a year) — by country, not currency: a
--                    national series is chain-linked across currency changes (RM → DM → EUR)
--   price_value()    an amount at a date, in a target currency at a target date: converted at the time, then
--                    adjusted by the price index of the target currency's country: 200 AFRF (1904) → CHF (1904) →
--                    CHF (2025).
-- No rates or indices are loaded yet — they need a reliable, cited source (📌 pinned). Until then price_value()
-- returns NULL ("not computable"), never a guess.
--
-- Two rates for the same pair can't both apply on the same day: an EXCLUSION constraint (btree_gist) — "no two rows
-- with equal currencies whose periods overlap (&&)". A UNIQUE constraint can compare only with =; an exclusion
-- constraint takes any operator its GiST index supports. (Provenance doesn't get such constraints: historical
-- sources contradict each other, and the checks in quality_issues_live report that instead of refusing it. A
-- table of rates is reference data: there one value per day is the rule.)
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- = on scalars inside GiST indexes (trusted: the database owner may create it)

CREATE TABLE currencies (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2,4}$'),
  name text NOT NULL,
  -- the country whose price index applies (ISO 3166 alpha-2), when one does
  country text,
  in_use daterange,
  successor text REFERENCES currencies(code) ON UPDATE CASCADE,
  successor_rate numeric CHECK (successor_rate > 0),   -- units of this currency per unit of the successor
  note text,
  CHECK ((successor IS NULL) = (successor_rate IS NULL)),
  CHECK (successor IS NULL OR upper(in_use) IS NOT NULL)
);
COMMENT ON TABLE currencies IS 'currencies of prices (090); successor + successor_rate = the fixed legal conversion when it was replaced';

-- successors first (the foreign key)
INSERT INTO currencies (code, name, country, in_use, successor, successor_rate, note) VALUES
  ('EUR', 'Euro', NULL, '[1999-01-01,)', NULL, NULL, 'price indices are national: a value in euros is computed for a country''s currency'),
  ('CHF', 'Swiss franc', 'CH', '[1850-05-07,)', NULL, NULL, NULL),
  ('USD', 'US dollar', 'US', '[1792-04-02,)', NULL, NULL, NULL),
  ('GBP', 'Pound sterling', 'GB', NULL, NULL, NULL, 'before 1971: pounds, shillings, pence — enter as decimal pounds'),
  ('JPY', 'Japanese yen', 'JP', '[1871-06-27,)', NULL, NULL, NULL),
  ('SEK', 'Swedish krona', 'SE', '[1873-01-01,)', NULL, NULL, NULL),
  ('NOK', 'Norwegian krone', 'NO', '[1875-01-01,)', NULL, NULL, NULL),
  ('DKK', 'Danish krone', 'DK', '[1875-01-01,)', NULL, NULL, NULL),
  ('FRF', 'French (new) franc', 'FR', '[1960-01-01,2002-01-01)', 'EUR', 6.55957, 'fixed 31 Dec 1998'),
  ('AFRF', 'French franc before 1960 (ancien franc)', 'FR', '[1795-04-07,1960-01-01)', 'FRF', 100, '100 old francs = 1 new franc, 1 Jan 1960 — prices before 1960 are in old francs'),
  ('DEM', 'Deutsche Mark', 'DE', '[1948-06-21,2002-01-01)', 'EUR', 1.95583, 'fixed 31 Dec 1998'),
  ('RM', 'Reichsmark', 'DE', '[1924-08-30,1948-06-21)', 'DEM', 10, '10 RM = 1 DM for prices and wages (1948 currency reform; savings at 100:6.5)'),
  ('ITL', 'Italian lira', 'IT', '[1861-01-01,2002-01-01)', 'EUR', 1936.27, 'fixed 31 Dec 1998'),
  ('NLG', 'Dutch guilder', 'NL', '[1816-01-01,2002-01-01)', 'EUR', 2.20371, 'fixed 31 Dec 1998'),
  ('BEF', 'Belgian franc', 'BE', '[1832-06-05,2002-01-01)', 'EUR', 40.3399, 'fixed 31 Dec 1998'),
  ('ATS', 'Austrian schilling', 'AT', '[1925-03-01,2002-01-01)', 'EUR', 13.7603, 'fixed 31 Dec 1998; 1938–1945 the Reichsmark');

CREATE TABLE exchange_rates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  currency text NOT NULL REFERENCES currencies(code) ON UPDATE CASCADE,
  quote text NOT NULL REFERENCES currencies(code) ON UPDATE CASCADE,
  period daterange NOT NULL CHECK (NOT isempty(period) AND NOT lower_inf(period)),
  rate numeric NOT NULL CHECK (rate > 0),          -- 1 unit of currency = rate units of quote
  source_id bigint REFERENCES bibliography(id) ON DELETE RESTRICT,
  note text,
  CHECK (currency <> quote),
  EXCLUDE USING gist (currency WITH =, quote WITH =, period WITH &&)
);
COMMENT ON TABLE exchange_rates IS 'historical exchange rates (090): one rate per pair and day (exclusion constraint); empty until a cited source is loaded';

CREATE TABLE price_indices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  period daterange NOT NULL CHECK (NOT isempty(period) AND NOT lower_inf(period)),
  value numeric NOT NULL CHECK (value > 0),
  base text,                                        -- e.g. 'Dec 2020 = 100' — values of one series share it
  source_id bigint REFERENCES bibliography(id) ON DELETE RESTRICT,
  note text,
  EXCLUDE USING gist (country WITH =, period WITH &&)
);
COMMENT ON TABLE price_indices IS 'consumer price indices per country (090), one value per day (exclusion constraint); empty until a cited source is loaded';

GRANT SELECT ON currencies, exchange_rates, price_indices TO arthistory_api;

-- prices name a known currency (no prices are recorded yet; the admin form says which codes there are)
ALTER TABLE provenance ADD CONSTRAINT provenance_price_currency_fkey
  FOREIGN KEY (price_currency) REFERENCES currencies(code) ON UPDATE CASCADE;

-- 1 unit of a in b on a day: a rate stored either way round (the inverse of b in a)
CREATE FUNCTION rate_on(a text, b text, d date) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN a = b THEN 1 ELSE coalesce(
    (SELECT rate FROM exchange_rates WHERE currency = a AND quote = b AND period @> d),
    (SELECT 1 / rate FROM exchange_rates WHERE currency = b AND quote = a AND period @> d)) END
$$;

CREATE FUNCTION index_on(ctry text, d date) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT value FROM price_indices WHERE country = ctry AND period @> d
$$;

-- amount (currency, date) → target currency at target date: converted on the date, then adjusted by the price index
-- of the target currency's country (for a target date after the newest index value: the newest). NULL when a rate
-- or an index is missing — and for a target without a country (EUR: indices are national).
CREATE FUNCTION price_value(amount numeric, cur text, on_date date, target text DEFAULT 'CHF', target_date date DEFAULT current_date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT round(amount * rate_on(cur, target, on_date)
               * index_on(t.country, least(target_date, (SELECT max(lower(period)) FROM price_indices WHERE country = t.country)))
               / index_on(t.country, on_date), 2)
  FROM currencies t
  WHERE t.code = target AND amount IS NOT NULL AND on_date IS NOT NULL
$$;
COMMENT ON FUNCTION price_value IS 'a price at a date in a target currency at a target date (090): converted then, adjusted by the price index; NULL without data';

-- the recorded prices with their value in today's Swiss francs (NULL until rates and indices are loaded); the
-- date is the start of the acquisition (a price "1904" counts from 1 Jan 1904)
CREATE VIEW provenance_prices AS
  SELECT p.id AS provenance_id, p.artwork_id, p.price, p.price_currency, p.price_note, p.acquired, p.acquired_label,
         lower(p.acquired) AS priced_on,
         price_value(p.price, p.price_currency, lower(p.acquired), 'CHF') AS chf_today
  FROM provenance p
  WHERE p.price IS NOT NULL;
COMMENT ON VIEW provenance_prices IS 'recorded prices, chf_today = value in today''s CHF when rates and indices exist (090)';
GRANT SELECT ON provenance_prices TO arthistory_api;
