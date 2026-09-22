import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeMenu, unverifiedNames, withoutUnverified, bookingFor, type RealPlace,
} from '../../lib/discovery/real-places.ts';

// ─── The rule this whole product rests on ───────────────────────────────
// Reach may only state what it has verified. These freeze the behaviour
// that was wrong this morning, so it cannot come back quietly.

test('a town we hold nothing for is told to name nothing', () => {
  // The honest answer, not a degraded one. An itinerary naming no venues in
  // a town we have never swept beats one naming a restaurant that is not
  // there — somebody stands outside a laundrette either way, and only one
  // of those is our doing.
  const menu = placeMenu([]);
  assert.match(menu, /NO VERIFIED VENUES/);
  assert.match(menu, /Name no restaurants, bars, shops, venues or businesses at all/);
  // Not softened into a suggestion.
  assert.doesNotMatch(menu, /if possible|try to|where you can|prefer/i);
});

test('an invented venue is caught before it reaches anybody', () => {
  // "El Charro Loco" shipped in a Moab itinerary and does not exist.
  const verified: RealPlace[] = [
    { ref: 'p1', name: "Milt's Stop & Eat", kind: 'restaurant', interest: null, url: null, city: 'Moab', source: 'osm' },
  ];
  assert.deepEqual(unverifiedNames('Dinner at El Charro Loco, then drinks.', verified), ['El Charro Loco']);
  const { text } = withoutUnverified('Dinner at El Charro Loco, then drinks.', verified);
  assert.doesNotMatch(text, /El Charro Loco/);
  assert.match(text, /Dinner/);
});

test('a verified venue is left exactly as it is', () => {
  const verified: RealPlace[] = [
    { ref: 'p1', name: "Milt's Stop & Eat", kind: 'restaurant', interest: null, url: null, city: 'Moab', source: 'osm' },
  ];
  const line = "Breakfast at Milt's Stop & Eat before the park.";
  assert.deepEqual(unverifiedNames(line, verified), []);
  assert.equal(withoutUnverified(line, verified).text, line);
});

test('Reach never claims to book what it cannot book', () => {
  // "Reach will book this" over a restaurant table is the promise this
  // session removed twice — the second time because I put it back.
  const diner: RealPlace = { ref: 'p1', name: 'Moab Diner', kind: 'restaurant', interest: null, url: null, city: 'Moab', source: 'osm' };
  const room: RealPlace = { ref: 'p2', name: 'The Gonzo Inn', kind: 'hotel', interest: 'hotels', url: null, city: 'Moab', source: 'osm' };
  assert.equal(bookingFor('reach', diner), 'ahead');
  assert.equal(bookingFor('reach', null), 'ahead');
  assert.equal(bookingFor('reach', null, true), 'ahead');   // a ticket is the seller's
  assert.equal(bookingFor('reach', room), 'reach');          // a room it does book
});

test('a poisoned answer is rejected, not tidied up', () => {
  // The read-back exists because a prompt rule is a request. Feed it an
  // answer naming a place nobody verified and it must come out changed.
  const verified: RealPlace[] = [
    { ref: 'p1', name: 'Pullen Arts Center', kind: 'arts centre', interest: null, url: null, city: 'Raleigh', source: 'osm' },
  ];
  const poisoned = 'Dinner at The Gilded Heron, then a nightcap at Vellum Bar.';
  const { text, removed } = withoutUnverified(poisoned, verified);
  assert.equal(removed.length, 2);
  assert.doesNotMatch(text, /Gilded Heron|Vellum Bar/);
});
