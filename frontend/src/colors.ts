// Map and timeline colours, apart from map.ts so pages can use them without loading MapLibre.
export const COLORS = {
  site: '#3b4fa0', // museums, institutions and buildings with their own location
  encounter: '#e0a800', // places where paths crossed
  presence: '#b4462b',
  route: '#b4462b',
  association: '#5b4fbf',
  place: '#2f6f73',
  empty: '#9aa3a8',
  event: '#d4237a', // events: fires, trials, auctions, exhibitions
  provenance: '#a0702a', // an artwork's holders on its map (--c-provenance)
};

/** Distinguishable colours for chosen entities (map routes and their timeline bars). */
export const PALETTE = [
  '#e15759', '#4e79a7', '#f28e2b', '#59a14f', '#b07aa1', '#d4a514',
  '#2f9e9a', '#ff7fa0', '#9c755f', '#3b4fa0', '#c2256c', '#7fb800',
];
