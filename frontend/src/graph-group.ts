// Grouping for the network view (2026-11-23): what makes a big network readable before it is drawn. Tried on van
// Gogh's network at two steps (424 entries, 1,794 links — 80 % provenance, the walk running from his works through
// their owners to every other work those owners had):
//   1. prune  — an owner, dealer or museum passes the walk on through provenance only when it is the centre: the
//               network of van Gogh keeps who owned his works, not the rest of Vollard's stock
//   2. merge  — one line per pair of entries, all their relationships listed together (owned by + kept in + passed to)
//   3. bundle — works of another artist reached through that artist ("13 works by Paul Gauguin"), and entries of one
//               type with exactly the same neighbours ("12 works", a leaf being the simplest case), become one node
//               that lists its members and opens on a click
// Pure functions on the API's nodes and edges, so they can be tested without a browser.
import type { Category, GraphEdge, GraphNode } from './types';

export interface Bundle {
  /** the entries every member is linked to (1–4); for works of an artist, the artist */
  parents: string[];
  type: GraphNode['type'];
  category: Category;
  members: GraphNode[];
  /** "by Paul Gauguin" for an artist's works */
  by?: string;
}
export type GNode = GraphNode & { bundle?: Bundle };
export interface GEdge {
  source: string;
  target: string;
  category: Category;
  /** every relationship between the two, in the API's order */
  rels: GraphEdge[];
  /** an arrow only when all of them point the same way and none is symmetric */
  directed: boolean;
  uncertain: boolean;
  implied: boolean;
}

const PLURAL_LABEL: Partial<Record<GraphNode['type'], string>> = {
  artwork: 'works', artist: 'artists', person: 'people', institution: 'institutions', movement: 'movements', event: 'events',
  polity: 'states', literature: 'literary works', place: 'places', term: 'terms', source: 'sources',
};
export const bundleName = (b: Bundle) => `${b.members.length} ${b.by === '' ? 'other ' : ''}${PLURAL_LABEL[b.type] ?? b.type}${b.by ? ` by ${b.by}` : ''}`;

const HOLDERS = new Set<GraphNode['type']>(['person', 'institution', 'artist']);

/**
 * The walk again, on what the API sent, with one rule more: provenance leads from a work to its holders, but from a
 * holder (not the centre) to no further works or holders. Entries no longer reached, and their links, drop out;
 * depths are recomputed.
 */
