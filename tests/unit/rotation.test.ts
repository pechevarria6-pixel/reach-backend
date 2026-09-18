// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotateDaily, seedOf, THIN_POOL } from '../../lib/discovery/rank.ts';

const pool = Array.from({ length: 12 }, (_, i) => `item-${i}`);

test('the same day and person always deal the same page', () => {
  const seed = seedOf('2026-09-18', 'user-a');
  assert.deepEqual(rotateDaily(pool, seed), rotateDaily(pool, seed));
});

test('a different day is a different page', () => {
  const monday = rotateDaily(pool, seedOf('2026-09-21', 'user-a'));
  const tuesday = rotateDaily(pool, seedOf('2026-09-22', 'user-a'));
  assert.notDeepEqual(monday, tuesday, 'the same twelve places must not arrive in the same order');
});

test('two people in the same town see different orders', () => {
  const a = rotateDaily(pool, seedOf('2026-09-18', 'user-a'));
  const b = rotateDaily(pool, seedOf('2026-09-18', 'user-b'));
  assert.notDeepEqual(a, b);
});

test('nothing is invented, dropped or duplicated', () => {
  const out = rotateDaily(pool, seedOf('2026-09-18', 'user-a'));
  assert.equal(out.length, pool.length);
  assert.deepEqual([...out].sort(), [...pool].sort());
});

test('the strongest matches stay near the top', () => {
  // Rotation happens inside bands of four, so the best result can move within
  // the first four places and never to the bottom of the page.
  for (const day of ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21']) {
    const out = rotateDaily(pool, seedOf(day, 'user-a'));
    assert.ok(out.indexOf('item-0') < 4, `best match fell to position ${out.indexOf('item-0')} on ${day}`);
  }
});

test('a list of one is left alone', () => {
  assert.deepEqual(rotateDaily(['only'], 123), ['only']);
  assert.deepEqual(rotateDaily([], 123), []);
});

test('thin means thin: a dozen places is not a catalogue', () => {
  assert.equal(THIN_POOL, 15);
  assert.ok(12 < THIN_POOL, 'the pilot area, today, is thin');
});
