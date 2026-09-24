// /api/plans/[planId]/funding/confirm — server-verified payment confirmation
// Bridges the gap until the Stripe webhook exists: the client sends a
// paymentIntentId, we ask Stripe (with the SECRET key) whether it truly
// succeeded and belongs to this plan, and only then mark the contribution
// succeeded. No client trust involved.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => ({}));
  const paymentIntentId = body.paymentIntentId;
  if (!paymentIntentId || typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_')) {
    return NextResponse.json({ error: 'paymentIntentId required' }, { status: 400 });
  }
  const r = await fetch('https://api.stripe.com/v1/payment_intents/' + paymentIntentId, {
    headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY },
  });
  const pi = await r.json();
  if (pi.status !== 'succeeded' || pi.metadata?.kind !== 'reach_contribution' || pi.metadata?.plan_id !== params.planId) {
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
  return NextResponse.json({ ok: true });
}
