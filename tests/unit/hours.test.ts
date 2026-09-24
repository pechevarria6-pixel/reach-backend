// Whether a place is shut when somebody would turn up, going by the map's hours.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedThroughout, windowFor, datesBetween } from '../../lib/discovery/hours.ts';

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

test('an evening is judged on the evening only for one night out', () => {
  assert.equal(windowFor('restaurant', 'places to eat', SUNDAY), 'evening');
  assert.equal(windowFor('museum', 'museums & history', SUNDAY), 'day');
  assert.equal(windowFor('restaurant', 'places to eat', { from: '2026-09-26', to: '2026-09-28' }), 'day');
});

test('the days are local calendar days, and at most a fortnight of them', () => {
  assert.deepEqual(datesBetween('2026-09-27', '2026-09-28').map(d => d.getDay()), [0, 1]);
  assert.equal(datesBetween('2026-01-01', '2026-12-31').length, 14);
  assert.equal(datesBetween('nonsense', 'x').length, 0);
});
