-- 121 — A gift made under duress (owner, 2026-10-20, as 120: "if there is something in the provenance … we can't
-- recreate, create the option"). Raphael's Marriage of the Virgin: in 1798 the town of Città di Castello was
-- "practically forced" to have the altarpiece removed and give it to the Napoleonic general Giuseppe Lechi. Neither a
-- gift (freely given) nor a forced sale (there was no price) — provenance research names it apart (German
-- "Zwangsschenkung"; also the "gifts" extorted from persecuted owners 1933–1945). The site counts it as taken.
ALTER TYPE acquisition_method ADD VALUE IF NOT EXISTS 'forced_gift' AFTER 'forced_sale';
