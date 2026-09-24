// Whether a place is shut when somebody would turn up, going by the map's hours.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedThroughout, windowFor, datesBetween, neverOpen } from '../../lib/discovery/hours.ts';

const RALEIGH = { lat: 35.78, lng: -78.64, countryCode: 'us' };
// 2026-09-27 is a Sunday, 2026-09-28 a Monday.
const SUNDAY = { from: '2026-09-27', to: '2026-09-27' };
const MONDAY = { from: '2026-09-28', to: '2026-09-28' };

test('closed on Sundays is closed on a Sunday evening', () => {
  assert.equal(closedThroughout('Mo-Sa 11:00-22:00; Su off', SUNDAY, 'evening', RALEIGH), true);
});

test('the same place is open on a Monday evening', () => {
  assert.equal(closedThroughout('Mo-Sa 11:00-22:00; Su off', MONDAY, 'evening', RALEIGH), false);
});

test('a lunch-only café is shut for an evening out, and open for the day', () => {
  const hours = 'Mo-Su 07:00-15:00';
  assert.equal(closedThroughout(hours, MONDAY, 'evening', RALEIGH), true);
  assert.equal(closedThroughout(hours, MONDAY, 'day', RALEIGH), false);
});

test('unknown hours keep the place', () => {
  assert.equal(closedThroughout(null, SUNDAY, 'evening', RALEIGH), false);
  assert.equal(closedThroughout('', SUNDAY, 'evening', RALEIGH), false);
  assert.equal(closedThroughout('Su unknown', SUNDAY, 'evening', RALEIGH), false, 'the map says it does not know');
  assert.equal(closedThroughout('whenever the owner feels like it', SUNDAY, 'evening', RALEIGH), false, 'hours that do not parse');
});

test('no date, no judgement', () => {
  assert.equal(closedThroughout('Mo-Sa 11:00-22:00; Su off', null, 'evening', RALEIGH), false);
});

test('a trip is only closed if every one of its days is', () => {
  const weekend = { from: '2026-09-26', to: '2026-09-27' };
  assert.equal(closedThroughout('Mo-Sa 11:00-22:00; Su off', weekend, 'day', RALEIGH), false);
  assert.equal(closedThroughout('Mo-Fr 09:00-17:00', weekend, 'day', RALEIGH), true);
});

test('a holiday rule without a country is not knowledge, so the place stays', () => {
  assert.equal(closedThroughout('Mo-Su 17:00-23:00; PH off', SUNDAY, 'evening', null), false);
});

test('food and drink are judged on the evening only on a night out', () => {
  assert.equal(windowFor('restaurant', 'places to eat', true), 'evening');
  assert.equal(windowFor('museum', 'museums & history', true), 'day', 'a museum on a night out is for the afternoon offer');
});

test('a day trip on one date is not a night out: lunch counts', () => {
  // The single date used to decide it. A day trip on 2026-09-28 dropped the
  // café that serves lunch until three, because it was shut from five.
  assert.equal(windowFor('cafe', 'places to eat', false), 'day');
  assert.equal(windowFor('restaurant', 'places to eat', false), 'day');
  assert.equal(closedThroughout('Mo-Su 07:00-15:00', MONDAY, windowFor('cafe', 'places to eat', false), RALEIGH), false);
  assert.equal(closedThroughout('Mo-Su 07:00-15:00', MONDAY, windowFor('cafe', 'places to eat', true), RALEIGH), true);
});

test('the days are local calendar days, and at most a fortnight of them', () => {
  assert.deepEqual(datesBetween('2026-09-27', '2026-09-28').map(d => d.getDay()), [0, 1]);
  assert.equal(datesBetween('2026-01-01', '2026-12-31').length, 14);
  assert.equal(datesBetween('nonsense', 'x').length, 0);
});

test('hours that say shut on every day are never open, with or without a date', () => {
  const from = new Date('2026-09-24T12:00:00Z');
  assert.equal(neverOpen('off', null, from), true);
  assert.equal(neverOpen('closed', null, from), true);
  // One evening a week, a summer season, around the clock: all open some time.
  assert.equal(neverOpen('We 19:00-21:00', null, from), false);
  assert.equal(neverOpen('Jun-Aug 10:00-18:00', null, from), false);
  assert.equal(neverOpen('24/7', null, from), false);
  // Not knowing keeps the place.
  assert.equal(neverOpen(null, null, from), false);
  assert.equal(neverOpen('ask at the bar', null, from), false);
  assert.equal(neverOpen('unknown', null, from), false);
});
