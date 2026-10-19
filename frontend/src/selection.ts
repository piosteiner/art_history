// What the explore page shows: per type all, none or a chosen list. Lives in the URL so views can be shared:
// /?artists=vincent-van-gogh,paul-gauguin&movements=none  (a missing parameter means "all").
import { PLURAL } from './api';
import type { EntityType } from './types';

export type Group = Extract<EntityType, 'artist' | 'artwork' | 'movement' | 'polity' | 'person'>;
export const GROUPS: Group[] = ['artist', 'artwork', 'movement', 'polity', 'person'];
/**
 * Layers drawn over the entries: museums and sites, events. Not routes of their own — they accompany the entries:
 * `auto` (their default) is museums linked to what the map shows, events in the time window (else the selection's span).
 */
export type Layer = Extract<EntityType, 'institution' | 'event'>;
export const LAYERS: Layer[] = ['institution', 'event'];
export type Key = Group | Layer;

/** `by-artists` (artworks only): the works of whichever artists are selected — follows the artist picker. */
export type Pick = { mode: 'all' } | { mode: 'none' } | { mode: 'some'; slugs: string[] } | { mode: 'by-artists' } | { mode: 'auto' };
export type Selection = Record<Key, Pick>;

export const ALL: Selection = {
  artist: { mode: 'all' }, artwork: { mode: 'all' }, movement: { mode: 'all' }, polity: { mode: 'all' }, person: { mode: 'all' },
  institution: { mode: 'auto' }, event: { mode: 'auto' },
};

const isGroup = (t: string): t is Group => (GROUPS as string[]).includes(t);
export const isLayer = (t: string): t is Layer => (LAYERS as string[]).includes(t);
/** What a missing parameter means: everything for the entries, the automatic choice for the layers. */
export const defaultPick = (k: Key): Pick => (isLayer(k) ? { mode: 'auto' } : { mode: 'all' });

export function parseSelection(params: URLSearchParams): Selection {
  const sel = { ...ALL };
  for (const g of [...GROUPS, ...LAYERS]) {
    // "patrons=" in links and remembered views from before patrons became people
    const v = params.get(PLURAL[g]) ?? (g === 'person' ? params.get('patrons') : null);
    if (v === null) continue;
    if (v === 'all') {
      sel[g] = { mode: 'all' };
      continue;
    }
    if (v === 'auto' && isLayer(g)) {
      sel[g] = { mode: 'auto' };
      continue;
    }
    if (v === 'by-artists' && g === 'artwork') {
      sel[g] = { mode: 'by-artists' };
      continue;
    }
    const slugs = v.split(',').map((s) => s.trim()).filter(Boolean);
    sel[g] = v === 'none' || !slugs.length ? { mode: 'none' } : { mode: 'some', slugs: [...new Set(slugs)] };
  }
  return sel;
}

/** Writes the selection into `params` (leaving out what is the default: "all" entries, "auto" layers). */
export function writeSelection(sel: Selection, params: URLSearchParams) {
  for (const g of [...GROUPS, ...LAYERS]) {
    const p = sel[g];
    if (g === 'person') params.delete('patrons');
    if (p.mode === defaultPick(g).mode) params.delete(PLURAL[g]);
    else params.set(PLURAL[g], p.mode === 'some' ? p.slugs.join(',') : p.mode);
  }
}

/**
 * Whether an entity of any type passes the selection (types without a picker always do).
 * `artistsOf` gives an artwork's artists (main creator and co-creators), for the "works by the chosen artists" mode.
 */
export function includes(sel: Selection, type: EntityType, slug: string, artistsOf?: (artwork: string) => string[] | undefined): boolean {
  if (!isGroup(type)) return true;
  const p = sel[type];
  if (p.mode === 'by-artists') return (artistsOf?.(slug) ?? []).some((artist) => includes(sel, 'artist', artist));
  return p.mode === 'all' || (p.mode === 'some' && p.slugs.includes(slug));
}

/** Entities picked one by one, in a stable order (group, then pick order). */
export const chosen = (sel: Selection) =>
  GROUPS.flatMap((g) => {
    const p = sel[g];
    return p.mode === 'some' ? p.slugs.map((slug) => ({ type: g, slug })) : [];
  });

export const isDefault = (sel: Selection) => [...GROUPS, ...LAYERS].every((g) => sel[g].mode === defaultPick(g).mode);

/** Whether a layer's entry (a museum, an event) is shown; `auto`: what the automatic choice has picked. */
export function layerIncludes(sel: Selection, layer: Layer, slug: string, auto: (slug: string) => boolean): boolean {
  const p = sel[layer];
  return p.mode === 'all' || (p.mode === 'some' && p.slugs.includes(slug)) || (p.mode === 'auto' && auto(slug));
}
