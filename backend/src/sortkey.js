// SQL for sorting (migration 061): an entry's sort key — romanized when written in another script, titles without
// their leading article — in the natural collation (ICU: "abbey" before "Zürich", "Édouard" with the e's, "No. 2"
// before "No. 10"). The database's own collation (C.UTF-8) would sort by bytes.
//   sortKey('artwork', 'w', 'title') → entry_sort_key('artwork', w.title, w.title_ruby, w.names, w.title_lang) COLLATE sort_natural
//   natural('o.name')                → o.name COLLATE sort_natural
const keyExpr = (type, alias, col = 'name') => `entry_sort_key('${type}', ${alias}.${col}, ${alias}.${col}_ruby, ${alias}.names, ${alias}.${col}_lang)`;
const sortKey = (type, alias, col = 'name') => `${keyExpr(type, alias, col)} COLLATE sort_natural`;
const natural = (expr) => `${expr} COLLATE sort_natural`;

module.exports = { keyExpr, sortKey, natural };
