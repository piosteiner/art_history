// "Crossed paths": two entries at the same place with overlapping dates (Gauguin and Van Gogh in Arles, Oct–Dec 1888),
// found in the dated presence links the maps already load. Left out: an artwork with its own artist, and two artworks.
import type { DateRange, EntityType, Ref } from './types';

export interface Stay {
  entity: { type: EntityType; slug: string; name: string };
  place: Ref;
  label: string; // "lived in"
  period: DateRange | null;
  note?: string | null;
}

export interface Encounter {
  place: Ref;
  a: Stay;
  b: Stay;
  from: number; // overlap, as days since 1970 (UTC)
  to: number;
  when: string; // "23 October – 25 December 1888", or "1887" when only years are known
  days: number;
  /** At least one of the dates is only known to the year (or "c."): the overlap is possible, not certain. */
  approximate: boolean;
}

const DAY = 86_400_000;
const today = Math.floor(Date.now() / DAY);

/** Days since 1970 for an ISO date, also BCE ("-0500-01-01"). */
function days(iso: string) {
  const m = /^(-?\d+)-(\d\d)-(\d\d)/.exec(iso);
  if (!m) return NaN;
  const d = new Date(0);
  d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.floor(d.getTime() / DAY);
}

/** Year-only or circa dates ("1887", "1886–1890", "c. 1831", "17th century"): good to the year at best. */
const coarse = (p: DateRange) => /^\s*(c\.\s*)?-?\d{1,4}(\s*[–-]\s*-?\d{1,4})?\s*$|c\.|century/i.test(p.label);

function range(p: DateRange | null): [number, number] | null {
  if (!p) return null;
  const a = p.from ? days(p.from) : p.from_year != null ? days(`${p.from_year}-01-01`) : NaN;
  const b = p.to ? days(p.to) : p.to_year != null ? days(`${p.to_year}-12-31`) : today; // open end: ongoing
  return Number.isNaN(a) || Number.isNaN(b) ? null : [a, b];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateOf = (n: number) => new Date(n * DAY);
const yearLabel = (y: number) => (y < 0 ? `${-y} BCE` : String(y));

/** "23 October – 25 December 1888", "1887", "1886–1888". */
function describe(from: number, to: number, approximate: boolean) {
  const a = dateOf(from), b = dateOf(to);
  const [ya, yb] = [a.getUTCFullYear(), b.getUTCFullYear()];
  if (approximate) return ya === yb ? yearLabel(ya) : `${yearLabel(ya)}–${yearLabel(yb)}`;
  const day = (d: Date, withYear: boolean) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${yearLabel(d.getUTCFullYear())}` : ''}`;
  if (from === to) return day(a, true);
  return `${day(a, ya !== yb)} – ${day(b, true)}`;
}

/** "9 weeks", "3 years". */
export function duration(n: number) {
  if (n < 14) return `${n + 1} ${n ? 'days' : 'day'}`;
  if (n < 90) return `${Math.round(n / 7)} weeks`;
  if (n < 730) return `${Math.round(n / 30.4)} months`;
  return `${Math.round(n / 365.25)} years`;
}

export interface FindOptions {
  /** An artwork's artist: their pair isn't an encounter. */
  creatorOf?: (artwork: string) => string | null | undefined;
  /** Only overlaps within these years (inclusive), clipped to them. */
  window?: { from: number; to: number } | null;
}

export function findEncounters(stays: Stay[], opts: FindOptions = {}): Encounter[] {
  const win = opts.window ? [days(`${opts.window.from}-01-01`), days(`${opts.window.to}-12-31`)] as const : null;
  const byPlace = new Map<string, { stay: Stay; r: [number, number] }[]>();
  for (const stay of stays) {
    const r = range(stay.period);
    if (r) byPlace.set(stay.place.slug, [...(byPlace.get(stay.place.slug) ?? []), { stay, r }]);
  }
  const key = (s: Stay) => `${s.entity.type}/${s.entity.slug}`;
  const out: Encounter[] = [];
  const seen = new Set<string>();
  for (const list of byPlace.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [x, y] = [list[i], list[j]];
        if (key(x.stay) === key(y.stay)) continue;
        // two works made in the same place say nothing about a relationship (their artists' stays do)
        if (x.stay.entity.type === 'artwork' && y.stay.entity.type === 'artwork') continue;
        const [art, other] = x.stay.entity.type === 'artwork' ? [x.stay, y.stay] : [y.stay, x.stay];
        if (art.entity.type === 'artwork' && other.entity.type === 'artist' && opts.creatorOf?.(art.entity.slug) === other.entity.slug) continue;
        let from = Math.max(x.r[0], y.r[0]);
        let to = Math.min(x.r[1], y.r[1]);
        if (win) [from, to] = [Math.max(from, win[0]), Math.min(to, win[1])];
        if (from > to) continue;
        // people before works, then by name, so the sentence reads the same way every time
        const [a, b] = [x.stay, y.stay].sort((p, q) => Number(p.entity.type === 'artwork') - Number(q.entity.type === 'artwork') || p.entity.name.localeCompare(q.entity.name));
        const id = `${x.stay.place.slug}|${key(a)}|${key(b)}|${from}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const approximate = coarse(x.stay.period!) || coarse(y.stay.period!);
        out.push({ place: x.stay.place, a, b, from, to, days: to - from, approximate, when: describe(from, to, approximate) });
      }
    }
  }
  // certain ones first, then in date order
  return out.sort((p, q) => Number(p.approximate) - Number(q.approximate) || p.from - q.from);
}

/** The entries an encounter is about, as route keys ("artist/vincent-van-gogh"). */
export const encounterKeys = (e: Encounter) => [`${e.a.entity.type}/${e.a.entity.slug}`, `${e.b.entity.type}/${e.b.entity.slug}`];
