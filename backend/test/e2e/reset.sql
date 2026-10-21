-- Empty the test database before a run (as arthistory_owner). TRUNCATE fires no row triggers, so this writes no
-- history; RESTART IDENTITY starts the ids at 1 again. The content is then loaded with scripts/import.js.
-- The tables that point at entries by (type, id) — no foreign key, so CASCADE doesn't reach them — are listed too:
-- with the ids starting at 1 again, an old row would belong to a new entry (an old ULAN number on a new artist #6).
TRUNCATE relationships, images, artworks, glossary, bibliography, polities, institutions, artists, people, movements, places, events,
         entry_identifiers, citations, slug_history, wikidata_reviews, auto_created, quality_acks, quality_issues,
         audit_log, live_docs, admin_drafts, admin_sessions, admin_users,
         -- derived data (125): no trigger saw the TRUNCATE — the import queues every entry again
         derived_queue, derived_drift, dup_entries, dup_keys, dup_pairs, entry_search_fields_stored, graph_links,
         entry_list_rows, list_queue
  RESTART IDENTITY CASCADE;
