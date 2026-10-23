// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotMinutes, inTimeOrder, bookingFor, referenceLine, whereOf, calendarEvents,
  calendarFileName, moneyLines, celebrationTitle, claimWasFirst, celebratedKey,
} from '../../lib/booked-trip.ts';
import { buildIcs } from '../../lib/ics.ts';

test('a day reads in the order it happens, whatever order it was written in', () => {
  const day = [
    { time: 'Day 2 · Evening', title: 'Dinner' },
    { time: 'Day 2 · 9:00 AM', title: 'Coffee' },
    { time: 'Day 2 · Afternoon', title: 'Museum' },
    { time: 'Day 2 · 12:30', title: 'Lunch' },
  ];
  assert.deepEqual(inTimeOrder(day).map(d => d.title), ['Coffee', 'Lunch', 'Museum', 'Dinner']);
});

test("a night out's own words sort as the evening runs", () => {
  const night = [
    { time: 'After', title: 'Nightcap' },
    { time: 'The main event', title: 'Gig' },
    { time: 'To start', title: 'Tacos' },
  ];
  assert.deepEqual(inTimeOrder(night).map(d => d.title), ['Tacos', 'Gig', 'Nightcap']);
});

test('a row nobody can place stays beside the one before it, not at the end', () => {
  const day = [
    { time: 'Day 1 · Evening', title: 'Dinner' },
    { time: 'Day 1 · whenever suits', title: 'Walk it off' },
    { time: 'Day 1 · Morning', title: 'Check in' },
  ];
  assert.deepEqual(inTimeOrder(day).map(d => d.title), ['Check in', 'Dinner', 'Walk it off']);
  const morning = [
    { time: 'Day 1 · Morning', title: 'Coffee' },
    { time: 'Day 1 · when the rain stops', title: 'Stroll' },
    { time: 'Day 1 · Evening', title: 'Dinner' },
  ];
  assert.deepEqual(inTimeOrder(morning).map(d => d.title), ['Coffee', 'Stroll', 'Dinner']);
  assert.equal(slotMinutes('Day 1 · whenever suits'), null);
});

test('two rows at the same time keep the order they were written in', () => {
  const day = [{ time: 'Morning', title: 'A' }, { time: 'Morning', title: 'B' }];
  assert.deepEqual(inTimeOrder(day).map(d => d.title), ['A', 'B']);
});

test('the booking behind a row is the live one, never a failed or cancelled one', () => {
  const rows = [
    { id: 'b1', itinerary_item_id: 'i1', status: 'failed', provider_ref: 'OLD' },
    { id: 'b2', itinerary_item_id: 'i1', status: 'confirmed', provider_ref: 'NEW' },
  ];
  assert.equal(bookingFor({ id: 'i1' }, rows)?.id, 'b2');
  assert.equal(bookingFor({ id: null }, rows), null);
});

test('a reference says whose it is, and only one is shown', () => {
  const item = { id: 'i1', conf: 'ROWCONF' };
  // Reach bought it: the provider's reference, not the itinerary's copy as well.
  assert.equal(referenceLine(item, { status: 'confirmed', mode: 'api', provider: 'duffel', provider_ref: 'ORD123' }), 'Booking ref ORD123');
  // Bought on the seller's site: what the person typed, as theirs.
  assert.equal(referenceLine(item, { status: 'confirmed', mode: 'redirect', provider: 'ticketmaster', provider_ref: 'tm-1', confirmation_number: 'ABC123' }), 'You entered ABC123');
  // A redirect's provider_ref is ours, not the seller's confirmation: never shown as one.
  assert.equal(referenceLine({ id: 'i2' }, { status: 'confirmed', mode: 'redirect', provider: 'resy', provider_ref: 'internal' }), null);
  assert.equal(referenceLine(item, null), 'Confirmation ROWCONF');
  assert.equal(referenceLine({ id: 'i3' }, null), null);
});

