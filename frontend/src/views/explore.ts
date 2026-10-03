// Start page: every place on the map, a timeline of lifespans and periods; a time window on the timeline
// switches the map to who or what was physically where during that window.
import { getPlacesMap, getPresence, listEntities } from '../api';
import { href, html, render } from '../html';
import { COLORS, createMap, showPlaces, showPresence } from '../map';
import { renderTimeline, type TimelineRow } from '../timeline';
import { showError } from './common';

export function explore(main: HTMLElement) {
  render(main, html`<section class="explore">
    <div class="intro">
      <h1>Art history on a map and a timeline</h1>
      <p>Where artists were born, lived and travelled, where their works were made and where they are now. Pick a time window on the timeline to see who was where.</p>
    </div>
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

  const placesLegend = html`<span><i class="dot" style="background:${COLORS.place}"></i>someone or something was there</span>
    <span><i class="dot" style="background:${COLORS.association}"></i>associations only (e.g. influence)</span>
    <span><i class="dot" style="background:${COLORS.empty}"></i>no links yet</span>`;

  let request = 0; // a slower, older response must not overwrite a newer one
  async function overview() {
    const mine = ++request;
    render(legend, placesLegend);
    status.textContent = '';
    try {
      const fc = await getPlacesMap();
      if (mine !== request) return;
      showPlaces(map, fc);
      status.textContent = `${fc.features.length} places. Size = number of links.`;
    } catch (err) {
      showError(status, err);
    }
  }

  async function presence(from: number, to: number) {
    const mine = ++request;
    render(legend, html`<span><i class="dot" style="background:${COLORS.presence}"></i>physically there between ${from} and ${to}</span>`);
    status.textContent = 'Loading…';
    try {
      const fc = await getPresence(from, to);
      if (mine !== request) return;
      showPresence(map, fc);
      const people = new Set(fc.features.map((f) => `${f.properties.entity.type}/${f.properties.entity.slug}`));
      status.textContent = fc.features.length
        ? `${people.size} people and works at ${new Set(fc.features.map((f) => f.properties.place.slug)).size} places in ${from === to ? from : `${from}–${to}`}. Click a circle for details.`
        : `Nobody and nothing dated in ${from}–${to} yet.`;
    } catch (err) {
      showError(status, err);
    }
  }

  overview();

  let timeline: ReturnType<typeof renderTimeline> | undefined;
  const timelineEl = main.querySelector<HTMLElement>('#timeline')!;
  Promise.all([
    listEntities('artists', { limit: 500 }),
    listEntities('movements', { limit: 500 }),
    listEntities('patrons', { limit: 500 }),
  ])
    .then(([artists, movements, patrons]) => {
      if (!timelineEl.isConnected) return;
      const rows: TimelineRow[] = [
        ...movements.data.map((m) => ({ group: 'Movements', label: m.name, href: href('movement', m.slug), from: m.period, to: m.period })),
        ...artists.data.map((a) => ({ group: 'Artists', label: a.name, href: href('artist', a.slug), from: a.birth, to: a.death })),
        ...patrons.data.map((p) => ({ group: 'Patrons', label: p.name, href: href('patron', p.slug), from: p.active, to: p.active })),
      ];
      timeline = renderTimeline(timelineEl, rows, {
        onWindow: (w) => (w ? presence(w.from, w.to) : overview()),
      });
    })
    .catch((err) => showError(timelineEl, err));

  return () => {
    timeline?.destroy();
    map.remove();
  };
}
