// Four more ways to draw one network (2026-11-23, owner: "the network view is the one that also obsidian uses — but
// people do criticize that view … try out some visualisation options"). The free force layout ("hairball") is good
// at showing clusters, bad at reading names, order and time. Each view here answers what it can't:
//   rings    — a radial tree around the centre: its links on the first ring in sectors by kind of link, the next step
//              outside (ego networks drawn as radial trees; links across the tree bundled towards the middle, after
//              Holten 2006, "Hierarchical edge bundling")
//   outline  — the same tree as a mind map, left to right: centre → kind of link → entries → their links; reads like a
//              list, also for hundreds of entries
//   timeline — entries on a time axis in lanes by kind (artists, people, works …), a life or a period as a bar, the
//              links as arcs: who came before whom (a "semantic substrate", Shneiderman & Aris 2006; arcs after
//              Wattenberg's arc diagrams, 2002)
//   matrix   — one row and one column per entry, a coloured cell per link: the dense networks where lines only tangle
//              (Ghoniem, Fekete & Castagliola 2004: matrices beat node-link drawings on dense graphs for most tasks)
// Each draws into the zoomed group and hands back its nodes and links, so the page keeps one side panel, one
// selection, one zoom and full screen for all of them.
import type { Selection } from 'd3-selection';
import type { SimulationNodeDatum } from 'd3-force';
import type { Category, GraphNode } from '../types';
import type { GEdge, GNode } from '../graph-group';
import { href, TYPE_LABEL } from '../html';

export type Node = GNode & SimulationNodeDatum & { degree: number };
export type Edge = Omit<GEdge, 'source' | 'target'> & { source: Node | string; target: Node | string; index?: number };
export const radius = (n: Node) => (n.depth === 0 ? 13 : n.bundle ? 9 + 2.2 * Math.sqrt(n.bundle.members.length) : 6 + Math.min(n.degree, 8));

export const VIEWS = ['free', 'rings', 'outline', 'timeline', 'matrix'] as const;
export type View = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<View, string> = { free: 'Free', rings: 'Rings', outline: 'Outline', timeline: 'Timeline', matrix: 'Matrix' };
export const VIEW_HELP: Record<View, string> = {
  free: 'entries pull on each other like springs: clusters show, the layout changes every time',
  rings: 'the centre in the middle, its links on the first ring in sectors by kind of link, the next step outside; links across the rings curve through the middle',
  outline: 'a mind map: the centre, then one branch per kind of link, then their links in turn; each entry appears once, links between branches are listed in the side panel',
  timeline: 'entries on a time axis in rows by kind — a life, a reign or a period as a bar, a work at its date; arcs are the links (undated entries at the right)',
  matrix: 'one row and one column per entry, a coloured cell for each link — for dense networks where lines tangle; hover a cell to read it',
};

type G = Selection<SVGGElement, unknown, null, undefined>;
export interface LayoutCtx {
  viewport: G;
  nodes: Node[];
  edges: Edge[];
  root: Node;
  catOrder: Category[];
  catLabel: Record<string, string>;
  width: number;
}
export interface Drawn {
  nodeSel: Selection<SVGAElement, Node, SVGGElement, unknown>;
  linkSel: Selection<SVGElement, Edge, SVGGElement, unknown>;
  /** how the first view is framed: centred, or from the top left (outlines, timelines, matrices are read from there);
   *  never smaller than `min` — the rest is a drag away, the text stays readable */
  fit: { anchor: 'centre' | 'top-left'; min: number };
}

const S = (e: Edge) => e.source as Node;
const T = (e: Edge) => e.target as Node;
const yearOf = (n: Node) => n.period?.from_year ?? n.period?.to_year ?? null;
const byDateName = (a: Node, b: Node) => (yearOf(a) ?? 99999) - (yearOf(b) ?? 99999) || a.name.localeCompare(b.name);
const textW = (s: string, bold = false) => s.length * (bold ? 7.4 : 6.4);
const short = (s: string, max = 34) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** A spanning tree from the centre (breadth first): each entry hangs on the entry it was first reached from; the
 *  centre's children sorted by kind of link, the rest by date. */
