// ─── A payment started and not finished, stopped ────────────────────────
// A PaymentIntent is made for somebody's share and handed to the pay form.
// If the share changes before they pay — somebody joins, a quote is priced
// again — that intent still carries the old amount, and it stays payable from
// any form still open on it. Paying it took the old share: on a solo trip
// somebody then joined, the organiser paid the whole one-person total against
// a half share, the plan looked funded, and approval refused it for ever as
// priced for the wrong party.
//
// So an unfinished intent whose amount is no longer right is cancelled at
// Stripe. Stripe cancels one that has not taken money (requires_payment_method,
// requires_confirmation, requires_action) and refuses one that is processing
// or has succeeded — money is moving, and that is never cancelled from here.

export type CancelOutcome =
  /** Stripe cancelled it (or it was already cancelled): it can never take money. */
  | 'canceled'
  /** Processing or succeeded: money is moving or has moved. */
  | 'moving'
  /** Stripe could not be asked, or said something else. */
  | 'unknown';

/** The states Stripe will cancel from, as far as money is concerned: none has been taken. */
export const UNPAID_STATES: ReadonlySet<string> = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);

export async function cancelUnpaidIntent(
  intentId: string,
  stripeKey: string | undefined = process.env.STRIPE_SECRET_KEY,
  fetchImpl: typeof fetch = fetch,
): Promise<CancelOutcome> {
  if (!intentId || !stripeKey || !/^(sk|rk)_/.test(stripeKey)) return 'unknown';
  const headers = { Authorization: `Bearer ${stripeKey}` };
  const read = async (res: Response | null) => (res ? await res.json().catch(() => null) : null);
  try {
    const res = await fetchImpl(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(intentId)}/cancel`, {
      method: 'POST', headers, signal: AbortSignal.timeout(10000),
    });
    const body = await read(res);
    if (res.ok && body?.status === 'canceled') return 'canceled';
    // Refused: ask what state it is in rather than guess from the error.
    const now = await fetchImpl(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(intentId)}`, {
      headers, signal: AbortSignal.timeout(10000),
    });
    const pi = await read(now);
    if (!now.ok || typeof pi?.status !== 'string') return 'unknown';
    if (pi.status === 'canceled') return 'canceled';
    if (pi.status === 'processing' || pi.status === 'succeeded' || pi.status === 'requires_capture') return 'moving';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
