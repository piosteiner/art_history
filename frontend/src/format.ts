// Numbers and dates written out, the same way everywhere (2026-11-07 — before, four files had their own `day`, three
// their own `plural`). Dates come from the API as ISO strings; shown in British English, the site's language.
//   plural(3, 'entry', 'entries') → "3 entries"      plural(1, 'card') → "1 card"
//   day('2026-11-05T09:00:00Z')  → "5 November 2026"
//   longDay('2026-11-17')         → "Monday, 17 November 2026"  (a date without a time: noon, so no zone shifts the day)
//   at(iso)                       → "5 Nov 2026, 09:00"          when(iso) → "5 Nov, 09:00"  (chat lines)

export const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

const EN = 'en-GB';
export const day = (iso: string) => new Date(iso).toLocaleDateString(EN, { day: 'numeric', month: 'long', year: 'numeric' });
export const longDay = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString(EN, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const at = (iso: string) => new Date(iso).toLocaleString(EN, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const when = (iso: string) => new Date(iso).toLocaleString(EN, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