function spanningTree(ctx: LayoutCtx) {
  const { root, nodes, edges, catOrder } = ctx;
  const adj = new Map<Node, { n: Node; e: Edge }[]>(nodes.map((n) => [n, []]));
  for (const e of edges) {
    adj.get(S(e))?.push({ n: T(e), e });
    adj.get(T(e))?.push({ n: S(e), e });
  }
  const rank = (c: Category) => { const i = catOrder.indexOf(c); return i < 0 ? 99 : i; };
  const parent = new Map<Node, { p: Node; e: Edge }>();
  const children = new Map<Node, Node[]>(nodes.map((n) => [n, []]));
  const seen = new Set([root]);
  let level = [root];
  while (level.length) {
    const next: Node[] = [];
    for (const p of level) {
      const out = (adj.get(p) ?? []).filter((x) => !seen.has(x.n))
        .sort((a, b) => (p === root ? rank(a.e.category) - rank(b.e.category) : 0) || byDateName(a.n, b.n));
      for (const { n, e } of out) {
        if (seen.has(n)) continue;
        seen.add(n);
        parent.set(n, { p, e });
        children.get(p)!.push(n);
        next.push(n);
      }
    }
    level = next;
  }
  const treeEdges = new Set([...parent.values()].map((x) => x.e));
  return { parent, children, treeEdges, reached: seen };
}

function nodeGroup(g: G, nodes: Node[], cls = '') {
  const sel = g.append('g').attr('class', `nodes ${cls}`).selectAll<SVGAElement, Node>('a').data(nodes).join((enter) => enter.append<SVGAElement>('a'))
    .attr('href', (n) => (n.bundle ? '#' : href(n.type, n.slug)))
    .attr('class', (n) => `node node-${n.type}${n.depth === 0 ? ' root' : ''}${n.bundle ? ' bundle' : ''}`);
  sel.append('title').text((n) => (n.bundle ? `${n.name} (click to list them)` : `${n.name} (${TYPE_LABEL[n.type]}${n.period ? `, ${n.period.label}` : ''})`));
  return sel;
}
function edgeTitle<T extends SVGElement>(sel: Selection<T, Edge, SVGGElement, unknown>) {
  sel.append('title').text((e) => e.rels.slice(0, 6).map((r) => `${nameIn(e, r.source)} ${r.label} ${nameIn(e, r.target)}${r.period ? ` ${r.period.label}` : ''}`).join('\n')
    + (e.rels.length > 6 ? `\n… ${e.rels.length - 6} more` : ''));
}
const nameIn = (e: Edge, id: string) => (S(e).id === id ? S(e).name : T(e).id === id ? T(e).name : id.split('/')[1] ?? id);
const edgeClass = (e: Edge) => `edge cat-${e.category}${e.uncertain ? ' uncertain' : ''}${e.implied ? ' implied' : ''}`;

