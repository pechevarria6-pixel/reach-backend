// ─── POST /api/plans/[planId]/funding/refund — give back what was not spent ─
// Moab took $1,474 from one person, every booking on it failed, and the app
// had no way to hand the money back. The screen said "Nothing to pay" and
// the promise underneath was "we'll follow up". Nothing in app/ or lib/ ever
// created a Stripe refund.
//
// Contract, for the checkout screen:
//   200 { refundedCents, status, paidCents, keptCents }
//         status: succeeded | pending | requires_action | partial
//   403 { error }   not somebody who paid on this plan
//   409 { error }   nothing to give back, or it has already gone back
//   502 / 503       Stripe refused or did not answer, or payments are not
//                   configured. Each says whether anything was refunded.
//
// The person asks. The server decides how much. The body is ignored: an
// amount from a client is an amount somebody can edit. What they get back
// is worked out in lib/refunds.ts planRefund, where the formula is written
// out and tested. In short:
//
//   refund = (what they paid − what Stripe already gave back)
//          − (their share of every booking still being paid for, or already
//             paid out to a provider)
//
// Two presses at once must not refund twice. Reading "no refund yet" first
// cannot stop that: both requests read before either writes, which is how
// payments were nearly doubled. So a row in `refunds`, whose unique index on
// contribution_id lets exactly one request claim a payment, is written
// BEFORE Stripe is asked. Stripe's idempotency key, one per contribution,
// is the second lock, and before sql/wave1-refunds-2026-09-22.sql it is the
// only one.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { planSkips } from '@/lib/participation';
import { report } from '@/lib/report';
import {
  planRefund, refusal, refundIdempotencyKey, afterStripeRefund, refundColumnPresent,
  isMissingColumn, isMissingTable, REFUNDS_MIGRATION,
  type ContributionRow, type RefundPiece,
} from '@/lib/refunds';

const REFUND_STATUSES = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);

type StripeAnswer = { ok: boolean; httpStatus: number; body: any; thrown?: string };

