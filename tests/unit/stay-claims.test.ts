import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stayClaim, withoutStayClaim } from '../../lib/stay-claims.ts';

// The three lines exactly as they sit in the itinerary_items table for the
// Moab plan, which has no hotel item and no hotel booking.
const MOAB = [
  'Arrive in Moab, check into the hotel, unpack and get oriented with a slow walk around downtown',
  'An afternoon doing nothing in particular back at the hotel pool',
  'Check out of the hotel and head to the airport or next stop',
];

test('the three lines that shipped are all caught', () => {
  for (const line of MOAB) {
    assert.ok(stayClaim(line), `not caught: ${line}`);
  }
});

test('the real day survives, the invented room does not', () => {
  // Three true things and one invented one. Throwing the line away loses a
  // real day; taking out the middle clause leaves a day that is still a day.
  const { text, removed } = withoutStayClaim(MOAB[0]);
  assert.equal(removed, 'check into');
  assert.equal(text, 'Arrive in Moab, unpack and get oriented with a slow walk around downtown');
  assert.equal(stayClaim(text), null);
});

test('a line that is nothing but the invented room comes back null', () => {
  // "An afternoon doing nothing in particular back at the hotel pool" minus
  // the pool is a true sentence, but "Check out of the hotel and head to the
  // airport" minus the stay is not a day. There is no replacement sentence in
  // that module on purpose — inventing one is how this started.
  const { text } = withoutStayClaim('back at the hotel pool');
  assert.equal(text, null);
});

test('a flight check-in is not a hotel', () => {
  // The one legitimate check-in on a trip. Catching it would strip a genuinely useful
  // line about a boarding pass.
  assert.equal(stayClaim('Check in for the flight the night before'), null);
  assert.equal(stayClaim('Online check-in for your flight opens 24 hours out'), null);
});

test('naming the hotel bar is a venue question, not this one', () => {
  // "The hotel bar is worth a drink" names a business, and whether that
  // business exists is the verified-venue rule's job. This rule is only about
  // being written into a room nobody booked.
  assert.equal(stayClaim('The Hotel Congress bar has live music on Fridays'), null);
});

test('the other ways a plan puts somebody in a room', () => {
  for (const line of [
    'Breakfast is included, so start there',
    'Drop your bags at the hotel and head straight out',
    'A quiet hour back at your apartment before dinner',
    'Head up to the rooftop bar at the hotel',
  ]) {
    assert.ok(stayClaim(line), `not caught: ${line}`);
  }
});

test('an ordinary day is left completely alone', () => {
  const day = 'Breakfast at Jailhouse Cafe, then the Fiery Furnace trail while it is cool';
  assert.equal(stayClaim(day), null);
  assert.equal(withoutStayClaim(day).text, day);
});

test('a real breakfast survives an invented checkout', () => {
  // "Breakfast at Milt's Stop & Eat before checkout" — the breakfast is a
  // real place on a real morning; the checkout is a hotel nobody booked.
  // Splitting on commas alone threw the whole line away for want of a comma.
  const { text, removed } = withoutStayClaim("Breakfast at Milt's Stop & Eat before checkout");
  assert.equal(removed, 'checkout');
  assert.equal(text, "Breakfast at Milt's Stop & Eat");
});

test('a true sentence before an invented tail is kept', () => {
  // "An afternoon doing nothing in particular" is the exact phrasing the
  // generator is told to use when it has no venue to name. It is a true
  // sentence about a real day; the pool is the only invented part.
  const { text } = withoutStayClaim('An afternoon doing nothing in particular back at the hotel pool');
  assert.equal(text, 'An afternoon doing nothing in particular');
});

test('a true sentence after an invented lead is kept', () => {
  const { text } = withoutStayClaim('Check out of the hotel and head to the airport or next stop');
  assert.equal(text, 'Head to the airport or next stop');
});

test('a short leftover is still refused', () => {
  // Four words is the floor. "back at the hotel pool" has nothing in front of
  // it, and a two-word fragment on a screen reads as a bug, which it is.
  assert.equal(withoutStayClaim('back at the hotel pool').text, null);
});
