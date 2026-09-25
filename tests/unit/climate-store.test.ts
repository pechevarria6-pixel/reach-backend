// Reading the climate we hold, and filling it.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readClimate, pickClimateRow, normalsFromRow, sameCountry, climateNotReady, climateFor } from '../../lib/climate-store.ts';
import { climatePlaces, countryOf, isStale, climateKey } from '../../lib/climate-places.ts';
import { fetchPower as fetchPowerJs } from '../../scripts/ingest/climate.mjs';
// These test the enforcement, which is switched off for the beta (lib/weather-no-go.ts).
process.env.REACH_TEST_CLIMATE_CHECKS = '1';

// The script is plain JavaScript; its fetcher is typed as the real fetch, and
// these fakes answer only what it reads.
const fetchPower = fetchPowerJs as (place: unknown, opts?: Record<string, unknown>) => Promise<any>;

const twelve = (v: number) => Array.from({ length: 12 }, () => v);
const row = (over: Record<string, unknown> = {}) => ({
  name: 'Paris', name_key: 'paris', country: 'FR', lat: 48.86, lng: 2.35,
  t2m: twelve(12), t2m_range: twelve(8), precip_mm_day: twelve(2), rh2m: twelve(70), cloud_pct: null, wind_ms: null,
  grid_elevation_m: 60, source: 'NASA POWER', period: '1981–2020', fetched_at: '2026-09-24T00:00:00Z', ...over,
});

function fakeDb(result: { data?: unknown[]; error?: { code: string; message: string } | null }) {
  const seen: Record<string, unknown> = {};
  const b: any = {
    select(c: string) { seen.select = c; return b; },
    eq(c: string, v: unknown) { seen[c] = v; return b; },
    limit() { return b; },
    then(resolve: (v: unknown) => void) { resolve({ data: result.error ? null : (result.data ?? []), error: result.error ?? null }); },
  };
  return { db: { from: (t: string) => { seen.table = t; return b; } } as any, seen };
}

test('Paris, France is not Paris, Texas: a namesake is never the answer', () => {
  const rows = [row(), row({ country: 'US', lat: 33.66, lng: -95.56 })];
  assert.equal(pickClimateRow(rows, { country: 'FR' })?.country, 'FR');
  assert.equal(pickClimateRow(rows, { country: 'US' })?.lat, 33.66);
  assert.equal(pickClimateRow(rows, {}), null, 'two held and no country: no guess');
  assert.equal(pickClimateRow(rows, { country: 'CA' }), null);
  assert.equal(pickClimateRow([row()], {})?.country, 'FR', 'held once, no country asked');
});

test('with a point, the nearest held row within a cell and a half, or nothing', () => {
  const rows = [row(), row({ country: 'US', lat: 33.66, lng: -95.56 })];
  assert.equal(pickClimateRow(rows, { lat: 33.7, lng: -95.5 })?.country, 'US');
  assert.equal(pickClimateRow(rows, { lat: 40, lng: -100 }), null);
});

test('a plan’s PR finds the Rincón the US file seeded', () => {
  assert.ok(sameCountry('US', 'PR'));
  assert.ok(!sameCountry('US', 'MX'));
  assert.equal(pickClimateRow([row({ name: 'Rincón', country: 'US' })], { country: 'PR' })?.name, 'Rincón');
});

test('a stored row with a month missing is not climate', () => {
  assert.ok(normalsFromRow(row()));
  assert.equal(normalsFromRow(row({ t2m: twelve(1).slice(0, 11) })), null);
  assert.equal(normalsFromRow(row({ precip_mm_day: [...twelve(1).slice(0, 11), null] })), null);
});

test('before the migration runs, "no climate held" — not an error, and not a crash', async () => {
  for (const code of ['PGRST205', '42P01', '42703']) {
    const { db } = fakeDb({ error: { code, message: 'relation "public.place_climate" does not exist' } });
    assert.deepEqual(await readClimate(db, { name: 'Moab' }), { normals: null, available: false }, code);
  }
  assert.ok(climateNotReady({ code: '42703', message: '' }));
  assert.ok(!climateNotReady({ code: '08006', message: 'connection' }));
});

test('it reads by the folded name, the part before the comma', async () => {
  const { db, seen } = fakeDb({ data: [row({ name: 'Rincón', name_key: 'rincon', country: 'US' })] });
  const got = await readClimate(db, { name: 'Rincón, Puerto Rico', country: 'PR' });
  assert.equal(seen.table, 'place_climate');
  assert.equal(seen.name_key, 'rincon');
  assert.equal(got.normals?.name, 'Rincón');
});

