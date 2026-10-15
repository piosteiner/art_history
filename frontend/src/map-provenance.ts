// An artwork's provenance on a map: its holders in the chain's order — numbered stops, segments direct / undocumented /
// implied, steps without a place listed beside the map. Used by an artwork's own map and the start map (map.ts).
import { Marker, Popup, type Map as MapLibre } from 'maplibre-gl';
import type { ExpressionSpecification } from 'maplibre-gl';
import { html, link, type Html } from './html';
import { addArrows, once, overlaps, removeLayers, setData } from './map-core';
import type {
  EntityMap, Feature, LineStringGeometry, PointGeometry, ProvenanceMap, ProvenanceMapStep, ProvenanceSegmentProps,
  ProvenanceStopProps, StopProps,
} from './types';

// ---- an artwork's provenance: its holders in the chain's order ------------------------------------

/** The artwork's own presence links the provenance features replace: `kept_in` dots, the creation place, the route. */
export const PROVENANCE_RELATIONSHIPS = new Set(['kept_in', 'created_in']);

/** "6–9", "2, 3", "1, 4–7": step numbers of one place, runs of three or more shortened. */
export function stepRuns(ns: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < ns.length;) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j - i >= 2 ? `${ns[i]}–${ns[j]}` : ns.slice(i, j + 1).join(', '));
    i = j + 1;
  }
  return out.join(', ');
}

/** "Estate of Hedwig Frieda Ullmann", linked where there is an entry (as in the provenance list). */
export const provenanceHolder = (s: ProvenanceMapStep): Html =>
  html`${s.role === 'estate' ? 'Estate of ' : ''}${s.holder ? link(s.holder.type, s.holder.slug, s.holder.name) : s.holder_label ?? 'Unknown owner'}`;

/** The same as plain text: "Estate of Hedwig Frieda Ullmann". */
export const holderText = (s: ProvenanceMapStep) => `${s.role === 'estate' ? 'Estate of ' : ''}${s.holder?.name ?? s.holder_label ?? 'Unknown owner'}`;

/** The place is inferred from where the artist lived or worked: drawn hollow, "probably". */
export const probable = (s: Pick<ProvenanceStopProps, 'place_basis'>) => s.place_basis === 'artist_residence' || s.place_basis === 'artist_workplace';

const STOP_ROLE: Record<string, string> = { dealer: 'dealer', agent: 'agent', custodian: 'custodian', publisher: 'publisher', foundry: 'foundry', trustee: 'trustee' };

