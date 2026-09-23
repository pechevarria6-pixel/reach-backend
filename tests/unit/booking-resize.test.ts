// Run with: npm run test:unit
// A quote is for a number of people. A trip for one that somebody joins must
// not go on handing back a one-seat quote to a party of two.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomsFor, sizeOf, sizeFor, partyFor, isStaleForParty, resized, repricing } from '../../lib/booking/resize.ts';
import { findDuplicate, findStale, identityOf } from '../../lib/booking/duplicate.ts';
import { partySize } from '../../lib/participation.ts';

const flight = (seats?: number, extra: Record<string, unknown> = {}) => ({
  vertical: 'flight',
  itineraryItemId: 'line-1', title: 'Flight to Puerto Vallarta',
  travelers: [{ firstName: 'Ana' }],
  flight: {
    origin: 'RDU', destination: 'PVR', departDate: '2026-11-02', returnDate: '2026-11-09',
    offerKey: 'AA100|AA101', ...(seats === undefined ? {} : { seats }), ...extra,
  },
});
const hotel = (rooms?: number) => ({
  vertical: 'hotel',
  hotel: { hotelId: 'lp81ecd', city: 'Puerto Vallarta', checkin: '2026-11-02', checkout: '2026-11-09', ...(rooms === undefined ? {} : { rooms }) },
});
const row = (status: string, payload: Record<string, unknown>) => ({ status, vertical: payload.vertical as string, request_payload: payload });

test('one room for every two people', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(roomsFor), [1, 1, 2, 2, 3]);
  assert.equal(roomsFor(0), 1);
  assert.equal(roomsFor(Number.NaN), 1);
});

test('how many a request is for', () => {
  assert.equal(sizeOf(flight(2)), 2);
  assert.equal(sizeOf(hotel(3)), 3);
  assert.equal(sizeOf(flight()), 1, 'a stored row with no seats was priced as one');
  assert.equal(sizeOf(flight(), null), null, 'an incoming request that does not say cannot disagree');
  assert.equal(sizeOf({ vertical: 'restaurant', restaurant: { partySize: 4 } }), null, 'a table is not priced per head');
  assert.equal(sizeFor('flight', 3), 3);
  assert.equal(sizeFor('hotel', 3), 2);
  assert.equal(sizeFor('activity', 3), null);
});

test('only an unbought quote for a different number is stale', () => {
  assert.equal(isStaleForParty(row('awaiting_approval', flight(1)), 2), true);
  assert.equal(isStaleForParty(row('quoted', flight(1)), 2), true, 'a hold is not bought either');
  assert.equal(isStaleForParty(row('awaiting_approval', flight(2)), 2), false);
  assert.equal(isStaleForParty(row('confirmed', flight(1)), 2), false, 'a bought seat is never quietly swapped');
  assert.equal(isStaleForParty(row('pending', flight(1)), 2), false);
  // One to two people is still one room: the hotel quote already assumed two to a room.
  assert.equal(isStaleForParty(row('awaiting_approval', hotel(1)), 2), false);
  assert.equal(isStaleForParty(row('awaiting_approval', hotel(1)), 3), true);
});

test('who a booking is for: everybody going, less whoever is kept off it', () => {
  const skips = [{ ref: 'b1', userId: 'u-new' }, { ref: 'b1', userId: 'u-gone' }, { ref: 'b2', userId: 'u-solo' }];
  assert.equal(partyFor(2, ['u-solo', 'u-new'], skips, 'b1'), 1);
  assert.equal(partyFor(2, ['u-solo', 'u-new'], [], 'b1'), 2);
  assert.equal(partyFor(1, ['u-solo'], [{ ref: 'b1', userId: 'u-solo' }], 'b1'), 1, 'never fewer than one');
});

