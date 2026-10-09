// Drag and drop in Firefox (cases: sortable-cases.js).
const { test } = require('./helpers');

test.use({ browserName: 'firefox' });
require('./sortable-cases').dragTests();
