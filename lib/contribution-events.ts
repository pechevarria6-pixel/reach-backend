// ─── What a Stripe event may do to a contribution and its plan ───────────
// The webhook (app/api/webhooks/stripe/route.ts) cannot be imported by the
// unit tests, so the writes whose filters carry the money rules live
// here, where a fake table can hold them to it.
//
// Stripe retries an event for days and promises no order. Every write below
// therefore says which states it may move a row *from*, never just to.
import type { SupabaseClient } from '@supabase/supabase-js';
import { contributionMove, statusNotAllowedYet, IN_FLIGHT, type Move } from './rail/contribution-state.ts';

/**
 * A payment attempt failed. Which rows that may move depends on what Stripe
 * says about the payment now (`stripeNow`, read back by the webhook): a row
 * still in flight, or — when Stripe holds nothing for it any more — a bank
 * debit that was returned after it cleared. Not known: only 'pending'.
 *
 * A declined card does not end a PaymentIntent: it goes back to
 * requires_payment_method and funding hands the same intent back to be paid
 * with another card. Stripe sends payment_intent.payment_failed for the
 * decline and payment_intent.succeeded for the second card, in no promised
 * order, and resends the first if our answer to it was slow. Written
 * unconditionally, a late "failed" landed over "succeeded": the money was
 * taken, the share read unpaid, the plan read short — and funding, seeing
 * nothing in flight, made a fresh PaymentIntent and charged the card again.
 */
export async function recordContributionFailed(db: SupabaseClient, intentId: string, stripeNow: string | null = null): Promise<Moved> {
  const move = contributionMove('failed', stripeNow);
  if (!move) return { data: [], error: null };
  return recordContributionMove(db, intentId, move);
}

/** The rows a write moved, by id, or why it could not. */
export type Moved = { data: { id: string }[]; error: { code?: string; message?: string } | null };

/**
 * Move a contribution the way contributionMove (lib/rail/contribution-state.ts)
 * decided, only out of the states it names.
 *
 * Before the pilot-gate migration the check constraint refuses
 * 'processing' (23514): the row stays 'pending', which every reader already
 * treats as in flight. That is answered as no error, so a webhook does not
 * make Stripe resend for days a fact the table cannot hold yet.
 */
export async function recordContributionMove(db: SupabaseClient, intentId: string, move: Move, userId?: string): Promise<Moved> {
  let q = db.from('contributions')
    .update({ status: move.to, updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent', intentId);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q.in('status', move.from).select('id');
  if (error && move.to === 'processing' && statusNotAllowedYet(error)) return { data: [], error: null };
  return { data: (data ?? []) as { id: string }[], error };
}

/**
 * The money behind a contribution was taken back by a dispute — a bank
 * return or a card chargeback (lib/rail/disputes.ts). The share stops
 * counting: 'refunded', the status every money figure already reads as
 * nothing held. From any state that had or was getting the money; a row
 * already 'refunded' or 'failed' has nothing left to take.
 */
export async function recordContributionDisputed(db: SupabaseClient, intentId: string): Promise<Moved> {
  const { data, error } = await db.from('contributions')
    .update({ status: 'refunded', updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent', intentId)
    .in('status', ['succeeded', ...IN_FLIGHT])
    .select('id');
  return { data: (data ?? []) as { id: string }[], error };
}

/**
 * The plan statuses a fully-funded announcement may move to 'approved':
 * one still being planned. A status of null is read as planning everywhere
 * else (lib/one-active.ts), so it is here too.
 */
export const FUNDED_FROM = ['planning', 'voting'] as const;

/**
 * Mark a fully funded plan approved, once. Returns whether this call is the
 * one that moved it, which is the only call that may tell the group.
 *
 * Read-then-write here sent the group two "fully funded" emails when the
 * last two shares landed together — both webhooks read "not approved" — and
 * a payment that cleared on a trip already called off (a bank payment takes
 * days; calling off only checks money that has arrived) brought the
 * cancelled plan back as 'approved' and told everybody their trip was on.
 */
export async function markPlanFunded(
  db: SupabaseClient, planId: string,
): Promise<{ moved: boolean; error: { code?: string; message?: string } | null }> {
  const { data, error } = await db.from('plans')
    .update({ status: 'approved' })
    .eq('id', planId)
    .or(`status.is.null,status.in.(${FUNDED_FROM.join(',')})`)
    .select('id');
  if (error) return { moved: false, error };
  return { moved: (data ?? []).length > 0, error: null };
}
