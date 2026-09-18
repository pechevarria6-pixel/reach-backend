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
import { planShares } from '@/lib/money';
import { planSkips } from '@/lib/participation';
import type { SupabaseClient } from '@supabase/supabase-js';

async function fundingStatus(
  db: SupabaseClient, planId: string, groupId: string, userId: string, budgetCents: number
) {
  // Target = sum of every non-failed booking priced on this plan
  const { data: bookings } = await db
    .from('bookings')
    .select('id,price_cents,status')
    .eq('plan_id', planId)
    .not('status', 'in', '("failed","cancelled")');
  const targetCents = (bookings || []).reduce((s, b) => s + (b.price_cents || 0), 0);

  const { data: contributions } = await db
    .from('contributions').select('*').eq('plan_id', planId);
  const succeeded = (contributions || []).filter(c => c.status === 'succeeded');
  const collectedCents = succeeded.reduce((s, c) => s + c.amount_cents, 0);

  const memberIds = await groupMemberIds(db, groupId);
  const skips = await planSkips(db, planId);

  // Priced bookings, less anything this member is sitting out, split exactly;
  // before anything is priced, an even share of the plan's budget. The same
  // function feeds the participation screen and the reminder email, so the
  // amount charged here is the amount shown there. `targetCents` still reports
  // the booking total, because that is what the approve gate compares against,
  // and the shares always add up to it.
  const rawShareCents = planShares(bookings || [], Math.max(0, budgetCents || 0), memberIds, skips)[userId] ?? 0;

  const myPaidCents = succeeded
    .filter(c => c.user_id === userId)
    .reduce((s, c) => s + c.amount_cents, 0);

  // ── Nobody pays more because a booking of ours failed ─────────────────
  // The target counts only bookings that have not failed, and the share falls
  // back to an even slice of the budget when nothing is priced. Put those
  // together after a provider refuses a booking and the trip re-prices
  // itself: in the first end-to-end run a hotel failed at the provider, the
  // target dropped from $334.01 to nothing, the share reverted to a quarter
  // of the budget, and somebody who had paid in full was asked for $65.99
  // more. Our failure, their money.
  //
  // So once anything has been collected, a share cannot rise above what that
  // person has already paid. It can still fall — a cancelled booking should
  // give money back, and that shows up as a refund rather than a smaller
  // demand — and a plan nobody has paid into yet prices normally.
  const myShareCents = collectedCents > 0 && rawShareCents > myPaidCents && myPaidCents > 0
    ? myPaidCents
    : rawShareCents;
  if (myShareCents !== rawShareCents) {
    console.error('[funding] share held at what was already paid', {
      planId, userId, rawShareCents, myPaidCents, targetCents,
      reason: 'a booking failed and the trip would otherwise have re-priced upwards',
    });
  }

  const { data: failedBookings } = await db
    .from('bookings')
    .select('id,vertical,price_cents,error')
    .eq('plan_id', planId)
    .in('status', ['failed']);

  return {
    targetCents,
    collectedCents,
    // Named so checkout can say what did not happen. A booking that failed
    // after somebody paid is the most important thing on the screen.
    failed: (failedBookings || []).map(b => ({ vertical: b.vertical, priceCents: b.price_cents || 0 })),
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

  // A secret key starts sk_. What was configured here was mk_1U4lD…, which is
  // the *identifier* of a key rather than the key, so Stripe answered with its
  // own message and the app relayed it verbatim onto a payment screen. Catch
  // the shape first and say something a person can act on.
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !/^(sk|rk)_/.test(stripeKey)) {
    console.error('[funding] STRIPE_SECRET_KEY is missing or is not a secret key', {
      present: !!stripeKey,
      prefix: stripeKey ? stripeKey.slice(0, 3) : null,
      hint: 'Stripe → Developers → API keys → reveal the secret key (sk_…), not its ID',
    });
    return NextResponse.json(
      { error: 'Payments are not configured correctly yet. Nothing has been charged.' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const status = await fundingStatus(
    ctx.db, params.planId, ctx.plan.group_id as string, ctx.user.id,
    Number(ctx.plan.budget_cents) || 0
  );

  // ── Never a second payment for the same share ─────────────────────────
  // Only succeeded contributions count against what somebody owes, so a
  // payment still settling left the full share outstanding — and every one of
  // checkout's error screens offered "Try again", which came back here and
  // made a second PaymentIntent for the whole amount. A card paid twice is the
  // worst thing this app can do, and pay-later methods take minutes to clear.
  //
  // A contribution in flight is therefore answered with the payment that
  // already exists, never a new one. Stripe is asked what became of it, so an
  // abandoned attempt cannot lock somebody out of paying for ever: one that
  // was never paid is handed back to be finished, and a cancelled one is
  // written off so the next attempt can start cleanly.
  const inFlight = (status.contributions || []).find(
    (c: { user_id?: string; status?: string }) => c.user_id === ctx.user.id && c.status === 'pending',
  ) as { id: string; stripe_payment_intent?: string; amount_cents?: number } | undefined;

  if (inFlight?.stripe_payment_intent) {
    const existing = await fetch(
      `https://api.stripe.com/v1/payment_intents/${inFlight.stripe_payment_intent}`,
      { headers: { Authorization: `Bearer ${stripeKey}` } },
    ).then(r => r.json()).catch(() => null);

    // Nothing usable came back from Stripe. Refusing is the safe half of the
    // guess: a duplicate charge cannot be undone by the app, a refused
    // payment can be retried.
    if (!existing || existing.error || typeof existing.status !== 'string') {
      console.error('[funding] could not read the in-flight payment', {
        planId: params.planId, paymentIntent: inFlight.stripe_payment_intent, error: existing?.error,
      });
      return NextResponse.json(
        { error: 'You already have a payment on this plan and we could not check it just now. Please wait a moment rather than paying again.', funding: status },
        { status: 409 },
      );
    }

    if (existing.status === 'canceled') {
      const { error: writeOff } = await ctx.db.from('contributions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', inFlight.id);
      if (writeOff) {
        console.error('[funding] could not write off a cancelled contribution', {
          planId: params.planId, contribution: inFlight.id, error: writeOff.message,
        });
        return NextResponse.json(
          { error: 'Could not start that payment. Nothing has been charged — try again.' },
          { status: 500 },
        );
      }
      // Falls through and starts a fresh payment below.
    } else if (existing.status === 'requires_payment_method') {
      // Started and never paid: the same intent is handed back to finish.
      return NextResponse.json({
        contribution: inFlight,
        clientSecret: existing.client_secret,
        amountCents: inFlight.amount_cents ?? existing.amount,
        resumed: true,
      });
    } else {
      // requires_action, requires_confirmation, processing, succeeded — money
      // is either moving or already moved.
      return NextResponse.json({
        error: existing.status === 'succeeded'
          ? 'That share is already paid. It can take a moment to show here.'
          : 'Your payment is still going through. Give it a moment — please do not pay again.',
        paymentIntent: inFlight.stripe_payment_intent,
        funding: status,
      }, { status: 409 });
    }
  }

  // Default to what this member actually owes. An explicit amount is honoured
  // but capped at the outstanding share, so a stale client can't overcharge.
  const requested = Number(body.amountCents);
  const amountCents = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.round(requested), status.myRemainingCents)
    : status.myRemainingCents;

  // Nothing on this plan has a price yet. That is a different thing from
  // "you have paid already", and saying the wrong one sends somebody looking
  // for a receipt that does not exist. A screenshot from production had this
  // exact state behind a live "Looks good" button on a total of $0 — the
  // client guard is the courtesy, this is the protection.
  if (status.targetCents <= 0) {
    return NextResponse.json(
      { error: "We're still pricing this — check back soon.", funding: status },
      { status: 422 }
    );
  }

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
    // Stripe refusing to create the payment intent is the moment checkout
    // dies, and it needs the reason recorded, not just relayed.
    console.error('[funding] Stripe refused the payment intent', {
      planId: params.planId, status: stripeRes.status, error: pi?.error,
    });
    // Stripe's message is written for whoever configured the account, not for
    // the person trying to pay. It goes to the log; they get something useful.
    const configProblem = /api key|authentication/i.test(pi?.error?.message || '');
    return NextResponse.json(
      { error: configProblem
          ? 'Payments are not configured correctly yet. Nothing has been charged.'
          : 'Could not start that payment. Nothing has been charged — try again.' },
      { status: configProblem ? 503 : 502 },
    );
  }

  const { data, error } = await ctx.db.from('contributions').insert({
    plan_id: params.planId,
    group_id: ctx.plan.group_id,
    user_id: ctx.user.id,
    amount_cents: amountCents,
    stripe_payment_intent: pi.id,
    status: 'pending',
  }).select().single();
  if (error) {
    // Stripe now holds a PaymentIntent with no contribution behind it. The
    // webhook finds contributions by that intent id, so a payment made against
    // it would never be recorded. This logged "failed" on every success before,
    // which buried the one time it mattered.
    console.error('[funding] could not record the contribution', {
      planId: params.planId, paymentIntent: pi.id, error: error.message,
    });
    return NextResponse.json(
      { error: 'Could not start that payment. Nothing has been charged — try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ contribution: data, clientSecret: pi.client_secret, amountCents });
}

// The Stripe webhook marks these succeeded on payment_intent.succeeded where
// metadata.kind === 'reach_contribution'. The /funding/confirm endpoint does
// the same check on demand, for clients that finish before the webhook lands.
