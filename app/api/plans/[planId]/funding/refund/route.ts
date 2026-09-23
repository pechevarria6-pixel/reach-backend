// ─── POST /api/plans/[planId]/funding/refund — give back what was not spent ─
// Moab took $1,474 from one person, every booking on it failed, and the app
// had no way to hand the money back. The screen said "Nothing to pay" and
// the promise underneath was "we'll follow up". Nothing in app/ or lib/ ever
// created a Stripe refund.
//
// Contract, for the checkout screen (no screen calls it yet):
//   200 { refundedCents, status, message, paidCents, keptCents }
//         status: succeeded | pending | partial | requires_action
//         message: what happened, in words that can be shown as they are
//   403 { error }   not somebody who paid on this plan
//   409 { error }   nothing to give back, a refund still going through, the
//                   money covering somebody else's share, or another refund
//                   on this plan running at this moment
//   500 / 502 / 503 { error }  our database, Stripe refused or did not answer,
//                   payments not configured or the migration not run. Each
//                   says whether anything was refunded.
//
// The person asks. The server decides how much. The body is ignored: an
// amount from a client is an amount somebody can edit. What they get back
// is worked out in lib/refunds.ts planRefund, where the formula is written
// out and tested. In short:
//
//   refund = min( what they paid, less what has gone back or is going
//                 − their share of what Reach is booking or has booked,
//                 what the plan holds beyond everything Reach is booking )
//
// Two locks, both taken before Stripe is asked. Reading "no refund yet"
// first cannot stop a double refund: both requests read before either
// writes, which is how payments were nearly doubled.
//   · refund_locks — one refund at a time per plan, because the second cap is
//     the whole plan's spare money and two payers would both see it;
//   · refunds — one row per payment, claimed before Stripe hears of it, and
//     Stripe's idempotency key (per payment, per attempt) behind that.
//
// Before sql/wave1-refunds-2026-09-22.sql runs there is neither, and this
// answers 503 and refunds nothing — which is exactly where the app was
// before this route existed.
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { planSkips } from '@/lib/participation';
import { report } from '@/lib/report';
import {
  planRefund, refusal, refundIdempotencyKey, refundRequestBody, afterStripeRefund, refundColumnPresent,
  claimAtStripe, refundReply, isMissingTable, REFUNDS_MIGRATION,
  type ContributionRow, type RefundClaim, type RefundPiece, type PieceResult, type StripeRefund,
} from '@/lib/refunds';

// Each Stripe call is capped at 15 seconds and the lock is taken over after
// two minutes, so a request must be dead by then: this keeps it so.
export const maxDuration = 60;

const LOCK_STALE_MS = 2 * 60 * 1000;
const REFUND_STATUSES = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);

type StripeAnswer = { ok: boolean; httpStatus: number; body: any; thrown?: string };

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