// ---- rings ----------------------------------------------------------------------------------------------------
export function rings(ctx: LayoutCtx): Drawn {
  const { viewport, nodes, edges, root, catLabel } = ctx;
  const { parent, children, treeEdges, reached } = spanningTree(ctx);
  const shown = nodes.filter((n) => reached.has(n));
  // leaves in depth-first order give the angles; a parent sits at the middle of its leaves
  const leaves: Node[] = [];
  const walk = (n: Node) => { const c = children.get(n)!; if (!c.length && n !== root) leaves.push(n); c.forEach(walk); };
  walk(root);
  const depthOf = new Map<Node, number>([[root, 0]]);
  for (const n of shown) { let d = 0, x: Node | undefined = n; while (x && x !== root) { d++; x = parent.get(x)?.p; } depthOf.set(n, d); }
  const maxDepth = Math.max(1, ...depthOf.values());
  // room for every name around the outside, and at least 75 px a step (a provenance chain runs six steps deep)
  const outer = Math.max(220, (leaves.length * 15) / (2 * Math.PI), (maxDepth + 0.5) * 75);
  // branches on rings between the centre and the outer ring: step 1 at a third, the last before the leaves
  const ring = (d: number) => (d === 0 ? 0 : outer * (d / (maxDepth + 0.5)));
  const angle = new Map<Node, number>();
  leaves.forEach((n, i) => angle.set(n, (i / Math.max(1, leaves.length)) * 2 * Math.PI));
  const angOf = (n: Node): number => {
    if (angle.has(n)) return angle.get(n)!;
    const c = children.get(n)!;
    const a = c.length ? (angOf(c[0]) + angOf(c[c.length - 1])) / 2 : 0;
    angle.set(n, a);
    return a;
  };
  const isLeaf = new Set(leaves);
  for (const n of shown) {
    // every end of the tree on the outer ring, where each name has its own angle; a branch at its own step
    const a = angOf(n) - Math.PI / 2, r = isLeaf.has(n) ? outer : ring(depthOf.get(n)!);
    n.x = r * Math.cos(a);
    n.y = r * Math.sin(a);
  }
  root.x = root.y = 0;

  // sectors: the centre's kinds of link as coloured arcs inside the first ring
  const sectors = new Map<Category, Node[]>();
  for (const c of children.get(root)!) { const cat = parent.get(c)!.e.category; (sectors.get(cat) ?? sectors.set(cat, []).get(cat)!).push(c); }
  const leafSpan = (n: Node): [number, number] => {
    const own = leaves.filter((l) => { let x: Node | undefined = l; while (x && x !== n) x = parent.get(x)?.p; return x === n; });
    const as = (own.length ? own : [n]).map((l) => angle.get(l)!);
    return [Math.min(...as), Math.max(...as)];
  };
  const step = (2 * Math.PI) / Math.max(1, leaves.length);
  const sec = viewport.append('g').attr('class', 'ring-sectors');
  for (const [cat, ns] of sectors) {
    const spans = ns.map(leafSpan);
    const a0 = Math.min(...spans.map((s) => s[0])) - step * 0.4 - Math.PI / 2, a1 = Math.max(...spans.map((s) => s[1])) + step * 0.4 - Math.PI / 2;
    const r = Math.min(55, ring(1) * 0.55);
    const arc = `M${r * Math.cos(a0)},${r * Math.sin(a0)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${r * Math.cos(a1)},${r * Math.sin(a1)}`;
    sec.append('path').attr('class', `sector cat-${cat}`).attr('d', arc);
    const am = (a0 + a1) / 2;
    if (a1 - a0 < 0.35) continue;   // a sliver: its colour says enough
    sec.append('text').attr('class', `sector-label cat-${cat}`).attr('x', 70 * Math.cos(am)).attr('y', 70 * Math.sin(am))
      .attr('text-anchor', Math.cos(am) >= 0 ? 'start' : 'end').attr('dy', '0.35em').text(catLabel[cat] ?? cat);
  }

  // tree links as radial curves; links across the tree bundled towards the middle, faint until selected
  const drawn = edges.filter((e) => reached.has(S(e)) && reached.has(T(e)));
  const linkSel = viewport.insert('g', ':first-child').attr('class', 'edges').selectAll<SVGPathElement, Edge>('path').data(drawn).join('path')
    .attr('class', (e) => `${edgeClass(e)}${treeEdges.has(e) ? '' : ' cross'}`)
    .attr('d', (e) => {
      const s = S(e), t = T(e);
      if (treeEdges.has(e)) {
        const [p, c] = parent.get(t)?.p === s ? [s, t] : [t, s];
        const rp = Math.hypot(p.x!, p.y!), rc = Math.hypot(c.x!, c.y!), rm = (rp + rc) / 2;
        const ap = Math.atan2(p.y!, p.x!), ac = Math.atan2(c.y!, c.x!);
        return p === root ? `M0,0L${c.x},${c.y}` : `M${p.x},${p.y}C${rm * Math.cos(ap)},${rm * Math.sin(ap)} ${rm * Math.cos(ac)},${rm * Math.sin(ac)} ${c.x},${c.y}`;
      }
      return `M${s.x},${s.y}Q${(s.x! + t.x!) * 0.15},${(s.y! + t.y!) * 0.15} ${t.x},${t.y}`;
    });
  edgeTitle(linkSel);

  const nodeSel = nodeGroup(viewport, shown);
  nodeSel.attr('transform', (n) => `translate(${n.x},${n.y})`);
  nodeSel.append('circle').attr('r', (n) => (n === root ? 13 : n.bundle ? 8 : 5));
  nodeSel.filter((n) => !!n.bundle).append('text').attr('class', 'count').attr('text-anchor', 'middle').attr('dy', '0.35em').text((n) => String(n.bundle!.members.length));
  // names at the ends point outwards, on the left half turned round so they read left to right; a branch's name sits
  // level above its dot (along a chain the radial names would run into each other)
  const branches = nodeSel.filter((n) => n !== root && !isLeaf.has(n));
  branches.append('text').attr('class', 'name').attr('text-anchor', 'middle').attr('y', -10).text((n) => short(n.bundle ? n.name.replace(/^\d+ /, '') : n.name, 30));
  nodeSel.filter((n) => n !== root && isLeaf.has(n)).append('text').attr('class', 'name').attr('dy', '0.35em')
    .attr('transform', (n) => {
      const a = (Math.atan2(n.y!, n.x!) * 180) / Math.PI, left = Math.abs(a) > 90;
      return `rotate(${left ? a + 180 : a})`;
    })
    .attr('x', (n) => (Math.abs(Math.atan2(n.y!, n.x!)) > Math.PI / 2 ? -1 : 1) * ((n.bundle ? 8 : 5) + 4))
    .attr('text-anchor', (n) => (Math.abs(Math.atan2(n.y!, n.x!)) > Math.PI / 2 ? 'end' : 'start'))
    .text((n) => short(n.bundle ? n.name.replace(/^\d+ /, '') : n.name, 38));
  nodeSel.filter((n) => n === root).append('text').attr('class', 'name').attr('text-anchor', 'middle').attr('y', 28).text(root.name);
  return { nodeSel, linkSel: linkSel as unknown as Drawn['linkSel'], fit: { anchor: 'centre', min: 0.55 } };
}