/** One step in a place's popup: holder, role, how and when, how we know the place. */
function stepRow(s: ProvenanceStopProps) {
  const made = s.kind === 'creation';
  const moved = (s.part ?? 0) > 0; // a further place of the step (API 077): when it was here
  const how = moved ? s.part_label ?? ''
    : [made ? null : s.method === 'theft' ? 'stolen' : s.method && s.method !== 'unknown' ? s.method.replace('_', ' ') : null, s.period?.label].filter(Boolean).join(' · ');
  return html`<li value="${s.step}">
    ${provenanceHolder(s)}${s.role && STOP_ROLE[s.role] && s.kind !== 'loan' ? html` <span class="tag">${STOP_ROLE[s.role]}</span>` : ''}
    ${made ? html` <span class="tag">${probable(s) ? 'probably made here' : 'made here'}</span>` : ''}
    ${s.kind === 'loan' ? html` <span class="tag">on loan</span>` : ''}
    ${moved ? html` <span class="tag">moved here</span>` : ''}
    ${s.certainty && s.certainty !== 'attested' ? html` <span class="tag">${s.certainty}</span>` : ''}
    ${how ? html`<br><span class="muted">${how}</span>` : ''}
    ${s.place_basis === 'holder_seat' ? html`<br><span class="muted">at the institution's seat</span>` : ''}
    ${!made && probable(s) ? html`<br><span class="muted">probably: where the artist ${s.place_basis === 'artist_workplace' ? 'worked' : 'lived'}</span>` : ''}
  </li>`;
}

/** An artwork's provenance when at least one step has a place (else its map stays as it was), or null. */
export const placedProvenance = (fc: EntityMap) =>
  fc.entity.type === 'artwork' && fc.provenance?.features.some((f) => f.properties.layer === 'provenance_stop') ? fc.provenance : null;

/** The entity map without what the provenance replaces: the route and the `kept_in` / creation dots. */
export const withoutReplaced = (fc: EntityMap): EntityMap => ({
  ...fc,
  features: fc.features.filter((f) => f.properties.layer !== 'route'
    && !(f.properties.layer === 'presence' && PROVENANCE_RELATIONSHIPS.has((f.properties as StopProps).relationship))),
});

export const provenanceStops = (prov: ProvenanceMap) =>
  prov.features.filter((f): f is Feature<PointGeometry, ProvenanceStopProps> => f.properties.layer === 'provenance_stop');

/** One artwork's provenance to draw; `entity` names it in the popups when several are on the map. */
interface ProvenanceDrawing { prov: ProvenanceMap; color: string; entity?: EntityMap['entity'] }
interface DrawnSegment { seg: ProvenanceSegmentProps; from?: string; to?: string; color: string; entity?: EntityMap['entity'] }
const drawnSegments = new WeakMap<MapLibre, Map<string, DrawnSegment[]>>(); // per map and layer prefix, for the line popups
const provenanceMarkers = new WeakMap<MapLibre, Marker[]>();
export const provenanceLayers = (prefix: string) => ['direct', 'gap', 'implied', 'arrows', 'hit'].map((s) => `${prefix}-${s}`);

export function clearProvenanceMarkers(map: MapLibre) {
  provenanceMarkers.get(map)?.forEach((m) => m.remove());
  provenanceMarkers.set(map, []);
}

const entityLine = (d: { color: string; entity?: EntityMap['entity'] }) =>
  d.entity ? html`<div><i class="dot" style="background:${d.color}"></i> ${link(d.entity.type, d.entity.slug, d.entity.name)}</div>` : '';

/**
 * Provenances in the chain's order (not by date — the order is the reliable thing), each in its colour: numbered
 * stops, several steps at one place in one popup; lines solid where the handover is documented, dashed where it
 * isn't, dotted and faded where an end is only implied; arrows in step order. Hollow: the place is only probable
 * (where the artist lived); a ring: only the region or country is known. Call when the style is ready.
 */
export function drawProvenance(map: MapLibre, prefix: string, items: ProvenanceDrawing[]) {
  clearProvenanceMarkers(map);
  removeLayers(map, provenanceLayers(prefix));
  const drawn: DrawnSegment[] = [];
  const segments = items.flatMap((it) => {
    // a step can have several places (API 077), so a segment's ends are found by their position
    const at = new Map(provenanceStops(it.prov).map((f) => [f.geometry.coordinates.join(','), f.properties.place.name] as const));
    return it.prov.features
      .filter((f): f is Feature<LineStringGeometry, ProvenanceSegmentProps> => f.properties.layer === 'provenance_segment')
      .map((f) => {
        const ends = [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)!].map((c) => at.get(c.join(',')));
        drawn.push({ seg: f.properties, from: ends[0], to: ends[1], color: it.color, entity: it.entity });
        return { ...f, properties: { ...f.properties, move: !!f.properties.move, between: undefined, i: drawn.length - 1, color: it.color } };
      });
  });
  const byPrefix = drawnSegments.get(map) ?? new Map<string, DrawnSegment[]>();
  drawnSegments.set(map, byPrefix.set(prefix, drawn));

  const source = `${prefix}-segments`;
  setData(map, source, { type: 'FeatureCollection', features: segments as unknown as GeoJSON.Feature[] });
  const line = (kind: string, filter: ExpressionSpecification, paint: Record<string, unknown>) => map.addLayer({
    id: `${prefix}-${kind}`, type: 'line', source, filter,
    layout: { 'line-join': 'round', 'line-cap': kind === 'implied' ? 'round' : 'butt' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.85, ...paint },
  });
  // a move within one step (the holder took it from place to place) is solid
  line('direct', ['any', ['get', 'move'], ['all', ['!', ['get', 'implied']], ['get', 'direct']]], {});
  line('gap', ['all', ['!', ['get', 'move']], ['!', ['get', 'implied']], ['!', ['get', 'direct']]], { 'line-dasharray': [3, 2] });
  line('implied', ['all', ['!', ['get', 'move']], ['get', 'implied']], { 'line-dasharray': [0.1, 2], 'line-opacity': 0.45, 'line-width': 3 });
  addArrows(map, `${prefix}-arrows`, source, ['get', 'color'], ['case', ['all', ['get', 'implied'], ['!', ['get', 'move']]], 0.4, 0.9]);
  // thin lines are hard to hit: a wide invisible copy takes the clicks
  map.addLayer({ id: `${prefix}-hit`, type: 'line', source, paint: { 'line-width': 14, 'line-opacity': 0 } });
  once(map, `${prefix}-hit`, () => {
    const hit = `${prefix}-hit`;
    map.on('mouseenter', hit, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', hit, () => (map.getCanvas().style.cursor = ''));
    map.on('click', hit, (e) => {
      if ((e.originalEvent.target as Element | null)?.closest('.maplibregl-marker')) return; // a stop's own popup opens
      const rows = [...new Set((e.features ?? []).map((f) => Number(f.properties.i)))]
        .map((i) => drawnSegments.get(map)?.get(prefix)?.[i]).filter((d): d is DrawnSegment => !!d);
      if (!rows.length) return;
      new Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(html`${rows.map(({ seg, from, to, ...d }) => html`<div class="popup-row">
        ${entityLine(d)}
        <strong>${seg.move ? `step ${seg.from_step}` : `${seg.from_step} → ${seg.to_step}`}</strong>
        <span class="muted">${from ?? ''} → ${to ?? ''}</span><br>
        ${seg.move ? 'moved by the same holder'
          : seg.implied ? html`<span class="tag tag-implied">implied</span> not recorded: follows from the creation, the loan or a place not recorded`
          : seg.direct ? 'handover documented' : html`<span class="tag">handover not documented</span> there may have been owners in between`}
        ${seg.between.length ? html`<div class="popup-note">passes over: ${seg.between.map((s, i) => html`${i ? '; ' : ''}${String(s.step)} ${provenanceHolder(s)}`)} (place not recorded)</div>` : ''}
      </div>`)}`.value).addTo(map);
    });
  });

  // numbered stops as HTML markers (one per artwork and position): numbers need no map font, and they are focusable
  const markers = provenanceMarkers.get(map)!;
  for (const it of items) {
    const places = new Map<string, Feature<PointGeometry, ProvenanceStopProps>[]>();
    for (const f of provenanceStops(it.prov)) {
      const key = f.geometry.coordinates.join(',');
      places.set(key, [...(places.get(key) ?? []), f]);
    }
    for (const group of places.values()) {
      const steps = group.map((f) => f.properties);
      const first = steps[0];
      const label = stepRuns([...new Set(steps.map((s) => s.step))]); // a step back at a place it had left: once
      const el = document.createElement('div');
      const hollow = steps.every(probable);
      const area = steps.every((s) => s.precision === 'region' || s.precision === 'country');
      el.className = `prov-stop${hollow ? ' hollow' : ''}${area ? ' area' : ''}`;
      el.style.setProperty('--pc', it.color);
      el.textContent = label;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${it.entity ? `${it.entity.name}, ` : ''}${first.place.name}: ${steps.length > 1 ? 'steps' : 'step'} ${label} of ${first.steps}`);
      const popup = new Popup({ maxWidth: '320px', offset: area ? 20 : 13 }).setHTML(html`<div class="popup-row">
        ${entityLine(it)}
        <strong>${link('place', first.place.slug, first.place.name)}</strong>
        <span class="muted">${steps.length > 1 ? 'steps' : 'step'} ${label} of ${String(first.steps)}</span>
        <ol class="popup-list popup-steps">${steps.map(stepRow)}</ol>
      </div>`.value);
      markers.push(new Marker({ element: el }).setLngLat(group[0].geometry.coordinates).setPopup(popup).addTo(map));
    }
  }
}

/**
 * The provenance inside a time window: the stops whose dates overlap it, and the segments with both ends among them.
 * Undated steps stay out — we can't say they were in the window.
 */
export function provenanceInWindow(prov: ProvenanceMap, w: { from: number; to: number }): ProvenanceMap {
  const inside = new Set(provenanceStops(prov).filter((f) => overlaps(f.properties.period, w)).map((f) => f.properties.step));
  return {
    ...prov,
    features: prov.features.filter((f) => (f.properties.layer === 'provenance_stop'
      ? inside.has(f.properties.step) : inside.has(f.properties.from_step) && inside.has(f.properties.to_step))),
  };
}

/** The steps without a place, one per line, numbered with their step: under the map, so every step is visible somewhere. */
export const unplacedSteps = (prov: ProvenanceMap) => html`<ol class="unplaced-list">${prov.unplaced.map((s) => html`<li value="${s.step}">
  ${provenanceHolder(s)}${s.kind === 'creation' ? ', creation' : ''}${s.period ? `, ${s.period.label}` : ''}</li>`)}</ol>`;
