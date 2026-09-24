// Seeds: the towns the weekly map load reads around, and which download holds them.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  regionFor, knownRegions, geofabrikUrl, dedupeSeeds, seedKey, seedName, seedCandidates, probePoints,
  type Seed,
} from '../../lib/discovery/regions.ts';

test('a US point is filed under its state, and Scotland under the United Kingdom', () => {
  assert.equal(regionFor({ countryCode: 'us', subdivision: 'US-NC' }), 'north-america/us/north-carolina');
  assert.equal(regionFor({ countryCode: 'us', subdivision: 'US-DC' }), 'north-america/us/district-of-columbia');
  assert.equal(regionFor({ countryCode: 'gb', subdivision: 'GB-SCT' }), 'europe/united-kingdom/scotland');
  assert.equal(regionFor({ countryCode: 'mx' }), 'north-america/mexico');
  assert.equal(regionFor({ countryCode: 'bs' }), 'central-america/bahamas');
});

test('Puerto Rico lands on one file whichever way it is described', () => {
  assert.equal(regionFor({ countryCode: 'us', subdivision: 'US-PR' }), 'north-america/us/puerto-rico');
  assert.equal(regionFor({ countryCode: 'PR' }), 'north-america/us/puerto-rico');
});

test('a country the table does not know is null, never the nearest path that looks right', () => {
  assert.equal(regionFor({ countryCode: 'fr', subdivision: 'FR-IDF' }), null);
  assert.equal(regionFor({ countryCode: 'us', subdivision: null }), null);
  assert.equal(regionFor({}), null);
});

test('every known region becomes a Geofabrik URL of the same shape', () => {
  for (const r of knownRegions()) {
    assert.match(geofabrikUrl(r), /^https:\/\/download\.geofabrik\.de\/[a-z-]+(\/[a-z-]+)+-latest\.osm\.pbf$/);
  }
});

test('the three queued Cancún profiles are one seed, accents and case folded', () => {
  const at = (name: string, source: string): Seed => ({ name, lat: 21.16, lng: -86.85, region: 'north-america/mexico', source });
  const seeds = dedupeSeeds([at('Cancún', 'plan'), at('Cancun', 'profile'), at('CANCUN', 'profile'), at('cancun', 'area')]);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].name, 'Cancún', 'the spelling somebody typed is kept');
  assert.equal(seeds[0].source, 'area,plan,profile');
});

test('the same town in two regions is two seeds: a circle that crosses a border reads both files', () => {
  const dc = { name: 'Washington', lat: 38.9, lng: -77.03, source: 'plan' };
  const seeds = dedupeSeeds([
    { ...dc, region: 'north-america/us/district-of-columbia' },
    { ...dc, region: 'north-america/us/maryland' },
    { ...dc, region: 'north-america/us/maryland' },
  ]);
  assert.equal(seeds.length, 2);
  assert.notEqual(seedKey('Washington', 'a'), seedKey('Washington', 'b'));
});

test('a seed with no point is dropped rather than read around Null Island', () => {
  assert.equal(dedupeSeeds([{ name: 'X', lat: NaN, lng: 1, region: 'r', source: 'plan' }]).length, 0);
});

test('names are towns: the state goes to the geocoder, and an airport code is not a town', () => {
  assert.equal(seedName('Southern Pines, NC'), 'Southern Pines');
  assert.equal(seedName('ABE'), null);
  assert.equal(seedName('  '), null);
});

test('plans, profiles and areas become one candidate per town, one geocoder request each', () => {
  const candidates = seedCandidates({
    plans: [{ destination_city: 'Raleigh', destination_country: 'US' }, { destination_city: 'Raleigh', destination_country: 'US' }, { destination_city: 'Rincón', destination_country: 'PR' }],
    profiles: [
      { city: 'Raleigh', region: 'NC', country: 'US' },
      { city: 'Cancun', country: 'MX' }, { city: 'Cancun', country: 'MX' }, { city: 'Cancun', country: 'MX' },
      { city: 'San Juan', country: 'PR' }, { city: 'San Juan', country: 'PR' }, { city: 'San Juan', country: 'PR' },
      { city: 'Nassau', country: 'BS' }, { city: 'Nassau', country: 'BS' }, { city: 'Nassau', country: 'BS' },
    ],
    areas: [
      { city: 'Raleigh', lat: 35.8, lng: -78.6 },
      { city: 'Seattle', lat: 47.6, lng: -122.3 },
      { city: 'ABE', lat: 40.6, lng: -75.4 },
      { city: 'Nowhere', lat: 0, lng: 0 },
    ],
  });
  const names = candidates.map(c => c.name).sort();
  assert.deepEqual(names, ['Cancun', 'Nassau', 'Raleigh', 'Rincón', 'San Juan', 'Seattle']);
  const raleigh = candidates.find(c => c.name === 'Raleigh')!;
  assert.deepEqual(raleigh.sources.sort(), ['area', 'plan', 'profile']);
  assert.equal(candidates.find(c => c.name === 'Seattle')!.lat, 47.6, 'an area already has its point');
});

test('a circle is probed at its centre, its rim and halfway out', () => {
  const pts = probePoints(38.9, -77.03, 100);
  assert.equal(pts.length, 13);
  assert.deepEqual(pts[0], { lat: 38.9, lng: -77.03 });
  const north = pts[1];
  assert.ok(Math.abs(north.lat - (38.9 + 100 / 69)) < 0.001);
});