export function pruneProvenance(rootId: string, nodes: GraphNode[], edges: GraphEdge[], depth: number) {
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  const adj = new Map<string, { to: string; e: GraphEdge }[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    adj.get(e.source)?.push({ to: e.target, e });
    adj.get(e.target)?.push({ to: e.source, e });
  }
  const dist = new Map([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    if (d >= depth) continue;
    const stops = cur !== rootId && HOLDERS.has(type.get(cur)!);
    for (const { to, e } of adj.get(cur) ?? []) {
      if (stops && e.category === 'provenance') continue;
      if (!dist.has(to)) {
        dist.set(to, d + 1);
        queue.push(to);
      }
    }
  }
  return {
    nodes: nodes.filter((n) => dist.has(n.id)).map((n) => ({ ...n, depth: dist.get(n.id)! })),
    // links between kept entries stay, except a holder's provenance to works that came in another way
    edges: edges.filter((e) => dist.has(e.source) && dist.has(e.target)),
  };
}

/**
 * Relationships written from the receiving side: their arrow is drawn the other way, so that an arrow always shows
 * what passes on — teacher → student, influence → influenced, parent → child, original → copy, artist → work, author →
 * work (owner 2026-11-23: "Hodler → student of → Menn" read as Hodler teaching Menn). The texts keep the wording.
 */
const FLOWS_BACK = new Set(['student_of', 'influenced_by', 'influenced_by_culture_of', 'inspired_by', 'child_of',
  'copy_after', 'based_on', 'printed_from', 'creator', 'written_by']);
/** The end an arrow starts from. */
export const flowFrom = (r: GraphEdge) => (FLOWS_BACK.has(r.type) ? r.target : r.source);
const flowTo = (r: GraphEdge) => (FLOWS_BACK.has(r.type) ? r.source : r.target);

const OWNED = new Set(['owned_by', 'held_by']);

/**
 * A work's provenance as a chain (2026-11-23, owner: "to have arrows from the artwork to each provenance step seems a
 * bit odd … one arrow and then a line … of all provenance steps"):
 *  - a "passed to" between two owners belongs to one work; it stays only when that work is in the network and linked
 *    to both — otherwise the Louvre's 1793 transfers of other works read as this work's history;
 *  - `chains` (not around a collector or a museum, where the works are bundled by the holder): the work keeps its
 *    arrow only to an owner the chain doesn't reach — its first one, or the first after a gap —, every later owner
 *    hangs on the "passed to" before it; custodians and agents stay beside the work without an arrow.
 */
export function provenanceChains(nodes: GraphNode[], edges: GraphEdge[], { chains = true } = {}) {
  const ids = new Set(nodes.map((n) => n.id));
  const held = new Map<string, Set<string>>();   // work → its owners and custodians in the network
  for (const e of edges) if (OWNED.has(e.type)) (held.get(e.source) ?? held.set(e.source, new Set()).get(e.source)!).add(e.target);
  const kept = edges.filter((e) => e.type !== 'transferred_to'
    || (!!e.artwork && ids.has(e.artwork) && !!held.get(e.artwork)?.has(e.source) && !!held.get(e.artwork)?.has(e.target)));
  if (!chains) return kept;
  const reached = new Set(kept.filter((e) => e.type === 'transferred_to').map((e) => `${e.artwork}\t${e.target}`));
  return kept
    .filter((e) => !(e.type === 'owned_by' && reached.has(`${e.source}\t${e.target}`)))
    .map((e) => (e.type === 'held_by' ? { ...e, beside: true } : e));
}

/**
 * How a family line is drawn: from the parent above to the child below (also when the two are teacher and pupil as
 * well — Kōkei and Unkei), spouses and siblings on one row; null = not a family line.
 */
export function familyKind(rels: GraphEdge[]): { kind: 'parent'; parent: string } | { kind: 'spouse' | 'sibling' | 'relative' } | null {
  const child = rels.find((r) => r.type === 'child_of');
  if (child) return { kind: 'parent', parent: child.target };
  // a family tie stays one beside other links (Theo was Vincent's brother and his patron; a son inherited the works)
  if (!rels.some((r) => r.category === 'family')) return null;
  if (rels.some((r) => r.type === 'married_to')) return { kind: 'spouse' };
  if (rels.some((r) => r.type === 'sibling_of')) return { kind: 'sibling' };
  return { kind: 'relative' };
}

/** Sibling lines the family tree already shows: both children of a parent in the network hang from the parent's bar. */
export function sharedParentSiblings(edges: GraphEdge[]) {
  const parents = new Map<string, Set<string>>();
  for (const e of edges) if (e.type === 'child_of') (parents.get(e.source) ?? parents.set(e.source, new Set()).get(e.source)!).add(e.target);
  return (e: GraphEdge) => e.type === 'sibling_of' && [...(parents.get(e.source) ?? [])].some((p) => parents.get(e.target)?.has(p));
}

/**
 * One edge per pair of entries. The pair's category is that of its first relationship (the API sorts by importance),
 * except that a family tie outranks every other (Theo, Vincent's brother and patron, is drawn as his brother) and a
 * stored relationship outranks the provenance.
 */
export function mergeEdges(edges: GraphEdge[]): GEdge[] {
  const byPair = new Map<string, GEdge>();
  for (const e of edges) {
    const key = e.source < e.target ? `${e.source}\t${e.target}` : `${e.target}\t${e.source}`;
    const m = byPair.get(key);
    if (!m) {
      byPair.set(key, { source: flowFrom(e), target: flowTo(e), category: e.category, rels: [e], directed: !e.symmetric && !e.beside,
        uncertain: !!e.certainty && e.certainty !== 'attested', implied: e.end_basis === 'implied' });
      continue;
    }
    m.rels.push(e);
    if (e.category === 'family' || (m.category === 'provenance' && e.category !== 'provenance')) m.category = e.category;
    if (e.symmetric || e.beside || flowFrom(e) !== m.source) m.directed = false;
    m.uncertain &&= !!e.certainty && e.certainty !== 'attested';   // uncertain only if every link is
    m.implied &&= e.end_basis === 'implied';
  }
  return [...byPair.values()];
}

/** The id a bundle keeps while the network is redrawn, so an opened bundle stays open. */
const keyOf = (b: Pick<Bundle, 'parents' | 'type' | 'by'>) => `bundle:${b.by !== undefined ? `by:${b.by}:` : ''}${b.parents.join('+')}:${b.type}`;

/**
 * Bundles (see the top). `minWorks` for an artist's works, `min` for entries with the same neighbours; `open` = ids
 * of bundles shown as their members; `creators` = each work's artist by work id, for works whose artist is not in
 * the network (around a collector the artists are two steps away and the first to be cut off).
 */
export function bundle(rootId: string, nodes: GraphNode[], edges: GEdge[],
  { min = 5, minWorks = 3, open = new Set<string>() as ReadonlySet<string>, creators = new Map<string, { id: string; name: string }>() as ReadonlyMap<string, { id: string; name: string }> } = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nbrs = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set()]));
  for (const e of edges) {
    nbrs.get(e.source)?.add(e.target);
    nbrs.get(e.target)?.add(e.source);
  }
  const groups = new Map<string, Bundle>();
  const add = (n: GraphNode, b: Omit<Bundle, 'members' | 'category'>) => {
    const id = keyOf(b);
    if (open.has(id)) return false;
    const g = groups.get(id) ?? { ...b, category: 'collaboration' as Category, members: [] };
    g.members.push(n);
    groups.set(id, g);
    return true;
  };
  const taken = new Set<string>();
  // 1. works of another artist: reached through the artist, or — around a collector or a museum — its works, by artist
  const holderRoot = ['person', 'institution'].includes(byId.get(rootId)?.type ?? '');
  for (const n of nodes) {
    const atRoot = nbrs.get(n.id)!.has(rootId);
    if (n.id === rootId || n.type !== 'artwork' || (atRoot && !holderRoot)) continue;
    const creator = edges.flatMap((e) => e.rels).find((r) => r.source === n.id && r.type === 'creator')?.target ?? creators.get(n.id)?.id;
    if (!creator || creator === rootId) continue;
    const shown = byId.has(creator);
    if (!shown && !atRoot) continue;
    const parents = [...(atRoot ? [rootId] : []), ...(shown ? [creator] : [])];
    if (add(n, { parents, type: 'artwork', by: byId.get(creator)?.name ?? creators.get(n.id)?.name ?? '' })) taken.add(n.id);
  }
  for (const [id, g] of groups) if (g.members.length < minWorks) { groups.delete(id); g.members.forEach((m) => taken.delete(m.id)); }
  // around a collector or a museum, its works by artists with fewer than `minWorks` there (or by no known artist)
  if (holderRoot) {
    const rest = nodes.filter((n) => n.type === 'artwork' && n.id !== rootId && !taken.has(n.id) && nbrs.get(n.id)!.has(rootId));
    const b = { parents: [rootId], type: 'artwork' as const, by: '' };
    if (rest.length >= minWorks && !open.has(keyOf(b))) {
      groups.set(keyOf(b), { ...b, category: 'provenance', members: rest });
      rest.forEach((n) => taken.add(n.id));
    }
  }
  // 2. the same neighbours (1–4 of them)
  const same = new Map<string, Bundle>();
  for (const n of nodes) {
    if (n.id === rootId || taken.has(n.id)) continue;
    const ns = [...nbrs.get(n.id)!].sort();
    if (!ns.length || ns.length > 4) continue;
    const b = { parents: ns, type: n.type };
    const id = keyOf(b);
    if (open.has(id)) continue;
    const g = same.get(id) ?? { ...b, category: 'collaboration' as Category, members: [] };
    g.members.push(n);
    same.set(id, g);
  }
  for (const [id, g] of same) if (g.members.length >= min) { groups.set(id, g); g.members.forEach((m) => taken.add(m.id)); }

  const outNodes: GNode[] = nodes.filter((n) => !taken.has(n.id));
  const outEdges: GEdge[] = edges.filter((e) => !taken.has(e.source) && !taken.has(e.target));
  for (const [id, g] of groups) {
    const ids = new Set(g.members.map((m) => m.id));
    const mine = edges.filter((e) => ids.has(e.source) || ids.has(e.target));
    g.category = mostCommon(mine.map((e) => e.category)) ?? 'collaboration';
    outNodes.push({ id, type: g.type, slug: '', name: bundleName(g), kind: null, depth: Math.min(...g.members.map((m) => m.depth)), period: null, bundle: g });
    // one line to each parent and to every other entry still shown that a member is linked to, with all the members'
    // relationships to it, pointing the way most of them do
    // (not to an entry also linked to the centre — the dealer a collector bought from: that triangle only tangles,
    // and the bundle's list says which works it handled)
    const rootNbrs = nbrs.get(rootId) ?? new Set<string>();
    const others = new Set(mine.flatMap((e) => [e.source, e.target])
      .filter((x) => !ids.has(x) && !taken.has(x) && (g.parents.includes(x) || x === rootId || !rootNbrs.has(x))));
    for (const p of others) {
      const lines = mine.filter((e) => e.source === p || e.target === p);
      const rels = lines.flatMap((e) => e.rels);
      const fromP = rels.filter((r) => flowFrom(r) === p).length;
      const out = fromP * 2 >= rels.length;
      outEdges.push({ source: out ? p : id, target: out ? id : p, category: mostCommon(lines.map((e) => e.category)) ?? g.category, rels,
        directed: rels.every((r) => !r.symmetric) && (fromP === 0 || fromP === rels.length), uncertain: false, implied: false });
    }
  }
  return { nodes: outNodes, edges: outEdges, bundles: groups };
}

function mostCommon<T>(xs: T[]): T | undefined {
  const count = new Map<T, number>();
  xs.forEach((x) => count.set(x, (count.get(x) ?? 0) + 1));
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
}
