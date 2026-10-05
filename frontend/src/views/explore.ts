// Start page: map + timeline over what the pickers select (per type: all, none or chosen entries).
// - no time window, nothing chosen individually → every place, sized by its number of links
// - no time window, entries chosen             → their routes and places, one colour per entry
// - a time window on the timeline              → who/what of the selection was physically where
// The state lives in the URL (/?artists=…&movements=none&from=1888&to=1889) and is remembered locally.
import { getEntityMap, getPlacesMap, getPresence, listEntities, PLURAL } from '../api';
import { entries } from '../catalog';
import { href, html, render } from '../html';
import { compareUrl, encounterLine } from '../crossings';
import { findEncounters, type Encounter, type Stay } from '../encounters';
import { COLORS, createMap, focusEncounter, highlightRoute, PALETTE, showEncounters, showPlaces, showPresence, showSelection, type ColoredEntityMap, type RouteInfo } from '../map';
import { mountPickers, type PickerGroup } from '../picker';
import { replaceQuery } from '../router';
import { chosen, includes, parseSelection, writeSelection, type Selection } from '../selection';
import { renderTimeline, type TimelineRow } from '../timeline';
import type { EntityType, Plural, PresenceMap, StopProps } from '../types';
import { showError } from './common';

const STORAGE_KEY = 'arthistory:explore';
const MAX_ROUTES = 24; // one request each; beyond that, use a time window
const LIST = { limit: 500 } as const;

type Window = { from: number; to: number } | null;

function readWindow(params: URLSearchParams): Window {
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  return params.has('from') && params.has('to') && Number.isInteger(from) && Number.isInteger(to) && from <= to ? { from, to } : null;
}

function remembered(): URLSearchParams | null {
  try {
    const q = localStorage.getItem(STORAGE_KEY);
    return q ? new URLSearchParams(q) : null;
  } catch {
    return null;
  }
}

