// What the explore page shows: per type all, none or a chosen list. Lives in the URL so views can be shared:
// #/?artists=vincent-van-gogh,paul-gauguin&movements=none  (a missing parameter means "all").
import { PLURAL } from './api';
import type { EntityType } from './types';

export type Group = Extract<EntityType, 'artist' | 'artwork' | 'movement' | 'polity' | 'patron'>;
export const GROUPS: Group[] = ['artist', 'artwork', 'movement', 'polity', 'patron'];

/** `by-artists` (artworks only): the works of whichever artists are selected — follows the artist picker. */
export type Pick = { mode: 'all' } | { mode: 'none' } | { mode: 'some'; slugs: string[] } | { mode: 'by-artists' };
export type Selection = Record<Group, Pick>;

export const ALL: Selection = {
  artist: { mode: 'all' }, artwork: { mode: 'all' }, movement: { mode: 'all' }, polity: { mode: 'all' }, patron: { mode: 'all' },
};

const isGroup = (t: string): t is Group => (GROUPS as string[]).includes(t);

export function parseSelection(params: URLSearchParams): Selection {
  const sel = { ...ALL };
  for (const g of GROUPS) {
    const v = params.get(PLURAL[g]);
    if (v === null || v === 'all') continue;
    if (v === 'by-artists' && g === 'artwork') {
      sel[g] = { mode: 'by-artists' };
      continue;
    }
    const slugs = v.split(',').map((s) => s.trim()).filter(Boolean);
    sel[g] = v === 'none' || !slugs.length ? { mode: 'none' } : { mode: 'some', slugs: [...new Set(slugs)] };
  }
  return sel;
}

/** Writes the selection into `params` (removing "all" groups, which are the default). */
export function writeSelection(sel: Selection, params: URLSearchParams) {
  for (const g of GROUPS) {
    const p = sel[g];
    if (p.mode === 'all') params.delete(PLURAL[g]);
    else params.set(PLURAL[g], p.mode === 'some' ? p.slugs.join(',') : p.mode);
  }
}

/**
 * Whether an entity of any type passes the selection (types without a picker always do).
 * `creatorOf` gives an artwork's artist, for the "works by the chosen artists" mode.
 */
export function includes(sel: Selection, type: EntityType, slug: string, creatorOf?: (artwork: string) => string | null | undefined): boolean {
  if (!isGroup(type)) return true;
  const p = sel[type];
  if (p.mode === 'by-artists') {
    const artist = creatorOf?.(slug);
    return !!artist && includes(sel, 'artist', artist);
  }
  return p.mode === 'all' || (p.mode === 'some' && p.slugs.includes(slug));
}

/** Entities picked one by one, in a stable order (group, then pick order). */
export const chosen = (sel: Selection) =>
  GROUPS.flatMap((g) => {
    const p = sel[g];
    return p.mode === 'some' ? p.slugs.map((slug) => ({ type: g, slug })) : [];
  });

export const isDefault = (sel: Selection) => GROUPS.every((g) => sel[g].mode === 'all');
