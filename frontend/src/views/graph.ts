// The network around one entry (/v1/graph/<type>/<slug>): who influenced whom, studied where, belonged to which
// movement, was supported by which patron, made which work, owned it after whom (provenance) … laid out with d3-force.
// /graph/artists/vincent-van-gogh?depth=2
//   click a node: details and its links in the side panel · double-click: center the network on it
//   Ctrl/Cmd/middle click: open its page in a new tab · drag nodes · wheel/pinch zooms, drag the background pans
import { drag } from 'd3-drag';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { getGraph, getVocabulary, PLURAL } from '../api';
import { escape, href, html, impliedEnd, link, render, TYPE_LABEL } from '../html';
import type { Category, GraphEdge, GraphNode, Plural } from '../types';
import { guard, loading, showError } from './common';
import { navigate } from '../router';

// place links are map material (presence/association), the API leaves them out of graphs by default
const GRAPH_CATEGORIES: Category[] = ['influence', 'education', 'collaboration', 'membership', 'patronage', 'depiction', 'provenance', 'architecture', 'polity'];
const CATEGORY_LABEL: Record<string, string> = {
  influence: 'Influence', education: 'Education', collaboration: 'Collaboration', membership: 'Movements & groups',
  patronage: 'Patronage', depiction: 'Depictions', provenance: 'Collections', architecture: 'Buildings', polity: 'States & nationality',
};

type Node = GraphNode & SimulationNodeDatum & { degree: number };
type Edge = Omit<GraphEdge, 'source' | 'target'> & SimulationLinkDatum<Node> & { source: Node | string; target: Node | string };

const radius = (n: Node) => (n.depth === 0 ? 13 : 6 + Math.min(n.degree, 8));

