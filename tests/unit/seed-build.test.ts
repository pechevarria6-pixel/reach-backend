// Placing the seeds: once per town, politely, and never losing what was
// placed when Nominatim says no.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeSeeds, politeGeocoder, memoFromSeeds, queryKey, NOT_FOUND_DAYS, NOMINATIM_SPACING_MS,
  type PlaceMemo, type Geocode,
} from '../../lib/discovery/seed-build.ts';
import { GeofabrikMap, type GeofabrikIndex } from '../../lib/discovery/geofabrik.ts';
import { locate, locateOrFail, type Located } from '../../lib/discovery/geocode.ts';
import { worldSeeds, type Seed } from '../../lib/discovery/regions.ts';

const box = (w: number, s: number, e: number, n: number) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const INDEX: GeofabrikIndex = {
  features: [
    { properties: { id: 'us', 'iso3166-1:alpha2': ['US'], urls: { pbf: 'https://download.geofabrik.de/north-america/us-latest.osm.pbf' } }, geometry: box(-125, 24, -66, 50) },
    { properties: { id: 'north-carolina', urls: { pbf: 'https://download.geofabrik.de/north-america/us/north-carolina-latest.osm.pbf' } }, geometry: box(-84.3, 33.8, -75.4, 36.588) },
    { properties: { id: 'virginia', urls: { pbf: 'https://download.geofabrik.de/north-america/us/virginia-latest.osm.pbf' } }, geometry: box(-83.7, 36.588, -75.2, 39.5) },
    { properties: { id: 'arkansas', urls: { pbf: 'https://download.geofabrik.de/north-america/us/arkansas-latest.osm.pbf' } }, geometry: box(-94.6, 33, -89.6, 36.5) },
  ],
};
const map = new GeofabrikMap(INDEX, ['north-america/us/north-carolina', 'north-america/us/virginia', 'north-america/us/arkansas']);

const NOW = new Date('2026-09-25T04:43:00Z');
const plan = (name: string, region: string | null = null, country = 'US') =>
  ({ name, region, country, source: 'plan' as const, sources: ['plan'] });
const at = (lat: number, lng: number, cc = 'us'): Located => ({ lat, lng, name: 'x', from: 'x', countryCode: cc, subdivision: null });

/** A geocoder that knows a few towns and counts what it was asked. */
function fakeGeocode(known: Record<string, Located | null>) {
  const asked: string[] = [];
  const geocode: Geocode = async (q) => { asked.push(q); return q in known ? known[q] : null; };
  return { geocode, asked };
}

test('a town already placed is never geocoded again', async () => {
  const memo = new Map<string, PlaceMemo>([[queryKey(plan('Raleigh')), {
    query_key: queryKey(plan('Raleigh')), name: 'Raleigh', lat: 35.78, lng: -78.64, country_code: 'US', asked_at: '2026-09-01T00:00:00Z',
  }]]);
  const g = fakeGeocode({});
  const out = await placeSeeds({ candidates: [plan('Raleigh')], memo, map, geocode: g.geocode, world: [], now: NOW });
  assert.deepEqual(g.asked, []);
  assert.equal(out.fromMemory, 1);
  assert.deepEqual(out.seeds.map(s => s.region), ['north-america/us/north-carolina']);
});

test('a town the geocoder could not place is remembered, and asked again only after a month', async () => {
  const key = queryKey(plan('Test'));
  const recent = new Map<string, PlaceMemo>([[key, { query_key: key, name: 'Test', lat: null, lng: null, country_code: null, asked_at: '2026-09-20T00:00:00Z' }]]);
  const g = fakeGeocode({});
  const out = await placeSeeds({ candidates: [plan('Test')], memo: recent, map, geocode: g.geocode, world: [], now: NOW });
  assert.deepEqual(g.asked, [], 'not asked every morning');
  assert.equal(out.skipped.length, 1);

  const old = new Map<string, PlaceMemo>([[key, { query_key: key, name: 'Test', lat: null, lng: null, country_code: null, asked_at: new Date(NOW.getTime() - (NOT_FOUND_DAYS + 1) * 86400_000).toISOString() }]]);
  const again = fakeGeocode({});
  const remembered: PlaceMemo[] = [];
  await placeSeeds({ candidates: [plan('Test')], memo: old, map, geocode: again.geocode, world: [], now: NOW, remember: r => { remembered.push(r); } });
  assert.deepEqual(again.asked, ['Test']);
  assert.equal(remembered[0].lat, null, 'still not found, and the new answer is what is remembered');
});

test('Fayetteville, NC and Fayetteville, AR are two towns, two keys, two regions', async () => {
  assert.notEqual(queryKey(plan('Fayetteville', 'NC')), queryKey(plan('Fayetteville', 'AR')));
  const g = fakeGeocode({ 'Fayetteville, NC': at(35.05, -78.88), 'Fayetteville, AR': at(36.06, -94.16) });
  const out = await placeSeeds({ candidates: [plan('Fayetteville', 'NC'), plan('Fayetteville', 'AR')], memo: new Map(), map, geocode: g.geocode, world: [], now: NOW });
  assert.deepEqual(out.seeds.map(s => s.region).sort(), ['north-america/us/arkansas', 'north-america/us/north-carolina']);
  assert.equal(out.remembered.length, 2);
});

