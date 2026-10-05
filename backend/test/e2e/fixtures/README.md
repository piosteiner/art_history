# Sample content for the end-to-end tests

A frozen copy of `content/` (as of migration 022) that `global-setup.js` imports into `arthistory_test`. The specs
are written against exactly these entries, so the real snapshot in `content/` can change (every `npm run export`)
without breaking the tests. Edit these files only together with the specs that rely on them.