export function explore(main: HTMLElement, params: URLSearchParams) {
  // a plain / brings back the last view
  let restored = false;
  if (![...params.keys()].length) {
    const last = remembered();
    if (last && [...last.keys()].length) {
      params = last;
      restored = true;
      replaceQuery(params);
    }
  }
  let sel: Selection = parseSelection(params);
  let win: Window = readWindow(params);

  render(main, html`<section class="explore">
    <div class="intro">
      <h1>Art history on a map and a timeline</h1>
      <p>Where artists were born, lived and travelled, where their works were made and where they are now. Choose what to show, then pick a time window on the timeline to see who was where.</p>
    </div>
    <p class="restored" id="restored" hidden></p>
    <div id="pickers" class="pickers-wrap"><p class="muted small">Loading entries…</p></div>
    <div class="map-wrap">
      <div class="map" id="map"></div>
      <div class="legend" id="legend"></div>
    </div>
    <p class="map-status muted" id="map-status"></p>
    <section class="encounters" id="encounters" hidden aria-live="polite"></section>
    <div id="timeline"></div>
  </section>`);

  const map = createMap(main.querySelector<HTMLElement>('#map')!);
  const status = main.querySelector<HTMLElement>('#map-status')!;
  const legend = main.querySelector<HTMLElement>('#legend')!;
  const encountersEl = main.querySelector<HTMLElement>('#encounters')!;

  // a remembered view (time window, picks) must not look like the default start page
  const restoredEl = main.querySelector<HTMLElement>('#restored')!;
  if (restored) {
    const w = readWindow(params);
    const parts = [w ? `time window ${w.from === w.to ? w.from : `${w.from}–${w.to}`}` : '', [...params.keys()].some((k) => k !== 'from' && k !== 'to') ? 'your selection' : '']
      .filter(Boolean).join(' and ');
    render(restoredEl, html`Showing your last view (${parts}). <a href="/" data-fresh>Start fresh</a>`);
    restoredEl.hidden = false;
    restoredEl.querySelector('[data-fresh]')!.addEventListener('click', () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* no storage */ }
    });
  }

  // ---- crossed paths: entries at the same place at the same time, listed under the map ----
  const SHOW_FIRST = 6;
  let crossed: Encounter[] = [];
  let crossedCoords: (slug: string) => [number, number] | undefined = () => undefined;
  let showAllCrossed = false;
  function crossings(stays: Stay[], coords: (slug: string) => [number, number] | undefined) {
    crossed = findEncounters(stays, { creatorOf, window: win });
    crossedCoords = coords;
    showEncounters(map, crossed, coords);
    drawCrossings();
  }
  function drawCrossings() {
    encountersEl.hidden = !crossed.length;
    if (!crossed.length) return;
    const shown = showAllCrossed ? crossed : crossed.slice(0, SHOW_FIRST);
    render(encountersEl, html`<h2>Crossed paths <span class="muted small">at the same place at the same time, marked with a yellow halo on the map${win ? ` · ${win.from === win.to ? win.from : `${win.from}–${win.to}`}` : ''}</span></h2>
      <ul class="encounters-list">${shown.map((e, i) => encounterLine(e, { actions: html`<div class="encounter-actions">
        <button type="button" class="link-button" data-encounter="${String(i)}">show on the map</button>
        <a href="${compareUrl(e)}">only these two →</a></div>` }))}</ul>
      ${crossed.length > SHOW_FIRST ? html`<button type="button" class="link-button" data-crossed-all>${showAllCrossed ? 'show fewer' : `show all ${crossed.length}`}</button>` : ''}`);
  }
  encountersEl.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.crossedAll !== undefined) {
      showAllCrossed = !showAllCrossed;
      return drawCrossings();
    }
    const e = crossed[Number(b.dataset.encounter)];
    if (e) {
      focusEncounter(map, e, crossedCoords);
      main.querySelector('#map')!.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  const timelineEl = main.querySelector<HTMLElement>('#timeline')!;
  const pickersEl = main.querySelector<HTMLElement>('#pickers')!;

  const colorOf = (() => {
    let index = new Map<string, string>();
    return {
      reset() {
        index = new Map(chosen(sel).map((c, i) => [`${c.type}/${c.slug}`, PALETTE[i % PALETTE.length]]));
      },
      get: (type: EntityType, slug: string) => index.get(`${type}/${slug}`) ?? routeColors.get(`${type}/${slug}`),
    };
  })();
  colorOf.reset();

  // ---- routes on the start map / in a time window: one colour each, named in the legend ----
  let routeColors = new Map<string, string>();
  const LEGEND_FIRST = 12;
  let legendAll = false;
  let lastRoutes: RouteInfo[] = [];
  /** Keeps the colours and redraws the timeline when they changed (its bars use the same colours). */
  function useRoutes(info: RouteInfo[]) {
    lastRoutes = info;
    const next = new Map(info.map((i) => [i.key, i.color]));
    const changed = next.size !== routeColors.size || [...next].some(([k, c]) => routeColors.get(k) !== c);
    routeColors = next;
    if (changed) drawTimeline();
  }
  const routeLegend = () => {
    const shown = legendAll ? lastRoutes : lastRoutes.slice(0, LEGEND_FIRST);
    return html`${shown.map((r) => html`<span class="route-key" data-route="${r.key}" tabindex="0" title="Highlight ${r.name}'s route"><i class="line" style="background:${r.color}"></i>${r.name}</span>`)}
      ${lastRoutes.length > LEGEND_FIRST ? html`<button type="button" class="link-button" data-legend-all>${legendAll ? 'fewer' : `+ ${lastRoutes.length - LEGEND_FIRST} more`}</button>` : ''}`;
  };
  // hover or focus a name: its route stands out; click: stays highlighted until clicked again
  let pinned: string | null = null;
  const routeKeyOf = (ev: Event) => (ev.target as Element).closest<HTMLElement>('[data-route]')?.dataset.route ?? null;
  const showRoute = (key: string | null) => {
    highlightRoute(map, key ? [key] : pinned ? [pinned] : []);
    legend.querySelectorAll<HTMLElement>('[data-route]').forEach((el) => el.classList.toggle('on', el.dataset.route === (key ?? pinned)));
  };
  legend.addEventListener('mouseover', (ev) => { const k = routeKeyOf(ev); if (k) showRoute(k); });
  legend.addEventListener('mouseout', (ev) => { if (routeKeyOf(ev)) showRoute(null); });
  legend.addEventListener('focusin', (ev) => { const k = routeKeyOf(ev); if (k) showRoute(k); });
  legend.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('[data-legend-all]')) {
      legendAll = !legendAll;
      return redrawLegend();
    }
    const k = routeKeyOf(ev);
    if (!k) return;
    pinned = pinned === k ? null : k;
    showRoute(null);
  });
  let redrawLegend = () => {};

  function persist() {
    const p = new URLSearchParams();
    writeSelection(sel, p);
    if (win) {
      p.set('from', String(win.from));
      p.set('to', String(win.to));
    }
    replaceQuery(p);
    try {
      localStorage.setItem(STORAGE_KEY, p.toString());
    } catch {
      /* private mode: the URL still has it */
    }
  }

  // ---- map -----------------------------------------------------------------------------------------

  let request = 0; // a slower, older response must not overwrite a newer one
  async function updateMap() {
    const mine = ++request;
    const stale = () => mine !== request;
    status.textContent = 'Loading…';
    try {
      if (win) await presence(win, stale);
      else if (chosen(sel).length) await routes(stale);
      else await overview(stale);
    } catch (err) {
      if (!stale()) showError(status, err);
    }
  }

  // Start map without single picks or a time window: every place plus the routes of everything selected, from all
  // dated presence links (one request; /v1/map/presence fails below year -4713, PostgreSQL's oldest date).
  const ALL_TIME = { from: -3000, to: new Date().getFullYear() + 1 };
  async function overview(stale: () => boolean) {
    const types = (['artist', 'person', 'artwork'] as const).filter((t) => sel[t].mode !== 'none');
    const [places, all] = await Promise.all([
      getPlacesMap(),
      types.length ? getPresence(ALL_TIME.from, ALL_TIME.to, [...types]) : Promise.resolve({ type: 'FeatureCollection', features: [] } as PresenceMap),
    ]);
    if (stale()) return;
    const rows = all.features.filter((f) => includes(sel, f.properties.entity.type, f.properties.entity.slug, creatorOf)).map((f) => f.properties);
    const where = new Map(places.features.map((f) => [f.properties.slug, f.geometry.coordinates] as const));
    useRoutes(showPlaces(map, places, rows, (slug) => where.get(slug)));
    crossings(rows, (slug) => where.get(slug));
    pinned = null;
    redrawLegend = () => render(legend, html`${routeLegend()}
      <span class="legend-key"><i class="dot" style="background:${COLORS.place}"></i> someone or something of the selection was there ·
        <i class="dot" style="background:${COLORS.association}"></i> associations only ·
        <i class="ring" style="border-color:${COLORS.place}"></i> country or region · lines = routes in date order</span>`);
    redrawLegend();
    const entries = new Set(rows.map((r) => `${r.entity.type}/${r.entity.slug}`)).size;
    status.textContent = rows.length
      ? `${entries} ${entries === 1 ? 'entry' : 'entries'} at ${new Set(rows.map((r) => r.place.slug)).size} places. Click a place to see what happened there; hover or click a route to follow it.`
      : 'Nothing in the selection has dated places yet.';
  }

  async function routes(stale: () => boolean) {
    useRoutes([]);
    const picks = chosen(sel);
    const shown = picks.slice(0, MAX_ROUTES);
    const maps = await Promise.all(shown.map((c) =>
      getEntityMap(PLURAL[c.type] as Exclude<Plural, 'places'>, c.slug).catch(() => null)));
    if (stale()) return;
    const items: ColoredEntityMap[] = maps.flatMap((fc, i) =>
      fc ? [{ fc, color: colorOf.get(shown[i].type, shown[i].slug) ?? PALETTE[0] }] : []);
    showSelection(map, items);
    const at = new Map<string, [number, number]>();
    const stays: Stay[] = items.flatMap((i) => i.fc.features.flatMap((f) => {
      if (f.geometry.type !== 'Point' || f.properties.layer !== 'presence') return [];
      const p = f.properties as StopProps;
      at.set(p.place.slug, f.geometry.coordinates as [number, number]);
      return [{ entity: i.fc.entity, place: p.place, label: p.label, period: p.period, note: p.note }];
    }));
    crossings(stays, (slug) => at.get(slug));
    const withPlaces = items.filter((i) => i.fc.features.some((f) => f.geometry.type === 'Point'));
    render(legend, html`${items.map((i) => html`<span><i class="dot" style="background:${i.color}"></i>
        <a href="${href(i.fc.entity.type, i.fc.entity.slug)}">${i.fc.entity.name}</a></span>`)}
      <span class="legend-key">filled dot + line = was there, in date order · ring = association, not travel</span>`);
    const missing = items.length - withPlaces.length;
    status.textContent = [
      `${withPlaces.length} of ${picks.length} chosen entries on the map.`,
      missing > 0 ? `${missing} without places yet.` : '',
      picks.length > MAX_ROUTES ? `Only the first ${MAX_ROUTES} are drawn; pick a time window to see all.` : '',
    ].filter(Boolean).join(' ');
  }

  async function presence(w: NonNullable<Window>, stale: () => boolean) {
    const types = (['artist', 'person', 'artwork'] as const).filter((t) => sel[t].mode !== 'none');
    const span = w.from === w.to ? `${w.from}` : `${w.from}–${w.to}`;
    pinned = null;
    redrawLegend = () => render(legend, html`${routeLegend()}
      <span class="legend-key"><i class="dot" style="background:${COLORS.presence}"></i> physically there in ${span} · lines = routes through the stops in ${span}, in date order</span>`);
    if (!types.length) {
      useRoutes(showPresence(map, { type: 'FeatureCollection', features: [] }));
      redrawLegend();
      status.textContent = 'Artists, people and artworks are all hidden, so there is nothing to place on the map.';
      return;
    }
    const fc = await getPresence(w.from, w.to, [...types]);
    if (stale()) return;
    // the API filters by type; single picks are filtered here (backend wish: an `entities=` parameter)
    const features = fc.features.filter((f) => includes(sel, f.properties.entity.type, f.properties.entity.slug, creatorOf));
    useRoutes(showPresence(map, { ...fc, features }));
    redrawLegend();
    const at = new Map(features.map((f) => [f.properties.place.slug, f.geometry.coordinates] as const));
    crossings(features.map((f) => f.properties), (slug) => at.get(slug));
    const who = new Set(features.map((f) => `${f.properties.entity.type}/${f.properties.entity.slug}`));
    const where = new Set(features.map((f) => f.properties.place.slug));
    status.textContent = features.length
      ? `${who.size} ${who.size === 1 ? 'entry' : 'people and works'} at ${where.size} ${where.size === 1 ? 'place' : 'places'} in ${span}. Click a circle for details.`
      : `Nothing in the selection is dated in ${span}.`;
  }

  // ---- timeline + pickers (need the entry lists) ---------------------------------------------------

  // an artwork's artist, for "works by the chosen artists" (known once the lists are loaded)
  const creators = new Map<string, string>();
  const creatorOf = (artwork: string) => creators.get(artwork);

  let timeline: ReturnType<typeof renderTimeline> | undefined;
  let timelineView: { from: number; to: number } | null = null; // zoom survives redraws when the picks change
  let lists: Awaited<ReturnType<typeof loadLists>> | undefined;

  function loadLists() {
    return Promise.all([
      listEntities('artists', LIST), listEntities('artworks', LIST),
      listEntities('movements', LIST), listEntities('polities', LIST), listEntities('people', LIST),
    ]).then(([artists, artworks, movements, polities, people]) => ({
      artists: artists.data, artworks: artworks.data, movements: movements.data, polities: polities.data, people: people.data,
    }));
  }

  function drawTimeline() {
    if (!lists) return;
    timeline?.destroy();
    const keep = <T extends { slug: string }>(type: EntityType, items: T[]) => items.filter((i) => includes(sel, type, i.slug));
    const rows: TimelineRow[] = [
      ...keep('polity', lists.polities).map((p) => ({ group: 'Polities', label: p.name, href: href('polity', p.slug), from: p.period, to: p.period, color: colorOf.get('polity', p.slug) })),
      ...keep('movement', lists.movements).map((m) => ({ group: 'Movements', label: m.name, href: href('movement', m.slug), from: m.period, to: m.period, color: colorOf.get('movement', m.slug) })),
      ...keep('artist', lists.artists).map((a) => ({ group: 'Artists', label: a.name, href: href('artist', a.slug), from: a.birth, to: a.death, color: colorOf.get('artist', a.slug) })),
      ...keep('person', lists.people).map((p) => ({ group: 'People', label: p.name, href: href('person', p.slug), from: p.birth ?? p.active, to: p.birth || p.death ? p.death : p.active, color: colorOf.get('person', p.slug) })),
    ];
    timeline = renderTimeline(timelineEl, rows, {
      initialWindow: win,
      initialView: timelineView,
      onView: (v) => (timelineView = v),
      onWindow: (w) => {
        win = w;
        persist();
        updateMap();
      },
    });
  }

  let pickers: ReturnType<typeof mountPickers> | undefined;
  loadLists()
    .then((l) => {
      if (!main.contains(timelineEl)) return;
      lists = l;
      l.artworks.forEach((a) => a.creator && creators.set(a.slug, a.creator.slug));
      updateMap(); // now artworks' artists are known: crossed paths leave out a work with its own artist, "by chosen artists" works
      const groups: PickerGroup[] = [
        { group: 'artist', plural: 'artists', label: 'Artists', entries: entries('artists', l.artists) },
        { group: 'artwork', plural: 'artworks', label: 'Artworks', entries: entries('artworks', l.artworks) },
        { group: 'movement', plural: 'movements', label: 'Movements', entries: entries('movements', l.movements) },
        { group: 'polity', plural: 'polities', label: 'Polities', entries: entries('polities', l.polities) },
        { group: 'person', plural: 'people', label: 'People', entries: entries('people', l.people) },
      ];
      pickers = mountPickers(pickersEl, groups, sel, (next) => {
        sel = next;
        colorOf.reset();
        persist();
        drawTimeline();
        updateMap();
      });
      drawTimeline();
    })
    .catch((err) => {
      showError(pickersEl, err);
      showError(timelineEl, err);
    });

  updateMap();

  return () => {
    pickers?.destroy();
    timeline?.destroy();
    map.remove();
  };
}
