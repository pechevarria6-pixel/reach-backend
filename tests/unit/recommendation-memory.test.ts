import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mayShow, hiddenFor, visitedIn, latestPerItem, groupVerdict, refOf,
} from '../../lib/recommendation-memory.ts';

const NOW = new Date('2026-09-20T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

test('"not for me" is permanent — a refusal does not quietly expire', () => {
  // Hiding it is the whole reason somebody taps it, and a refusal that
  // lapses is the app deciding it knows better than the person who said no.
  const f = { itemRef: 'osm:1', vertical: 'restaurant', verdict: 'not_interested' as const, at: daysAgo(3650) };
  assert.equal(mayShow(f), false);
});

test('marking somewhere done never takes it away', () => {
  // A record, not a refusal. The first version hid these and brought them
  // back after four months for kinds it judged repeatable — which put the
  // app in charge of deciding whether you might return to somewhere you had
  // enjoyed, and got crafts wrong immediately.
  for (const vertical of ['restaurant', 'museum', 'pottery & crafts', 'anything at all']) {
    const f = { itemRef: 'osm:2', vertical, verdict: 'done' as const, at: daysAgo(1) };
    assert.equal(mayShow(f), true, vertical);
  }
});

test('what you have been to is remembered, so a card can say so', () => {
  const visited = visitedIn([
    { itemRef: 'a', vertical: 'pottery & crafts', verdict: 'done', at: daysAgo(1) },
    { itemRef: 'b', vertical: 'restaurant', verdict: 'not_interested', at: daysAgo(1) },
  ]);
  assert.deepEqual([...visited], ['a']);
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

test('only a refusal hides anything', () => {
  const hidden = hiddenFor([
    { itemRef: 'a', vertical: 'restaurant', verdict: 'not_interested', at: daysAgo(1) },
    { itemRef: 'b', vertical: 'museum', verdict: 'done', at: daysAgo(500) },
    { itemRef: 'c', vertical: 'pottery & crafts', verdict: 'done', at: daysAgo(1) },
  ]);
  assert.deepEqual([...hidden], ['a'], 'everything else stays available');
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

test('a group that has all been somewhere may still be going back', () => {
  // An earlier version read a majority as the group having collectively done
  // it, and removed it. Five people who have all been somewhere they liked
  // may well be going back together — that is a thing a group chooses.
  const all = ['u1', 'u2', 'u3'].map(userId => ({ userId, verdict: 'done' as const }));
  const call = groupVerdict(all, 'org', 3);
  assert.equal(call.exclude, false);
  assert.match(call.note as string, /all been here before/);
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
