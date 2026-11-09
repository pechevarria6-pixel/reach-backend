// ─── A contribution's states, and which Stripe news may move it ──────────
// Directive P2 (REACH-BUSINESS-MODEL-2026-11-08.md §4A). A bank debit is on
// its way for days: Stripe says `processing`, and so does the row. Only
// `succeeded` is money the group holds; `processing` is money on its way and
// is neither counted towards the target nor treated as unpaid.
//
//   pending ──processing──▶ processing ──succeeded──▶ succeeded
//      │                        │                        │
//      └──payment_failed──▶ failed ◀──payment_failed─────┘ (a bank return)
//
// Stripe resends events for days and promises no order, so every move is
// decided against what Stripe says about the payment *now* (the PaymentIntent
// read back), not the snapshot the event carried. A decline's event arriving
// after a bank debit was started on the same intent must not mark the bank
// debit failed; a bank return after the money "succeeded" must.
//
// The gate calls the clearing state pending_settlement; the pilot-gate
// migration allows both names, and both are read here as the same thing.
// Before that migration runs the column's check refuses 'processing'
// (23514), and the row stays 'pending', which every reader already treats
// as a payment in flight — exactly as P1 left it.

/** Money on its way from a bank: not held, not unpaid. */
export const CLEARING: readonly string[] = ['processing', 'pending_settlement'];

/** A payment started and not finished: never a second one beside it. */
export const IN_FLIGHT: readonly string[] = ['pending', ...CLEARING];

export function isClearing(status: unknown): boolean {
  return CLEARING.includes(String(status));
}

export function isInFlight(status: unknown): boolean {
  return IN_FLIGHT.includes(String(status));
}

/** Stripe's PaymentIntent states in which no money is with us and none is moving. */
const NOT_PAID_AT_STRIPE = new Set(['requires_payment_method', 'canceled']);

export type Move = { to: 'processing' | 'failed'; from: string[] };

/**
 * Which rows an event may move, given what Stripe says about the payment now
 * (`stripeNow`, null when Stripe could not be asked). Null: move nothing.
 */
export function contributionMove(event: 'processing' | 'failed', stripeNow: string | null | undefined): Move | null {
  const now = stripeNow ?? null;
  if (event === 'processing') {
    // A resent "processing" after the money landed, or after it bounced,
    // is history. Only a payment Stripe still calls processing moves.
    if (now === 'processing') return { to: 'processing', from: ['pending', 'failed'] };
    // Not known: only out of 'pending', which cannot be worse than P1's
    // "pending while it clears".
    if (now === null) return { to: 'processing', from: ['pending'] };
    return null;
  }
  // payment_failed
  if (now === 'succeeded' || now === 'processing' || now === 'requires_capture') return null;
  if (now !== null && NOT_PAID_AT_STRIPE.has(now)) {
    // Stripe holds nothing for this payment now. A row reading succeeded
    // is a bank debit returned after it cleared (ACH return): a card that
    // succeeded never goes back to requires_payment_method. Never out of
    // 'refunded' — that money is already accounted for as gone.
    return { to: 'failed', from: ['pending', ...CLEARING, 'succeeded'] };
  }
  // requires_action / requires_confirmation, or not known: only a row that
  // has not started moving money. The old rule, and the safe half of a guess.
  return { to: 'failed', from: ['pending'] };
}

type Contribution = { status?: unknown; amount_cents?: unknown; user_id?: unknown };

/** Money on its way, for the plan or for one person. */
export function clearingCents(contribs: Contribution[] | null | undefined, userId?: string): number {
  return (contribs ?? [])
    .filter(c => isClearing(c.status) && (userId === undefined || c.user_id === userId))
    .reduce((s, c) => s + Math.max(0, Math.round(Number(c.amount_cents) || 0)), 0);
}

/** How many payments are on their way. */
export function clearingCount(contribs: Contribution[] | null | undefined): number {
  return (contribs ?? []).filter(c => isClearing(c.status)).length;
}

/**
 * Approval's 402 sentence. "Not paid in yet" and "still clearing" are
 * different things to do about it — one is chase somebody, the other is
 * wait — so the screen has to be told which.
 */
export function notFundedMessage(shortfallCents: number, clearing: { cents: number; count: number }): {
  error: string; clearing: boolean;
} {
  const some = clearing.count === 1 ? 'A payment is' : 'A few payments are';
  if (clearing.count > 0 && clearing.cents >= shortfallCents) {
    return {
      clearing: true,
      error: `${some} still clearing. Bank payments take a few business days to land, and this can be booked once they do. Nothing was booked.`,
    };
  }
  if (clearing.count > 0) {
    return {
      clearing: true,
      error: `Some of the money isn't paid in yet, and ${some.toLowerCase()} still clearing. Nothing was booked.`,
    };
  }
  return { clearing: false, error: "The money paid in doesn't cover this yet, so nothing was booked." };
}

/** The check constraint refused the status: the pilot-gate migration has not run. */
export function statusNotAllowedYet(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === '23514' || /contributions_status_check/.test(String(e.message ?? '')));
}
