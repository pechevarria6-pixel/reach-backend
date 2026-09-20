import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mayShow, hiddenFor, latestPerItem, groupVerdict, isRepeatable, refOf,
} from '../../lib/recommendation-memory.ts';

const NOW = new Date('2026-09-20T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

test('"not for me" is permanent — a refusal does not quietly expire', () => {
  // There is no cooldown on a refusal. One that lapses is the app deciding
  // it knows better than the person who said no.
  const f = { itemRef: 'osm:1', vertical: 'restaurant', verdict: 'not_interested' as const, at: daysAgo(3650) };
  assert.equal(mayShow(f, NOW), false);
});

test('a landmark done once is done', () => {
  // Somebody who has seen the Statue of Liberty has seen it. Offering it
  // again next spring is the app not listening.
  const f = { itemRef: 'osm:2', vertical: 'museum', verdict: 'done' as const, at: daysAgo(3650) };
  assert.equal(isRepeatable('museum'), false);
  assert.equal(mayShow(f, NOW), false);
});

test('a restaurant comes round again, but not next week', () => {
  const recent = { itemRef: 'osm:3', vertical: 'restaurant', verdict: 'done' as const, at: daysAgo(10) };
  const old = { itemRef: 'osm:3', vertical: 'restaurant', verdict: 'done' as const, at: daysAgo(200) };
  assert.equal(mayShow(recent, NOW), false, 'ten days is not a gap');
  assert.equal(mayShow(old, NOW), true, 'two hundred is');
});

test('the most recent verdict wins, whatever order the rows arrive in', () => {
  // Somebody can change their mind, and the older row must not win. The
  // database returns these in no particular order.
  const rows = [
    { itemRef: 'osm:4', vertical: 'restaurant', verdict: 'not_interested' as const, at: daysAgo(2) },
    { itemRef: 'osm:4', vertical: 'restaurant', verdict: 'done' as const, at: daysAgo(300) },
  ];
  assert.equal(latestPerItem(rows).get('osm:4')?.verdict, 'not_interested');
  assert.equal(latestPerItem([...rows].reverse()).get('osm:4')?.verdict, 'not_interested');
});

test('what stays hidden is exactly what they ruled out', () => {
  const hidden = hiddenFor([
    { itemRef: 'a', vertical: 'restaurant', verdict: 'not_interested', at: daysAgo(1) },
    { itemRef: 'b', vertical: 'museum', verdict: 'done', at: daysAgo(500) },
    { itemRef: 'c', vertical: 'restaurant', verdict: 'done', at: daysAgo(500) },
  ], NOW);
  assert.ok(hidden.has('a'), 'refused');
  assert.ok(hidden.has('b'), 'a museum they have been to');
  assert.ok(!hidden.has('c'), 'a restaurant, long enough ago');
});

// ─── What a group does with one person's history ────────────────────────

test('one member having been does not veto five other people', () => {
  // Somebody who has seen the cathedral has not decided that five others may
  // not see it. Silently removing it would make that call for them.
  const call = groupVerdict(
    [{ userId: 'u1', verdict: 'done', name: 'Sam Reid' }], 'organiser', 6,
  );
  assert.equal(call.exclude, false);
  assert.match(call.note as string, /Sam's been here/);
});

test('the organiser saying no rules it out', () => {
  const call = groupVerdict(
    [{ userId: 'org', verdict: 'not_interested', name: 'Peter' }], 'org', 6,
  );
  assert.equal(call.exclude, true);
  assert.equal(call.note, null);
});

test('most of the group having been means the group has been', () => {
  const been = ['u1', 'u2', 'u3', 'u4'].map(userId => ({ userId, verdict: 'done' as const }));
  assert.equal(groupVerdict(been, 'org', 6).exclude, true);
  assert.equal(groupVerdict(been.slice(0, 2), 'org', 6).exclude, false, 'two of six is not most');
});

test('a majority is of the group, not of those who happened to answer', () => {
  // Two people answering "done" out of six is not a majority, even though it
  // is both of the answers received.
  const two = [{ userId: 'u1', verdict: 'done' as const }, { userId: 'u2', verdict: 'done' as const }];
  assert.equal(groupVerdict(two, 'org', 6).exclude, false);
  assert.equal(groupVerdict(two, 'org', 3).exclude, true, 'two of three is');
});

test('a member who would rather not is quoted, not overruled', () => {
  const call = groupVerdict(
    [{ userId: 'u9', verdict: 'not_interested', name: 'Marco Diaz' }], 'org', 4,
  );
  assert.equal(call.exclude, false);
  assert.match(call.note as string, /Marco would rather not/);
});

test('nothing said means nothing shown', () => {
  assert.deepEqual(groupVerdict([], 'org', 4), { exclude: false, note: null });
});

test('a reference is stable across sources', () => {
  assert.equal(refOf('OSM', ' 123 '), 'osm:123');
});