export async function POST(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const planId = params.planId;

  // The same check as taking payment: a key that is not a secret key gets
  // Stripe's own message, written for whoever set up the account.
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !/^(sk|rk)_/.test(stripeKey)) {
    console.error('[refund] STRIPE_SECRET_KEY is missing or is not a secret key', { present: !!stripeKey });
    return NextResponse.json(
      { error: 'Refunds are not configured correctly yet. Nothing has been refunded.' },
      { status: 503 },
    );
  }

  // Every booking, not just live ones: one paid out to a provider and then
  // cancelled still holds its money. keptBookings() in lib/refunds.ts sorts
  // them. Contributions are select('*') so a missing refunded_cents column
  // reads as nothing refunded rather than failing the read.
  const [bookingsRes, contributionsRes, claimsRes, memberIds, skips] = await Promise.all([
    ctx.db.from('bookings').select('id,price_cents,status,approved_at,error').eq('plan_id', planId),
    ctx.db.from('contributions').select('*').eq('plan_id', planId),
    ctx.db.from('refunds').select('contribution_id').eq('plan_id', planId),
    groupMemberIds(ctx.db, ctx.plan.group_id as string),
    planSkips(ctx.db, planId),
  ]);
  if (bookingsRes.error || contributionsRes.error) {
    console.error('[refund] could not read the plan’s money', {
      planId, bookings: bookingsRes.error?.code, contributions: contributionsRes.error?.code,
    });
    return NextResponse.json(
      { error: 'We could not check what you paid just now. Nothing has been refunded — try again in a moment.' },
      { status: 500 },
    );
  }

  let ledger = true; // whether the refunds table exists to claim a payment in
  if (claimsRes.error) {
    if (!isMissingTable(claimsRes.error)) {
      console.error('[refund] could not read earlier refunds', { planId, code: claimsRes.error.code });
      return NextResponse.json(
        { error: 'We could not check for an earlier refund just now. Nothing has been refunded — try again in a moment.' },
        { status: 500 },
      );
    }
    ledger = false;
    console.error(`[refund] the refunds table does not exist — run ${REFUNDS_MIGRATION}. Whole payments only, locked by Stripe's idempotency key alone`, { planId });
  }

  const contributions = (contributionsRes.data ?? []) as ContributionRow[];
  const columnPresent = refundColumnPresent(contributions as unknown as Array<Record<string, unknown>>);
  if (!columnPresent) {
    console.error(`[refund] contributions.refunded_cents does not exist — run ${REFUNDS_MIGRATION}. Only whole payments can be refunded`, { planId });
  }

  const decision = planRefund({
    userId: ctx.user.id,
    memberIds,
    skips,
    bookings: bookingsRes.data ?? [],
    contributions,
    claimed: new Set((claimsRes.data ?? []).map(r => String(r.contribution_id))),
    columnPresent,
  });
  if (!decision.ok) {
    const { status, error } = refusal(decision.why, decision);
    return NextResponse.json(
      { error, paidCents: decision.paidCents, keptCents: decision.keptCents },
      { status },
    );
  }

  // ── Claim each payment before Stripe hears about it ───────────────────
  const claimed: RefundPiece[] = [];
  let claimFailed = false;
  for (const piece of decision.pieces) {
    if (!ledger) { claimed.push(piece); continue; }
    const { error } = await ctx.db.from('refunds').insert({
      contribution_id: piece.contributionId,
      plan_id: planId,
      user_id: ctx.user.id,
      amount_cents: piece.cents,
      status: 'pending',
    });
    if (!error) { claimed.push(piece); continue; }
    // 23505: the other half of a double-tap claimed this payment first. It
    // is refunding it, so this request leaves it alone.
    if (error.code !== '23505') {
      claimFailed = true;
      console.error('[refund] could not claim a payment to refund', { planId, contribution: piece.contributionId, code: error.code });
    }
  }
  if (!claimed.length && claimFailed) {
    return NextResponse.json(
      { error: 'We could not start that refund just now. Nothing has been refunded — try again in a moment.' },
      { status: 500 },
    );
  }
  if (!claimed.length) {
    return NextResponse.json(
      { error: 'A refund of this payment is already going through. Stripe says a refund takes 5–10 business days to reach the card.' },
      { status: 409 },
    );
  }

  // ── Ask Stripe, one payment at a time ─────────────────────────────────
  let refundedCents = 0;
  const stripeStates: string[] = [];
  const refused: string[] = [];
  const unanswered: string[] = [];
  const inProgress: string[] = [];

  for (const piece of claimed) {
    const answer: StripeAnswer = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': refundIdempotencyKey(piece.contributionId),
      },
      body: new URLSearchParams({
        payment_intent: piece.paymentIntent,
        amount: String(piece.cents),
        reason: 'requested_by_customer',
        'metadata[kind]': 'reach_refund',
        'metadata[plan_id]': planId,
        'metadata[user_id]': ctx.user.id,
        'metadata[contribution_id]': piece.contributionId,
      }),
      signal: AbortSignal.timeout(15000),
    })
      .then(async r => ({ ok: r.ok, httpStatus: r.status, body: await r.json().catch(() => null) }))
      .catch((e: unknown) => ({ ok: false, httpStatus: 0, body: null, thrown: e instanceof Error ? e.message : String(e) }));

    // The same key already in use means another request for this payment
    // is running or has run. Stripe answers 409 to the concurrent one and an
    // idempotency_error to one sent with different figures. Either way a
    // refund may exist, so this is not a refusal and nothing is marked.
    // Only possible before the migration: afterwards the claim above stops
    // the second request first.
    if (!answer.ok && (answer.httpStatus === 409 || answer.body?.error?.type === 'idempotency_error')) {
      inProgress.push(piece.contributionId);
      continue;
    }

    // Stripe answered with an error: no refund was created. A 5xx or no
    // answer at all is different — the refund may exist — so the claim
    // stays pending and nobody retries it but a person who has looked.
    const definitive = !answer.ok && answer.httpStatus >= 400 && answer.httpStatus < 500 && !!answer.body?.error;
    if (!answer.ok || !answer.body?.id) {
      const reason = answer.body?.error?.message ?? answer.thrown ?? `HTTP ${answer.httpStatus}`;
      report(new Error(`Stripe ${definitive ? 'refused' : 'did not answer'} a refund: ${reason}`), {
        where: 'funding/refund',
        extra: { planId, contribution: piece.contributionId, cents: piece.cents, httpStatus: answer.httpStatus, code: answer.body?.error?.code ?? null },
      });
      if (definitive) {
        refused.push(String(answer.body.error.code ?? 'refused'));
        if (ledger) {
          const { error } = await ctx.db.from('refunds')
            .update({ status: 'failed', error: String(reason).slice(0, 500), updated_at: new Date().toISOString() })
            .eq('contribution_id', piece.contributionId);
          if (error) console.error('[refund] could not record a refused refund', { contribution: piece.contributionId, code: error.code });
        }
      } else {
        unanswered.push(piece.contributionId);
      }
      continue;
    }

    const stripeStatus = String(answer.body.status ?? 'pending');
    stripeStates.push(stripeStatus);
    if (ledger) {
      const { error } = await ctx.db.from('refunds').update({
        stripe_refund_id: String(answer.body.id),
        status: REFUND_STATUSES.has(stripeStatus) ? stripeStatus : 'pending',
        updated_at: new Date().toISOString(),
      }).eq('contribution_id', piece.contributionId);
      if (error) console.error('[refund] Stripe refunded it and the refunds row was not updated', { contribution: piece.contributionId, refund: answer.body.id, code: error.code });
    }

    const { counts, outcome } = afterStripeRefund(piece, stripeStatus);
    if (!counts || !outcome) continue;
    refundedCents += piece.cents;

    // Written here as well as by the webhook so the screen that asked sees
    // it at once. The webhook writes the charge's own running total over
    // this, which is the same number.
    const now = new Date().toISOString();
    let { error: recordErr } = await ctx.db.from('contributions')
      .update({ status: outcome.status, refunded_cents: outcome.refundedCents, updated_at: now })
      .eq('id', piece.contributionId);
    if (recordErr && isMissingColumn(recordErr) && !outcome.partial) {
      // Before the migration: a whole refund can still be said with the
      // status. planRefund never hands out part of a payment until then.
      ({ error: recordErr } = await ctx.db.from('contributions')
        .update({ status: outcome.status, updated_at: now })
        .eq('id', piece.contributionId));
    }
    if (recordErr) {
      // The money is on its way back and the plan still counts it. The
      // charge.refunded webhook writes the same thing and will retry, so
      // this is loud rather than fatal.
      report(new Error('refunded at Stripe but not recorded on the contribution'), {
        where: 'funding/refund',
        extra: { planId, contribution: piece.contributionId, refund: String(answer.body.id), code: recordErr.code },
      });
    }
  }

  const figures = { paidCents: decision.paidCents, keptCents: decision.keptCents };

  if (refundedCents > 0) {
    const status = refused.length || unanswered.length || inProgress.length || decision.shortCents > 0 || claimed.length < decision.pieces.length
      ? 'partial'
      : stripeStates.includes('pending') ? 'pending' : 'succeeded';
    return NextResponse.json({ refundedCents, status, ...figures });
  }

  if (stripeStates.includes('requires_action')) {
    return NextResponse.json({ refundedCents: 0, status: 'requires_action', ...figures });
  }
  if (inProgress.length && !refused.length && !unanswered.length) {
    return NextResponse.json(
      { error: 'A refund of this payment is already going through. Stripe says a refund takes 5–10 business days to reach the card.', ...figures },
      { status: 409 },
    );
  }
  if (unanswered.length) {
    console.error('[refund] Stripe did not answer; the claim stays pending until somebody checks Stripe', { planId, contributions: unanswered });
    return NextResponse.json({
      error: 'Stripe did not answer, so we cannot tell yet whether your refund went through. It cannot be refunded twice. If it does not show on this plan within a day, write to hello@alcanzar.io with the name of this plan.',
      ...figures,
    }, { status: 502 });
  }
  if (refused.includes('charge_already_refunded')) {
    return NextResponse.json(
      { error: 'That payment has already been refunded. Stripe says a refund takes 5–10 business days to reach the card.', ...figures },
      { status: 409 },
    );
  }
  console.error('[refund] Stripe refused every refund asked for', { planId, codes: refused, states: stripeStates });
  return NextResponse.json({
    error: 'Stripe refused the refund, so nothing has been refunded. To get it sorted, write to hello@alcanzar.io with the name of this plan.',
    ...figures,
  }, { status: 502 });
}
