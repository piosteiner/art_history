-- Empty the test database before a run (as arthistory_owner). TRUNCATE fires no row triggers, so this writes no
-- history; RESTART IDENTITY starts the ids at 1 again. The content is then loaded with scripts/import.js.
TRUNCATE relationships, images, artworks, institutions, artists, patrons, movements, places,
         audit_log, live_docs, admin_drafts, admin_sessions, admin_users
  RESTART IDENTITY CASCADE;