test('re-sized is the same flight and the same room, for more people', () => {
  const two = resized(flight(1), 2) as ReturnType<typeof flight>;
  assert.equal(two.flight.seats, 2);
  assert.equal(two.flight.offerKey, 'AA100|AA101', 'the flights that were chosen');
  assert.equal(two.itineraryItemId, 'line-1');
  assert.deepEqual(two.travelers, [], 'nobody is named at quote time');
  assert.equal(identityOf(two), identityOf(flight(1)), 'the same thing, so the old quote is the one it replaces');
  const rooms = resized(hotel(1), 4) as ReturnType<typeof hotel>;
  assert.equal(rooms.hotel.rooms, 2);
  assert.equal(rooms.hotel.hotelId, 'lp81ecd');
});

test('checkout re-prices what was quoted for one once a second person is going', () => {
  const rows = [
    { id: 'f', status: 'awaiting_approval', request_payload: flight(1) },
    { id: 'h', status: 'quoted', request_payload: hotel(1) },
    { id: 'c', status: 'confirmed', request_payload: flight(1, { departDate: '2026-12-01' }) },
    { id: 'x', status: 'awaiting_approval', request_payload: null },
  ];
  const two = repricing(rows, { party: 2, memberIds: ['a', 'b'], skips: [], paid: false });
  assert.deepEqual(two.map(r => (r as any).flight?.seats ?? (r as any).hotel?.rooms), [2],
    'the flight for two; one room still holds two; the bought flight is not touched');
  const three = repricing(rows, { party: 3, memberIds: ['a', 'b', 'c'], skips: [], paid: false });
  assert.equal(three.length, 2, 'three people need a second room');
  assert.deepEqual(repricing(rows, { party: 2, memberIds: ['a', 'b'], skips: [], paid: true }), [],
    'once somebody has paid, the total they paid against does not move');
  // Somebody kept off the flight (they joined after it was paid for) does
  // not count towards its seats.
  assert.deepEqual(repricing(rows, { party: 2, memberIds: ['a', 'b'], skips: [{ ref: 'f', userId: 'b' }], paid: false }), []);
});

test('a one-seat quote is not handed back to a request for two', () => {
  const existing = [row('awaiting_approval', flight(1))];
  // The review's bug: findDuplicate matched on route and dates and handed
  // the solo quote back, so the second person could never be priced on.
  assert.equal(findDuplicate(existing, flight(2)), null);
  assert.equal(findStale(existing, flight(2)), existing[0], 'it is the one the new quote replaces');
  // The same size is still a duplicate, and nothing to replace.
  assert.equal(findDuplicate(existing, flight(1)), existing[0]);
  assert.equal(findStale(existing, flight(1)), null);
  // A request that does not say how many is not a resize.
  assert.equal(findDuplicate(existing, flight()), existing[0]);
  assert.equal(findStale(existing, flight()), null);
});

test('a bought seat is handed back whatever the size, never replaced', () => {
  for (const status of ['confirmed', 'pending']) {
    const existing = [row(status, flight(1))];
    assert.equal(findDuplicate(existing, flight(2)), existing[0], status);
    assert.equal(findStale(existing, flight(2)), null, status);
  }
  assert.equal(findStale([row('cancelled', flight(1))], flight(2)), null, 'a dead row is nothing to replace');
});

// ── partySize against a stand-in for group_members ───────────────────────
function counting(count: number | null, error: { code: string } | null = null) {
  const b: any = { select() { return b; }, eq() { return Promise.resolve({ count, error }); } };
  return { from: () => b } as any;
}

test('a plan still flagged solo is priced for whoever has since joined', async () => {
  assert.equal(await partySize(counting(2), { group_id: 'g1', solo_mode: true }), 2,
    'the flag is cleared when somebody joins, but a clear that did not land must not quote one seat for two');
  assert.equal(await partySize(counting(1), { group_id: 'g1', solo_mode: true }), 1);
  assert.equal(await partySize(counting(null, { code: 'XX000' }), { group_id: 'g1', solo_mode: true }), 1,
    'a count that could not be read falls back to what the plan says');
  assert.equal(await partySize(counting(4), { group_id: 'g1', solo_mode: false }), 4);
});
