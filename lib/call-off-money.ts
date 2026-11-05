// ─── Calling a trip off with a payment still in flight ───────────────────
// PATCH /api/plans/[planId] refuses to call a trip off while money paid in
// is still held — calling it off would not give it back. It counted only
// payments that had arrived. A share paid by bank, or one sitting on a 3-D
// Secure screen, is 'pending' for minutes to days, so the trip was called
// off under it; the money then landed on a cancelled plan that has left
// Home, with no checkout left to take it back from.
//
// So before a call-off, every payment started on the plan is stopped at
// Stripe. One that has taken no money is cancelled and written off. One
// that is moving, or that Stripe could not be asked about, stops the
// call-off: it may be money in, and that is the payer's to have back first.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cancelUnpaidIntent, type CancelOutcome } from './stripe-intents.ts';

/** `reason` is set when `ok` is false. */
export type InFlightOutcome = { ok: boolean; reason?: 'moving' | 'unknown' | 'read_failed' };

export async function stopPaymentsInFlight(
  db: SupabaseClient, planId: string,
  cancelIntent: (intentId: string) => Promise<CancelOutcome> = id => cancelUnpaidIntent(id),
): Promise<InFlightOutcome> {
  const { data, error } = await db.from('contributions')
    .select('id, status, stripe_payment_intent').eq('plan_id', planId).in('status', ['pending', 'failed']);
  if (error) {
    console.error('[call-off] could not read payments in flight', { planId, code: error.code });
    return { ok: false, reason: 'read_failed' };
  }
  let worst: 'moving' | 'unknown' | null = null;
  for (const c of (data ?? []) as { id: unknown; status?: unknown; stripe_payment_intent?: unknown }[]) {
    const intent = typeof c.stripe_payment_intent === 'string' ? c.stripe_payment_intent : '';
    // A declined share is 'failed' here, but its intent goes back to
    // requires_payment_method at Stripe and the open checkout can still pay
    // it with another card. It is cancelled too; its row is already off.
    if (c.status === 'failed') {
      if (!intent) continue;
      const outcome = await cancelIntent(intent);
      if (outcome !== 'canceled' && (outcome === 'moving' || !worst)) worst = outcome;
      continue;
    }
    // A pending row with no intent can never take money.
    const outcome: CancelOutcome = intent ? await cancelIntent(intent) : 'canceled';
    if (outcome !== 'canceled') {
      if (outcome === 'moving' || !worst) worst = outcome;
      continue;
    }
    const { error: offErr } = await db.from('contributions')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', String(c.id)).eq('status', 'pending');
    // Cancelled at Stripe either way, so it can never take money.
    if (offErr) console.error('[call-off] could not write off a cancelled payment', { planId, code: offErr.code });
  }
  return worst ? { ok: false, reason: worst } : { ok: true };
}
