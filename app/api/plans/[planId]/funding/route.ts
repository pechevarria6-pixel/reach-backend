// ─── /api/plans/[planId]/funding — collect-then-approve ──────────────────
// Nobody fronts money for the group. Each member contributes their share;
// the approve endpoint refuses to execute until the plan is fully funded.
// GET  → { targetCents, collectedCents, funded, myShareCents, contributions[] }
// POST { amountCents? } → PaymentIntent for my share, returns clientSecret.
//
// The share is computed here, not in the client. The client used to divide by
// `plan.participants.length` — a field the API never returned — so it fell
// back to 1 and asked every member to pay for the entire trip.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { shareFor } from '@/lib/money';
import type { SupabaseClient } from '@supabase/supabase-js';

async function fundingStatus(
  db: SupabaseClient, planId: string, groupId: string, userId: string, budgetCents: number
) {
  // Target = sum of every non-failed booking priced on this plan
  const { data: bookings } = await db
    .from('bookings')
    .select('price_cents,status')
    .eq('plan_id', planId)
    .not('status', 'in', '("failed","cancelled")');
  const targetCents = (bookings || []).reduce((s, b) => s + (b.price_cents || 0), 0);

  const { data: contributions } = await db
    .from('contributions').select('*').eq('plan_id', planId);
  const succeeded = (contributions || []).filter(c => c.status === 'succeeded');
  const collectedCents = succeeded.reduce((s, c) => s + c.amount_cents, 0);

  const memberIds = await groupMemberIds(db, groupId);

  // Before anything is priced there is nothing to collect against, so fall
  // back to the plan's own budget. `targetCents` still reports the booking
  // total, because that is what the approve gate compares against.
  const basisCents = targetCents > 0 ? targetCents : Math.max(0, budgetCents || 0);

  const myShareCents = shareFor(basisCents, memberIds, userId);

  const myPaidCents = succeeded
    .filter(c => c.user_id === userId)
    .reduce((s, c) => s + c.amount_cents, 0);

  return {
    targetCents,
    collectedCents,
    funded: targetCents > 0 && collectedCents >= targetCents,
    memberCount: memberIds.length,
    myShareCents,
    myPaidCents,
    myRemainingCents: Math.max(0, myShareCents - myPaidCents),
    contributions: contributions || [],
  };
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  return NextResponse.json(
    await fundingStatus(
      ctx.db, params.planId, ctx.plan.group_id as string, ctx.user.id,
      Number(ctx.plan.budget_cents) || 0
    )
  );
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY not set' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const status = await fundingStatus(
    ctx.db, params.planId, ctx.plan.group_id as string, ctx.user.id,
    Number(ctx.plan.budget_cents) || 0
  );

  // Default to what this member actually owes. An explicit amount is honoured
  // but capped at the outstanding share, so a stale client can't overcharge.
  const requested = Number(body.amountCents);
  const amountCents = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.round(requested), status.myRemainingCents)
    : status.myRemainingCents;

  if (!amountCents || amountCents < 50) {
    return NextResponse.json(
      { error: 'Nothing left to pay on this plan', funding: status },
      { status: 400 }
    );
  }

  // Create the PaymentIntent via Stripe's REST API (no SDK dependency)
  const form = new URLSearchParams({
    amount: String(amountCents),
    currency: 'usd',
    'metadata[plan_id]': params.planId,
    'metadata[user_id]': ctx.user.id,
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

  const { data, error } = await ctx.db.from('contributions').insert({
    plan_id: params.planId,
    group_id: ctx.plan.group_id,
    user_id: ctx.user.id,
    amount_cents: amountCents,
    stripe_payment_intent: pi.id,
    status: 'pending',
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ contribution: data, clientSecret: pi.client_secret, amountCents });
}

// The Stripe webhook marks these succeeded on payment_intent.succeeded where
// metadata.kind === 'reach_contribution'. The /funding/confirm endpoint does
// the same check on demand, for clients that finish before the webhook lands.
