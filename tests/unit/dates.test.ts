// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDateOrNull, planDates, formatDates, nightsBetween, parseISODate } from '../../lib/dates.ts';

test('ISO dates pass through untouched', () => {
  assert.equal(toDateOrNull('2026-03-08'), '2026-03-08');
  assert.equal(toDateOrNull('  2026-03-08  '), '2026-03-08');
});

test('display strings that are not dates become null, not an error', () => {
  // These are the exact values the client used to send straight into a
  // Postgres `date` column, which rejected the INSERT and lost the plan.
  for (const v of ['Dates TBD', 'Tonight', '', '   ', 'Weekend Away', 'undefined']) {
    assert.equal(toDateOrNull(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

test('non-strings become null', () => {
  for (const v of [null, undefined, 42, {}, [], NaN]) {
    assert.equal(toDateOrNull(v), null);
  }
});

test('human date strings are normalised', () => {
  assert.equal(toDateOrNull('March 8, 2026'), '2026-03-08');
  assert.equal(toDateOrNull('2026/03/08'), '2026-03-08');
});

test('planDates prefers the explicit ISO fields', () => {
  const got = planDates({
    startDate: '2026-03-08',
    endDate: '2026-03-14',
    dates: 'Dates TBD',
  });
  assert.deepEqual(got, { start: '2026-03-08', end: '2026-03-14' });
});

test('planDates falls back to parsing a range display string', () => {
  const got = planDates({ dates: '2026-03-08 – 2026-03-14' });
  assert.deepEqual(got, { start: '2026-03-08', end: '2026-03-14' });
});

test('planDates handles a single-day event with a time', () => {
  const got = planDates({ dates: '2026-03-08 at 19:30' });
  assert.deepEqual(got, { start: '2026-03-08', end: null });
});

test('planDates returns nulls rather than garbage for an undated plan', () => {
  assert.deepEqual(planDates({ dates: 'Dates TBD' }), { start: null, end: null });
  assert.deepEqual(planDates({}), { start: null, end: null });
});

// ── Display formatting ───────────────────────────────────────────────────
// A fixed "today" keeps the year-suppression rule deterministic.
const TODAY = new Date(2026, 0, 15);

test('a range inside one month names the month once', () => {
  assert.equal(formatDates('2026-08-01', '2026-08-08', null, TODAY), 'Aug 1 – 8');
});

test('a range across months names both', () => {
  assert.equal(formatDates('2026-08-28', '2026-09-03', null, TODAY), 'Aug 28 – Sep 3');
});

test('the year appears only when it is not this one', () => {
  assert.equal(formatDates('2026-08-01', '2026-08-08', null, TODAY), 'Aug 1 – 8');
  assert.equal(formatDates('2027-08-01', '2027-08-08', null, TODAY), 'Aug 1 – 8, 2027');
});

test('a single day, with and without a time', () => {
  assert.equal(formatDates('2026-08-01', null, null, TODAY), 'Aug 1');
  assert.equal(formatDates('2026-08-01', '2026-08-01', '19:30', TODAY), 'Aug 1 at 19:30');
});

test('a missing start is labelled, never rendered as Invalid Date', () => {
  assert.equal(formatDates(null, null, null, TODAY), 'Dates TBD');
  assert.equal(formatDates('Dates TBD', null, null, TODAY), 'Dates TBD');
  assert.equal(formatDates(undefined, '2026-08-08', null, TODAY), 'Dates TBD');
});

test('ISO dates parse in local time, not UTC', () => {
  // new Date('2026-08-01') is UTC midnight and renders as Jul 31 in the
  // Americas. This is the bug that would shift every trip back a day.
  const d = parseISODate('2026-08-01');
  assert.equal(d?.getDate(), 1);
  assert.equal(d?.getMonth(), 7);
});

test('nights are counted, not assumed to be seven', () => {
  assert.equal(nightsBetween('2026-08-01', '2026-08-08'), 7);
  assert.equal(nightsBetween('2026-08-01', '2026-08-03'), 2);
  assert.equal(nightsBetween('2026-08-01', '2026-08-01'), null);
  assert.equal(nightsBetween('2026-08-08', '2026-08-01'), null, 'a reversed range is not negative nights');
  assert.equal(nightsBetween(null, '2026-08-08'), null);
});
