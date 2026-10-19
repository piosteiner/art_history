// An artwork's provenance on a map: its holders in the chain's order — numbered stops, segments direct / undocumented /
// implied, steps without a place listed beside the map. Used by an artwork's own map and the start map (map.ts).
import { Marker, Popup, type Map as MapLibre } from 'maplibre-gl';
import type { ExpressionSpecification } from 'maplibre-gl';
import { html, link, type Html } from './html';
import { gapSides, gapText, years } from './coverage';
import { addArrows, once, overlaps, removeLayers, setData } from './map-core';
import type {
  EntityMap, Feature, Inference, LineStringGeometry, PointGeometry, ProvenanceMap, ProvenanceMapStep, ProvenanceSegmentProps,
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

const STOP_ROLE: Record<string, string> = { dealer: 'dealer', agent: 'agent', custodian: 'custodian', publisher: 'publisher', foundry: 'foundry', trustee: 'trustee', possessor: 'without title' };

/** One step in a place's popup: holder, role, how and when, how we know the place; what its dates imply (API 086). */
function stepRow(s: ProvenanceStopProps, inferences: Inference[] = []) {
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
    ${(s.part ?? 0) === 0 ? inferences.map((i) => html`<br><span class="popup-derived"><span class="tag tag-derived">derived</span> <i>${i.text}</i></span>`) : ''}
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

/**
 * One artwork's provenance to draw; `entity` names it in the popups when several are on the map. `inferences`: what
 * the dates imply per step `position` (API 086, from the artwork's detail) — the distance travelled labels its segment.
 */
interface ProvenanceDrawing { prov: ProvenanceMap; color: string; entity?: EntityMap['entity']; inferences?: Map<number, Inference[]> }
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

/** An artwork's numbered steps at one place, as in its stop's popup — for the place's popup on the start map in a time
 *  window, so the numbers on the marker are explained there too. Empty when it has no step at that place. */
export function stepsAtPlace(prov: ProvenanceMap, placeSlug: string, color: string, entity?: EntityMap['entity']) {
  const steps = provenanceStops(prov).map((f) => f.properties).filter((st) => st.place.slug === placeSlug);
  if (!steps.length) return null;
  const label = stepRuns([...new Set(steps.map((st) => st.step))]);
  return html`<div class="popup-steps-block">${entityLine({ color, entity })}
    <span class="muted">${steps.length > 1 ? 'steps' : 'step'} ${label} of ${String(steps[0].steps)}</span>
    <ol class="popup-list popup-steps">${steps.map((st) => stepRow(st))}</ol></div>`;
}

/**
 * Provenances in the chain's order (not by date — the order is the reliable thing), each in its colour: numbered
 * stops, several steps at one place in one popup; lines solid where the handover is documented, dashed where it
 * isn't, dotted and faded where an end is only implied; arrows in step order. Hollow: the place is only probable
 * (where the artist lived); a ring: only the region or country is known. Call when the style is ready.
 */
/** `onStop`: a click on a numbered stop calls it instead of opening the stop's own popup (the start map in a time
 *  window opens the place's popup there — one popup with everyone at that place); it returns false to fall back. */
export function drawProvenance(map: MapLibre, prefix: string, items: ProvenanceDrawing[],
  { onStop, ends }: { onStop?: (at: [number, number]) => boolean; ends?: boolean | 'gone' } = {}) {
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
  // a handover that crossed the world (API 086): "≈ 14,393 km" mid-segment, on the segment into that step
  for (const it of items) {
    if (!it.inferences?.size) continue;
    const stops = provenanceStops(it.prov).map((f) => f.properties);
    for (const f of it.prov.features) {
      if (f.properties.layer !== 'provenance_segment' || f.properties.move) continue;
      const to = f.properties.to_step;
      const position = stops.find((st) => st.step === to && (st.part ?? 0) === 0)?.position;
      const travelled = position === undefined ? undefined : it.inferences.get(position)?.find((i) => i.kind === 'travelled');
      if (!travelled?.km) continue;
      const [a, b] = [(f.geometry as LineStringGeometry).coordinates[0], (f.geometry as LineStringGeometry).coordinates.at(-1)!];
      const el = document.createElement('div');
      el.className = 'prov-km';
      el.textContent = `≈ ${travelled.km.toLocaleString('en')} km`;
      el.title = `Derived: ${travelled.text}`;
      markers.push(new Marker({ element: el }).setLngLat([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]).addTo(map));
    }
  }
  // gaps between two stops (API 078): a "?" with the years mid-segment, red when it touches 1933–1945
  for (const it of items) {
    for (const f of it.prov.features) {
      if (f.properties.layer !== 'provenance_segment' || !f.properties.gaps?.length) continue;
      const gaps = f.properties.gaps;
      const [a, b] = [(f.geometry as LineStringGeometry).coordinates[0], (f.geometry as LineStringGeometry).coordinates.at(-1)!];
      const el = document.createElement('div');
      el.className = `prov-gap${gaps.some((g) => g.in_1933_1945) ? ' ns' : ''}`;
      el.textContent = `? ${gaps.map((g) => years(g.period)).join(', ')}`;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${it.entity ? `${it.entity.name}, ` : ''}${gaps.map(gapText).join('; ')}`);
      const popup = new Popup({ maxWidth: '320px', offset: 12 }).setHTML(html`<div class="popup-row">
        ${entityLine(it)}
        ${gaps.map((g) => html`<div><strong>${gapText(g)}</strong>${gapSides(g) ? html`<br><span class="muted">${gapSides(g)}</span>` : ''}
          ${g.in_1933_1945 ? html`<br><span class="tag tag-ns">1933–1945</span>` : ''}</div>`)}
      </div>`.value);
      markers.push(new Marker({ element: el }).setLngLat([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]).setPopup(popup).addTo(map));
    }
  }
  for (const it of items) {
    // ends: on one artwork's own map, its first and last placed stop are marked "start" and "today" / "last known",
    // since a return to a place puts both in one marker ("2, 8") and the order alone is hard to read
    const placed = provenanceStops(it.prov).map((f) => f.properties.step);
    const [firstStep, lastStep] = [Math.min(...placed), Math.max(...placed)];
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
      const end = ends && placed.length > 1 ? endOf(steps, firstStep, lastStep, ends === 'gone') : null;
      if (end) {
        el.classList.add(`prov-${end.kind}`);
        el.dataset.cap = end.text;  // drawn by CSS (::after): the marker's text stays its step numbers
      }
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${it.entity ? `${it.entity.name}, ` : ''}${first.place.name}: ${steps.length > 1 ? 'steps' : 'step'} ${label} of ${first.steps}${end ? ` (${end.text})` : ''}`);
      const popup = new Popup({ maxWidth: '320px', offset: area ? 20 : 13 }).setHTML(html`<div class="popup-row">
        ${entityLine(it)}
        <strong>${link('place', first.place.slug, first.place.name)}</strong>
        <span class="muted">${steps.length > 1 ? 'steps' : 'step'} ${label} of ${String(first.steps)}</span>
        <ol class="popup-list popup-steps">${steps.map((st) => stepRow(st, st.position === undefined ? [] : it.inferences?.get(st.position) ?? []))}</ol>
      </div>`.value);
      const at = group[0].geometry.coordinates as [number, number];
      const marker = new Marker({ element: el }).setLngLat(at);
      if (onStop) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!onStop(at)) popup.setLngLat(at).addTo(map);
        });
      } else marker.setPopup(popup);
      markers.push(marker.addTo(map));
    }
  }
}

