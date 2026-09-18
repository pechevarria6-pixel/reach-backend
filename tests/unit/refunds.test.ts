// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundOutcome } from '../../lib/refunds.ts';

test('a full refund stops the contribution counting', () => {
  assert.deepEqual(refundOutcome(5000, 5000), { status: 'refunded', note: null });
});

test('over-refunding is still a refund', () => {
  // Stripe can refund more than the charge in edge cases; it is still gone.
  assert.equal(refundOutcome(5000, 5100).status, 'refunded');
});

test('a partial refund keeps counting, and says so', () => {
  const out = refundOutcome(5000, 500);
  assert.equal(out.status, 'succeeded');
  assert.match(out.note as string, /partial refund of 500 of 5000/);
});

test('a refund of nothing changes nothing', () => {
  assert.equal(refundOutcome(5000, 0).status, 'succeeded');
});

test('nonsense in does not produce a refund', () => {
  // A zero-amount contribution cannot be "fully refunded" into not counting.
  assert.equal(refundOutcome(0, 0).status, 'succeeded');
  assert.equal(refundOutcome(NaN as unknown as number, NaN as unknown as number).status, 'succeeded');
});