test("where: a hotel's own address, a venue as a search, and no map for a flight", () => {
  const hotel = whereOf({ type: 'hotel', title: '3 nights' }, { vertical: 'hotel', response_payload: { hotel: { name: 'Casa Azul', address: '12 Calle Luna, Cabo' } } }, 'Cabo');
  assert.equal(hotel?.address, '12 Calle Luna, Cabo');
  assert.match(hotel!.url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Casa%20Azul%2C%2012%20Calle%20Luna/);

  const bar = whereOf({ type: 'activity', venue_name: 'SPIN' }, null, 'Washington');
  assert.equal(bar?.address, null, 'a search is not an address');
  assert.equal(bar?.query, 'SPIN, Washington');

  assert.equal(whereOf({ type: 'flight', venue_name: 'RDU' }, null, 'Cabo'), null);
  assert.equal(whereOf({ type: 'activity', title: 'Wander the old town' }, null, 'Cabo'), null, 'nothing named, nothing to map');
});

test('the calendar has every row on its own date, and the reference in its notes', () => {
  const items = [
    { id: 'i1', time: 'Day 1 · 8:30 PM', title: 'Dinner at Lupa', venue_name: 'Lupa' },
    { id: 'i2', time: 'Day 2 · Morning', title: 'Boat trip' },
    { id: 'i3', time: 'Day 1 · 3:00 PM', title: '' },
  ];
  const bookings = [{ itinerary_item_id: 'i1', status: 'confirmed', mode: 'redirect', provider: 'resy', confirmation_number: 'R-77' }];
  const ev = calendarEvents({ id: 'p1', startDate: '2026-10-03', city: 'Rome' }, items, bookings);
  assert.equal(ev.length, 2, 'a row with no title is left out');
  assert.deepEqual(ev[0], {
    uid: 'p1-i1', title: 'Dinner at Lupa', date: '2026-10-03', time: '8:30 PM',
    location: 'Lupa, Rome', description: 'You entered R-77', url: null,
  });
  assert.equal(ev[1].date, '2026-10-04');
  assert.equal(ev[1].time, null, '"Morning" is not nine o\'clock');

  const ics = buildIcs(ev, { name: 'Rome', now: new Date('2026-10-04T00:30:00Z') });
  assert.match(ics, /DTSTART:20261003T203000/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261004/);
  assert.equal(calendarFileName('Rome · Oct 3–5'), 'Rome-Oct-3-5.ics');
  assert.equal(calendarFileName(''), 'trip.ics');
});

test('the money is what was booked and what came in, never the budget', () => {
  const f = { targetCents: 120000, collectedCents: 120000, myPaidCents: 40000, budgetCents: 999999 } as never;
  assert.deepEqual(moneyLines(f, false), [
    { key: 'booked', label: 'Booked via Reach', cents: 120000 },
    { key: 'mine', label: 'You put in', cents: 40000 },
    { key: 'group', label: 'Everyone together', cents: 120000 },
  ]);
  // A trip of one: one person paid, and there is no group line.
  assert.deepEqual(moneyLines({ targetCents: 50000, collectedCents: 50000, myPaidCents: 50000 }, true).map(l => l.label),
    ['Booked via Reach', 'You paid']);
  // Nothing bought, nothing paid: no strip at all, not a row of zeros.
  assert.deepEqual(moneyLines({ targetCents: 0, collectedCents: 0, myPaidCents: 0 }, false), []);
  assert.deepEqual(moneyLines(null, false), []);
});

test('the celebration speaks to a trip of one in the singular', () => {
  assert.equal(celebrationTitle({ city: 'Lisbon', solo: true }), "You're going to Lisbon");
  assert.equal(celebrationTitle({ city: 'Lisbon', solo: false }), "You're all going to Lisbon");
  assert.equal(celebrationTitle({ city: 'Raleigh', title: 'J. Cole', night: true, solo: true }), "You're set for J. Cole");
  assert.equal(celebrationTitle({ solo: true }), "You're all set");
  for (const solo of [true]) {
    const t = celebrationTitle({ city: 'Lisbon', title: 'x', solo });
    assert.doesNotMatch(t, /\ball\b|everyone|group/i);
  }
});

test("the server's claim is read as first only when it says so", () => {
  assert.equal(claimWasFirst({ first: true }), true);
  assert.equal(claimWasFirst({ claimed: true }), true);
  assert.equal(claimWasFirst({ first: false }), false);
  assert.equal(claimWasFirst({}), false);
  assert.equal(claimWasFirst(null), false);
  assert.equal(celebratedKey('abc'), 'reach:celebrated:abc');
});
