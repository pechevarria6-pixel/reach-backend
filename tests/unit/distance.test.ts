import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineMiles, parseMiles, milesOf, bandOf, byDistance } from '../../lib/discovery/distance.ts';

const SOUTHERN_PINES = { lat: 35.17, lng: -79.39 };

const finding = (over: Record<string, unknown>) => ({
  id: 'x', title: 't', meta: '', emoji: '', price: null, dist: null,
  category: 'c', url: '', date: null, venue: null, source: 'osm',
  because: null, ...over,
} as never);

test('miles between two real points', () => {
  // Southern Pines to Raleigh is a bit under 60 miles.
  const raleigh = { lat: 35.78, lng: -78.64 };
  const miles = haversineMiles(SOUTHERN_PINES, raleigh);
  assert.ok(miles > 50 && miles < 65, `got ${miles}`);
  assert.equal(Math.round(haversineMiles(SOUTHERN_PINES, SOUTHERN_PINES)), 0);
});

test('the distance a provider writes as words', () => {
  assert.equal(parseMiles('60 mi'), 60);
  assert.equal(parseMiles('1 mi'), 1);
  assert.equal(parseMiles('12.5 mi'), 12.5);
  assert.equal(parseMiles(null), null);
  assert.equal(parseMiles('nearby'), null);
});

test('a point is preferred, a provider distance is the fallback', () => {
  // Coordinates are a fact; the string is somebody else's measurement.
  const withPoint = finding({ lat: 35.78, lng: -78.64, dist: '999 mi' });
  assert.ok((milesOf(withPoint, SOUTHERN_PINES) as number) < 65);
  // Ticketmaster and Yelp send this and no point, which is most of the list.
  assert.equal(milesOf(finding({ dist: '60 mi' }), SOUTHERN_PINES), 60);
  assert.equal(milesOf(finding({}), SOUTHERN_PINES), null);
});

test('an unknown distance sorts last and is never treated as zero', () => {
  assert.equal(bandOf(null), Number.POSITIVE_INFINITY);
  assert.equal(bandOf(0), 0);
  assert.equal(bandOf(9.9), 0);
  assert.equal(bandOf(10), 1);
  assert.equal(bandOf(60), 6);
});

test('nearest band first, and nothing without a distance jumps the queue', () => {
  const rows = [
    finding({ id: 'far', dist: '60 mi' }),
    finding({ id: 'unknown' }),
    finding({ id: 'near', dist: '1 mi' }),
    finding({ id: 'mid', dist: '15 mi' }),
  ];
  assert.deepEqual(
    byDistance(rows, SOUTHERN_PINES).map(f => f.id),
    ['near', 'mid', 'far', 'unknown'],
  );
});

test('inside a band the ranking survives', () => {
  // The whole reason this is banded rather than sorted by exact yards: a
  // pottery class somebody asked for, four miles away, must still beat a
  // stadium show three miles away that they did not.
  const rows = [
    finding({ id: 'the-thing-they-asked-for', dist: '4 mi', because: 'pottery' }),
    finding({ id: 'a-stadium-show', dist: '3 mi' }),
  ];
  assert.deepEqual(
    byDistance(rows, SOUTHERN_PINES).map(f => f.id),
    ['the-thing-they-asked-for', 'a-stadium-show'],
  );
});

test('sorting never throws on the shapes real sources send', () => {
  const rows = [
    finding({ id: 'a', lat: null, lng: null }),
    finding({ id: 'b', lat: 35.2, lng: undefined }),
    finding({ id: 'c', dist: '' }),
    finding({ id: 'd', dist: 'mi' }),
  ];
  assert.equal(byDistance(rows, SOUTHERN_PINES).length, 4);
  // And with no origin at all, which is what happens before a location is
  // resolved — the provider's own distances still order the list.
  assert.equal(byDistance(rows, null).length, 4);
  assert.deepEqual(byDistance([], SOUTHERN_PINES), []);
});
