import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRealPlace, realPlacesAmong } from '../../lib/discovery/is-place.ts';

const PV = { lat: 20.62, lng: -105.23 };

/** A stand-in for the map, so these tests do not depend on a live service. */
function mapReturning(rows: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;
}

test('a beach near the destination is a real place', () => {
  // Verified against the live map before this was written: Playa Los
  // Muertos, Rio Cuale and the Romantic Zone all resolve; El Charro Loco,
  // La Piazzetta and Moab Giants do not.
  return isRealPlace('Playa Los Muertos', PV, mapReturning([
    { class: 'natural', type: 'beach', lat: '20.60', lon: '-105.23' },
  ])).then(r => assert.equal(r, true));
});

test('a business is not geography, whatever class it arrives under', async () => {
  // tourism covers a viewpoint and a hotel; leisure covers a park and a gym.
  // The venue table is the only thing allowed to vouch for a business,
  // because that is what the sweep actually verified.
  assert.equal(await isRealPlace('Hotel Rosita', PV, mapReturning([
    { class: 'tourism', type: 'hotel', lat: '20.61', lon: '-105.23' },
  ])), false);
  assert.equal(await isRealPlace('Some Gym', PV, mapReturning([
    { class: 'leisure', type: 'fitness_centre', lat: '20.61', lon: '-105.23' },
  ])), false);
});

test('a place with that name somewhere else is not this place', async () => {
  // "Test" once resolved to a canal in Iran. A name is only that place if it
  // is where somebody is actually going.
  assert.equal(await isRealPlace('Somewhere Else', PV, mapReturning([
    { class: 'place', type: 'suburb', lat: '51.50', lon: '-0.12' },
  ])), false);
});

test('an amenity the map does not know is not waved through', async () => {
  assert.equal(await isRealPlace('El Charro Loco', PV, mapReturning([])), false);
});

test('a map that fails softens rather than vouches', async () => {
  // A distinct name on purpose: answers are memoised for the life of the
  // process, which is right — a beach does not move, and the second person
  // planning the same trip should not ask again — but it means a name
  // another test already resolved would answer from memory, not from this
  // broken map, and the test would pass without testing anything.
  const broken = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  assert.equal(await isRealPlace('A Beach Nobody Asked About Yet', PV, broken), false);
});

test('a name too short to mean anything is not asked about', async () => {
  let asked = 0;
  const counting = (async () => { asked++; return new Response('[]', { status: 200 }); }) as unknown as typeof fetch;
  assert.equal(await isRealPlace('La', PV, counting), false);
  assert.equal(asked, 0);
});

test('only the real ones come back from a batch', async () => {
  const real = await realPlacesAmong(['A Real Beach'], PV, mapReturning([
    { class: 'natural', type: 'beach', lat: '20.60', lon: '-105.23' },
  ]));
  assert.deepEqual([...real], ['A Real Beach']);
});
