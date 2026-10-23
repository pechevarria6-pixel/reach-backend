// Run with: npm run test:unit
//
// "I'll drive / already have a flight" (owner decision 8): somebody comes
// off the group's flight until anybody pays, and while the flight is only
// proposed. The hotel is never one to sit out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canOptOut, optOutRefusal, lastOneOut } from '../../lib/participation.ts';
import { partyFor } from '../../lib/booking/resize.ts';
import { sharesWithSkips } from '../../lib/money.ts';

test('a flight can be sat out; somewhere to stay cannot', () => {
  for (const v of ['activity', 'event', 'restaurant', 'flight']) assert.equal(canOptOut(v), true, v);
  for (const v of ['hotel', '', null, undefined, 'transport']) assert.equal(canOptOut(v), false, String(v));
});

test('a proposed flight, nobody paid: the driver comes off', () => {
  assert.equal(optOutRefusal({ vertical: 'flight', status: 'awaiting_approval', anyonePaid: false }), null);
});

test('once anybody pays, nobody comes off the flight', () => {
  const r = optOutRefusal({ vertical: 'flight', status: 'awaiting_approval', anyonePaid: true });
  assert.equal(r?.status, 409);
  assert.match(r!.error, /already paid/);
});

test('a held or bought seat is somebody\'s seat', () => {
  for (const status of ['quoted', 'pending', 'confirmed', 'booking']) {
    const r = optOutRefusal({ vertical: 'flight', status, anyonePaid: false });
    assert.equal(r?.status, 409, status);
  }
});

test('the hotel is refused whatever the state', () => {
  const r = optOutRefusal({ vertical: 'hotel', status: 'awaiting_approval', anyonePaid: false });
  assert.equal(r?.status, 400);
  assert.doesNotMatch(r!.error, /getting there/, 'getting there can be sat out now — the copy must not say it cannot');
});

test('a dinner is still governed only by payment', () => {
  assert.equal(optOutRefusal({ vertical: 'restaurant', status: 'confirmed', anyonePaid: false }), null);
  assert.equal(optOutRefusal({ vertical: 'restaurant', status: 'confirmed', anyonePaid: true })?.status, 409);
});

test('the last person on the flight is told so in its own words', () => {
  assert.match(lastOneOut('flight'), /flight/);
  assert.match(lastOneOut('restaurant'), /in for this one/);
});

test('a driver off the flight shrinks its party and its split', () => {
  const members = ['a', 'b', 'c', 'd'];
  const skips = [{ ref: 'f1', userId: 'd' }];
  assert.equal(partyFor(4, members, skips, 'f1'), 3);
  const shares = sharesWithSkips([{ ref: 'f1', priceCents: 90000 }], members, skips);
  assert.deepEqual(shares, { a: 30000, b: 30000, c: 30000, d: 0 });
});

test('the route asks the shared rule, not its own list', () => {
  const src = readFileSync(new URL('../../app/api/plans/[planId]/participation/route.ts', import.meta.url), 'utf8');
  assert.match(src, /optOutRefusal\(/);
  assert.match(src, /canOptOut\(b\.vertical\)/);
  assert.doesNotMatch(src, /canSkip\(/);
});