// ---- outline (mind map) --------------------------------------------------------------------------------------
export function outline(ctx: LayoutCtx): Drawn {
  const { viewport, edges, root, catLabel, catOrder } = ctx;
  const { parent, children, treeEdges, reached } = spanningTree(ctx);
  // the centre's children grouped under a heading per kind of link
  interface Item { node?: Node; cat?: Category; kids: Item[]; x: number; y: number; level: number }
  const groups = new Map<Category, Item>();
  const top: Item = { node: root, kids: [], x: 0, y: 0, level: 0 };
  const build = (n: Node, level: number): Item => ({ node: n, kids: children.get(n)!.map((c) => build(c, level + 1)), x: 0, y: 0, level });
  for (const c of children.get(root)!) {
    const cat = parent.get(c)!.e.category;
    const g = groups.get(cat) ?? (() => { const it: Item = { cat, kids: [], x: 0, y: 0, level: 1 }; groups.set(cat, it); return it; })();
    g.kids.push(build(c, 2));
  }
  top.kids = [...groups.values()].sort((a, b) => catOrder.indexOf(a.cat!) - catOrder.indexOf(b.cat!));
  // columns as wide as their longest name; rows 22 px; a parent in the middle of its children
  const colW: number[] = [];
  const measure = (it: Item) => {
    const w = it.node ? textW(short(it.node.name, 44), it.node === root) : textW(catLabel[it.cat!] ?? it.cat!);
    colW[it.level] = Math.max(colW[it.level] ?? 0, w);
    it.kids.forEach(measure);
  };
  measure(top);
  const colX: number[] = [0];
  for (let i = 1; i < colW.length; i++) colX[i] = colX[i - 1] + (i === 1 ? 40 : colW[i - 1] + 60);
  let row = 0;
  const place = (it: Item) => {
    it.x = colX[it.level];
    if (!it.kids.length) { it.y = row++ * 22; return; }
    it.kids.forEach(place);
    it.y = (it.kids[0].y + it.kids[it.kids.length - 1].y) / 2;
  };
  place(top);
  const items: Item[] = [];
  const all = (it: Item) => { items.push(it); it.kids.forEach(all); };
  all(top);
  const itemOf = new Map(items.filter((i) => i.node).map((i) => [i.node!, i]));
  for (const it of items) if (it.node) { it.node.x = it.x; it.node.y = it.y; }
  // where a line leaves an item: after its name (names sit right of their dots)
  const crossN = new Map<Node, number>();
  for (const e of edges) if (!treeEdges.has(e) && reached.has(S(e)) && reached.has(T(e))) { crossN.set(S(e), (crossN.get(S(e)) ?? 0) + 1); crossN.set(T(e), (crossN.get(T(e)) ?? 0) + 1); }
  const note = (n: Node) => ((crossN.get(n) ?? 0) > 0 && n !== root ? `+${crossN.get(n)} link${crossN.get(n) === 1 ? '' : 's'}` : '');
  const outX = (it: Item) => it.x + (it.node ? 8 + textW(short(it.node.name, 44), it.node === root) + (note(it.node) ? 8 + note(it.node).length * 5.6 : 0) : textW(catLabel[it.cat!] ?? it.cat!) + 6);
  const curve = (a: Item, b: Item) => { const x0 = outX(a) + 4, x1 = b.x - 7, xm = (x0 + x1) / 2; return `M${x0},${a.y}C${xm},${a.y} ${xm},${b.y} ${x1},${b.y}`; };

  // the lines: graph edges of the tree; the centre's go through their heading
  const drawn = edges.filter((e) => treeEdges.has(e));
  const linkSel = viewport.insert('g', ':first-child').attr('class', 'edges outline-edges').selectAll<SVGPathElement, Edge>('path').data(drawn).join('path')
    .attr('class', edgeClass)
    .attr('d', (e) => {
      const [p, c] = parent.get(T(e))?.p === S(e) ? [S(e), T(e)] : [T(e), S(e)];
      const pc = itemOf.get(c)!;
      if (p === root) {
        const g = groups.get(parent.get(c)!.e.category)!;
        return curve(g, pc);
      }
      return curve(itemOf.get(p)!, pc);
    });
  edgeTitle(linkSel);
  // headings: the kind of link, joined to the centre
  const heads = viewport.append('g').attr('class', 'outline-heads');
  for (const g of groups.values()) {
    heads.append('path').attr('class', `edge cat-${g.cat}`).attr('d', curve(top, g));
    heads.append('text').attr('class', `outline-head cat-${g.cat}`).attr('x', g.x).attr('y', g.y).attr('dy', '0.35em')
      .text(`${catLabel[g.cat!] ?? g.cat} (${g.kids.length})`);
  }
  const nodeSel = nodeGroup(viewport, [...itemOf.keys()]);
  nodeSel.attr('transform', (n) => `translate(${n.x},${n.y})`);
  nodeSel.append('circle').attr('r', (n) => (n === root ? 8 : n.bundle ? 6 : 4));
  nodeSel.append('text').attr('class', 'name').attr('x', (n) => (n === root ? 12 : 8)).attr('dy', '0.35em')
    .text((n) => short(n.name, 44));
  // entries linked across branches: a small note after the name (the side panel lists them)
  nodeSel.filter((n) => !!note(n)).append('text').attr('class', 'outline-more').attr('dy', '0.35em')
    .attr('x', (n) => 14 + textW(short(n.name, 44))).text(note);
  return { nodeSel, linkSel: linkSel as unknown as Drawn['linkSel'], fit: { anchor: 'top-left', min: 0.8 } };
}

