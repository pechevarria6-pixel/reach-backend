// Run with: npm run test:unit
//
// Pilot gate A1 (code side): PAYMENTS_ENABLED=false stops every new movement
// of money, before Stripe is asked, and says so in words a member can read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paymentsPaused, pausedAnswer, PAYMENTS_PAUSED_MESSAGE } from '../../lib/rail/kill-switch.ts';

test('only "false" pauses; unset or anything else means payments run', () => {
  assert.equal(paymentsPaused({}), false, 'unset is on');
  assert.equal(paymentsPaused({ PAYMENTS_ENABLED: 'true' }), false);
  assert.equal(paymentsPaused({ PAYMENTS_ENABLED: '' }), false);
  assert.equal(paymentsPaused({ PAYMENTS_ENABLED: 'no' }), false, 'a typo never stops money by accident');
  assert.equal(paymentsPaused({ PAYMENTS_ENABLED: 'false' }), true);
  assert.equal(paymentsPaused({ PAYMENTS_ENABLED: ' FALSE ' }), true, 'the owner typing FALSE meant it');
});

test('the answer is a 503 in human words, saying nothing was charged', () => {
  const a = pausedAnswer();
  assert.equal(a.status, 503);
  assert.equal(a.body.code, 'payments_paused');
  assert.match(PAYMENTS_PAUSED_MESSAGE, /^Payments are paused for a moment\./);
  assert.match(PAYMENTS_PAUSED_MESSAGE, /Nothing has been charged/);
});

test('funding refuses before Stripe is asked for a PaymentIntent', () => {
  const src = readFileSync('app/api/plans/[planId]/funding/route.ts', 'utf8');
  const post = src.slice(src.indexOf('export async function POST'));
  const paused = post.indexOf('if (paymentsPaused())');
  assert.ok(paused > 0, 'the funding POST checks the switch');
  for (const later of ["fetch('https://api.stripe.com/v1/payment_intents'", 'fundingStatus(', 'process.env.STRIPE_SECRET_KEY']) {
    const at = post.indexOf(later);
    assert.ok(at > paused, `the switch comes before ${later}`);
  }
});

test('approval refuses anything Reach pays for before it is priced, claimed or bought', () => {
  const src = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  const post = src.slice(src.indexOf('export async function POST'));
  const paused = post.indexOf('if (movesMoney && paymentsPaused())');
  assert.ok(paused > 0, 'approve checks the switch');
  for (const later of ['provider.quote(request)', 'claimBooking(', 'provider.book(request)', 'approveTable(']) {
    assert.ok(post.indexOf(later) > paused, `the switch comes before ${later}`);
  }
});

test('recording money already moved is never paused', () => {
  for (const f of ['app/api/plans/[planId]/funding/confirm/route.ts', 'app/api/webhooks/stripe/route.ts']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /paymentsPaused/, f);
  }
});
