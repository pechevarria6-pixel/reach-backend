import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJourney } from '../../lib/travel-slot.ts';

// Both verbatim from itinerary_items, typed as a restaurant and an activity
// to book ahead.
test('the lines that shipped are the journey', () => {
  for (const line of ['Flight home.', 'Head to the airport or next stop']) {
    assert.ok(isJourney(line), `not caught: ${line}`);
  }
});

test('other ways of saying it', () => {
  for (const line of ['Fly home', 'Catch your flight back', 'Drive home', 'Departure day — transfer out', 'Transfer to the airport']) {
    assert.ok(isJourney(line), `not caught: ${line}`);
  }
});

// Verbatim too: this one is free time, and it stays an activity.
test('a slot that only mentions the airport is not the journey', () => {
  for (const line of [
    'Free time to pack and settle up before heading to the airport.',
    'Dinner near the airport at Mariscos Tino\'s',
    'Home-style tacos at a market stall',
    '',
  ]) {
    assert.ok(!isJourney(line), `wrongly caught: ${line}`);
  }
});
