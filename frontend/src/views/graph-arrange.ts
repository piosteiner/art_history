// Arrange (2026-11-24, owner: "a new graph similar to the obsidian one but each node can be shown and hidden and the
// nodes can be moved with the earlier nodes always taking the later nodes with them but if a later node is moved the
// earlier stays. so the user can arrange the tree to their liking").
//   - "earlier" and "later" come from the spanning tree the other tree views use: each entry hangs on the entry it was
//     first reached from, starting at the centre. Dragging an entry moves its whole branch; its ancestors stay put.
//   - the layout is a radial tree loosened once by forces (organic like Obsidian), then it holds still: nothing
//     drifts while you arrange it.
//   - hide an entry, fold away its branch ("+N" on the entry), spread a branch out again — right-click / long-press
//     or the side panel; hidden entries are listed in the side panel to bring back.
//   - hovering an entry marks its path back to the centre; names fade when zoomed far out.
//   - the arrangement (positions, hidden, folded) is kept in this browser per centre — localStorage, a convenience
//     only: without it the view works the same and starts fresh.
//   - shared as a link (2026-11-25, API 259 /v1/arrangements): `&arr=<code>` opens someone's arrangement; it stays off
//     this browser's own arrangement until the visitor changes it — then it becomes theirs.
import { drag } from 'd3-drag';
import { forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { Selection } from 'd3-selection';
import type { ArrangementState } from '../api';
import { familyKind } from '../graph-group';
import { href, TYPE_LABEL } from '../html';
import { edgeClass, edgeTitle, radius, spanningTree, type Drawn, type Edge, type LayoutCtx, type Node } from './graph-layouts';

export interface ArrangeApi {
  hide(n: Node): void;
  show(id: string): void;
  showAll(): void;
  /** fold away the entries reached through it, or bring them back */
  toggleBranch(n: Node): void;
  folded(n: Node): boolean;
  /** how many entries are reached through it (its branch) */
  branchSize(n: Node): number;
  /** its branch laid out again as a fan away from the entry before it (the centre: the whole tree) */
  spread(n: Node): void;
  /** forget the arrangement: laid out afresh, nothing hidden */
  reset(): void;
  /** where everything is, what is hidden and folded — what a shared link stores */
  state(): ArrangementState;
  /** still the arrangement a link opened, unchanged (not kept in this browser) */
  fromLink(): boolean;
  hidden(): Node[];
  visible(n: Node): boolean;
  onChange(fn: () => void): void;
  onZoom(k: number): void;
}

type Saved = ArrangementState;
const KEY = (root: Node) => `graph-arrange:v1:${root.id}`;
const load = (root: Node): Saved | null => {
  try { const s = localStorage.getItem(KEY(root)); return s ? JSON.parse(s) as Saved : null; } catch { return null; }
};
const store = (root: Node, s: Saved | null) => {
  try { if (s) localStorage.setItem(KEY(root), JSON.stringify(s)); else localStorage.removeItem(KEY(root)); } catch { /* private window, full storage */ }
};

const S = (e: Edge) => e.source as Node;
const T = (e: Edge) => e.target as Node;

export function arrange(ctx: LayoutCtx & { height: number; menuHost: HTMLElement; shared?: Saved | null }): Drawn & { api: ArrangeApi } {
  const { viewport, nodes, edges, root, width, height } = ctx;
  const { parent, children } = spanningTree(ctx);
  // entries the walk didn't reach from the centre (a family member joined later) hang on the centre
  for (const n of nodes) if (n !== root && !parent.has(n)) { children.get(root)!.push(n); parent.set(n, { p: root, e: null as unknown as Edge }); }
  const treeEdges = new Set([...parent.values()].map((x) => x.e).filter(Boolean));
  const branch = (n: Node): Node[] => children.get(n)!.flatMap((c) => [c, ...branch(c)]);
  const sizes = new Map<Node, number>();
  const size = (n: Node): number => sizes.get(n) ?? sizes.set(n, children.get(n)!.reduce((a, c) => a + 1 + size(c), 0)).get(n)!;

  const hidden = new Set<string>();
  const foldedSet = new Set<string>();
  const visible = (n: Node) => {
    if (hidden.has(n.id)) return false;
    for (let p = parent.get(n)?.p; p; p = parent.get(p)?.p) if (foldedSet.has(p.id)) return false;
    return true;
  };

  // ---- layout -----------------------------------------------------------------------------------------------------
  // a fan: the entry's children on an arc away from the entry before it, each given room by the size of its branch
  function fan(n: Node, dir: number, spreadAngle: number) {
    const kids = children.get(n)!;
    if (!kids.length) return;
    const weight = (k: Node) => Math.sqrt(1 + size(k));
    const total = kids.reduce((a, k) => a + weight(k), 0);
    const dist = Math.min(700, Math.max(n === root ? 140 : 90, (kids.length * 38) / spreadAngle));
    let a = dir - spreadAngle / 2;
    for (const k of kids) {
      const share = (spreadAngle * weight(k)) / total;
      const ang = a + share / 2;
      k.x = n.x! + dist * Math.cos(ang);
      k.y = n.y! + dist * Math.sin(ang);
      fan(k, ang, Math.min(Math.PI * 0.9, Math.max(share * 1.6, 0.9)));
      a += share;
    }
  }
  function freshLayout() {
    root.x = width / 2;
    root.y = height / 2;
    fan(root, -Math.PI / 2, Math.PI * 2);
    // loosened once: each entry held near its place in the fan (the tree keeps its shape), neighbours pushed apart
    // only close by — overlaps ease, branches don't pull together; then it holds still
    const home = new Map(nodes.map((n) => [n, [n.x!, n.y!] as const]));
    const anchor = (alpha: number) => {
      for (const n of nodes) { const [x, y] = home.get(n)!; n.vx! += (x - n.x!) * alpha * 0.25; n.vy! += (y - n.y!) * alpha * 0.25; }
    };
    const sim = forceSimulation(nodes)
      .force('link', forceLink<Node, Edge>(edges.filter((e) => treeEdges.has(e))).distance(80).strength(0.15))
      .force('charge', forceManyBody<Node>().strength(-90).distanceMax(110))
      .force('collide', forceCollide<Node>().radius((n) => radius(n) + 20).strength(0.8))
      .force('anchor', anchor)
      .stop();
    root.fx = root.x;
    root.fy = root.y;
    sim.tick(120);
    for (const n of nodes) { n.fx = n.fy = undefined; n.vx = n.vy = 0; }
  }
  let linked = !!ctx.shared?.pos[root.id];   // opened from a shared link, not changed yet
  const saved = linked ? ctx.shared! : load(root);
  if (saved && saved.pos[root.id]) {
    saved.hidden.forEach((id) => hidden.add(id));
    saved.folded.forEach((id) => foldedSet.add(id));
    // the entries kept where they were; new ones (more steps, an opened bundle) next to the entry before them
    const placeNew = (n: Node) => {
      for (const k of children.get(n)!) {
        const p = saved.pos[k.id];
        if (p) [k.x, k.y] = p;
        else {
          const ang = Math.random() * Math.PI * 2;
          k.x = n.x! + 70 * Math.cos(ang);
          k.y = n.y! + 70 * Math.sin(ang);
        }
        placeNew(k);
      }
    };
    [root.x, root.y] = saved.pos[root.id];
    placeNew(root);
  } else freshLayout();
  const state = (): Saved => ({
    pos: Object.fromEntries(nodes.map((n) => [n.id, [Math.round(n.x!), Math.round(n.y!)] as [number, number]])),
    hidden: [...hidden], folded: [...foldedSet],
  });
  // a change makes a linked arrangement the visitor's own; until then this browser's own one is left as it was
  const save = (changed = true) => {
    if (changed) linked = false;
    if (!linked) store(root, state());
  };

  // ---- drawing ----------------------------------------------------------------------------------------------------
  const kindOf = new Map(edges.map((e) => [e, familyKind(e.rels)]));
  const linkSel = viewport.append('g').attr('class', 'edges arrange-edges').selectAll<SVGPathElement, Edge>('path').data(edges).join('path')
    .attr('class', (e) => `${edgeClass(e)}${kindOf.get(e) ? ` family-${kindOf.get(e)!.kind}` : ''}${treeEdges.has(e) ? ' tree' : ''}`)
    .attr('marker-end', (e) => (e.directed && !kindOf.get(e) ? `url(#arrow-${e.category})` : null));
  edgeTitle(linkSel);
  const nodeSel = viewport.append('g').attr('class', 'nodes').selectAll<SVGAElement, Node>('a').data(nodes).join((enter) => enter.append<SVGAElement>('a'))
    .attr('href', (n) => (n.bundle ? '#' : href(n.type, n.slug)))
    .attr('data-id', (n) => n.id)
    .attr('class', (n) => `node node-${n.type}${n.depth === 0 ? ' root' : ''}${n.bundle ? ' bundle' : ''}`);
  nodeSel.append('circle').attr('r', radius);
  nodeSel.filter((n) => !!n.bundle).append('text').attr('class', 'count').attr('text-anchor', 'middle').attr('dy', '0.35em').text((n) => String(n.bundle!.members.length));
  nodeSel.append('text').attr('class', 'name').attr('text-anchor', 'middle').attr('dy', (n) => radius(n) + 13)
    .text((n) => (n.bundle ? n.name.replace(/^\d+ /, '') : n.name));
  nodeSel.append('text').attr('class', 'fold-badge').attr('dx', (n) => radius(n) + 3).attr('dy', (n) => -radius(n) + 2);
  nodeSel.append('title').text((n) => (n.bundle ? `${n.name} (click to list them)` : `${n.name} (${TYPE_LABEL[n.type]}${n.period ? `, ${n.period.label}` : ''})`));

  const end = (e: Edge, which: 'x' | 'y') => {   // lines stop at the target's edge so the arrowhead stays visible
    const s = S(e), t = T(e);
    const dx = t.x! - s.x!, dy = t.y! - s.y!, len = Math.hypot(dx, dy) || 1;
    const k = (len - radius(t) - 2) / len;
    return which === 'x' ? s.x! + dx * k : s.y! + dy * k;
  };
  function place() {
    nodeSel.attr('transform', (n) => `translate(${n.x},${n.y})`);
    linkSel.attr('d', (e) => {
      if (kindOf.get(e)?.kind === 'spouse') {   // a double line, as in the free view
        const s = S(e), t = T(e), dx = t.x! - s.x!, dy = t.y! - s.y!, len = Math.hypot(dx, dy) || 1;
        const ox = (-dy / len) * 2, oy = (dx / len) * 2;
        return `M${s.x! + ox},${s.y! + oy}L${t.x! + ox},${t.y! + oy}M${s.x! - ox},${s.y! - oy}L${t.x! - ox},${t.y! - oy}`;
      }
      return `M${S(e).x},${S(e).y}L${end(e, 'x')},${end(e, 'y')}`;
    });
  }
  const listeners: (() => void)[] = [];
  function update(changed = true) {
    nodeSel.classed('gone', (n) => !visible(n));
    linkSel.classed('gone', (e) => !visible(S(e)) || !visible(T(e)));
    nodeSel.select<SVGTextElement>('text.fold-badge').text((n) => (foldedSet.has(n.id) && size(n) ? `+${size(n)}` : ''));
    save(changed);
    listeners.forEach((f) => f());
  }
  place();
  update(false);

  // dragging: the entry and everything reached through it, by the same step; the entries before it stay
  let moving: Node[] = [];
  let dragged = false;
  nodeSel.call(drag<SVGAElement, Node>()
    .on('start', (_ev, n) => { moving = [n, ...branch(n)]; dragged = false; })
    .on('drag', (ev) => {
      dragged = true;
      for (const m of moving) { m.x! += ev.dx; m.y! += ev.dy; }
      place();
    })
    .on('end', () => {
      moving = [];
      if (!dragged) return;   // a click
      const was = linked;
      save();
      if (was) listeners.forEach((f) => f());   // the panel stops calling it a shared arrangement
    }));

  // the path back to the centre, on hover
  const pathTo = (n: Node) => { const out = new Set<Edge>(); for (let x = parent.get(n); x && x.e; x = parent.get(x.p)) out.add(x.e); return out; };
  // links outside the tree are faint until their entry is hovered or selected (they'd cross the whole drawing)
  let picked: Node | null = null;
  const light = (n: Node | null) => linkSel.classed('lit', (e) => !!n && (S(e) === n || T(e) === n) || (!!picked && (S(e) === picked || T(e) === picked)));
  nodeSel.on('mouseenter.arrange', (_ev, n) => { const p = pathTo(n); linkSel.classed('path-to-centre', (e) => p.has(e)); light(n); })
    .on('mouseleave.arrange', () => { linkSel.classed('path-to-centre', false); light(null); })
    .on('click.arrange', (_ev, n) => { picked = n; light(null); });
  viewport.node()!.ownerSVGElement!.addEventListener('click', (ev) => { if (ev.target === viewport.node()!.ownerSVGElement) { picked = null; light(null); } });

  // ---- the menu (right-click, long-press) ---------------------------------------------------------------------------
  const menu = document.createElement('div');
  menu.className = 'arrange-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  ctx.menuHost.append(menu);
  const closeMenu = () => { menu.hidden = true; };
  nodeSel.on('contextmenu', (ev: MouseEvent, n) => {
    ev.preventDefault();
    const host = ctx.menuHost.getBoundingClientRect();
    const kids = size(n);
    menu.innerHTML = '';
    const item = (label: string, fn: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      b.disabled = disabled;
      b.addEventListener('click', () => { closeMenu(); fn(); });
      menu.append(b);
    };
    const head = document.createElement('div');
    head.className = 'arrange-menu-head';
    head.textContent = n.name;
    menu.append(head);
    if (n !== root) item('Hide this entry', () => api.hide(n));
    if (kids) item(foldedSet.has(n.id) ? `Show its branch (${kids})` : `Fold away its branch (${kids})`, () => api.toggleBranch(n));
    if (kids) item(n === root ? 'Lay out the whole tree again' : 'Spread its branch out', () => api.spread(n));
    menu.style.left = `${Math.min(ev.clientX - host.left, host.width - 220)}px`;
    menu.style.top = `${ev.clientY - host.top}px`;
    menu.hidden = false;
    (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
  });
  const outside = (ev: Event) => { if (!menu.contains(ev.target as globalThis.Node)) closeMenu(); };
  const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeMenu(); };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', esc);
  // the menu leaves with the page (the next render replaces the host's content; the listeners check for it)
  const gone = new MutationObserver(() => {
    if (!menu.isConnected) { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc); gone.disconnect(); }
  });
  gone.observe(document.body, { childList: true, subtree: true });

  const api: ArrangeApi = {
    hide(n) { if (n !== root) { hidden.add(n.id); update(); } },
    show(id) { hidden.delete(id); foldedSet.delete(id); update(); },
    showAll() { hidden.clear(); foldedSet.clear(); update(); },
    toggleBranch(n) { if (foldedSet.has(n.id)) foldedSet.delete(n.id); else foldedSet.add(n.id); update(); },
    folded: (n) => foldedSet.has(n.id),
    branchSize: size,
    spread(n) {
      const p = parent.get(n);
      if (!p || !p.p) {
        const [x, y] = [root.x!, root.y!];
        fan(root, -Math.PI / 2, Math.PI * 2);
        root.x = x; root.y = y;
      } else fan(n, Math.atan2(n.y! - p.p.y!, n.x! - p.p.x!), Math.PI * 0.9);
      place();
      update();
    },
    reset() {
      hidden.clear();
      foldedSet.clear();
      store(root, null);
      freshLayout();
      place();
      update();
    },
    state,
    fromLink: () => linked,
    hidden: () => nodes.filter((n) => hidden.has(n.id) || foldedSet.has(n.id)),
    visible,
    onChange(fn) { listeners.push(fn); },
    onZoom(k) { (viewport.node()!.ownerSVGElement as SVGSVGElement).classList.toggle('names-far', k < 0.35); },
  };
  return {
    nodeSel: nodeSel as unknown as Selection<SVGAElement, Node, SVGGElement, unknown>,
    linkSel: linkSel as unknown as Drawn['linkSel'],
    fit: { anchor: 'centre', min: 0.25 },
    api,
  };
}
