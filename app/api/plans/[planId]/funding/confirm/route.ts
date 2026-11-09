// /api/plans/[planId]/funding/confirm — server-verified payment confirmation
// Bridges the gap until the Stripe webhook exists: the client sends a
// paymentIntentId, we ask Stripe (with the SECRET key) whether it truly
// succeeded and belongs to this plan, and only then mark the contribution
// succeeded. No client trust involved.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { methodOf, recordMethod } from '@/lib/contribution-method';
import { recordContributionMove } from '@/lib/contribution-events';
import { contributionMove } from '@/lib/rail/contribution-state';
import { feeOfCharge, recordFee } from '@/lib/rail/fees';

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => ({}));
  const paymentIntentId = body.paymentIntentId;
  if (!paymentIntentId || typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_')) {
    return NextResponse.json({ error: 'paymentIntentId required' }, { status: 400 });
  }
  // Expanded so the method that paid (directive P1) and what Stripe kept of
  // it (P6) can be recorded.
  const r = await fetch('https://api.stripe.com/v1/payment_intents/' + paymentIntentId + '?expand[]=latest_charge.balance_transaction&expand[]=payment_method', {
    headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY },
  });
  const pi = await r.json();
  if (pi.metadata?.kind !== 'reach_contribution' || pi.metadata?.plan_id !== params.planId) {
    return NextResponse.json({ error: 'Payment not confirmed' }, { status: 409 });
  }
  // A bank debit confirms as `processing` and clears in a few business days.
  // That is a payment on its way, not one that failed, and the row says so:
  // `processing` (directive P2, lib/rail/contribution-state.ts). The in-flight
  // guard in funding refuses a second payment over it, approval waits for
  // the money and says "still clearing", and the webhook marks it when it
  // clears. Before the pilot-gate migration the table cannot hold
  // 'processing' and the row stays `pending`, which those read the same way.
  // Answered as clearing, so the screen says so instead of telling somebody
  // their payment was not recorded.
  if (pi.status === 'processing') {
    const move = contributionMove('processing', 'processing');
    if (move) {
      const { error: moved } = await recordContributionMove(ctx.db, paymentIntentId, move, ctx.user.id);
      // Left 'pending' if this fails, which is still in flight to every reader.
      if (moved) console.error('[funding] a bank payment on its way could not be marked clearing', { plan: params.planId, code: moved.code });
    }
    await recordMethod(ctx.db, paymentIntentId, methodOf(pi));
    return NextResponse.json({ ok: true, clearing: true });
  }
  if (pi.status !== 'succeeded') {
    return NextResponse.json({ error: 'Payment not confirmed' }, { status: 409 });
  }
  // Stripe says the money moved. If this write does not land, the plan goes
  // on believing that share was never paid — so the person is asked for it
  // twice and the funding gate holds a trip that is actually funded.
  //
  // A refunded payment's intent still says succeeded at Stripe, so a screen
  // confirming it again after the refund would have made the plan count
  // money it had handed back. Refunded stays refunded.
  const { error: recorded } = await ctx.db.from('contributions')
    .update({ status: 'succeeded', updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent', paymentIntentId)
    .eq('user_id', ctx.user.id)
    .neq('status', 'refunded');
  if (recorded) {
    console.error('[funding] paid at Stripe but not recorded', { plan: params.planId, code: recorded.code });
    return NextResponse.json({ error: "Your payment went through, but we couldn't record it against this trip. Don't pay again. Email hello@alcanzar.io with your payment reference so it can be attached or refunded." }, { status: 500 });
  }
  await recordMethod(ctx.db, paymentIntentId, methodOf(pi));
  await recordFee(ctx.db, paymentIntentId, feeOfCharge(pi.latest_charge));
  return NextResponse.json({ ok: true });
}
