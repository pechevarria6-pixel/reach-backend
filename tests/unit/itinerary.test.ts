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

// ─── An evening is not a preparation for one ────────────────────────────

test('a night out is the plan, not what comes before it', () => {
  // A concert's rows are "To start", "The main event" and "After" — none of
  // them says "Day 1", so every one fell into the before-you-go bucket and
  // the concert was listed under "Before you go".
  const evening = itineraryDays([
    { time: 'To start', title: 'Dinner at Domestique' },
    { time: 'The main event', title: 'The Milk Carton Kids at the 9:30 Club' },
    { time: 'After', title: 'A pint at World of Beer' },
  ], '2026-09-21', new Date('2026-09-21T09:00:00'));

  assert.equal(evening.length, 1);
  assert.notEqual(evening[0].label, 'Before you go');
  assert.equal(evening[0].label, 'The plan');
  // And it carries its date, like any day does.
  assert.match(evening[0].dateLabel, /Sep/);
  assert.equal(evening[0].isToday, true);
});

test('a trip still separates what comes before from its days', () => {
  // The case the bucket exists for: pack your passport, then Day 1.
  const trip = itineraryDays([
    { time: 'Before you go', title: 'Check your passport is in date' },
    { time: 'Day 1 · Morning', title: 'Land and get the car' },
  ], '2026-10-01', new Date('2026-09-21T09:00:00'));

  assert.equal(trip.length, 2);
  assert.equal(trip[0].label, 'Before you go');
  assert.equal(trip[1].label, 'Day 1');
});
