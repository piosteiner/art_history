// The network around one entry (/v1/graph/<type>/<slug>): who influenced whom, studied where, belonged to which
// movement, was supported by which patron, made which work, owned it after whom (provenance) … laid out with d3-force.
// /graph/artists/vincent-van-gogh (?depth=1–4, ?categories=…)
//   click a node: details and its links in the side panel · double-click: center the network on it
//   Ctrl/Cmd/middle click: open its page in a new tab · drag nodes · wheel/pinch zooms, drag the background pans
import { drag } from 'd3-drag';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { select } from 'd3-selection';
import { reducedMotion } from '../theme';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { getGraph, getVocabulary, listAll, PLURAL } from '../api';
import { escape, href, html, impliedEnd, link, render, TYPE_LABEL } from '../html';
import type { Category, GraphEdge, GraphNode, Plural } from '../types';
import { bundle, familyKind, mergeEdges, provenanceChains, pruneProvenance, sharedParentSiblings, type GEdge, type GNode } from '../graph-group';
import { findAll } from '../search';
import { guard, loading, showError } from './common';
import { navigate } from '../router';

// place links are map material (presence/association), the API leaves them out of graphs by default
const GRAPH_CATEGORIES: Category[] = ['family', 'influence', 'education', 'collaboration', 'membership', 'patronage', 'publication', 'depiction', 'provenance', 'architecture', 'polity', 'event', 'literature'];
const CATEGORY_LABEL: Record<string, string> = {
  family: 'Family', influence: 'Influence', education: 'Education', collaboration: 'Collaboration', membership: 'Movements & groups',
  patronage: 'Patronage', depiction: 'Depictions', provenance: 'Collections', architecture: 'Buildings', publication: 'Publishers', polity: 'States & nationality', event: 'Events', literature: 'Literature',
};

type Node = GNode & SimulationNodeDatum & { degree: number };
type Edge = Omit<GEdge, 'source' | 'target'> & SimulationLinkDatum<Node> & { source: Node | string; target: Node | string };

const radius = (n: Node) => (n.depth === 0 ? 13 : n.bundle ? 9 + 2.2 * Math.sqrt(n.bundle.members.length) : 6 + Math.min(n.degree, 8));
// Readable networks (2026-11-23, tried on screenshots of van Gogh, Japonisme, Hokusai, Bührle, the Kunsthaus and
// The Starry Night): owners pass on no provenance, one line per pair, bundles, names only for the main entries (the
// rest on hover or around the selected one), a free layout — rings by distance crowded everything into one corner.

