-- 012 — Remembered decisions from comparing an entry with Wikidata (src/admin/wikidata.js).
--
-- Nothing from Wikidata is taken without review, and the editor's own values win: when a Wikidata value is declined,
-- that is remembered here together with the value itself — the next comparison shows it folded away ("you kept
-- yours"), and offers it again only if Wikidata's value has changed since.
--   item   what was compared: a field ("birth"), an image ("image"), or a suggestion ("rel:born_in:Q9883")
--   value  Wikidata's value at the time (jsonb, compared with the current one)
CREATE TABLE wikidata_reviews (
  entity_type entity_type NOT NULL,
  entity_id   bigint NOT NULL,
  item        text NOT NULL,
  value       jsonb NOT NULL,
  decision    text NOT NULL CHECK (decision IN ('declined', 'accepted')),
  decided_by  bigint REFERENCES admin_users ON DELETE SET NULL,
  decided_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, item)
);

REVOKE ALL ON wikidata_reviews FROM arthistory_api;
