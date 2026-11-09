// Run with: npm run test:unit
//
// Pilot gate A3 / directive P5: a bank return or chargeback takes the share
// off; an inquiry moves nothing; a dispute won puts it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargeOfDispute, disputeGaveBack, disputeTookMoney, intentOfDispute } from '../../lib/rail/disputes.ts';

test('a dispute that withdrew money takes the share off; an inquiry does not', () => {
  assert.ok(disputeTookMoney('charge.dispute.created', { status: 'needs_response' }));
  assert.ok(!disputeTookMoney('charge.dispute.created', { status: 'warning_needs_response' }), 'an inquiry moves no money');
  assert.ok(disputeTookMoney('charge.dispute.funds_withdrawn', { status: 'needs_response' }), 'an inquiry that became a dispute');
  assert.ok(!disputeTookMoney('charge.dispute.closed', { status: 'lost' }), 'closing lost takes nothing more');
});

test('money given back counts again', () => {
  assert.ok(disputeGaveBack('charge.dispute.funds_reinstated', { status: 'won' }));
  assert.ok(disputeGaveBack('charge.dispute.closed', { status: 'won' }));
  assert.ok(!disputeGaveBack('charge.dispute.closed', { status: 'lost' }));
  assert.ok(!disputeGaveBack('charge.dispute.closed', { status: 'warning_closed' }));
});

test('the payment is found from the dispute, or from its charge', () => {
  assert.equal(intentOfDispute({ payment_intent: 'pi_1' }), 'pi_1');
  assert.equal(intentOfDispute({ payment_intent: { id: 'pi_2' } }), 'pi_2');
  assert.equal(intentOfDispute({ payment_intent: null }), null);
  assert.equal(chargeOfDispute({ charge: 'ch_1' }), 'ch_1');
  assert.equal(chargeOfDispute({ charge: { id: 'ch_2' } }), 'ch_2');
});

test('the webhook sends every dispute event here, marks the share, and tells the owner what the plan now holds', () => {
  const src = readFileSync('app/api/webhooks/stripe/route.ts', 'utf8');
  assert.match(src, /if \(type\.startsWith\('charge\.dispute\.'\)\) \{\s*return disputeChanged\(/);
  assert.match(src, /recordContributionDisputed\(supabase, intentId\)/);
  // A bank return after the money cleared, as well as a dispute.
  assert.match(src, /how: 'returned'/);
  assert.match(src, /how: 'disputed'/);
  // Won back: recounted from Stripe's refunds, the same as charge.refunded.
  assert.match(src, /if \(contribution\.status !== 'refunded'\) return NextResponse\.json\(\{ received: true \}\);\s*const failed = await recountFromRefunds\(/);
  assert.match(src, /case 'charge\.refunded':[\s\S]{0,2500}recountFromRefunds\(supabase, contribution, intentId/);
});
