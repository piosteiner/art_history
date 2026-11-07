// One rule for slugs made from a name (2026-11-07 — before, three copies with small differences: ß was dropped by
// the server and spelled "ss" by the editor): folded like the searches (src/fold.js: accents off, æ → ae, ß → ss,
// ligatures and full-width letters plain), lower case, runs of anything else as one hyphen, at most `max` characters.
//   slugify('Édouard Manet')   → 'edouard-manet'
//   slugify('Straße')          → 'strasse'
// The editor's slug field (src/admin/editor/slug.js) follows the same rule as you type.
const { fold } = require('./fold');

const slugify = (s, max = 80) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

module.exports = { slugify };
