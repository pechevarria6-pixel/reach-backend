// ─── What a Stripe event may do to a contribution and its plan ───────────
// The webhook (app/api/webhooks/stripe/route.ts) cannot be imported by the
// unit tests, so the two writes whose filters carry the money rules live
// here, where a fake table can hold them to it.
//
// Stripe retries an event for days and promises no order. Every write below
// therefore says which states it may move a row *from*, never just to.
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A payment attempt failed. Only a contribution still in flight can become
 * 'failed'.
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
export async function recordContributionFailed(db: SupabaseClient, intentId: string) {
  return db.from('contributions')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent', intentId)
    .eq('status', 'pending');
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
