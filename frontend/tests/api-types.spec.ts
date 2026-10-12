// src/types.ts against real responses: a JSON Schema is generated from the TypeScript types and each endpoint's
// answer is checked against it (through the dev proxy, so API_TARGET applies). A missing field or another type
// fails here instead of somewhere in a view; fields the frontend doesn't declare are allowed.
import Ajv, { type ValidateFunction } from 'ajv';
import { createGenerator } from 'ts-json-schema-generator';
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const ITEM: Record<string, string> = {
  artists: 'ArtistItem', artworks: 'ArtworkItem', places: 'PlaceItem', movements: 'MovementItem', institutions: 'InstitutionItem',
  people: 'PersonItem', polities: 'PolityItem', events: 'EventItem', glossary: 'TermItem', bibliography: 'SourceItem',
};
const DETAIL: Record<string, string> = {
  artists: 'Artist', artworks: 'Artwork', places: 'Place', movements: 'Movement', institutions: 'Institution',
  people: 'Person', polities: 'Polity', events: 'Event', glossary: 'Term', bibliography: 'Source',
};
const DETAILS_PER_TYPE = 5;

let ajv: Ajv;
test.beforeAll(() => {
  const schema = createGenerator({
    path: 'src/types.ts', tsconfig: 'tsconfig.json', type: '*', expose: 'export',
    additionalProperties: true, skipTypeCheck: true,
  }).createSchema('*');
  ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(schema, 'types');
});

const validator = (type: string) => {
  const v = ajv.getSchema(`types#/definitions/${type}`);
  if (!v) throw new Error(`no type ${type} in src/types.ts`);
  return v;
};

/** Up to 5 problems, readable: "artists/vincent-van-gogh /birth must be object". */
function problems(v: ValidateFunction, data: unknown, where: string): string[] {
  if (v(data)) return [];
  return (v.errors ?? []).slice(0, 5).map((e) => `${where} ${e.instancePath || '/'} ${e.message}`);
}

async function json(request: APIRequestContext, path: string) {
  const res = await request.get(`/v1${path}`);
  expect(res.ok(), `${path}: ${res.status()}`).toBe(true);
  return res.json();
}

test.describe.configure({ mode: 'parallel' });

for (const plural of Object.keys(ITEM)) {
  test(`types.ts matches the API: ${plural} (list and entries)`, async ({ request }) => {
    const list = await json(request, `/${plural}?limit=500`);
    const found = ['total', 'limit', 'offset'].filter((k) => typeof list[k] !== 'number').map((k) => `/${plural} ${k} is not a number`);
    const item = validator(ITEM[plural]);
    for (const x of list.data) found.push(...problems(item, x, `/${plural} item ${x.slug}`));
    const detail = validator(DETAIL[plural]);
    for (const x of list.data.slice(0, DETAILS_PER_TYPE)) {
      found.push(...problems(detail, await json(request, `/${plural}/${encodeURIComponent(x.slug)}`), `/${plural}/${x.slug}`));
    }
    expect(found).toEqual([]);
  });
}

test('types.ts matches the API: maps, graph, search, previews, vocabulary', async ({ request }) => {
  const found: string[] = [];
  const check = async (path: string, type: string) => found.push(...problems(validator(type), await json(request, path), path));
  await check('/map/artists/vincent-van-gogh', 'EntityMap');
  await check('/map/presence?from=1880&to=1890', 'PresenceMap');
  await check('/map/places', 'PlacesMap');
  await check('/map/events', 'EventsMap');
  await check('/map/sites', 'SitesMap');
  await check('/graph/artists/vincent-van-gogh?depth=2', 'Graph');
  const hits = await json(request, '/search?q=gogh');
  hits.data.forEach((h: unknown, i: number) => found.push(...problems(validator('SearchHit'), h, `/search hit ${i}`)));
  const previews = await json(request, '/previews?refs=artist/vincent-van-gogh,artwork/the-great-wave-off-kanagawa');
  Object.entries(previews.data).forEach(([ref, h]) => found.push(...problems(validator('EntryHint'), h, `/previews ${ref}`)));
  const vocabulary = await json(request, '/vocabulary');
  vocabulary.data.forEach((t: { code: string }) => found.push(...problems(validator('RelationshipType'), t, `/vocabulary ${t.code}`)));
  expect(found).toEqual([]);
});
