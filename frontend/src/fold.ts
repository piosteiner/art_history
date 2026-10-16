/**
 * Text folded for comparing in searches: lowercase, accents off ("Dürer" → "durer", "Irène" → "irene"), letters without
 * a separate accent spelled out (æ → ae, ø → o, ß → ss, ł → l, œ → oe, đ → d, þ → th …), compatibility forms
 * (ligatures, full-width letters), typographic apostrophes and dashes as plain ones (d’Anvers = d'Anvers).
 * The same rules as the database (f_unaccent, API migration 080), so the site's and the API's searches agree.
 */
const SPELLED: Record<string, string> = { ß: 'ss', ẞ: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ø: 'o', Ø: 'o', ł: 'l', Ł: 'l',
  đ: 'd', Đ: 'd', ð: 'd', Ð: 'd', þ: 'th', Þ: 'th', ı: 'i', ħ: 'h', Ħ: 'h' };
export const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/[ßẞæÆœŒøØłŁđĐðÐþÞıħĦ]/g, (c) => SPELLED[c])
  .replace(/[’‘ʼ`´]/g, "'").replace(/[‐‑‒–—―]/g, '-')
  .toLowerCase();
