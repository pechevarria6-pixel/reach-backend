// ─── What a refund means to a group's money ──────────────────────────────
// A contribution counts towards the trip's target only while it is
// 'succeeded'. Refund it in Stripe and the money is gone from the account,
// but the row went on saying succeeded — so the plan still looked funded, and
// the approve gate would have booked a hotel with money that had been handed
// back. Nobody would find out until a provider was paid.
//
// Pure, because the decision is worth testing without a webhook.

export type RefundOutcome =
  | { status: 'refunded'; note: null }
  | { status: 'succeeded'; note: string };

/**
 * A fully refunded contribution stops counting. A partial one cannot be
 * expressed: contributions are a single amount with a single status, so
 * halving one would mean inventing a shape the table does not have. It keeps
 * counting and says so loudly instead — the honest failure, because the
 * alternative is silently dropping somebody's whole share over a $5 refund.
 */
export function refundOutcome(amountCents: number, refundedCents: number): RefundOutcome {
  const paid = Math.max(0, Math.round(amountCents || 0));
  const back = Math.max(0, Math.round(refundedCents || 0));
  if (paid > 0 && back >= paid) return { status: 'refunded', note: null };
  if (back > 0) {
    return {
      status: 'succeeded',
      note: `partial refund of ${back} of ${paid} cents — the contribution still counts in full`,
    };
  }
  return { status: 'succeeded', note: 'no amount refunded' };
}
