import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepStates, cannotSign, bookingTracker } from '../../lib/plan-steps.ts';

const signed = { at: '2026-09-22T20:00:00Z', by: 'u1' };

test('a fresh plan opens on the overview and locks the rest', () => {
  assert.deepEqual(stepStates({}), { overview: 'open', budget: 'locked', bookings: 'locked' });
});

test('each sign-off unlocks the next, in order', () => {
  assert.deepEqual(stepStates({ overview: signed }), { overview: 'done', budget: 'open', bookings: 'locked' });
  assert.deepEqual(stepStates({ overview: signed, budget: signed, bookings: signed }),
    { overview: 'done', budget: 'done', bookings: 'done' });
});

test('a later step signed without an earlier one does not count', () => {
  assert.deepEqual(stepStates({ budget: signed }), { overview: 'open', budget: 'locked', bookings: 'locked' });
});

test('the server refuses out of order, and the last step while anything is open', () => {
  assert.match(cannotSign('budget', {}) ?? '', /overview first/);
  assert.equal(cannotSign('budget', { overview: signed }), null);
  assert.match(cannotSign('bookings', { overview: signed, budget: signed }, 2) ?? '', /2 things are still to book/);
  assert.equal(cannotSign('bookings', { overview: signed, budget: signed }, 0), null);
});

// The Downtown Raleigh Italian Evening, as it is: a pint you walk into and a
// dinner to book ahead.
test('the Raleigh evening has one thing to book, and the pint is not it', () => {
  const lines = [
    { id: 'a', type: 'restaurant', booking_mode: 'walk_in' },
    { id: 'b', type: 'restaurant', booking_mode: 'ahead', filled: false },
  ];
  const t = bookingTracker(lines);
  assert.equal(t.total, 1);
  assert.equal(t.done, 0);
  assert.equal(bookingTracker([lines[0], { ...lines[1], filled: true }]).done, 1);
});

test("Reach's lines are done when their booking is confirmed, not before", () => {
  const lines = [{ id: 'h', type: 'hotel', booking_mode: 'reach' }, { id: 'f', type: 'flight', booking_mode: 'reach' }];
  const t = bookingTracker(lines, [
    { itinerary_item_id: 'h', status: 'confirmed' },
    { itinerary_item_id: 'f', status: 'awaiting_approval' },
  ]);
  assert.deepEqual(t.items.map(i => [i.who, i.done]), [['reach', true], ['reach', false]]);
});

test('a ticket from the seller counts until somebody says they have it', () => {
  const t = bookingTracker([{ id: 'e', type: 'event', venue_website: 'https://example.com/t', booking_mode: null }]);
  assert.equal(t.total, 1);
  assert.equal(t.items[0].who, 'you');
});