test('climateFor, the one call a suggestion makes: a cold place on cold dates is ruled out; nothing held is kept, unchecked', async () => {
  const cold = row({ name: 'Oslo', name_key: 'oslo', country: 'NO', t2m: twelve(-4), t2m_range: twelve(6) });
  const { db } = fakeDb({ data: [cold] });
  const out = await climateFor(db, { name: 'Oslo, Norway', country: 'NO' }, { start: '2027-01-10', end: '2027-01-15' }, ['coldWeather']);
  assert.equal(out.breach, 'coldWeather');
  assert.equal(out.climate?.trip?.when, 'January');
  assert.match(out.climate?.credit ?? '', /^NASA POWER 1981–2020 averages/);
  const none = await climateFor(fakeDb({ error: { code: 'PGRST205', message: '' } }).db, { name: 'Oslo' }, { start: '2027-01-10' }, ['coldWeather']);
  assert.deepEqual({ breach: none.breach, held: none.climate?.held, checked: none.climate?.checked, available: none.available },
    { breach: null, held: false, checked: false, available: false });
});

// ── The places the loader fills ─────────────────────────────────────────

test('a town seeded from two files is one place, and the world list is in it', () => {
  const places = climatePlaces([
    { name: 'Moab', lat: 38.5738096, lng: -109.546214, region: 'north-america/us/utah' },
    { name: 'Moab', lat: 38.5738096, lng: -109.546214, region: 'north-america/us/colorado' },
    { name: 'Rincón', lat: 18.3362074, lng: -67.2321202, region: 'north-america/us/puerto-rico' },
    { name: 'Nowhere', lat: 0, lng: 0, region: 'north-america/us/utah' },
  ]);
  assert.equal(places.filter(p => p.name === 'Moab').length, 1);
  assert.equal(places.find(p => p.name === 'Moab')?.lat, 38.57);
  assert.equal(places.find(p => p.name === 'Rincón')?.country, 'PR');
  assert.ok(places.some(p => p.name === 'Cusco' && p.country === 'PE'));
  assert.ok(!places.some(p => p.name === 'Nowhere'), 'Null Island is a missing coordinate');
  assert.equal(new Set(places.map(climateKey)).size, places.length);
});

test('a country is taken from what we hold, never guessed from a file name', () => {
  assert.equal(countryOf({ name: 'Raleigh', lat: 35.78, lng: -78.64, region: 'north-america/us/north-carolina' }), 'US');
  assert.equal(countryOf({ name: 'Agra', lat: 27.1767, lng: 78.0081, region: 'asia/india/central-zone' }), 'IN');
  assert.equal(countryOf({ name: 'Nassau', lat: 25.08, lng: -77.34, region: 'central-america/bahamas' }), null);
});

test('a row is asked for again only after a year', () => {
  const now = Date.parse('2026-09-24T00:00:00Z');
  assert.equal(isStale('2026-01-01T00:00:00Z', now), false);
  assert.equal(isStale('2025-09-01T00:00:00Z', now), true);
  assert.equal(isStale(null, now), true);
});

// ── Asking POWER ────────────────────────────────────────────────────────

const moab = JSON.parse(readFileSync(new URL('./fixtures/climate/moab.json', import.meta.url), 'utf8'));
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const PLACE = { name: 'Moab', name_key: 'moab', country: 'US', lat: 38.57, lng: -109.55 };

test('the loader asks politely: a User-Agent, and a retry with backoff on a 503', async () => {
  const calls: Array<{ url: string; ua: string }> = [];
  const waits: number[] = [];
  const answers = [reply(503, {}), reply(429, {}), reply(200, moab)];
  const got = await fetchPower(PLACE, {
    fetcher: async (url: string, init: any) => { calls.push({ url, ua: init.headers['User-Agent'] }); return answers.shift(); },
    wait: async (ms: number) => { waits.push(ms); },
  });
  assert.ok(got.normals, got.error);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [2000, 4000]);
  assert.match(calls[0].ua, /^ReachClimate\/1\.0 \(\+https:\/\/www\.alcanzar\.io/);
  assert.match(calls[0].url, /start=1981&end=2020/);
});

test('a request POWER refuses is not asked again, and a broken answer is an error, never data', async () => {
  let n = 0;
  const bad = await fetchPower(PLACE, { fetcher: async () => { n++; return reply(422, { messages: ['One of your parameters is incorrect'] }); }, wait: async () => {} });
  assert.equal(n, 1);
  assert.match(bad.error, /422/);
  const broken = { ...moab, properties: { parameter: { ...moab.properties.parameter, T2M: { ...moab.properties.parameter.T2M, JUL: -999 } } } };
  const r = await fetchPower(PLACE, { fetcher: async () => reply(200, broken), wait: async () => {} });
  assert.ok(r.error && !r.normals);
  const down = await fetchPower(PLACE, { attempts: 2, fetcher: async () => { throw new Error('ECONNRESET'); }, wait: async () => {} });
  assert.match(down.error, /gave up after 2 tries: ECONNRESET/);
});