export function graph(main: HTMLElement, plural: Plural | undefined, slug: string | undefined, params: URLSearchParams) {
  if (!plural || !slug) {
    render(main, html`<section class="page graph-start"><h1>Network</h1>
      <p>The network shows who influenced whom, who studied where, belonged to which movement, was supported by which patron, made or appears in which work,
      and which collectors, dealers and museums owned a work one after another. Every entry has one: search for where to start.</p>
      <form class="graph-search" role="search"><input type="search" placeholder="Start from an artist, a work, a movement, a collector…" aria-label="Start the network from"
        autocomplete="off"><ul class="plain-list graph-search-results"></ul></form>
      <h2>For example</h2>
      <ul class="plain-list graph-examples">
        <li><a href="/graph/artists/vincent-van-gogh">Vincent van Gogh</a> <span class="muted">— his teachers, friends, works and who owned them</span></li>
        <li><a href="/graph/movements/japonisme">Japonisme</a> <span class="muted">— Japanese prints and the painters in Europe who took them up</span></li>
        <li><a href="/graph/people/emil-georg-buhrle">Emil Bührle</a> <span class="muted">— a collection and where its works came from</span></li>
        <li><a href="/graph/artists/katsushika-hokusai">Katsushika Hokusai</a> <span class="muted">— pupils, series and the painters he influenced</span></li>
        <li><a href="/graph/events/tani-buncho-manpachiro-gathering-1792">Tani Bunchō's gathering, 1792</a> <span class="muted">— a painting-and-calligraphy party and its people</span></li>
      </ul></section>`);
    const input = main.querySelector<HTMLInputElement>('.graph-search input')!;
    const list = main.querySelector<HTMLElement>('.graph-search-results')!;
    const NO_GRAPH = new Set(['place', 'term', 'source']);
    let asked = 0;
    let timer: number | undefined;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const q = input.value.trim();
        const mine = ++asked;
        if (q.length < 2) return render(list, html``);
        const { local, similar } = await findAll(q);
        if (mine !== asked) return;
        const hits = [...local.map(({ e }) => ({ type: e.type, slug: e.slug, name: e.name })), ...similar.map((h) => ({ type: h.type, slug: h.slug, name: h.name }))]
          .filter((h) => !NO_GRAPH.has(h.type)).slice(0, 12);
        render(list, hits.length ? html`${hits.map((h) => html`<li><a href="/graph/${PLURAL[h.type]}/${encodeURIComponent(h.slug)}">${h.name}</a>
          <span class="muted">${TYPE_LABEL[h.type]}</span></li>`)}` : html`<li class="muted">Nothing found.</li>`);
      }, 200);
    });
    main.querySelector('form')!.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const a = list.querySelector<HTMLAnchorElement>('a');
      if (a) navigate(a.getAttribute('href')!);
    });
    input.focus();
    return;
  }
  loading(main);
  const current = guard();
  // a collector's or a museum's own works and owners are already hundreds: one step; everything else two
  const holder = plural === 'people' || plural === 'institutions';
  const depth = Math.min(Math.max(Number(params.get('depth')) || (holder ? 1 : 2), 1), 4);
  // provenance is the story of a work, a collector or a museum; around an artist or a movement it drowns the rest
  // (van Gogh: 1,428 of 1,794 links), so there it is off until ticked
  // (van Gogh: 1,428 of 1,794 links), so there it is off until ticked; states (nationality) only around a state —
  // elsewhere France links every French artist two steps away
  const defaultCats = GRAPH_CATEGORIES.filter((c) => (c !== 'provenance' || ['artworks', 'people', 'institutions'].includes(plural)) && (c !== 'polity' || plural === 'polities'));
  const chosenCats = params.get('categories')?.split(',').filter((c): c is Category => (GRAPH_CATEGORIES as string[]).includes(c)) ?? null;
  const open = new Set<string>();   // bundles opened by a click
  const creators = new Map<string, { id: string; name: string }>();
  let stop: (() => void) | undefined;

  getVocabulary()
    .then(async (vocab) => {
      const cats = chosenCats ?? defaultCats;
      const types = cats.length !== GRAPH_CATEGORIES.length ? vocab.filter((v) => cats.includes(v.category)).map((v) => v.code) : undefined;
      // each work's artist, for bundling works whose artist the network doesn't reach (the list the search uses too)
      const [g, works] = await Promise.all([getGraph(plural, slug, depth, types), listAll('artworks').catch(() => null)]);
      if (!current()) return;
      creators.clear();
      for (const w of works?.data ?? []) if (w.creator) creators.set(`artwork/${w.slug}`, { id: `artist/${w.creator.slug}`, name: w.creator.name });
      const redraw = () => {
        stop?.();
        stop = draw(g.root, g.nodes, g.edges, g.truncated, depth, cats, redraw);
      };
      redraw();
    })
    .catch((err) => current() && showError(main, err));

  function setParams(next: { depth?: number; categories?: Category[] }) {
    const p = new URLSearchParams();
    p.set('depth', String(next.depth ?? depth));
    const c = next.categories ?? chosenCats;
    if (c && (c.length !== defaultCats.length || c.some((x) => !defaultCats.includes(x)))) p.set('categories', c.join(','));
    navigate(`/graph/${plural}/${encodeURIComponent(slug!)}?${p.toString().replace(/%2C/g, ',')}`);
  }

  function draw(rootId: string, nodesIn: GraphNode[], edgesIn: GraphEdge[], truncated: boolean, depthNow: number, cats: Category[], redraw: () => void) {
    const known = new Set(nodesIn.map((n) => n.id));
    const sent = edgesIn.filter((e) => known.has(e.source) && known.has(e.target));
    const walked = pruneProvenance(rootId, nodesIn, sent, depthNow);
    const raw = walked.edges;
    const holderRoot = ['person', 'institution'].includes(nodesIn.find((n) => n.id === rootId)?.type ?? '');
    const shown = sharedParentSiblings(raw);
    const grouped = bundle(rootId, walked.nodes, mergeEdges(provenanceChains(walked.nodes, raw, { chains: !holderRoot }).filter((e) => !shown(e))), { open, creators });
    const nodes: Node[] = grouped.nodes.map((n) => ({ ...n, degree: 0 }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: Edge[] = grouped.edges.map((e) => ({ ...e }));
    for (const e of edges) {
      byId.get(e.source as string)!.degree++;
      byId.get(e.target as string)!.degree++;
    }
    // another centre keeps a depth the visitor chose; otherwise it opens with its own defaults (a collector: one step)
    const recenter = (n: Node) => `/graph/${PLURAL[n.type]}/${encodeURIComponent(n.slug)}${params.has('depth') ? `?depth=${depthNow}` : ''}`;
    // every name in a small network (a gathering's guests were nameless dots); in a big one the main entries
    const labelled = (n: Node) => nodes.length <= 40 || n.depth <= 1 || !!n.bundle || n.degree >= 4;
    const root = byId.get(rootId)!;
    const usedTypes = [...new Set(nodes.map((n) => n.type))];
    const usedCats = [...new Set(edges.map((e) => e.category))];

    render(main, html`<section class="page graph-page">
      <p class="crumbs"><a href="/graph">Network</a> / ${TYPE_LABEL[root.type]}</p>
      <h1>Network around ${link(root.type, root.slug, root.name)}</h1>
      <div class="graph-controls">
        <div class="seg" role="group" aria-label="Depth">
          <span class="muted">Steps</span>
          ${[1, 2, 3, 4].map((d) => html`<button type="button" data-depth="${d}" class="${d === depthNow ? 'on' : ''}" aria-pressed="${String(d === depthNow)}">${d}</button>`)}
        </div>
        <div class="graph-cats" role="group" aria-label="Kinds of links">
          ${GRAPH_CATEGORIES.map((c) => html`<label class="cat cat-${c}"><input type="checkbox" value="${c}" ${cats.includes(c) ? html`checked` : ''}>
            <i class="swatch"></i>${CATEGORY_LABEL[c]}</label>`)}
        </div>
        <div class="seg" role="group" aria-label="Zoom">
          <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
          <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
          <button type="button" data-zoom="fit">Fit</button>
        </div>
      </div>
      <p class="muted small">${walked.nodes.length} entries, ${raw.length} links${truncated ? ' (cut off at 500 entries: choose fewer steps or kinds of links)' : ''}${nodes.some((n) => n.bundle) ? '; entries of one kind with the same links are bundled — click a bundle to list or open it' : ''}.
        Click an entry for details, double-click to center the network on it; dashed = not certain, faded and dashed = end of the period only implied; arrows show what passes on (teacher → student, Hokusai → Van Gogh for an influence, artist → work); a work's owners follow one another — work → first owner → the next …, a dotted line to whoever held it for them; families as a family tree: parents above their children, a double line between spouses.</p>
      <div class="graph-wrap">
        <svg class="graph" role="img" aria-label="Network graph"></svg>
        <aside class="graph-info" aria-live="polite"></aside>
      </div>
      <div class="legend">${usedTypes.map((t) => html`<span><i class="dot node-${t}"></i>${TYPE_LABEL[t]}</span>`)}
        ${usedCats.map((c) => html`<span class="cat-${c}"><i class="line swatch"></i>${CATEGORY_LABEL[c] ?? c}</span>`)}</div>
    </section>`);

    const svgEl = main.querySelector<SVGSVGElement>('svg.graph')!;
    const info = main.querySelector<HTMLElement>('.graph-info')!;
    const width = svgEl.clientWidth || 900;
    const height = svgEl.clientHeight || 600;
    const svg = select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);

    // one arrowhead per category, coloured through CSS
    svg.append('defs').html(usedCats.map((c) => `<marker id="arrow-${escape(c)}" class="cat-${escape(c)}" viewBox="0 -4 8 8" refX="8" refY="0"
      markerWidth="7" markerHeight="7" orient="auto"><path d="M0,-4L8,0L0,4" class="arrowhead"/></marker>`).join(''));
    const viewport = svg.append('g');
    // family as a family tree: no arrows — parents above their children on an elbow line, spouses side by side on a
    // double line, siblings on one row (2026-11-23, owner: "family relationships should be portrayed in a family style")
    const kindOf = new Map(edges.map((e) => [e, familyKind(e.rels)]));
    const familyNodes = [...new Set(edges.filter((e) => kindOf.get(e)).flatMap((e) => [byId.get(e.source as string)!, byId.get(e.target as string)!]))];
    const familySet = new Set(familyNodes);
    const linkSel = viewport.append('g').attr('class', 'edges').selectAll('path').data(edges).join('path')
      .attr('class', (e) => `edge cat-${e.category}${e.uncertain ? ' uncertain' : ''}${e.implied ? ' implied' : ''}${e.rels.every((r) => r.beside) ? ' beside' : ''}${kindOf.get(e) ? ` family-${kindOf.get(e)!.kind}` : ''}`)
      .attr('stroke-width', (e) => (kindOf.get(e)?.kind === 'spouse' ? 1.4 : Math.min(1.6 + Math.log2(e.rels.length), 5)))
      .attr('marker-end', (e) => (e.directed && !kindOf.get(e) ? `url(#arrow-${e.category})` : null));
    const nodeSel = viewport.append('g').attr('class', 'nodes').selectAll<SVGAElement, Node>('a').data(nodes).join((enter) => enter.append<SVGAElement>('a'))
      .attr('href', (n) => (n.bundle ? '#' : href(n.type, n.slug)))
      .attr('class', (n) => `node node-${n.type}${n.depth === 0 ? ' root' : ''}${n.bundle ? ' bundle' : ''}${labelled(n) ? '' : ' quiet'}`);
    nodeSel.append('circle').attr('r', radius);
    nodeSel.filter((n) => !!n.bundle).append('text').attr('class', 'count').attr('text-anchor', 'middle').attr('dy', '0.35em').text((n) => String(n.bundle!.members.length));
    nodeSel.append('text').attr('class', 'name').attr('dx', (n) => radius(n) + 4).attr('dy', '0.35em')
      .text((n) => (n.bundle ? n.name.replace(/^\d+ /, '') : n.name));
    nodeSel.append('title').text((n) => (n.bundle ? `${n.name} (click to list them)` : `${n.name} (${TYPE_LABEL[n.type]}${n.period ? `, ${n.period.label}` : ''})`));
    const nameOf = (id: string) => byId.get(id)?.name ?? nodesIn.find((x) => x.id === id)?.name ?? id;
    linkSel.append('title').text((e) => e.rels.slice(0, 6).map((r) => `${nameOf(r.source)} ${r.label} ${nameOf(r.target)}${r.period ? ` ${r.period.label}` : ''}`).join('\n')
      + (e.rels.length > 6 ? `\n… ${e.rels.length - 6} more` : ''));
    // where the arrow ends (tests read it; the simulation turns source/target into nodes later)
    linkSel.attr('data-to', (e) => nameOf(typeof e.target === 'string' ? e.target : (e.target as Node).id));

    root.fx = width / 2;
    root.fy = height / 2;
    let ticks = 0;
    const sim = forceSimulation(nodes)
      .force('link', forceLink<Node, Edge>(edges).id((n) => n.id).distance((e) => 110 + 30 * Math.min((e.target as Node).depth ?? 1, 3)).strength(0.5))
      .force('charge', forceManyBody().strength(-700))
      // labels sit to the right of the dots: keep neighbours a label's height and some width apart
      .force('collide', forceCollide<Node>().radius((n) => radius(n) + (labelled(n) ? 26 : 10)).strength(0.9))
      .force('x', forceX(width / 2).strength(0.04))
      .force('y', forceY(height / 2).strength(0.06))
      .force('family', familyForce)
      .on('tick', () => {
        draw();
        if (++ticks === 60) fit();   // a first overview while the layout still settles
      })
      .on('end', () => fit());
    const p0 = (s: Node, t: Node, parent: string): [Node, Node] => (t.id === parent ? [t, s] : [s, t]);
    function familyForce(alpha: number) {
      for (const [e, fam] of kindOf) {
        if (!fam) continue;
        const kind = fam.kind;
        let s = e.source as Node, t = e.target as Node;
        if (typeof s !== 'object' || typeof t !== 'object') continue;
        if (fam.kind === 'parent') {   // the parent a generation (110 px) above
          if (t.id === fam.parent) [s, t] = [t, s];
          const gap = s.y! + 110 - t.y!;
          if (gap > 0) { t.vy! += gap * alpha * 0.6; s.vy! -= gap * alpha * 0.6; }
        } else if (kind === 'spouse' || kind === 'sibling') {   // one row, a name's width apart
          const dy = (t.y! - s.y!) * alpha * 0.5;
          s.vy! += dy; t.vy! -= dy;
        }
      }
      // everyone on a row of the family tree keeps the left one's name clear (labels sit right of the dots)
      for (let i = 0; i < familyNodes.length; i++) for (let j = i + 1; j < familyNodes.length; j++) {
        const [a, b] = familyNodes[i].x! <= familyNodes[j].x! ? [familyNodes[i], familyNodes[j]] : [familyNodes[j], familyNodes[i]];
        if (Math.abs(a.y! - b.y!) > 30) continue;
        const short = 36 + 6.5 * a.name.length - (b.x! - a.x!);
        if (short > 0) { const push = Math.min(short, 80) * alpha; b.vx! += push; a.vx! -= push; }
      }
      // names: two labels on one line don't run into each other — the right one moves up or down
      const named = nodes.filter((n) => labelled(n) && !familySet.has(n));
      for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
        const [a, b] = named[i].x! <= named[j].x! ? [named[i], named[j]] : [named[j], named[i]];
        const dy = b.y! - a.y!;
        if (Math.abs(dy) >= 15 || b.x! - a.x! > radius(a) + 8 + (a === root ? 7.5 : 6.5) * a.name.length) continue;
        const push = (15 - Math.abs(dy)) * alpha * (dy >= 0 ? 1 : -1);
        if (a.fy == null) { b.vy! += push / 2; a.vy! -= push / 2; } else b.vy! += push;
      }
    }
    function draw() {
      linkSel.attr('d', (e) => {
        const s = e.source as Node, t = e.target as Node;
        const fam = kindOf.get(e);
        const kind = fam?.kind;
        if (fam?.kind === 'parent') {   // down from the parent, across, down to the child
          const [p, c] = p0(s, t, fam.parent);
          const mid = (p.y! + c.y!) / 2;
          return `M${p.x},${p.y}V${mid}H${c.x}V${c.y}`;
        }
        if (kind === 'spouse') {   // a double line
          const dx = t.x! - s.x!, dy = t.y! - s.y!, len = Math.hypot(dx, dy) || 1;
          const ox = (-dy / len) * 2, oy = (dx / len) * 2;
          return `M${s.x! + ox},${s.y! + oy}L${t.x! + ox},${t.y! + oy}M${s.x! - ox},${s.y! - oy}L${t.x! - ox},${t.y! - oy}`;
        }
        return `M${s.x},${s.y}L${endX(e)},${endY(e)}`;
      });
      nodeSel.attr('transform', (n) => `translate(${n.x},${n.y})`);
    }

    // lines stop at the target's edge so the arrowhead stays visible
    const shorten = (e: Edge) => {
      const s = e.source as Node, t = e.target as Node;
      const dx = t.x! - s.x!, dy = t.y! - s.y!;
      const len = Math.hypot(dx, dy) || 1;
      return (len - radius(t) - 2) / len;
    };
    const endX = (e: Edge) => (e.source as Node).x! + ((e.target as Node).x! - (e.source as Node).x!) * shorten(e);
    const endY = (e: Edge) => (e.source as Node).y! + ((e.target as Node).y! - (e.source as Node).y!) * shorten(e);

    // ---- zoom, pan, drag ----
    const zoomer: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4])
      .filter((ev: Event) => (ev.type === 'wheel' ? true : !(ev as MouseEvent).button))
      .on('zoom', (ev) => viewport.attr('transform', ev.transform.toString()));
    svg.call(zoomer).on('dblclick.zoom', null);
    function fit() {
      const xs = nodes.map((n) => n.x!), ys = nodes.map((n) => n.y!);
      const [x0, x1, y0, y1] = [Math.min(...xs) - 40, Math.max(...xs) + 160, Math.min(...ys) - 40, Math.max(...ys) + 40];
      const k = Math.min(width / (x1 - x0), height / (y1 - y0), 1); // never enlarge beyond 100 %
      svg.call(zoomer.transform, zoomIdentity.translate(width / 2 - k * (x0 + x1) / 2, height / 2 - k * (y0 + y1) / 2).scale(k));
    }
    // less motion: the layout is computed at once and shown finished (dragging still moves nodes)
    if (reducedMotion()) {
      sim.stop();
      sim.tick(Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay())));
      draw();
      fit();
    }
    main.querySelector('.graph-controls')!.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.depth) setParams({ depth: Number(b.dataset.depth) });
      else if (b.dataset.zoom === 'in') svg.call(zoomer.scaleBy, 1.4);
      else if (b.dataset.zoom === 'out') svg.call(zoomer.scaleBy, 1 / 1.4);
      else if (b.dataset.zoom === 'fit') fit();
    });
    main.querySelector('.graph-cats')!.addEventListener('change', () => {
      const picked = [...main.querySelectorAll<HTMLInputElement>('.graph-cats input:checked')].map((i) => i.value as Category);
      setParams({ categories: picked.length ? picked : GRAPH_CATEGORIES });
    });

    nodeSel.call(drag<SVGAElement, Node>()
      .on('start', (ev, n) => {
        if (!ev.active) sim.alphaTarget(0.25).restart();
        n.fx = n.x;
        n.fy = n.y;
      })
      .on('drag', (ev, n) => {
        n.fx = ev.x;
        n.fy = ev.y;
      })
      .on('end', (ev, n) => {
        if (!ev.active) sim.alphaTarget(0);
        if (n !== root) n.fx = n.fy = null;
      }));

    // ---- select, highlight, recenter ----
    const neighbours = (n: Node) => {
      const ids = new Set([n.id]);
      edges.forEach((e) => {
        const s = (e.source as Node).id, t = (e.target as Node).id;
        if (s === n.id) ids.add(t);
        if (t === n.id) ids.add(s);
      });
      return ids;
    };
    const focus = (n: Node | null) => {
      const ids = n ? neighbours(n) : null;
      nodeSel.classed('faded', (m) => !!ids && !ids.has(m.id)).classed('near', (m) => !!ids && ids.has(m.id));
      linkSel.classed('faded', (e) => !!n && (e.source as Node).id !== n.id && (e.target as Node).id !== n.id);
    };
    let selected: Node | null = null;
    nodeSel
      .on('mouseenter', (_, n) => focus(n))
      .on('mouseleave', () => focus(selected))
      .on('click', (ev: MouseEvent, n) => {
        if (!n.bundle && (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0)) return; // new tab/window
        ev.preventDefault();
        selected = n;
        nodeSel.classed('selected', (m) => m === n);
        focus(n);
        showInfo(n);
      })
      .on('dblclick', (ev: MouseEvent, n) => {
        ev.preventDefault();
        if (n.bundle) {
          open.add(n.id);
          redraw();
        } else if (n !== root) navigate(recenter(n));
      });
    svg.on('click', (ev: MouseEvent) => {
      if (ev.target === svgEl) {
        selected = null;
        nodeSel.classed('selected', false);
        focus(null);
        showInfo(null);
      }
    });

    function showInfo(n: Node | null) {
      if (!n) return render(info, html`<p class="muted">Click an entry to see its links here.</p>`);
      if (n.bundle) {
        const b = n.bundle;
        render(info, html`<h2>${n.name}</h2>
          <p class="muted">${CATEGORY_LABEL[b.category] ?? b.category} · each linked only to ${b.parents.map((id) => byId.get(id)?.name ?? id).join(', ')} here</p>
          <p class="graph-actions"><button type="button" class="button-link" data-open="${n.id}">Show them in the network</button></p>
          <ul class="plain-list graph-links">${b.members.map((m) => html`<li>${link(m.type, m.slug, m.name)}${m.period ? html` <span class="muted">${m.period.label}</span>` : ''}</li>`)}</ul>`);
        info.querySelector<HTMLButtonElement>('[data-open]')!.addEventListener('click', () => {
          open.add(n.id);
          redraw();
        });
        return;
      }
      const mine = edges.filter((e) => (e.source as Node) === n || (e.target as Node) === n);
      const ref = (id: string) => {
        if (id === n.id) return 'this';
        const x = byId.get(id) ?? nodesIn.find((y) => y.id === id);
        return x ? link(x.type, x.slug, x.name) : id;
      };
      const relRow = (r: GraphEdge) => html`<li class="cat-${r.category}"><i class="line swatch"></i>
          ${ref(r.source)} <span class="muted">${r.label}</span> ${ref(r.target)}
          ${r.period ? html` <span class="muted">${r.period.label}</span>` : ''}${impliedEnd(r.end_basis)}${r.certainty && r.certainty !== 'attested' ? html` <span class="tag">${r.certainty}</span>` : ''}
          ${r.note ? html`<div class="rel-note">${r.note}</div>` : ''}</li>`;
      render(info, html`<h2>${n.name}</h2>
        <p class="muted">${TYPE_LABEL[n.type]}${n.kind ? ` · ${n.kind}` : ''}${n.period ? ` · ${n.period.label}` : ''}</p>
        <p class="graph-actions"><a class="button-link" href="${href(n.type, n.slug)}">Open page</a>
          ${n !== root ? html`<a class="button-link" href="${recenter(n)}">Center the network here</a>` : ''}</p>
        <ul class="plain-list graph-links">${mine.flatMap((e) => {
          const other = ((e.source as Node) === n ? e.target : e.source) as Node;
          return other.bundle ? [html`<li class="cat-${e.category}"><i class="line swatch"></i>${other.name} <span class="muted">· ${CATEGORY_LABEL[e.category] ?? e.category}</span></li>`]
            : e.rels.map(relRow);
        })}</ul>`);
    }

    showInfo(null);
    document.title = `Network around ${root.name} · Art History`;
    return () => sim.stop();
  }

  return () => stop?.();
}

