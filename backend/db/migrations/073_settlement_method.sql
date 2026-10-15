-- 073 — A way to acquire (or keep) a work: settlement. Seen in the Kunsthaus Zürich's Gauguin provenances: the
-- Foundation E.G. Bührle Collection agreed with Richard Semmel's heirs (2025) — the painting, sold under Nazi
-- persecution, stays; a "just and fair solution" (Washington Principles) rather than a restitution. A step of the
-- same holder with this method records it; 074 lets it answer the forced-sale check like a restitution.
-- On its own: a new enum value can't be used in the transaction that adds it (each migration is one transaction).
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'settlement' AFTER 'restitution';
