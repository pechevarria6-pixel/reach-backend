import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, byDay, dearestDay } from '../../lib/budget.ts';

test('the day is the part that groups', () => {
  assert.equal(dayOf('Day 3 · Evening').label, 'Day 3');
  assert.equal(dayOf('Day 11 · Morning').label, 'Day 11');
  assert.equal(dayOf('Before you go').label, 'Before you go');
});

test('a night out has no day in it, and that is correct', () => {
  // "To start", "The main event", "After" are one evening.
  for (const slot of ['To start', 'The main event', 'After']) {
    assert.equal(dayOf(slot).label, 'The evening');
  }
});

test('days come in the order they happen, not alphabetically', () => {
  // "Day 10" sorts before "Day 2" as a string, which would print a trip out
  // of sequence on the screen where somebody checks the damage.
  const groups = byDay([
    { d: 'Day 10 · Morning', c: 100 },
    { d: 'Day 2 · Evening', c: 200 },
    { d: 'Before you go', c: 5000 },
  ]);
  assert.deepEqual(groups.map(g => g.label), ['Before you go', 'Day 2', 'Day 10']);
});

test('each day carries its own total', () => {
  const groups = byDay([
    { d: 'Day 1 · Morning', c: 900 },
    { d: 'Day 1 · Evening', c: 2200 },
    { d: 'Day 2 · Evening', c: 2000 },
  ]);
  assert.equal(groups[0].totalCents, 3100);
  assert.equal(groups[1].totalCents, 2000);
});

test('the dearest day is named only when there is a comparison', () => {
  const one = byDay([{ d: 'Day 1 · Evening', c: 2200 }]);
  assert.equal(dearestDay(one), null, 'one day is not the dearest of anything');

  const many = byDay([
    { d: 'Day 1 · Evening', c: 2200 },
    { d: 'Day 2 · Evening', c: 9000 },
  ]);
  assert.equal(dearestDay(many)?.label, 'Day 2');
});

test('before-you-go is never the dearest day, because it is not a day', () => {
  const groups = byDay([
    { d: 'Before you go', c: 140000 },
    { d: 'Day 1 · Evening', c: 2200 },
    { d: 'Day 2 · Evening', c: 3000 },
  ]);
  assert.equal(dearestDay(groups)?.label, 'Day 2');
});

test('nothing in, nothing out', () => {
  assert.deepEqual(byDay([]), []);
  assert.deepEqual(byDay(null), []);
  assert.equal(dearestDay([]), null);
});
