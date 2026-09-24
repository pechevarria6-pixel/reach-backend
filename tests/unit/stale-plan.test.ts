import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshness } from '../../lib/stale-plan.ts';

const lines = (named: number, of: number) => Array.from({ length: of }, (_, i) => ({ type: 'restaurant', venue_name: i < named ? 'Alma' : null }));

test('a plan naming almost nothing in a town we now know is stale', () => {
  assert.equal(freshness(lines(1, 12), 27, 'planning').stale, true);
});

test('not stale when the plan already names places, or the town is still thin', () => {
  assert.equal(freshness(lines(8, 12), 27, 'planning').stale, false);
  assert.equal(freshness(lines(0, 12), 2, 'planning').stale, false);
});

test('never once bookings follow the days', () => {
  assert.equal(freshness(lines(0, 12), 60, 'approved').stale, false);
  assert.equal(freshness(lines(0, 12), 60, 'booked').stale, false);
});

test('travel and the stay are not lines a place could fill', () => {
  const f = freshness([{ type: 'flight' }, { type: 'hotel' }, { type: 'transport' }], 60, 'planning');
  assert.equal(f.lines, 0);
  assert.equal(f.stale, false);
});
