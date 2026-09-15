// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itineraryDays } from '../../lib/itinerary.ts';

const rows = [
  { time: 'Before you go', title: 'Round-trip flights' },
  { time: 'Day 1 · Morning', title: 'Arrive' },
  { time: 'Day 1 · Evening', title: 'Dinner' },
  { time: 'Day 2 · Morning', title: 'Museum' },
  { time: 'Day 3 · Afternoon', title: 'Boat' },
];

test('one flat list becomes the days it actually is', () => {
  const days = itineraryDays(rows, '2026-03-08', new Date('2026-03-01T12:00:00'));
  assert.deepEqual(days.map(d => d.label), ['Before you go', 'Day 1', 'Day 2', 'Day 3']);
  assert.equal(days[1].items.length, 2);
  assert.equal(days[0].items.length, 1);
});

test('the day you are on is the one marked today', () => {
  // Day 2 of a trip starting the 8th is the 9th.
  const days = itineraryDays(rows, '2026-03-08', new Date('2026-03-09T09:30:00'));
  const today = days.filter(d => d.isToday);
  assert.equal(today.length, 1);
  assert.equal(today[0].label, 'Day 2');
  // And the day before it has been had.
  assert.equal(days.find(d => d.label === 'Day 1')?.isPast, true);
  assert.equal(days.find(d => d.label === 'Day 3')?.isPast, false);
});

test('a trip nobody is on yet has no today', () => {
  const days = itineraryDays(rows, '2026-03-08', new Date('2026-02-01T12:00:00'));
  assert.equal(days.some(d => d.isToday), false);
  assert.equal(days.some(d => d.isPast), false);
});

test('without a start date the days still separate, just undated', () => {
  const days = itineraryDays(rows, null, new Date('2026-03-09T12:00:00'));
  assert.deepEqual(days.map(d => d.label), ['Before you go', 'Day 1', 'Day 2', 'Day 3']);
  assert.equal(days.every(d => d.dateLabel === ''), true);
  assert.equal(days.some(d => d.isToday), false);
});

test('"Before you go" never claims to be a date', () => {
  const days = itineraryDays(rows, '2026-03-08', new Date('2026-03-08T12:00:00'));
  const before = days[0];
  assert.equal(before.dateLabel, '');
  assert.equal(before.isToday, false);
  assert.equal(before.n, 0);
});

test('nothing in, nothing out — no crash on an empty plan', () => {
  assert.deepEqual(itineraryDays([], '2026-03-08'), []);
  assert.deepEqual(itineraryDays(null, null), []);
  assert.deepEqual(itineraryDays(undefined, undefined), []);
});