export function graph(main: HTMLElement, plural: Plural | undefined, slug: string | undefined, params: URLSearchParams) {
  if (!plural || !slug) {
    render(main, html`<section class="page"><h1>Network</h1>
      <p>The network shows who influenced whom, who studied where, belonged to which movement, was supported by which patron, made or appears in which work,
      and which collectors, dealers and museums owned a work one after another.
      Start from any entry: open its page and choose <em>Show the network</em>, or start with one of these:</p>
      <ul class="plain-list">
        <li>${link('artist', 'vincent-van-gogh', 'Vincent van Gogh')}: <a href="/graph/artists/vincent-van-gogh?depth=2">network</a></li>
        <li>${link('movement', 'japonisme', 'Japonisme')}: <a href="/graph/movements/japonisme?depth=2">network</a></li>
      </ul></section>`);
    return;
  }
  loading(main);
  const current = guard();
  const depth = Math.min(Math.max(Number(params.get('depth')) || 2, 1), 4);
  const chosenCats = params.get('categories')?.split(',').filter((c): c is Category => (GRAPH_CATEGORIES as string[]).includes(c)) ?? null;
  let stop: (() => void) | undefined;

  getVocabulary()
    .then(async (vocab) => {
      const cats = chosenCats ?? GRAPH_CATEGORIES;
      const types = chosenCats ? vocab.filter((v) => cats.includes(v.category)).map((v) => v.code) : undefined;
      const g = await getGraph(plural, slug, depth, types);
      if (!current()) return;
      stop = draw(g.root, g.nodes, g.edges, g.truncated, depth, cats);
    })
    .catch((err) => current() && showError(main, err));

  function setParams(next: { depth?: number; categories?: Category[] }) {
    const p = new URLSearchParams();
    p.set('depth', String(next.depth ?? depth));
    const c = next.categories ?? chosenCats;
    if (c && c.length !== GRAPH_CATEGORIES.length) p.set('categories', c.join(','));
    navigate(`/graph/${plural}/${encodeURIComponent(slug!)}?${p.toString().replace(/%2C/g, ',')}`);
  }

  function draw(rootId: string, nodesIn: GraphNode[], edgesIn: GraphEdge[], truncated: boolean, depthNow: number, cats: Category[]) {
    const nodes: Node[] = nodesIn.map((n) => ({ ...n, degree: 0 }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: Edge[] = edgesIn.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ ...e }));
    for (const e of edges) {
      byId.get(e.source as string)!.degree++;
      byId.get(e.target as string)!.degree++;
    }
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
      <p class="muted small">${nodes.length} entries, ${edges.length} links${truncated ? ' (cut off at 500 entries: choose fewer steps or kinds of links)' : ''}.
        Click an entry for details, double-click to center the network on it; dashed = not certain, faded and dashed = end of the period only implied; arrows point from the subject (“Van Gogh → influenced by → Hokusai”).</p>
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
    const linkSel = viewport.append('g').attr('class', 'edges').selectAll('line').data(edges).join('line')
      .attr('class', (e) => `edge cat-${e.category}${e.certainty && e.certainty !== 'attested' ? ' uncertain' : ''}${e.end_basis === 'implied' ? ' implied' : ''}`)
      .attr('marker-end', (e) => (e.symmetric ? null : `url(#arrow-${e.category})`));
    const nodeSel = viewport.append('g').attr('class', 'nodes').selectAll<SVGAElement, Node>('a').data(nodes).join((enter) => enter.append<SVGAElement>('a'))
      .attr('href', (n) => href(n.type, n.slug))
      .attr('class', (n) => `node node-${n.type}${n.depth === 0 ? ' root' : ''}`);
    nodeSel.append('circle').attr('r', radius);
    nodeSel.append('text').attr('dx', (n) => radius(n) + 4).attr('dy', '0.35em').text((n) => n.name);
    nodeSel.append('title').text((n) => `${n.name} (${TYPE_LABEL[n.type]}${n.period ? `, ${n.period.label}` : ''})`);
    linkSel.append('title').text((e) => `${byId.get(e.source as string)?.name} ${e.label} ${byId.get(e.target as string)?.name}${e.period ? ` ${e.period.label}` : ''}`
      + `${e.end_basis === 'implied' ? ' (end implied)' : ''}${e.certainty && e.certainty !== 'attested' ? ` (${e.certainty})` : ''}`);

    root.fx = width / 2;
    root.fy = height / 2;
    const sim = forceSimulation(nodes)
      .force('link', forceLink<Node, Edge>(edges).id((n) => n.id).distance((e) => 110 + 30 * Math.min((e.target as Node).depth ?? 1, 3)).strength(0.5))
      .force('charge', forceManyBody().strength(-700))
      // labels sit to the right of the dots: keep neighbours a label's height and some width apart
      .force('collide', forceCollide<Node>().radius((n) => radius(n) + 26).strength(0.9))
      .force('x', forceX(width / 2).strength(0.04))
      .force('y', forceY(height / 2).strength(0.06))
      .on('tick', () => {
        linkSel
          .attr('x1', (e) => (e.source as Node).x!).attr('y1', (e) => (e.source as Node).y!)
          .attr('x2', (e) => endX(e)).attr('y2', (e) => endY(e));
        nodeSel.attr('transform', (n) => `translate(${n.x},${n.y})`);
      })
      .on('end', () => fit());

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
      nodeSel.classed('faded', (m) => !!ids && !ids.has(m.id));
      linkSel.classed('faded', (e) => !!n && (e.source as Node).id !== n.id && (e.target as Node).id !== n.id);
    };
    let selected: Node | null = null;
    nodeSel
      .on('mouseenter', (_, n) => focus(n))
      .on('mouseleave', () => focus(selected))
      .on('click', (ev: MouseEvent, n) => {
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return; // new tab/window
        ev.preventDefault();
        selected = n;
        nodeSel.classed('selected', (m) => m === n);
        focus(n);
        showInfo(n);
      })
      .on('dblclick', (ev: MouseEvent, n) => {
        ev.preventDefault();
        if (n !== root) navigate(`/graph/${PLURAL[n.type]}/${encodeURIComponent(n.slug)}?depth=${depthNow}${chosenCats ? `&categories=${chosenCats.join(',')}` : ''}`);
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
      const mine = edges.filter((e) => (e.source as Node) === n || (e.target as Node) === n);
      render(info, html`<h2>${n.name}</h2>
        <p class="muted">${TYPE_LABEL[n.type]}${n.kind ? ` · ${n.kind}` : ''}${n.period ? ` · ${n.period.label}` : ''}</p>
        <p class="graph-actions"><a class="button-link" href="${href(n.type, n.slug)}">Open page</a>
          ${n !== root ? html`<a class="button-link" href="/graph/${PLURAL[n.type]}/${encodeURIComponent(n.slug)}?depth=${String(depthNow)}">Center the network here</a>` : ''}</p>
        <ul class="plain-list graph-links">${mine.map((e) => {
          const s = e.source as Node, t = e.target as Node;
          return html`<li class="cat-${e.category}"><i class="line swatch"></i>
            ${s === n ? 'this' : link(s.type, s.slug, s.name)} <span class="muted">${e.label}</span> ${t === n ? 'this' : link(t.type, t.slug, t.name)}
            ${e.period ? html` <span class="muted">${e.period.label}</span>` : ''}${impliedEnd(e.end_basis)}${e.certainty && e.certainty !== 'attested' ? html` <span class="tag">${e.certainty}</span>` : ''}
            ${e.note ? html`<div class="rel-note">${e.note}</div>` : ''}</li>`;
        })}</ul>`);
    }
    showInfo(null);
    document.title = `Network around ${root.name} · Art History`;
    return () => sim.stop();
  }

  return () => stop?.();
}

