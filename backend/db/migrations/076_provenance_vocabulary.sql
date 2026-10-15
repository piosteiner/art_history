-- 076 — Provenance vocabulary for the cases the Kunsthaus Zürich's 20,666 provenance lines document (owner's review,
-- 2026-10-15). Alone: new enum values can't be used in the transaction that adds them; 077 builds on them.
-- Ways a holding begins (or an event in the chain is described):
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'transfer' AFTER 'exchange';      -- Übertragung, Übernahme, Übereignung (to one's foundation …)
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'theft' AFTER 'confiscation';     -- stolen: the thief holds it, the owner keeps the title
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'claim' AFTER 'settlement';       -- a claim raised (events)
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'dissolution' AFTER 'claim';      -- a collection dissolved, a firm wound up (events)
-- Roles:
ALTER TYPE holder_role ADD VALUE IF NOT EXISTS 'publisher';  -- holds an edition and sells it (prints) — of the ownership chain
ALTER TYPE holder_role ADD VALUE IF NOT EXISTS 'foundry';    -- casts and holds a bronze — custody
ALTER TYPE holder_role ADD VALUE IF NOT EXISTS 'trustee';    -- holds in trust or as security (Treuhand, Sicherungsübereignung) — custody
ALTER TYPE holder_role ADD VALUE IF NOT EXISTS 'event';      -- no holder: a claim, a settlement between others, a dissolution
