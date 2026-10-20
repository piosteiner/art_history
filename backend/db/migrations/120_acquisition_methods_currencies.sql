-- 120 — What the French and Italian museums' provenances need that we couldn't record (owner, 2026-10-20: "if there
-- is something in the provenance of a new artwork that we can't recreate, create the option to do so"):
--   find            found or dug up: a chance find on someone's land (the Venus de Milo, 1820), an excavation (the
--                   Victory of Samothrace, 1863) — the first holder after the work was lost
--   partage         the division of excavation finds between the excavators and the host country (the Louvre's
--                   "partage après fouilles": the Code of Hammurabi from Susa)
--   spoils_of_war   taken in war or handed over under a peace treaty as a war contribution (the Louvre's "conquête
--                   militaire": Veronese's Wedding at Cana, Campo Formio 1797) — distinct from a confiscation by a
--                   state of its own subjects' property
--   in_lieu         accepted in payment of a tax (French "dation en paiement", 1968 law; British "acceptance in lieu"):
--                   Vermeer's Astronomer from Guy de Rothschild, 1983
-- ALTER TYPE … ADD VALUE: an enum value is added in place (no table rewrite); usable once this migration commits.
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'find' BEFORE 'unknown';
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'partage' BEFORE 'unknown';
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'spoils_of_war' BEFORE 'unknown';
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'in_lieu' BEFORE 'unknown';

-- Currencies the sources quote prices in before the national currencies (090 has the modern ones). Codes only, no
-- rates (📌 pinned: historical rates need a citable source per currency). Codes of 2–4 letters (090): LIV, SCU, DUC, FIOR, PIA.
INSERT INTO currencies (code, name, country, note) VALUES
  ('LIV', 'Livre tournois', 'FR', 'France until the franc (1795); 1 livre = 20 sols = 240 deniers — enter as decimal livres'),
  ('SCU', 'Roman scudo', 'IT', 'Papal States until 1866; 1 scudo = 100 baiocchi'),
  ('DUC', 'Venetian ducat', 'IT', 'Republic of Venice; money of account (ducato corrente) and gold coin (zecchino) — say which in the note'),
  ('FIOR', 'Florentine florin', 'IT', 'Florence (fiorino d''oro) until the 16th century; later the Tuscan scudo and lira'),
  ('PIA', 'Ottoman piastre (kuruş)', 'TR', 'Ottoman Empire, also in the Levant and the Aegean islands')
ON CONFLICT (code) DO NOTHING;