async function stripeCall(url: string, stripeKey: string, init: { body?: Record<string, string>; key?: string } = {}): Promise<StripeAnswer> {
  const headers: Record<string, string> = { Authorization: `Bearer ${stripeKey}` };
  if (init.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (init.key) headers['Idempotency-Key'] = init.key;
  return fetch(url, {
    method: init.body ? 'POST' : 'GET',
    headers,
    body: init.body ? new URLSearchParams(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
    .then(async r => ({ ok: r.ok, httpStatus: r.status, body: await r.json().catch(() => null) }))
    .catch((e: unknown) => ({ ok: false, httpStatus: 0, body: null, thrown: e instanceof Error ? e.message : String(e) }));
}

/**
 * Writes a refund Stripe has taken onto the payment. Only ever raises
 * refunded_cents: the webhook may already have written a larger running
 * total (a dashboard refund in between), and this figure was read before
 * Stripe was called.
 */
async function recordOnPayment(db: SupabaseClient, planId: string, contributionId: string, refundId: string, piece: Pick<RefundPiece, 'cents' | 'refundedBefore' | 'amountCents'>, stripeStatus: string) {
  const { counts, outcome } = afterStripeRefund(piece, stripeStatus);
  if (!counts || !outcome) return;
  const { error } = await db.from('contributions')
    .update({ status: outcome.status, refunded_cents: outcome.refundedCents, updated_at: new Date().toISOString() })
    .eq('id', contributionId)
    .lt('refunded_cents', outcome.refundedCents);
  if (error) {
    // The money is on its way back and the payment row does not say so yet.
    // The claim row does, so no second refund can take it, and the
    // charge.refunded webhook writes the same figure and retries until it can.
    report(new Error('refunded at Stripe but not recorded on the contribution'), {
      where: 'funding/refund', extra: { planId, contribution: contributionId, refund: refundId, code: error.code },
    });
  }
}

/** Takes the plan's refund lock, or says why not. */
async function takeLock(db: SupabaseClient, planId: string, userId: string):
  Promise<{ token: string } | { busy: true } | { missing: true } | { failed: string }> {
  const token = randomUUID();
  const { error } = await db.from('refund_locks').insert({ plan_id: planId, token, user_id: userId, taken_at: new Date().toISOString() });
  if (!error) return { token };
  if (isMissingTable(error)) return { missing: true };
  if (error.code !== '23505') return { failed: String(error.code ?? error.message) };
  // Held. Taken over only from a request that has certainly died.
  const { data: taken, error: takeError } = await db.from('refund_locks')
    .update({ token, user_id: userId, taken_at: new Date().toISOString() })
    .eq('plan_id', planId)
    .lt('taken_at', new Date(Date.now() - LOCK_STALE_MS).toISOString())
    .select('plan_id');
  if (takeError) return { failed: String(takeError.code ?? takeError.message) };
  return taken?.length ? { token } : { busy: true };
}

export async function POST(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const planId = params.planId;
  const db = ctx.db;

  // The same check as taking payment: a key that is not a secret key gets
  // Stripe's own message, written for whoever set up the account.
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !/^(sk|rk)_/.test(stripeKey)) {
    console.error('[refund] STRIPE_SECRET_KEY is missing or is not a secret key', { present: !!stripeKey });
    return reply(503, { error: 'Refunds are not configured correctly yet. Nothing has been refunded.' });
  }

  const lock = await takeLock(db, planId, ctx.user.id);
  if ('missing' in lock) {
    console.error(`[refund] the refund_locks table does not exist — run ${REFUNDS_MIGRATION}. Refunds stay in the Stripe dashboard until then`, { planId });
    return reply(503, { error: refusal('needs_migration', { paidCents: 0, keptCents: 0 }).error });
  }
  if ('failed' in lock) {
    console.error('[refund] could not take the plan’s refund lock', { planId, code: lock.failed });
    return reply(500, { error: 'We could not start that refund just now. Nothing has been refunded — try again in a moment.' });
  }
  if ('busy' in lock) {
    return reply(409, { error: 'Somebody on this plan is taking a refund right now. Nothing has been refunded for you yet — try again in a minute.' });
  }

  try {
    return await refundUnderLock(db, planId, ctx.user.id, ctx.plan.group_id as string, stripeKey);
  } finally {
    const { error } = await db.from('refund_locks').delete().eq('plan_id', planId).eq('token', lock.token);
    // Left behind, it is taken over after two minutes; until then this plan's
    // payers are told to try again in a minute.
    if (error) console.error('[refund] could not release the plan’s refund lock', { planId, code: error.code });
  }
}

async function readMoney(db: SupabaseClient, planId: string) {
  // Every booking, not just live ones: one paid out to a provider and then
  // cancelled still holds its money. keptBookings() in lib/refunds.ts sorts
  // them, and reads mode and provider so only what Reach buys is kept.
  // Contributions and refunds are select('*') so a missing column reads as
  // absent rather than failing the read.
  const [bookings, contributions, claims] = await Promise.all([
    db.from('bookings').select('id,price_cents,status,mode,provider,approved_at,error').eq('plan_id', planId),
    db.from('contributions').select('*').eq('plan_id', planId),
    db.from('refunds').select('*').eq('plan_id', planId),
  ]);
  return { bookings, contributions, claims };
}

async function refundUnderLock(db: SupabaseClient, planId: string, userId: string, groupId: string, stripeKey: string) {
  const readFailed = () => reply(500, { error: 'We could not check what you paid just now. Nothing has been refunded — try again in a moment.' });
  let money = await readMoney(db, planId);
  if (money.claims.error && isMissingTable(money.claims.error)) {
    console.error(`[refund] the refunds table does not exist — run ${REFUNDS_MIGRATION}`, { planId });
    return reply(503, { error: refusal('needs_migration', { paidCents: 0, keptCents: 0 }).error });
  }
  if (money.bookings.error || money.contributions.error || money.claims.error) {
    console.error('[refund] could not read the plan’s money', {
      planId, bookings: money.bookings.error?.code, contributions: money.contributions.error?.code, refunds: money.claims.error?.code,
    });
    return readFailed();
  }
  if (!refundColumnPresent(money.contributions.data as Array<Record<string, unknown>>)) {
    console.error(`[refund] contributions.refunded_cents does not exist — run ${REFUNDS_MIGRATION}`, { planId });
    return reply(503, { error: refusal('needs_migration', { paidCents: 0, keptCents: 0 }).error });
  }

  // ── Settle claims whose answer was never heard ─────────────────────────
  // We hold the plan's lock, so any claim still reading 'claimed' belongs
  // to a request that has finished or died without recording Stripe's
  // answer. Stripe's list of refunds on the payment says what happened.
  const stale = ((money.claims.data ?? []) as RefundClaim[]).filter(k => k.status === 'claimed');
  if (stale.length) {
    const payments = new Map(((money.contributions.data ?? []) as ContributionRow[]).map(c => [String(c.id), c]));
    for (const claim of stale) {
      const payment = payments.get(String(claim.contribution_id));
      if (!payment?.stripe_payment_intent) continue;
      const listed = await stripeCall(
        `https://api.stripe.com/v1/refunds?payment_intent=${encodeURIComponent(payment.stripe_payment_intent)}&limit=100`, stripeKey);
      // Could not ask: left as it is. It still counts as gone and blocks only
      // its own payment, which is the safe way to be wrong.
      if (!listed.ok || !Array.isArray(listed.body?.data)) continue;
      const found = claimAtStripe(claim, listed.body.data as StripeRefund[]);
      const { error } = await db.from('refunds').update({
        status: REFUND_STATUSES.has(found.status) ? found.status : 'pending',
        stripe_refund_id: found.stripeRefundId,
        error: found.stripeRefundId ? null : 'No refund was found at Stripe for this claim.',
        updated_at: new Date().toISOString(),
      }).eq('id', claim.id).eq('status', 'claimed');
      if (error) { console.error('[refund] could not settle an earlier claim', { claim: claim.id, code: error.code }); continue; }
      if (found.stripeRefundId) {
        await recordOnPayment(db, planId, String(claim.contribution_id), found.stripeRefundId, {
          cents: Number(claim.amount_cents) || 0,
          refundedBefore: Number(claim.refunded_before_cents) || 0,
          amountCents: Number(payment.amount_cents) || 0,
        }, found.status);
      }
    }
    money = await readMoney(db, planId);
    if (money.bookings.error || money.contributions.error || money.claims.error) return readFailed();
  }

  const [memberIds, skips] = await Promise.all([groupMemberIds(db, groupId), planSkips(db, planId)]);
  const decision = planRefund({
    userId, memberIds, skips,
    bookings: money.bookings.data ?? [],
    contributions: (money.contributions.data ?? []) as ContributionRow[],
    claims: (money.claims.data ?? []) as RefundClaim[],
  });
  const figures = { paidCents: decision.paidCents, keptCents: decision.keptCents, shortCents: decision.shortCents };
  if (!decision.ok) {
    const { status, error } = refusal(decision.why, decision);
    return reply(status, { error, paidCents: decision.paidCents, keptCents: decision.keptCents });
  }

  const results: PieceResult[] = [];
  for (const piece of decision.pieces) {
    // ── Claim the payment before Stripe hears about it ───────────────────
    const now = new Date().toISOString();
    const claimRow = {
      status: 'claimed', amount_cents: piece.cents, refunded_before_cents: piece.refundedBefore,
      attempt: piece.attempt, user_id: userId, stripe_refund_id: null, error: null, updated_at: now,
    };
    let claimId: string | null = null;
    if (piece.claimId) {
      // A settled or refused claim, taken again only where it still reads
      // the way planRefund saw it.
      const { data, error } = await db.from('refunds').update(claimRow)
        .eq('id', piece.claimId).in('status', ['succeeded', 'failed', 'canceled']).select('id');
      if (error) console.error('[refund] could not claim a payment to refund', { planId, contribution: piece.contributionId, code: error.code });
      claimId = data?.[0]?.id ? String(data[0].id) : null;
      if (!claimId && !error) { results.push({ kind: 'busy', cents: piece.cents }); continue; }
    } else {
      const { data, error } = await db.from('refunds')
        .insert({ ...claimRow, contribution_id: piece.contributionId, plan_id: planId, created_at: now })
        .select('id');
      if (error?.code === '23505') { results.push({ kind: 'busy', cents: piece.cents }); continue; }
      if (error) console.error('[refund] could not claim a payment to refund', { planId, contribution: piece.contributionId, code: error.code });
      claimId = data?.[0]?.id ? String(data[0].id) : null;
    }
    if (!claimId) {
      // Nothing was sent to Stripe for this piece.
      results.push({ kind: 'not_started', cents: piece.cents });
      continue;
    }

    // ── Ask Stripe ───────────────────────────────────────────────────────
    const answer = await stripeCall('https://api.stripe.com/v1/refunds', stripeKey, {
      key: refundIdempotencyKey(piece.contributionId, piece.attempt),
      body: refundRequestBody({ planId, userId, claimId, attempt: piece.attempt, piece }),
    });

    if (answer.ok && answer.body?.id) {
      const stripeStatus = String(answer.body.status ?? 'pending');
      const { error } = await db.from('refunds').update({
        stripe_refund_id: String(answer.body.id),
        status: REFUND_STATUSES.has(stripeStatus) ? stripeStatus : 'pending',
        error: stripeStatus === 'failed' ? String(answer.body.failure_reason ?? 'failed') : null,
        updated_at: new Date().toISOString(),
      }).eq('id', claimId);
      // Left 'claimed', it is settled from Stripe's list on the next request.
      if (error) console.error('[refund] Stripe answered and the refunds row was not updated', { claim: claimId, refund: answer.body.id, code: error.code });
      await recordOnPayment(db, planId, piece.contributionId, String(answer.body.id), piece, stripeStatus);
      if (stripeStatus === 'succeeded' || stripeStatus === 'pending') results.push({ kind: 'going', cents: piece.cents, stripeStatus });
      else if (stripeStatus === 'requires_action') {
        report(new Error('a refund needs action at Stripe'), { where: 'funding/refund', extra: { planId, claim: claimId, refund: answer.body.id } });
        results.push({ kind: 'needs_action', cents: piece.cents });
      } else results.push({ kind: 'refused', cents: piece.cents, reason: String(answer.body.failure_reason ?? stripeStatus) });
      continue;
    }

    // Stripe answered with a 4xx error: no refund was created, and asking
    // again is a new attempt with a new key. A 409 or an idempotency error is
    // not a refusal — the same key is in use, so a refund may exist — and a
    // 5xx or no answer at all is the same: the claim stays 'claimed' and the
    // next request settles it from Stripe's own list.
    const inUse = answer.httpStatus === 409 || answer.body?.error?.type === 'idempotency_error';
    const definitive = !inUse && answer.httpStatus >= 400 && answer.httpStatus < 500 && !!answer.body?.error;
    const reason = String(answer.body?.error?.message ?? answer.thrown ?? `HTTP ${answer.httpStatus}`);
    report(new Error(`Stripe ${definitive ? 'refused' : 'did not answer'} a refund: ${reason}`), {
      where: 'funding/refund',
      extra: { planId, claim: claimId, cents: piece.cents, httpStatus: answer.httpStatus, code: answer.body?.error?.code ?? null },
    });
    if (!definitive) { results.push({ kind: 'unknown', cents: piece.cents }); continue; }
    const { error } = await db.from('refunds')
      .update({ status: 'failed', error: reason.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', claimId);
    // Left 'claimed', the next request finds nothing at Stripe and marks it
    // failed then.
    if (error) console.error('[refund] could not record a refused refund', { claim: claimId, code: error.code });
    results.push({ kind: 'refused', cents: piece.cents, reason });
  }

  const out = refundReply(results, figures);
  if (out.status >= 500) console.error('[refund] nothing went back', { planId, results });
  return reply(out.status, out.body);
}
