// Start page: map + timeline over what the pickers select (per type: all, none or chosen entries).
// - no time window, nothing chosen individually → every place, sized by its number of links
// - no time window, entries chosen             → their routes and places, one colour per entry
// - a time window on the timeline              → who/what of the selection was physically where
// The state lives in the URL (/?artists=…&movements=none&from=1888&to=1889) and is remembered locally.
import { getEntityMap, getPlacesMap, getPresence, listEntities, PLURAL } from '../api';
import { entries } from '../catalog';
import { href, html, render } from '../html';
import { COLORS, createMap, PALETTE, showPlaces, showPresence, showSelection, type ColoredEntityMap } from '../map';
import { mountPickers, type PickerGroup } from '../picker';
import { replaceQuery } from '../router';
import { chosen, includes, isDefault, parseSelection, writeSelection, type Selection } from '../selection';
import { renderTimeline, type TimelineRow } from '../timeline';
import type { EntityType, Plural } from '../types';
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
  if (![...params.keys()].length) {
    const last = remembered();
    if (last && [...last.keys()].length) {
      params = last;
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
    <div id="pickers" class="pickers-wrap"><p class="muted small">Loading entries…</p></div>
    <div class="map-wrap">
      <div class="map" id="map"></div>
      <div class="legend" id="legend"></div>
    </div>
    <p class="map-status muted" id="map-status"></p>
    <div id="timeline"></div>
  </section>`);

  const map = createMap(main.querySelector<HTMLElement>('#map')!);
  const status = main.querySelector<HTMLElement>('#map-status')!;
  const legend = main.querySelector<HTMLElement>('#legend')!;
  const timelineEl = main.querySelector<HTMLElement>('#timeline')!;
  const pickersEl = main.querySelector<HTMLElement>('#pickers')!;

  const colorOf = (() => {
    let index = new Map<string, string>();
    return {
      reset() {
        index = new Map(chosen(sel).map((c, i) => [`${c.type}/${c.slug}`, PALETTE[i % PALETTE.length]]));
      },
      get: (type: EntityType, slug: string) => index.get(`${type}/${slug}`),
    };
  })();
  colorOf.reset();

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

  async function overview(stale: () => boolean) {
    const fc = await getPlacesMap();
    if (stale()) return;
    showPlaces(map, fc);
    render(legend, html`<span><i class="dot" style="background:${COLORS.place}"></i>someone or something was there</span>
      <span><i class="dot" style="background:${COLORS.association}"></i>associations only (e.g. influence)</span>
      <span><i class="dot" style="background:${COLORS.empty}"></i>no links yet</span>
      <span><i class="ring" style="border-color:${COLORS.place}"></i>ring = country or region</span>`);
    status.textContent = isDefault(sel)
      ? `${fc.features.length} places. Size = number of links. Pick entries above to see their routes.`
      : `${fc.features.length} places, counting all entries. Pick single entries above to see their routes, or a time window to filter.`;
  }

  async function routes(stale: () => boolean) {
    const picks = chosen(sel);
    const shown = picks.slice(0, MAX_ROUTES);
    const maps = await Promise.all(shown.map((c) =>
      getEntityMap(PLURAL[c.type] as Exclude<Plural, 'places'>, c.slug).catch(() => null)));
    if (stale()) return;
    const items: ColoredEntityMap[] = maps.flatMap((fc, i) =>
      fc ? [{ fc, color: colorOf.get(shown[i].type, shown[i].slug) ?? PALETTE[0] }] : []);
    showSelection(map, items);
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
    const types = (['artist', 'patron', 'artwork'] as const).filter((t) => sel[t].mode !== 'none');
    const span = w.from === w.to ? `${w.from}` : `${w.from}–${w.to}`;
    render(legend, html`<span><i class="dot" style="background:${COLORS.presence}"></i>physically there in ${span}</span>`);
    if (!types.length) {
      showPresence(map, { type: 'FeatureCollection', features: [] });
      status.textContent = 'Artists, patrons and artworks are all hidden, so there is nothing to place on the map.';
      return;
    }
    const fc = await getPresence(w.from, w.to, [...types]);
    if (stale()) return;
    // the API filters by type; single picks are filtered here (backend wish: an `entities=` parameter)
    const features = fc.features.filter((f) => includes(sel, f.properties.entity.type, f.properties.entity.slug, creatorOf));
    showPresence(map, { ...fc, features });
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
      listEntities('movements', LIST), listEntities('polities', LIST), listEntities('patrons', LIST),
    ]).then(([artists, artworks, movements, polities, patrons]) => ({
      artists: artists.data, artworks: artworks.data, movements: movements.data, polities: polities.data, patrons: patrons.data,
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
      ...keep('patron', lists.patrons).map((p) => ({ group: 'Patrons', label: p.name, href: href('patron', p.slug), from: p.active, to: p.active, color: colorOf.get('patron', p.slug) })),
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
      if (sel.artwork.mode === 'by-artists' && win) updateMap();
      const groups: PickerGroup[] = [
        { group: 'artist', plural: 'artists', label: 'Artists', entries: entries('artists', l.artists) },
        { group: 'artwork', plural: 'artworks', label: 'Artworks', entries: entries('artworks', l.artworks) },
        { group: 'movement', plural: 'movements', label: 'Movements', entries: entries('movements', l.movements) },
        { group: 'polity', plural: 'polities', label: 'Polities', entries: entries('polities', l.polities) },
        { group: 'patron', plural: 'patrons', label: 'Patrons', entries: entries('patrons', l.patrons) },
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
