// Run with: npm run test:unit
// A quote is for a number of people. A trip for one that somebody joins must
// not go on handing back a one-seat quote to a party of two.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomsFor, roomsAt, partyFor, resized, repricing, staleOnPlan, requestSize, matchFor } from '../../lib/booking/resize.ts';
import { findDuplicate, identityOf } from '../../lib/booking/duplicate.ts';

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
const row = (status: string, payload: Record<string, unknown>, id = 'b1') => ({ id, status, vertical: payload.vertical as string, request_payload: payload });

test('one room for every two people', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(roomsFor), [1, 1, 2, 2, 3]);
  assert.equal(roomsFor(0), 1);
  assert.equal(roomsFor(Number.NaN), 1);
});

test('how many a request says it is for, and only when it says', () => {
  assert.equal(requestSize(flight(2)), 2);
  assert.equal(requestSize({ ...hotel(1), party: 3 }), 3);
  assert.equal(requestSize(hotel(2)), null, 'rooms are not people: a hotel says its party or nothing');
  assert.equal(requestSize(flight()), null, 'a request that does not say cannot ask for a re-price');
});

test('rooms for a party: never fewer than before, never more than people', () => {
  assert.equal(roomsAt(1, 2), 1);
  assert.equal(roomsAt(1, 3), 2);
  assert.equal(roomsAt(2, 2), 2, 'a group that grew keeps the rooms it chose');
  assert.equal(roomsAt(3, 2), 2, 'a hotel will not sell an empty room');
});

test('stale is one rule: a proposal priced for a different number than are on it', () => {
  const rows = [
    row('awaiting_approval', flight(1), 'f'),
    row('quoted', flight(1, { departDate: '2026-12-01' }), 'held'),
    row('confirmed', flight(1, { departDate: '2026-12-02' }), 'bought'),
    row('awaiting_approval', { ...hotel(1), party: 1 }, 'h'),
  ];
  const opts = { party: 2, memberIds: ['a', 'b'], skips: [] };
  assert.deepEqual(staleOnPlan(rows, opts).map(r => r.id), ['f', 'h'],
    'a held quote is out of every money sum and is never re-priced while held; a bought seat is never swapped');
  // Somebody kept off a booking because they joined after it was paid for:
  // it is rightly still priced for one.
  const kept = { ...opts, skips: [{ ref: 'f', userId: 'b' }, { ref: 'h', userId: 'b' }] };
  assert.deepEqual(staleOnPlan(rows, kept), []);
});

test('who a booking is for: everybody going, less whoever is kept off it', () => {
  const skips = [{ ref: 'b1', userId: 'u-new' }, { ref: 'b1', userId: 'u-gone' }, { ref: 'b2', userId: 'u-solo' }];
  assert.equal(partyFor(2, ['u-solo', 'u-new'], skips, 'b1'), 1);
  assert.equal(partyFor(2, ['u-solo', 'u-new'], [], 'b1'), 2);
  assert.equal(partyFor(1, ['u-solo'], [{ ref: 'b1', userId: 'u-solo' }], 'b1'), 1, 'never fewer than one');
});

test('re-sized is the same flight and the same room, for more people', () => {
  const two = resized(flight(1), 2) as ReturnType<typeof flight> & { party: number };
  assert.equal(two.flight.seats, 2);
  assert.equal(two.party, 2, 'what approval compares against');
  assert.equal(two.flight.offerKey, 'AA100|AA101', 'the flights that were chosen');
  assert.equal(two.itineraryItemId, 'line-1');
  assert.deepEqual(two.travelers, [], 'nobody is named at quote time');
  assert.equal(identityOf(two), identityOf(flight(1)), 'the same thing');
  const rooms = resized(hotel(1), 4) as ReturnType<typeof hotel> & { party: number };
  assert.equal(rooms.hotel.rooms, 2);
  assert.equal(rooms.party, 4);
  assert.equal(rooms.hotel.hotelId, 'lp81ecd');
});

test('checkout re-prices what was quoted for one once a second person is going', () => {
  const rows = [
    { id: 'f', vertical: 'flight', status: 'awaiting_approval', request_payload: flight(1) },
    { id: 'h', vertical: 'hotel', status: 'quoted', request_payload: { ...hotel(1), party: 1 } },
    { id: 'c', vertical: 'flight', status: 'confirmed', request_payload: flight(1, { departDate: '2026-12-01' }) },
    { id: 'x', vertical: 'flight', status: 'awaiting_approval', request_payload: null },
  ];
  const two = repricing(rows, { party: 2, memberIds: ['a', 'b'], skips: [], paid: false });
  assert.deepEqual(two.map(r => (r as any).flight?.seats), [2],
    'the flight for two; the held room waits until it is let go; the bought flight is not touched');
  assert.deepEqual(repricing(rows, { party: 2, memberIds: ['a', 'b'], skips: [], paid: true }), [],
    'once somebody has paid, the total they paid against does not move');
  assert.deepEqual(repricing(rows, { party: 2, memberIds: ['a', 'b'], skips: [{ ref: 'f', userId: 'b' }], paid: false }), []);
  const claimed = [{ ...rows[0], approved_at: '2026-09-23T10:00:00.000Z', updated_at: '2026-09-23T10:00:00.000Z' }];
  assert.deepEqual(repricing(claimed, { party: 2, memberIds: ['a', 'b'], skips: [], paid: false }), [],
    'an approval is at the provider with it');
});

test('findDuplicate matches the thing, whatever size either says', () => {
  const existing = [row('awaiting_approval', flight(1))];
  assert.equal(findDuplicate(existing, flight(2)), existing[0]);
  assert.equal(findDuplicate([row('cancelled', flight(1))], flight(2)), null, 'a dead row is nothing to hand back');
});

test('the size that decides a re-price is the route’s own count, never the request’s', () => {
  const existing = [row('awaiting_approval', flight(1), 'f')];
  const two = () => 2;
  assert.equal(matchFor(existing, flight(2), two).kind, 'stale');
  // Any member can post the same flight with seats: 9. That used to retire
  // the quote and write a nine-seat one into everybody's share.
  const nine = matchFor(existing, flight(9), two);
  assert.equal(nine.kind, 'twin');
  assert.equal(nine.kind === 'twin' && nine.row, existing[0]);
  assert.equal(matchFor(existing, flight(), two).kind, 'twin', 'a request that does not say is handed back');
  assert.equal(matchFor(existing, flight(2), null).kind, 'twin', 'who is going unknown: nothing on a guess');
  assert.equal(matchFor([row('awaiting_approval', flight(2), 'f')], flight(9), two).kind, 'twin', 'not stale at all');
});