/**
 * The first or last placed stop of an artwork: "start" (or "first known place" when earlier steps have no place) and
 * "today" when the last step is the provenance's last and still runs (and the work wasn't destroyed or lost — API
 * 103), else "last known place". Both in one marker:
 * the end wins (an artwork back where it started).
 */
function endOf(steps: ProvenanceStopProps[], firstStep: number, lastStep: number, gone: boolean): { kind: 'start' | 'end'; text: string } | null {
  const last = steps.find((s) => s.step === lastStep);
  if (last) return { kind: 'end', text: !gone && last.step === last.steps && !last.period?.to ? 'today' : 'last known place' };
  if (steps.some((s) => s.step === firstStep)) return { kind: 'start', text: firstStep === 1 ? 'start' : 'first known place' };
  return null;
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

/** Every gap of the provenance, one per line, under the map (API 078). */
export const gapList = (prov: ProvenanceMap) => html`<ul class="unplaced-list gap-list">${(prov.gaps ?? []).map((g) => html`<li class="${g.in_1933_1945 ? 'ns' : ''}">
  ${gapText(g)}${gapSides(g) ? html` <span class="muted">(${gapSides(g)})</span>` : ''}</li>`)}</ul>`;

/** The steps without a place, one per line, numbered with their step: under the map, so every step is visible somewhere. */
export const unplacedSteps = (prov: ProvenanceMap) => html`<ol class="unplaced-list">${prov.unplaced.map((s) => html`<li value="${s.step}">
  ${provenanceHolder(s)}${s.kind === 'creation' ? ', creation' : ''}${s.period ? `, ${s.period.label}` : ''}</li>`)}</ol>`;
