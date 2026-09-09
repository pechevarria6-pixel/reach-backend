// /api/plans/[planId]/funding/confirm — server-verified payment confirmation
// Bridges the gap until the Stripe webhook exists: the client sends a
// paymentIntentId, we ask Stripe (with the SECRET key) whether it truly
// succeeded and belongs to this plan, and only then mark the contribution
// succeeded. No client trust involved.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
  await supabase().from('contributions')
    .update({ status: 'succeeded' })
    .eq('stripe_payment_intent', paymentIntentId);
  return NextResponse.json({ ok: true });
}
