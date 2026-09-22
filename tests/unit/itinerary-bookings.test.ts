import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBookings } from '../../lib/itinerary-bookings.ts';

const VINNYS = { id: 'old-1', type: 'restaurant', title: "Dinner at the bar counter at Vinny's Italian Grill" };
const HOTEL_OLD = { id: 'old-2', type: 'hotel', title: '7 nights in Puerto Vallarta' };
const VICS = { id: 'new-1', type: 'restaurant', title: "Birthday dinner at Vic's Italian Restaurant" };
const HOTEL_NEW = { id: 'new-2', type: 'hotel', title: '7 nights in Puerto Vallarta' };

test('the Raleigh case: a dinner nobody booked goes with its line', () => {
  const out = reconcileBookings([VINNYS], [VICS], [{ id: 'b1', itinerary_item_id: 'old-1', status: 'pending' }]);
  assert.deepEqual(out, { relink: [], retire: ['b1'] });
});

test('a line saved unchanged keeps its booking, on its new id', () => {
  const out = reconcileBookings([HOTEL_OLD], [HOTEL_NEW], [{ id: 'b2', itinerary_item_id: 'old-2', status: 'awaiting_approval' }]);
  assert.deepEqual(out, { relink: [{ bookingId: 'b2', itemId: 'new-2' }], retire: [] });
});

test('a confirmed booking is never retired, whatever happened to its line', () => {
  const out = reconcileBookings([VINNYS], [VICS], [{ id: 'b3', itinerary_item_id: 'old-1', status: 'confirmed' }]);
  assert.deepEqual(out, { relink: [], retire: [] });
});

test('bookings already on a current line, or on none, are left alone', () => {
  const out = reconcileBookings([], [VICS], [
    { id: 'b4', itinerary_item_id: 'new-1', status: 'pending' },
    { id: 'b5', itinerary_item_id: null, status: 'pending' },
  ]);
  assert.deepEqual(out, { relink: [], retire: [] });
});

test('two bookings cannot both move onto one line', () => {
  const out = reconcileBookings(
    [HOTEL_OLD, { ...HOTEL_OLD, id: 'old-3' }], [HOTEL_NEW],
    [{ id: 'b6', itinerary_item_id: 'old-2', status: 'awaiting_approval' }, { id: 'b7', itinerary_item_id: 'old-3', status: 'quoted' }],
  );
  assert.deepEqual(out, { relink: [{ bookingId: 'b6', itemId: 'new-2' }], retire: ['b7'] });
});
