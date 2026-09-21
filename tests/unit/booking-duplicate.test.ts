import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityOf, findDuplicate } from '../../lib/booking/duplicate.ts';

const flight = (over: Record<string, unknown> = {}) => ({
  vertical: 'flight',
  flight: { origin: 'RDU', destination: 'PVR', departDate: '2026-11-02', returnDate: '2026-11-09', ...over },
});
const row = (status: string, payload: unknown) => ({ vertical: 'flight', status, request_payload: payload });

test('the same flight pressed twice is the same flight', () => {
  // The bookings table holds this exact shape: RDU → PVR on 2026-11-02, four
  // times, two of them pending behind one already confirmed.
  assert.equal(identityOf(flight()), identityOf(flight()));
  assert.ok(findDuplicate([row('confirmed', flight())], flight()));
});

test('a different date is a different flight', () => {
  assert.equal(findDuplicate([row('confirmed', flight())], flight({ departDate: '2026-11-03' })), null);
  assert.equal(findDuplicate([row('confirmed', flight())], flight({ destination: 'CUN' })), null);
});

test('a failed booking is not a duplicate — it is why they pressed again', () => {
  // Refusing here would be worse than the bug this prevents: somebody whose
  // booking failed could never retry it.
  assert.equal(findDuplicate([row('failed', flight())], flight()), null);
  assert.equal(findDuplicate([row('cancelled', flight())], flight()), null);
});

test('every live status counts as already in play', () => {
  for (const status of ['quoted', 'awaiting_approval', 'pending', 'confirmed']) {
    assert.ok(findDuplicate([row(status, flight())], flight()), status);
  }
});

test('things that are not what makes a booking distinct are ignored', () => {
  // Two presses of the same button can carry different travellers or a
  // nudged cabin. Neither makes it a different flight.
  const a = { vertical: 'flight', flight: { origin: 'RDU', destination: 'PVR', departDate: '2026-11-02', cabin: 'M' }, travelers: [{ id: 1 }] };
  const b = { vertical: 'flight', flight: { origin: 'RDU', destination: 'PVR', departDate: '2026-11-02', cabin: 'W' }, travelers: [] };
  assert.equal(identityOf(a), identityOf(b));
});

test('a table at the same restaurant at the same time is one table', () => {
  const table = (time: string) => ({
    vertical: 'restaurant',
    restaurant: { name: "Poole's Diner", city: 'Raleigh', date: '2026-11-02', time, partySize: 4 },
  });
  assert.ok(findDuplicate([row('pending', table('19:30'))].map(r => ({ ...r, vertical: 'restaurant' })), table('19:30')));
  assert.equal(findDuplicate([{ vertical: 'restaurant', status: 'pending', request_payload: table('19:30') }], table('21:00')), null);
});

test('nothing identifiable means nothing is blocked', () => {
  // A payload we cannot read must never be treated as matching another one
  // we cannot read — that would block real bookings to prevent imaginary
  // duplicates. The eight rows in production with an empty detail are this.
  assert.equal(identityOf({ vertical: 'flight', flight: {} }), null);
  assert.equal(identityOf({}), null);
  assert.equal(identityOf(null), null);
  assert.equal(findDuplicate([row('pending', {})], { vertical: 'flight', flight: {} }), null);
});
