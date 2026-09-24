import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itineraryLines } from '../../lib/itinerary-email.ts';

test('a restaurant marked reach is the traveller\'s, not Reach\'s', () => {
  const { fixed, days } = itineraryLines([{ id: 'r', type: 'restaurant', title: 'Dinner at Alma', booking_mode: 'reach', cost_cents: 4500 }]);
  assert.equal(fixed.length, 0);
  assert.equal(days[0].title, 'Dinner at Alma');
});

test('each Reach line says what has actually happened to it', () => {
  const { fixed } = itineraryLines([
    { id: 'h', type: 'hotel', title: 'Hotel', booking_mode: 'reach', cost_cents: 30000 },
    { id: 'f', type: 'flight', title: 'Flight', booking_mode: 'reach', cost_cents: 25000 },
    { id: 'a', type: 'activity', title: 'Tour', booking_mode: 'reach', cost_cents: 5000 },
    { id: 'c', type: 'activity', title: 'Kayak', booking_mode: 'reach', cost_cents: 4000 },
  ], [
    { itinerary_item_id: 'h', status: 'failed' }, { itinerary_item_id: 'h', status: 'confirmed', provider_ref: 'LT123' },
    { itinerary_item_id: 'f', status: 'quoted' },
    { itinerary_item_id: 'a', status: 'failed' },
  ]);
  assert.deepEqual(fixed.map(f => f.state), [
    'Booked · LT123', 'Held back for later', "Didn't go through — open the trip to try again", 'Book it in Reach',
  ]);
});

test('an unpriced line is null and counted, never $0', () => {
  const { fixed, days, unpriced } = itineraryLines([
    { id: 'h', type: 'hotel', title: 'Hotel', booking_mode: 'reach', cost_cents: 0 },
    { id: 'w', type: 'activity', title: 'Walk', booking_mode: null, cost_cents: null },
  ]);
  assert.equal(fixed[0].cents, null);
  assert.equal(days[0].cents, null);
  assert.equal(unpriced, 1);
});
