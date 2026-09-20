import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reservationUrl, reserveLabel, usableTime, usableParty, chargesUpfront,
} from '../../lib/booking/reservations.ts';

test('a time is a time, and "Day 3 · Evening" is not', () => {
  // The itinerary stores prose in scheduled_time, and it reached a provider
  // once already as if it were a clock time.
  assert.equal(usableTime('19:30'), '19:30');
  assert.equal(usableTime('9:05'), '09:05');
  assert.equal(usableTime('Day 3 · Evening'), null);
  assert.equal(usableTime('evening'), null);
  assert.equal(usableTime('25:00'), null);
  assert.equal(usableTime(null), null);
});

test('a party is a plausible number of people', () => {
  assert.equal(usableParty(4), 4);
  assert.equal(usableParty(0), 2, 'a table for nobody is a table for two');
  assert.equal(usableParty(null), 2);
  assert.equal(usableParty(900), 20);
});

test('a link the restaurant published beats one we build', () => {
  const url = reservationUrl('resy', { name: 'Desert Bistro', knownUrl: 'https://resy.com/cities/moab/desert-bistro' });
  assert.equal(url, 'https://resy.com/cities/moab/desert-bistro');
});

test('the date, time and party are carried into the link', () => {
  const ot = reservationUrl('opentable', { name: 'Desert Bistro', date: '2026-11-02', time: '19:30', partySize: 4 });
  assert.ok(ot?.includes('covers=4'), ot!);
  assert.ok(ot?.includes('2026-11-02T19%3A30'), ot!);
  const resy = reservationUrl('resy', { name: 'Desert Bistro', date: '2026-11-02', partySize: 4 });
  assert.ok(resy?.includes('seats=4'), resy!);
});

test('prose in the time field never reaches the link', () => {
  const ot = reservationUrl('opentable', { name: 'X', date: '2026-11-02', time: 'Day 3 · Evening' });
  assert.equal(ot?.includes('dateTime'), false, 'a date with no usable time is sent without one');
});

test('not knowing the platform is an answer, not a guess', () => {
  // Sending somebody to Resy for a restaurant that has never been on Resy is
  // the same lie as offering tickets to a wine bar.
  assert.equal(reservationUrl('none', { name: 'Desert Bistro' }), null);
  assert.equal(reserveLabel('none'), 'Call to book');
  assert.equal(reservationUrl('resy', { name: '   ' }), null);
});

test('the button says whose platform it is', () => {
  assert.equal(reserveLabel('resy'), 'Reserve on Resy');
  assert.equal(reserveLabel('opentable'), 'Reserve on OpenTable');
  assert.equal(reserveLabel('tock'), 'Reserve on Tock');
});

test('only a prepaid booking is money the group owes now', () => {
  // A held table costs nothing today, so it must not inflate what everybody
  // is asked to pay in.
  assert.equal(chargesUpfront('resy', 12000), false);
  assert.equal(chargesUpfront('opentable', null), false);
  assert.equal(chargesUpfront('tock', 12000), true, 'a Tock deposit is paid at booking');
  assert.equal(chargesUpfront('tock', null), false);
});
