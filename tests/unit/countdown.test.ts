import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countdown, daysUntil } from '../../lib/calendar.ts';

// Eight in the evening in New York: the UTC date has already turned over,
// which is the hour that made tonight's events vanish from Discover.
const EVENING = new Date('2026-09-21T00:30:00Z');

test('a countdown is between days, not between instants', () => {
  // "In 3 days" is a statement about dates. At 8pm on the 20th in New York,
  // a trip on the 23rd is still three days away — it must not tick over to
  // two because UTC has moved on.
  assert.equal(daysUntil({ startDate: '2026-09-23' }, EVENING), 3);
  assert.equal(countdown({ startDate: '2026-09-23' }, EVENING), 'In 3 days');
});

test('today is today, even late in the evening', () => {
  assert.equal(countdown({ startDate: '2026-09-20' }, EVENING), 'Today');
  assert.equal(countdown({ startDate: '2026-09-21' }, EVENING), 'Tomorrow');
});

test('further out, in the words people use', () => {
  assert.equal(countdown({ startDate: '2026-09-29' }, EVENING), 'Next week');
  assert.equal(countdown({ startDate: '2026-10-11' }, EVENING), 'In 3 weeks');
  assert.equal(countdown({ startDate: '2026-11-19' }, EVENING), 'In 2 months');
});

test('a trip that has been and gone says nothing', () => {
  assert.equal(countdown({ startDate: '2026-09-01' }, EVENING), null);
});

test('no date, no countdown — never a number the app invented', () => {
  assert.equal(countdown({ startDate: null } as never, EVENING), null);
  assert.equal(countdown({} as never, EVENING), null);
  // Matches the shape and is not a date.
  assert.equal(countdown({ startDate: '2026-13-45' }, EVENING), null);
});
