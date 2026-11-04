import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  impactOfDateChange, describeImpact, needsConfirmation, stillWorksFor,
} from '../../lib/date-change.ts';

test('a table the member booked themselves is theirs to move', () => {
  // Reach has no standing to change it: it is on their account, their card,
  // on the restaurant's own platform. Naming who must act is the whole job.
  const [impact] = impactOfDateChange([{
    id: 'b1', vertical: 'restaurant', status: 'confirmed', mode: 'redirect',
    provider: 'resy', detail: 'Poole’s Diner, Raleigh', fulfilled_by: 'u-marco',
  }]);
  assert.equal(impact.consequence, 'rebook_yourself');
  assert.equal(impact.whose, 'u-marco');
  assert.equal(impact.what, 'Poole’s Diner, Raleigh');
});

test('a hotel Reach holds can be re-run through the provider', () => {
  const [impact] = impactOfDateChange([{
    id: 'b2', vertical: 'hotel', status: 'confirmed', mode: 'native',
    provider: 'liteapi', detail: 'Best Western Raleigh',
  }]);
  assert.equal(impact.consequence, 'rebook_through_reach');
});

test('a price is not a booking, so it is simply asked again', () => {
  for (const status of ['quoted', 'awaiting_approval']) {
    const [impact] = impactOfDateChange([{ id: 'b3', vertical: 'flight', status, detail: 'AA10' }]);
    assert.equal(impact.consequence, 'requote', status);
  }
});

test('a booking with no name of its own is still described in words', () => {
  // "your restaurant" is the enum talking. The vocabulary check caught this
  // in the fallback before it shipped.
  const [table] = impactOfDateChange([{ id: 'x', vertical: 'restaurant', status: 'confirmed', mode: 'redirect' }]);
  assert.equal(table.what, 'your table');
  const [unknown] = impactOfDateChange([{ id: 'y', vertical: 'something-new', status: 'confirmed', mode: 'native' }]);
  assert.equal(unknown.what, 'something on this trip');
});

test('a failed booking is not something to disturb', () => {
  for (const status of ['failed', 'cancelled']) {
    const [impact] = impactOfDateChange([{ id: 'b4', status, detail: 'x' }]);
    assert.equal(impact.consequence, 'none', status);
  }
  assert.equal(needsConfirmation(impactOfDateChange([{ status: 'failed' }])), false);
});

test('the organiser is told in plain words what they are about to disturb', () => {
  const lines = describeImpact(impactOfDateChange([
    { id: '1', status: 'confirmed', mode: 'redirect', provider: 'resy', detail: 'Desert Bistro' },
    { id: '2', status: 'confirmed', mode: 'native', provider: 'liteapi', detail: 'Best Western' },
    { id: '3', status: 'awaiting_approval', detail: 'AA10 RDU to PVR' },
    { id: '4', status: 'failed', detail: 'nothing' },
  ]));
  assert.equal(lines.length, 3, 'the failed one is not mentioned');
  assert.match(lines[0], /has to move it there/);
  assert.match(lines[1], /booked again/);
  assert.match(lines[2], /price it again/);
});

test('who the new dates still work for', () => {
  const windows = [
    { userId: 'a', start: '2026-11-01', end: '2026-11-30' },
    { userId: 'b', start: '2026-11-01', end: '2026-11-05' },
    { userId: 'c', start: '2026-11-20', end: '2026-11-24' },
  ];
  // Being free for part of a trip is not being able to come on it.
  const moved = stillWorksFor(windows, '2026-11-02', '2026-11-09');
  assert.deepEqual(moved.works, ['a']);
  assert.deepEqual(moved.out.sort(), ['b', 'c']);

  const original = stillWorksFor(windows, '2026-11-02', '2026-11-04');
  assert.deepEqual(original.works.sort(), ['a', 'b']);
});

test('nobody has said when they are free, so nobody is counted out', () => {
  assert.deepEqual(stillWorksFor([], '2026-11-02', '2026-11-09'), { works: [], out: [] });
});

test('a row written by the retired queue still reads as a place', () => {
  // Verbatim from production. Splitting on the separator alone left the
  // prefix and a trailing comma in a sentence somebody reads.
  const legacy = 'Reservation request: Seafood dinner at the chef’s counter at Desert Bistro,  · 2026-09-17 Day 3 · Evening · party of 2';
  const [impact] = impactOfDateChange([{ id: 'l', status: 'pending', mode: 'concierge', detail: legacy }]);
  assert.equal(impact.what, 'Seafood dinner at the chef’s counter at Desert Bistro');
});

test('a table being booked, or sent and never answered, is not "only priced": the dates do not move over it', async () => {
  const { blocksDateChange } = await import('../../lib/date-change.ts');
  const stamp = '2026-11-04T17:59:00.000Z';
  const claimed = { id: 'b1', vertical: 'restaurant', status: 'awaiting_approval', detail: "Luigi's", approved_at: stamp, updated_at: stamp };
  const unknown = { ...claimed, id: 'b2', response_payload: { table: { platform: 'opentable', reserving: { at: stamp, unknown: 'timeout' } } } };
  const priced = { id: 'b3', vertical: 'restaurant', status: 'awaiting_approval', detail: "Poole's", approved_at: null, updated_at: '2026-11-04T10:00:00.000Z' };
  const impacts = impactOfDateChange([claimed, { ...unknown, approved_at: null }, priced]);
  assert.deepEqual(impacts.map(i => i.consequence), ['held_up', 'held_up', 'requote']);
  assert.equal(impacts[2].version, '2026-11-04T10:00:00.000Z', 'a requote is cancelled only as it was read');
  assert.equal(blocksDateChange(impacts), true);
  assert.equal(blocksDateChange(impactOfDateChange([priced])), false);
  const said = describeImpact(impacts);
  assert.match(said[0], /being booked right now, or we can't yet tell/);
  assert.doesNotMatch(said[0], /only priced/);
});

test('the date move refuses a held-up booking before asking, and cancels a quote only at the version read', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('app/api/plans/[planId]/route.ts', 'utf8');
  const blocked = src.indexOf('if (blocksDateChange(impacts))');
  assert.ok(blocked > 0 && blocked < src.indexOf('if (needsConfirmation(impacts)'), 'confirming cannot cancel a table that may be booked');
  assert.match(src, /select\('id, vertical, status, mode, provider, detail, fulfilled_by, booked_by, approved_at, updated_at, response_payload'\)/);
  assert.match(src, /atVersion\(supabase\.from\('bookings'\)\s*\.update\(\{ status: 'cancelled'/);
  assert.doesNotMatch(src, /\.in\('id', stale\)/, 'cancelled by id alone, whatever the row says now');
});