// ---- timeline -------------------------------------------------------------------------------------------------
const LANE_LABEL: Partial<Record<GraphNode['type'], string>> = { movement: 'Movements', event: 'Events', polity: 'States', artist: 'Artists',
  person: 'People', institution: 'Institutions', artwork: 'Works', literature: 'Literary works', place: 'Places', term: 'Terms', source: 'Sources' };
const LANES: GraphNode['type'][] = ['movement', 'event', 'polity', 'artist', 'person', 'institution', 'artwork', 'literature', 'place', 'term', 'source'];
export function timeline(ctx: LayoutCtx): Drawn {
  const { viewport, nodes, edges, root, width } = ctx;
  const dated = nodes.filter((n) => yearOf(n) != null && !n.bundle);
  const years = dated.flatMap((n) => [n.period!.from_year, n.period!.to_year].filter((y): y is number => y != null));
  const thisYear = new Date().getFullYear();
  const y0 = years.length ? Math.min(...years) : thisYear - 100, y1 = years.length ? Math.max(...years) : thisYear;
  const span = Math.max(10, y1 - y0);
  const pad = Math.max(2, Math.round(span * 0.03));
  const from = y0 - pad, to = y1 + pad;
  const pxPerYear = Math.min(14, Math.max(1.2, (Math.max(width, 900) - 420) / (to - from)));
  const X = (y: number) => (y - from) * pxPerYear;
  const end = X(to);
  // each entry: a bar from its start to its end (a work: its date), the name after it; packed into rows per lane
  const barOf = (n: Node): [number, number] => {
    const a = n.period!.from_year ?? n.period!.to_year!, b = n.period!.to_year ?? (['institution', 'polity', 'movement'].includes(n.type) ? Math.max(a, y1) : a);
    return [X(a), Math.max(X(b), X(a) + 3)];
  };
  const lanes = LANES.filter((t) => dated.some((n) => n.type === t));
  let top = 40;
  const label = viewport.append('g').attr('class', 'timeline-lanes');
  for (const t of lanes) {
    const rows: number[] = [];   // the x where each row is free again
    const mine = dated.filter((n) => n.type === t).sort((a, b) => barOf(a)[0] - barOf(b)[0]);
    for (const n of mine) {
      const [a, b] = barOf(n);
      const need = b + 10 + textW(short(n.name, 30), n === root);
      let r = rows.findIndex((free) => free <= a);
      if (r < 0) { r = rows.length; rows.push(0); }
      rows[r] = need;
      n.x = a;
      n.y = top + 14 + r * 20;
    }
    label.append('rect').attr('class', 'lane').attr('x', -150).attr('y', top).attr('width', end + 150 + 240).attr('height', Math.max(1, rows.length) * 20 + 10);
    label.append('text').attr('class', 'lane-label').attr('x', -140).attr('y', top + 16).text(LANE_LABEL[t] ?? TYPE_LABEL[t]);
    top += Math.max(1, rows.length) * 20 + 18;
  }
  // undated entries (and bundles) in a column after the axis
  const undated = nodes.filter((n) => !dated.includes(n));
  const ux = end + 40;
  if (undated.length) label.append('text').attr('class', 'lane-label').attr('x', ux).attr('y', 28).text('No date');
  undated.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)).forEach((n, i) => { n.x = ux; n.y = 44 + i * 20; });
  // the axis: a tick every 10, 25, 50, 100 … years, whatever fits about every 90 px
  const axis = viewport.append('g').attr('class', 'timeline-axis');
  const stepY = [1, 5, 10, 25, 50, 100, 200, 250, 500, 1000].find((s) => s * pxPerYear >= 70) ?? 1000;
  for (let y = Math.ceil(from / stepY) * stepY; y <= to; y += stepY) {
    axis.append('line').attr('x1', X(y)).attr('x2', X(y)).attr('y1', 22).attr('y2', Math.max(top, 44 + undated.length * 20));
    axis.append('text').attr('x', X(y)).attr('y', 16).attr('text-anchor', 'middle').text(y < 0 ? `${-y} BC` : String(y));
  }
  // links as arcs between the starts of two bars, above the higher one
  const linkSel = viewport.append('g').attr('class', 'edges timeline-edges').selectAll<SVGPathElement, Edge>('path').data(edges).join('path')
    .attr('class', edgeClass)
    .attr('d', (e) => {
      const s = S(e), t = T(e);
      const lift = Math.min(80, 18 + Math.abs(t.x! - s.x!) * 0.15);
      const cy = Math.min(s.y!, t.y!) - lift;
      return `M${s.x},${s.y}C${s.x},${cy} ${t.x},${cy} ${t.x},${t.y}`;
    });
  edgeTitle(linkSel);
  const nodeSel = nodeGroup(viewport, nodes);
  nodeSel.attr('transform', (n) => `translate(${n.x},${n.y})`);
  nodeSel.filter((n) => dated.includes(n)).append('rect').attr('class', 'bar').attr('x', 0).attr('y', -4).attr('height', 8).attr('rx', 3)
    .attr('width', (n) => barOf(n)[1] - barOf(n)[0]);
  nodeSel.append('circle').attr('r', (n) => (n === root ? 6 : 3.5));
  nodeSel.append('text').attr('class', 'name').attr('dy', '0.35em')
    .attr('x', (n) => (dated.includes(n) ? barOf(n)[1] - barOf(n)[0] + 6 : 8))
    .text((n) => short(n.bundle ? n.name : n.name, 30));
  return { nodeSel, linkSel: linkSel as unknown as Drawn['linkSel'], fit: { anchor: 'top-left', min: 0.75 } };
}

