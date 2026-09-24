// Where a trip to a world destination lands: the town's own airport only
// when it is actually near the town, otherwise the nearest ones.
// Run with: npm run test:unit
//
// Duffel is stubbed; the airport coordinates in the stubs are the airports'
// real ones (Wikipedia, 2026-09-24), so the distances are the real distances.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalFor, OWN_AIRPORT_MILES } from '../../lib/booking/arrival.ts';

const AIRPORTS = {
  VLL: { name: 'Valladolid (Spain)', latitude: 41.7061, longitude: -4.8519 },
  AGU: { name: 'Aguascalientes (Mexico)', latitude: 21.7056, longitude: -102.3178 },
  CUZ: { name: 'Cusco', latitude: -13.5357, longitude: -71.9388 },
  CZA: { name: 'Chichén Itzá International', latitude: 20.6413, longitude: -88.4462 },
  MID: { name: 'Mérida', latitude: 20.9370, longitude: -89.6577 },
  CUN: { name: 'Cancún', latitude: 21.0365, longitude: -86.8771 },
  AQJ: { name: 'Aqaba', latitude: 29.6116, longitude: 35.0181 },
  AMM: { name: 'Amman Queen Alia', latitude: 31.7226, longitude: 35.9932 },
  AGR: { name: 'Agra', latitude: 27.1558, longitude: 77.9609 },
} as const;
type Code = keyof typeof AIRPORTS;
const airport = (iata: Code) => ({ type: 'airport', iata_code: iata, name: AIRPORTS[iata].name, latitude: AIRPORTS[iata].latitude, longitude: AIRPORTS[iata].longitude });

let byName: Record<string, Code[]> = {};
let nearby: Code[] = [];
let asked: string[] = [];
const realFetch = globalThis.fetch;
const realKey = process.env.DUFFEL_API_KEY;

beforeEach(() => {
  process.env.DUFFEL_API_KEY = 'duffel_test_stub';
  byName = {}; nearby = []; asked = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    asked.push(url.host + url.pathname + url.search);
    if (url.host.includes('nominatim')) throw new Error('the world list should not need the geocoder');
    const q = url.searchParams.get('query');
    const data = q != null ? (byName[q] ?? []).map(airport) : nearby.map(airport);
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.DUFFEL_API_KEY; else process.env.DUFFEL_API_KEY = realKey;
});

test('Valladolid, Yucatán does not fly a group to Valladolid, Spain', async () => {
  byName = { 'Valladolid, MX': ['VLL'] };
  nearby = ['MID', 'CUN', 'CZA'];
  const got = await arrivalFor({ city: 'Valladolid', countryCode: 'MX' });
  assert.notEqual(got?.iata, 'VLL');
  // Nearest first, from the world list's own point, with a car from there.
  assert.equal(got?.iata, 'CZA');
  assert.ok(got!.gateway!.miles < 20, `${got!.gateway!.miles} miles`);
  assert.ok(!asked.some(a => a.includes('nominatim')));
});

test('Aguas Calientes, under Machu Picchu, is not Aguascalientes, Mexico: it lands at Cusco', async () => {
  byName = { 'Aguas Calientes, PE': ['AGU'] };
  nearby = ['CUZ'];
  const got = await arrivalFor({ city: 'Aguas Calientes', countryCode: 'PE' });
  assert.equal(got?.iata, 'CUZ');
  assert.ok(got!.gateway!.miles > 30 && got!.gateway!.miles < 60, `${got!.gateway!.miles} miles, a rail or road leg`);
});

test('a town whose own airport is where it is keeps it: Cusco is CUZ, Agra is AGR', async () => {
  byName = { 'Cusco, PE': ['CUZ'], 'Agra, IN': ['AGR'] };
  assert.deepEqual(await arrivalFor({ city: 'Cusco', countryCode: 'PE' }), { iata: 'CUZ', gateway: null });
  assert.deepEqual(await arrivalFor({ city: 'Agra', countryCode: 'IN' }), { iata: 'AGR', gateway: null });
});

test('Wadi Musa, for Petra, has no airport of its own and lands at the nearest', async () => {
  nearby = ['AMM', 'AQJ'];
  const got = await arrivalFor({ city: 'Wadi Musa', countryCode: 'JO' });
  assert.equal(got?.iata, 'AQJ', 'Aqaba is nearer than Amman');
  assert.ok(got!.gateway!.miles < 80);
});

test('the check is a distance, and generous enough for a city code', () => {
  assert.ok(OWN_AIRPORT_MILES >= 40, "Stansted is 35 miles from London and is London's airport");
  assert.ok(OWN_AIRPORT_MILES < 200);
});
