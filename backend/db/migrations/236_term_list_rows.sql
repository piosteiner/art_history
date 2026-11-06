-- 236 — The glossary's stored list rows anew (234 renamed "style" in the enum, 235 added also_in to the list): renaming an
-- enum value changes no row, so nothing queued them.
INSERT INTO list_queue (type, id) SELECT 'term', id FROM glossary;
INSERT INTO derived_queue (type, id) SELECT 'term', id FROM glossary;