// ---- matrix ---------------------------------------------------------------------------------------------------
export function matrix(ctx: LayoutCtx): Drawn {
  const { viewport, nodes, edges, root } = ctx;
  // the centre first, then by kind, within a kind the best linked first (a block of cells shows a cluster)
  const order = [...nodes].sort((a, b) => (a === root ? -1 : b === root ? 1 : 0) || LANES.indexOf(a.type) - LANES.indexOf(b.type) || b.degree - a.degree || byDateName(a, b));
  const idx = new Map(order.map((n, i) => [n, i]));
  const cell = Math.max(11, Math.min(18, Math.floor(900 / Math.max(1, order.length))));
  const labelW = Math.min(240, 16 + Math.max(...order.map((n) => textW(short(n.name, 32)))));
  order.forEach((n, i) => { n.x = 0; n.y = i * cell + cell / 2; });
  const g = viewport.append('g').attr('class', 'matrix').attr('transform', `translate(${labelW},${labelW})`);
  // kinds of entry as bands
  let start = 0;
  for (let i = 1; i <= order.length; i++) {
    if (i < order.length && order[i].type === order[start].type && order[start] !== root) continue;
    g.append('rect').attr('class', `matrix-band node-${order[start].type}`).attr('x', 0).attr('y', start * cell).attr('width', order.length * cell).attr('height', (i - start) * cell);
    g.append('rect').attr('class', `matrix-band node-${order[start].type}`).attr('y', 0).attr('x', start * cell).attr('height', order.length * cell).attr('width', (i - start) * cell);
    start = i;
  }
  g.append('rect').attr('class', 'matrix-frame').attr('width', order.length * cell).attr('height', order.length * cell);
  // one cell each way round: the row's entry is the subject of the link
  const cells = edges.flatMap((e) => [{ e, r: idx.get(S(e))!, c: idx.get(T(e))! }, { e, r: idx.get(T(e))!, c: idx.get(S(e))! }]);
  const linkSel = g.append('g').attr('class', 'edges matrix-cells').selectAll<SVGRectElement, Edge>('rect').data(cells.map((x) => x.e)).join('rect')
    .attr('class', (e) => `${edgeClass(e)} cell`)
    .attr('x', (_, i) => cells[i].c * cell + 0.5).attr('y', (_, i) => cells[i].r * cell + 0.5)
    .attr('width', cell - 1).attr('height', cell - 1);
  edgeTitle(linkSel);
  // names on the left (rows) and on top (columns, turned)
  const rowsSel = nodeGroup(g, order, 'matrix-rows');
  rowsSel.attr('transform', (n) => `translate(-6,${idx.get(n)! * cell + cell / 2})`);
  rowsSel.append('text').attr('class', 'name').attr('text-anchor', 'end').attr('dy', '0.35em').text((n) => short(n.name, 32));
  const colsSel = nodeGroup(g, order, 'matrix-cols');
  colsSel.attr('transform', (n) => `translate(${idx.get(n)! * cell + cell / 2},-6) rotate(-60)`);
  colsSel.append('text').attr('class', 'name').attr('dy', '0.35em').text((n) => short(n.name, 32));
  const both = g.selectAll<SVGAElement, Node>('.matrix-rows a, .matrix-cols a');
  return { nodeSel: both as unknown as Drawn['nodeSel'], linkSel: linkSel as unknown as Drawn['linkSel'], fit: { anchor: 'top-left', min: 0.7 } };
}

export const LAYOUTS: Record<Exclude<View, 'free'>, (ctx: LayoutCtx) => Drawn> = { rings, outline, timeline, matrix };