test('which files a circle reaches comes from the polygons, not from thirteen more requests', async () => {
  const g = fakeGeocode({ 'Roanoke Rapids': at(36.46, -77.65) });
  const out = await placeSeeds({ candidates: [plan('Roanoke Rapids')], memo: new Map(), map, geocode: g.geocode, world: [], now: NOW });
  assert.equal(g.asked.length, 1, 'one request for the centre, none for the rim');
  assert.deepEqual(out.seeds.map(s => s.region), ['north-america/us/north-carolina', 'north-america/us/virginia']);
});

test('when the geocoder stops, everything placed so far is still kept and the rest wait', async () => {
  let calls = 0;
  const geocode: Geocode = async (q) => (++calls > 1 ? 'stopped' : (q === 'Raleigh' ? at(35.78, -78.64) : null));
  const world: Seed[] = [{ name: 'Somewhere', lat: 36, lng: -79, region: 'north-america/us/north-carolina', source: 'world' }];
  const out = await placeSeeds({
    candidates: [plan('Raleigh'), plan('Durham'), plan('Asheville')],
    memo: new Map(), map, geocode, world, now: NOW,
  });
  assert.equal(out.waiting, 2);
  assert.deepEqual(out.seeds.map(s => s.name).sort(), ['Raleigh', 'Somewhere'], 'the placed town and the world list, not nothing');
  assert.equal(out.remembered.length, 1, 'a refusal is not remembered as "not found"');
});

test('a plan to a wonder joins its base towns and costs the geocoder nothing', async () => {
  const g = fakeGeocode({});
  const out = await placeSeeds({ candidates: [plan('Machu Picchu', null, 'PE')], memo: new Map(), map, geocode: g.geocode, world: worldSeeds(), now: NOW });
  assert.deepEqual(g.asked, []);
  const bases = out.seeds.filter(s => s.name === 'Aguas Calientes' || s.name === 'Cusco');
  assert.equal(bases.length, 2);
  assert.ok(bases.every(s => s.source === 'plan,world'), JSON.stringify(bases));
});

test('a namesake of a wonder is geocoded as a town, not joined to the wonder', async () => {
  const g = fakeGeocode({});
  const out = await placeSeeds({
    candidates: [plan('Petra', 'Mallorca', 'ES'), plan('Corcovado', 'Costa Rica', ''), plan('Coliseum', 'Oakland', '')],
    memo: new Map(), map, geocode: g.geocode, world: worldSeeds(), now: NOW,
  });
  assert.deepEqual(g.asked, ['Petra, Mallorca', 'Corcovado, Costa Rica', 'Coliseum, Oakland']);
  for (const name of ['Wadi Musa', 'Rio de Janeiro', 'Rome']) {
    assert.ok(out.seeds.filter(s => s.name === name).every(s => s.source === 'world'), `${name} gained a plan it was never asked for`);
  }
});

test('before the migration, a stored seed stands in for the memory only when nothing disagrees', () => {
  const reuse = memoFromSeeds([
    { name: 'Raleigh', name_key: 'raleigh', lat: 35.78, lng: -78.64, region: 'north-america/us/north-carolina' },
    { name: 'Washington', name_key: 'washington', lat: 38.9, lng: -77.03, region: 'north-america/us/district-of-columbia' },
    { name: 'Washington', name_key: 'washington', lat: 38.9, lng: -77.03, region: 'north-america/us/maryland' },
    { name: 'Fayetteville', name_key: 'fayetteville', lat: 35.05, lng: -78.88, region: 'north-america/us/north-carolina' },
    { name: 'Fayetteville', name_key: 'fayetteville', lat: 36.06, lng: -94.16, region: 'north-america/us/arkansas' },
  ]);
  assert.deepEqual(reuse({ name: 'Raleigh', country: 'US' }), { lat: 35.78, lng: -78.64 });
  assert.deepEqual(reuse({ name: 'Raleigh', region: 'NC', country: 'US' }), { lat: 35.78, lng: -78.64 });
  assert.equal(reuse({ name: 'Raleigh', region: 'SC', country: 'US' }), null, 'a state that disagrees');
  assert.equal(reuse({ name: 'Raleigh', country: 'GB' }), null, 'a country that disagrees');
  assert.deepEqual(reuse({ name: 'Washington', country: 'US' }), { lat: 38.9, lng: -77.03 }, 'one town filed in two regions is one point');
  assert.equal(reuse({ name: 'Fayetteville', region: 'NC', country: 'US' }), null, 'two points: ask');
  assert.equal(reuse({ name: 'Raleigh', region: 'North Carolina, USA', country: 'US' }), null, 'a state spelt out is not checked, so it is asked');
});

// ── Nominatim's terms ──────────────────────────────────────────────────

