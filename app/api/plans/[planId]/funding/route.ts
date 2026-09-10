// ─── /api/plans/[planId]/funding — collect-then-approve ──────────────────
// Nobody fronts money for the group. Each member contributes their share;
// the approve endpoint refuses to execute until the plan is fully funded.
// GET  → { targetCents, collectedCents, funded, contributions[] }
// POST { amountCents } → creates a Stripe PaymentIntent for my share,
//        returns clientSecret for the app's payment sheet.
// (Stripe webhook marks contributions 'succeeded' — see webhook note below.)
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fundingStatus(planId: string) {
  const db = supabase();
  // Target = sum of every non-failed booking priced on this plan
  const { data: bookings } = await db
    .from('bookings')
    .select('price_cents,status')
    .eq('plan_id', planId)
    .not('status', 'in', '("failed","cancelled")');
  const targetCents = (bookings || []).reduce((s, b) => s + (b.price_cents || 0), 0);

  const { data: contributions } = await db
    .from('contributions').select('*').eq('plan_id', planId);
  const collectedCents = (contributions || [])
    .filter(c => c.status === 'succeeded')
    .reduce((s, c) => s + c.amount_cents, 0);

  return { targetCents, collectedCents, funded: targetCents > 0 && collectedCents >= targetCents, contributions: contributions || [] };
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await fundingStatus(params.planId));
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY not set' }, { status: 500 });
  }
  const body = await req.json().catch(() => ({}));
  const amountCents = Number(body.amountCents);
  if (!amountCents || amountCents < 50) {
    return NextResponse.json({ error: 'amountCents (>= 50) required' }, { status: 400 });
  }

  // Create the PaymentIntent via Stripe's REST API (no SDK dependency)
  const form = new URLSearchParams({
    amount: String(amountCents),
    currency: 'usd',
    'metadata[plan_id]': params.planId,
    'metadata[user_id]': userId,
    'metadata[kind]': 'reach_contribution',
    'automatic_payment_methods[enabled]': 'true',
  });
  const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const pi = await stripeRes.json();
  if (!stripeRes.ok) {
    return NextResponse.json({ error: pi?.error?.message || 'Stripe error' }, { status: 502 });
  }

  const { data, error } = await supabase().from('contributions').insert({
    plan_id: params.planId,
    group_id: body.groupId || null,
    user_id: userId,
    amount_cents: amountCents,
    stripe_payment_intent: pi.id,
    status: 'pending',
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ contribution: data, clientSecret: pi.client_secret });
}

// The Stripe webhook marks these succeeded on payment_intent.succeeded where
// metadata.kind === 'reach_contribution'. The /funding/confirm endpoint does
// the same check on demand, for clients that finish before the webhook lands.
export { fundingStatus };
