// ─── /api/plans/[planId]/funding — collect-then-approve ──────────────────
// Nobody fronts money for the group. Each member contributes their share;
// the approve endpoint refuses to execute until the plan is fully funded.
// GET  → { targetCents, collectedCents, funded, myShareCents, contributions[] }
// POST { amountCents? } → PaymentIntent for my share, returns clientSecret.
//
// The share is computed here, not in the client. The client used to divide by
// `plan.participants.length` — a field the API never returned — so it fell
// back to 1 and asked every member to pay for the entire trip.
import { NOT_CHARGED, chargedRows } from '@/lib/booking/charged';
import { NextRequest, NextResponse } from 'next/server';
import { report } from '@/lib/report';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { planShares } from '@/lib/money';
import { planSkips, partySize } from '@/lib/participation';
import { netCollectedCents } from '@/lib/booking/approval';
import { staleForParty } from '@/lib/booking/party';
import { midClaim } from '@/lib/booking/claim';
import { notOnBooked } from '@/lib/joining';
import type { SupabaseClient } from '@supabase/supabase-js';
import { track } from '@/lib/track';

async function fundingStatus(
  db: SupabaseClient, planId: string, groupId: string, userId: string, budgetCents: number
) {
  // Target = every live booking on this plan that Reach itself buys. A
  // ticket or a table somebody buys on the seller's own site is not in it —
  // checkout does not show it in the total, so nobody is charged for it.
  const { data: rows } = await db
    .from('bookings')
    .select('id,price_cents,status,mode,provider,vertical')
    .eq('plan_id', planId)
    .not('status', 'in', NOT_CHARGED);
  const bookings = chargedRows(rows);
  const targetCents = bookings.reduce((s, b) => s + (b.price_cents || 0), 0);

  // select('*'), never naming refunded_cents: before
  // sql/wave1-refunds-2026-09-22.sql runs the column is not there, and naming
  // it would fail the whole read. collectedCents counts a missing one as
  // nothing refunded, and money handed back never counts towards the target.
  const { data: contributions } = await db
    .from('contributions').select('*').eq('plan_id', planId);
  // Net of anything Stripe has given back — the same figure approval checks
  // against, so this screen cannot say "funded" over a plan approval refuses.
  const collectedCents = netCollectedCents(contributions);

  const memberIds = await groupMemberIds(db, groupId);
  const skips = await planSkips(db, planId);

  // ── Nobody pays more because a booking of ours failed ─────────────────
  // Priced bookings, less anything this member is sitting out, split exactly;
  // before anything is priced, an even share of the plan's budget. The same
  // function feeds the participation screen and the reminder email, so the
  // amount charged here is the amount shown there.
  //
  // The budget is a guess for a plan nothing has been priced on, and once
  // money has come in it is never used again. In the first end-to-end run a
  // hotel failed at the provider, the target dropped from $334.01 to
  // nothing, the share fell back to a quarter of the budget, and somebody
  // who had paid in full was asked for $65.99 more. Our failure, their money.
  //
  // That used to be patched by capping every share at what the person had
  // already paid — which also made a real top-up impossible. A price rise
  // somebody accepted, or a booking added before anyone paid, left the plan
  // short for good, and approval refused it for ever. With the budget out of
  // it after the first payment, a share only rises when real bookings do.
  const guessCents = collectedCents > 0 ? 0 : Math.max(0, budgetCents || 0);
  const myShareCents = planShares(bookings, guessCents, memberIds, skips)[userId] ?? 0;

  const myPaidCents = netCollectedCents(contributions, userId);

  const { data: failedBookings } = await db
    .from('bookings')
    .select('id,vertical,price_cents,error')
    .eq('plan_id', planId)
    .in('status', ['failed']);

  // Sent to the provider and never answered (approval's outcome_unknown):
  // it may be bought, so it stays in the total and cannot be booked again.
  // Named here so it is not a row nobody can see that blocks for ever.
  const { data: open } = await db
    .from('bookings')
    .select('id,vertical,detail,status,approved_at,updated_at,error')
    .eq('plan_id', planId)
    .in('status', ['booking', 'awaiting_approval'])
    .not('error', 'is', null);
  const inDoubt = (open || []).filter(b => midClaim(b) && /^outcome unknown/.test(String(b.error)));

  return {
    targetCents,
    collectedCents,
    // Named so checkout can say what did not happen. A booking that failed
    // after somebody paid is the most important thing on the screen.
    failed: (failedBookings || []).map(b => ({ vertical: b.vertical, priceCents: b.price_cents || 0 })),
    inDoubt: inDoubt.map(b => ({ id: b.id, vertical: b.vertical, detail: b.detail ?? null })),
    funded: targetCents > 0 && collectedCents >= targetCents,
    memberCount: memberIds.length,
    // Who is not on a flight or hotel already bought, because they joined
    // after it was (lib/joining.ts). Without it the plan screen marked them
    // "✓ In" and "Ready to fly" for a seat that is not theirs.
    notOnBooked: notOnBooked(bookings, skips, memberIds),
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

  // Priced for a different number of people than are going. A share of a
  // two-seat fare is not a share of the three-seat fare that will actually
  // be charged, so no money is taken against it until it is priced again.
  const { data: waiting, error: waitingError } = await ctx.db.from('bookings')
    .select('id, vertical, status, mode, request_payload')
    .eq('plan_id', params.planId).eq('status', 'awaiting_approval');
  if (waitingError) {
    console.error('[funding] could not read the bookings waiting', { planId: params.planId, code: waitingError.code });
    return NextResponse.json({ error: 'Could not check this trip just now. Nothing has been charged.' }, { status: 500 });
  }
  const party = await partySize(ctx.db, ctx.plan as { group_id?: unknown; solo_mode?: boolean | null });
  const stale = staleForParty(waiting, party);
  if (stale.length) {
    return NextResponse.json({
      code: 'stale_quotes',
      stale: stale.map(b => ({ id: b.id, vertical: b.vertical })),
      error: `Some of this was priced for a different number of people than are going (${party}). It needs pricing again before anybody pays. Nothing has been charged.`,
      funding: status,
    }, { status: 409 });
  }

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
  // Stripe's own idempotency, because the guard above is a read and this is
  // a write, and a fast double-tap sends two requests that both read "no
  // payment in flight" before either of them writes one. Without this they
  // create two payment intents for the same share and the person can be
  // charged twice.
  //
  // Keyed on the plan, the person and the amount, so a retry of the same
  // press returns the very same intent while a different share — someone
  // leaving the group changes what everyone owes — is a new one. A second
  // identical payment is already refused above, which is what makes keying
  // on the amount safe rather than a way to block a legitimate charge.
  //
  // And on how many payments this person has made here before. A top-up of
  // the same amount as an earlier payment — the fare rose by exactly what
  // they paid last time — would otherwise be handed that earlier, finished
  // intent back, and nothing would be charged for the rise.
  const priorPayments = (status.contributions || [])
    .filter((c: { user_id?: string }) => c.user_id === ctx.user.id).length;
  const idempotencyKey = `reach_contrib_${params.planId}_${ctx.user.id}_${amountCents}_${priorPayments}`;
  const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: form,
  });
  const pi = await stripeRes.json();
  if (!stripeRes.ok) {
    // Stripe refusing to create the payment intent is the moment checkout
    // dies, and it needs the reason recorded, not just relayed.
    report(new Error(pi?.error?.message ?? 'Stripe refused the payment intent'), { where: 'funding', extra: { planId: params.planId, status: stripeRes.status } });
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

  // With the amount on it. Without one this event says somebody reached the
  // pay screen and nothing else, so the gap between what people set out to
  // pay and what they actually paid — the only drop-off on this path that
  // costs money — could not be worked out from the table at all.
  void track(ctx.db, 'funding_started', {
    userId: ctx.user.id, groupId: String(ctx.plan.group_id), planId: params.planId,
    props: { amount_cents: amountCents },
  });

  // One row per intent.
  //
  // Stripe's idempotency key above means a double-tap gets back the SAME
  // payment intent rather than two — which stops the double charge and does
  // not stop this insert running twice. Walked on production: two
  // simultaneous requests produced one intent and two pending contributions
  // against it. The webhook finds contributions by intent id, so a single
  // payment of $918.81 would have been recorded twice, and a group's
  // collected total would have said it was funded on half the money.
  //
  // Reading first is not enough for the same reason it was not enough for
  // the intent — both requests read before either writes. The unique index
  // is what settles it, and until the migration adding it has run, the
  // duplicate is cleaned up here: same intent, same person, keep the first.
  let { data, error } = await ctx.db.from('contributions').insert({
    plan_id: params.planId,
    group_id: ctx.plan.group_id,
    user_id: ctx.user.id,
    amount_cents: amountCents,
    stripe_payment_intent: pi.id,
    status: 'pending',
  }).select().single();

  // 23505: the index refused a second row for this intent. Not an error for
  // anybody to see — it means the other half of a double-tap got there
  // first, and that row is the one to hand back.
  if (error && (error as { code?: string }).code === '23505') {
    const existing = await ctx.db.from('contributions')
      .select().eq('stripe_payment_intent', pi.id).eq('user_id', ctx.user.id).maybeSingle();
    if (existing.data) {
      console.log('[funding] a second contribution for one intent was refused — returning the first');
      data = existing.data; error = null;
    }
  }
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
