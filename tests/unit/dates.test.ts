// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDateOrNull, planDates } from '../../lib/dates.ts';

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
