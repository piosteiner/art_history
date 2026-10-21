-- 122 — The API may read the change counter (sequence quality_changes, 058): it keeps the artworks' provenance maps
-- cached (src/routes/map.js) and knows from the counter when the data changed. Reading a sequence's last_value takes
-- no lock and changes nothing.
GRANT SELECT ON SEQUENCE quality_changes TO arthistory_api;
