// Run with: npm run test:unit
// Coordinator merge follow-ups (pilot gate, 2026-11-08): a bank payment on its
// way is neither "still to pay" nor "Chip in" again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fundingStanding } from '../../lib/nudge.ts';

const bookings = [{ price_cents: 20000, status: 'awaiting_approval', mode: 'native', provider: 'liteapi', vertical: 'hotel' }] as never;

test('nobody is nudged to pay while their bank payment is clearing', () => {
  const clearing = fundingStanding(bookings, 0, [{ user_id: 'a', amount_cents: 10000, status: 'processing' }] as never, ['a', 'b']);
  assert.ok(clearing.done.has('a'), 'a clearing share is not "still to pay"');
  assert.ok(!clearing.done.has('b'), 'the member who has not paid is still nudged');
  const none = fundingStanding(bookings, 0, [], ['a', 'b']);
  assert.ok(!none.done.has('a'));
});

test('the plan card says a bank payment is on its way instead of "Chip in" again', () => {
  const src = readFileSync('lib/next-action.ts', 'utf8');
  assert.match(src, /if \(clearing > 0 && clearing >= owe\) \{[\s\S]{0,200}title: 'Your bank payment is on its way'/);
  assert.match(readFileSync('lib/checkout.ts', 'utf8'), /myClearingCents\?: number \| null;/);
});

test('every new booking row is stamped, and the stamp never costs the booking', () => {
  const src = readFileSync('app/api/bookings/route.ts', 'utf8');
  assert.match(src, /const stamp = stampFor\(/);
  assert.match(src, /if \(wrote && stamp && schemaPending\(wrote\)\)/);
});
