// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestWindows, cleanRanges, isoDate } from '../../lib/availability.ts';

const free = (userId: string, start: string, end: string) => ({ userId, start, end });

test('the stretch most people can make wins, even over an earlier one', () => {
  const best = bestWindows([
    free('ana', '2026-10-01', '2026-10-05'),
    free('ana', '2026-10-10', '2026-10-14'),
    free('ben', '2026-10-10', '2026-10-14'),
    free('cam', '2026-10-10', '2026-10-14'),
  ], 3);
  assert.equal(best[0].start, '2026-10-10');
  assert.equal(best[0].end, '2026-10-13');
  assert.equal(best[0].count, 3);
  assert.deepEqual(best[0].available, ['ana', 'ben', 'cam']);
});

test('the earliest stretch wins a tie', () => {
  const best = bestWindows([
    free('dee', '2026-11-20', '2026-11-24'),
    free('eli', '2026-11-20', '2026-11-24'),
    free('ana', '2026-11-01', '2026-11-05'),
    free('ben', '2026-11-01', '2026-11-05'),
  ], 3);
  assert.equal(best[0].start, '2026-11-01');
  assert.equal(best[1].start, '2026-11-20');
  assert.equal(best[0].count, best[1].count);
});

test('suggestions never overlap one another', () => {
  const best = bestWindows([free('ana', '2026-12-01', '2026-12-20'), free('ben', '2026-12-01', '2026-12-20')], 2);
  assert.ok(best.length <= 3);
  for (let i = 0; i < best.length; i++) {
    for (let j = i + 1; j < best.length; j++) {
      assert.ok(best[i].end < best[j].start || best[j].end < best[i].start, 'two suggestions share a day');
    }
  }
});

test('a trip longer than anybody is free finds nothing', () => {
  assert.deepEqual(bestWindows([free('ana', '2026-10-01', '2026-10-02')], 3), []);
  assert.deepEqual(bestWindows([], 3), []);
});

test('only somebody free on every day of the trip counts as able to come', () => {
  const best = bestWindows([
    free('ana', '2026-10-01', '2026-10-04'),
    free('ben', '2026-10-01', '2026-10-02'),
  ], 3);
  assert.equal(best[0].count, 1);
  assert.deepEqual(best[0].available, ['ana']);
});

test('dates somebody sends are checked before anything is saved', () => {
  assert.deepEqual(cleanRanges([{ start: '2026-10-09', end: '2026-10-12' }]), [{ start: '2026-10-09', end: '2026-10-12' }]);
  assert.equal(cleanRanges([{ start: '2026-10-12', end: '2026-10-09' }]), null);
  assert.equal(cleanRanges([{ start: '2026-02-30', end: '2026-03-02' }]), null);
  assert.equal(cleanRanges('2026-10-09'), null);
  assert.equal(cleanRanges([]), null);
  assert.equal(cleanRanges(Array.from({ length: 21 }, () => ({ start: '2026-10-09', end: '2026-10-10' }))), null);
  assert.equal(isoDate('Oct 9'), null);
});
