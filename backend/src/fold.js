// Text folded for comparing in searches: lowercase, accents off (é è ê → e), letters without a separate accent
// spelled out (æ → ae, ø → o, ß → ss, ł → l, œ → oe, đ → d, þ → th …), compatibility forms (ligatures, full-width),
// typographic apostrophes and dashes as plain ones. Same rules as the database's f_unaccent() (migration 080) and the
// site's frontend/src/fold.ts. Shared by the admin's browser bundle.
const SPELLED = { ß: 'ss', ẞ: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ø: 'o', Ø: 'o', ł: 'l', Ł: 'l', đ: 'd', Đ: 'd',
  ð: 'd', Ð: 'd', þ: 'th', Þ: 'th', ı: 'i', ħ: 'h', Ħ: 'h' };
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/[ßẞæÆœŒøØłŁđĐðÐþÞıħĦ]/g, (c) => SPELLED[c])
  .replace(/[’‘ʼ`´]/g, "'").replace(/[‐‑‒–—―]/g, '-')
  .toLowerCase();

module.exports = { fold };