/** A fetch that answers like Nominatim, with the status given for each call. */
function nominatim(statuses: number[]) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    const status = statuses[urls.length - 1] ?? 200;
    return {
      ok: status === 200, status,
      json: async () => [{ lat: '35.78', lon: '-78.64', display_name: 'Raleigh, NC', class: 'place', type: 'city', address: { country_code: 'us' } }],
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

test('at most one request a second', async () => {
  const { fetchImpl } = nominatim([]);
  let now = 0;
  const waits: number[] = [];
  const g = politeGeocoder({ locate, fetchImpl, cap: 10, clock: () => now, sleep: async ms => { waits.push(ms); now += ms; } });
  for (const town of ['A', 'B', 'C']) { await g.geocode(town, null); now += 50; }
  assert.equal(g.asked(), 3);
  assert.equal(waits.length, 2);
  for (const w of waits) assert.ok(w >= NOMINATIM_SPACING_MS - 50, `waited only ${w} ms`);
});

test('a 429 stops the asking at once, and is not taken for "no such town"', async () => {
  const { fetchImpl, urls } = nominatim([200, 429, 200]);
  const g = politeGeocoder({ locate, fetchImpl, cap: 10, sleep: async () => {} });
  assert.notEqual(await g.geocode('Raleigh', null), 'stopped');
  assert.equal(await g.geocode('Durham', null), 'stopped');
  assert.equal(await g.geocode('Cary', null), 'stopped');
  assert.equal(urls.length, 2, 'nothing asked after the 429');
  assert.match(String(g.stopped()), /429/);
});

test('a run asks at most its cap', async () => {
  const { fetchImpl, urls } = nominatim([]);
  const g = politeGeocoder({ locate, fetchImpl, cap: 2, sleep: async () => {} });
  const answers = [];
  for (const town of ['A', 'B', 'C', 'D']) answers.push(await g.geocode(town, null));
  assert.equal(urls.length, 2);
  assert.deepEqual(answers.slice(2), ['stopped', 'stopped']);
  assert.match(String(g.stopped()), /cap of 2/);
});

// ── A failed request is not "no such town" ─────────────────────────────

/** A fetch that fails the way Nominatim does on a bad day. */
function failing(kind: '503' | 'timeout' | 'network' | 'garbage') {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (kind === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    if (kind === 'network') throw new TypeError('fetch failed');
    if (kind === 'garbage') return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    return { ok: false, status: 503, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

for (const kind of ['503', 'timeout', 'network', 'garbage'] as const) {
  test(`a ${kind} from Nominatim is never remembered as "could not place it"`, async () => {
    // Plain `locate` hides a 200 whose body is not JSON; only the fetch's own
    // failures are caught around it, which is why build-seeds uses locateOrFail.
    for (const loc of kind === 'garbage' ? [locateOrFail] : [locate, locateOrFail]) {
      const { fetchImpl } = failing(kind);
      const g = politeGeocoder({ locate: loc, fetchImpl, cap: 10, sleep: async () => {} });
      const remembered: PlaceMemo[] = [];
      const memo = new Map<string, PlaceMemo>();
      const out = await placeSeeds({
        candidates: [plan('Lyon', null, 'FR')], memo, map, geocode: g.geocode, world: [], now: NOW,
        remember: r => { remembered.push(r); },
      });
      assert.equal(remembered.length, 0, `${loc.name}: nothing learned, nothing remembered`);
      assert.equal(memo.size, 0);
      assert.equal(out.skipped.length, 0, 'not skipped as unplaceable');
      assert.equal(out.waiting, 1, 'it waits for the next run');
    }
  });
}

test('locateOrFail tells a failed request from a town that is not there', async () => {
  assert.equal(await locateOrFail('Lyon', 'FR', failing('503').fetchImpl), 'failed');
  assert.equal(await locateOrFail('Lyon', 'FR', failing('timeout').fetchImpl), 'failed');
  const none = (async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch;
  assert.equal(await locateOrFail('Nowherecityxyz', 'US', none), null);
  assert.equal(await locate('Lyon', 'FR', failing('503').fetchImpl), null, 'locate itself still answers null');
});

test('Nominatim failing three times in a row stops the run, and a success in between resets it', async () => {
  const { fetchImpl, calls } = failing('503');
  const g = politeGeocoder({ locate: locateOrFail, fetchImpl, cap: 10, sleep: async () => {} });
  const answers = [];
  for (const town of ['A', 'B', 'C', 'D', 'E']) answers.push(await g.geocode(town, null));
  assert.deepEqual(answers, ['failed', 'failed', 'failed', 'stopped', 'stopped']);
  assert.equal(calls(), 3);
  assert.match(String(g.stopped()), /no answer/);

  const { fetchImpl: mixed } = nominatim([503, 503, 200, 503, 503, 200]);
  const h = politeGeocoder({ locate: locateOrFail, fetchImpl: mixed, cap: 10, sleep: async () => {} });
  const got = [];
  for (const town of ['A', 'B', 'C', 'D', 'E', 'F']) { const r = await h.geocode(town, null); got.push(typeof r === 'string' ? r : 'found'); }
  assert.deepEqual(got, ['failed', 'failed', 'found', 'failed', 'failed', 'found']);
  assert.equal(h.stopped(), null);
});
