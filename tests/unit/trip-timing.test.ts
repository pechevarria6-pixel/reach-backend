import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripTiming, worthQuoting } from '../../lib/calendar.ts';

const MOAB = { startDate: '2026-09-17', endDate: '2026-09-30' };

test('a trip that began five days ago is happening, not upcoming', () => {
  // The real case. Its plan screen offered "Book everything", and pressing
  // it reached a hotel provider and came back "No rates available" — true,
  // and a strange way to learn your trip has started.
  assert.equal(tripTiming(MOAB, '2026-09-22'), 'on_now');
  assert.equal(worthQuoting(MOAB, '2026-09-22'), false);
});

test('the last day still counts as happening', () => {
  assert.equal(tripTiming(MOAB, '2026-09-30'), 'on_now');
});

test('the day after the last day is over', () => {
  assert.equal(tripTiming(MOAB, '2026-10-01'), 'over');
  assert.equal(worthQuoting(MOAB, '2026-10-01'), false);
});

test('a trip still to come is worth quoting', () => {
  assert.equal(tripTiming({ startDate: '2026-11-02', endDate: '2026-11-09' }, '2026-09-22'), 'upcoming');
  assert.equal(worthQuoting({ startDate: '2026-11-02', endDate: '2026-11-09' }, '2026-09-22'), true);
});

test('a one-day plan is happening on its day and over after it', () => {
  const night = { startDate: '2026-09-22' };
  assert.equal(tripTiming(night, '2026-09-22'), 'on_now');
  assert.equal(tripTiming(night, '2026-09-23'), 'over');
});

test('an undated plan is not late, it is undated', () => {
  assert.equal(tripTiming({}, '2026-09-22'), null);
  // And nothing is refused on the strength of a null.
  assert.equal(worthQuoting({}, '2026-09-22'), false);
});
