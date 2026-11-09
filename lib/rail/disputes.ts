// ─── Money a bank or card issuer takes back (directive P5) ───────────────
// A dispute withdraws the disputed money from Reach's Stripe balance the
// moment it opens. For a bank debit that is how most returns arrive
// (unauthorised, revoked), days or weeks after the payment "succeeded". The
// share then is not money the group holds, and the funding figures have to
// stop counting it — or approval books a hotel with money that is gone.
//
// An inquiry (status warning_*) is a question from the issuer with no money
// moved; it is left alone until it becomes a dispute (funds_withdrawn).
// A dispute won gives the money back (funds_reinstated, or closed as won),
// and the share counts again — as far as Stripe's own refunds on it allow.

type DisputeLike = { status?: unknown; charge?: unknown; payment_intent?: unknown } | null | undefined;

/** Whether this dispute event means the money is gone from Reach's balance. */
export function disputeTookMoney(type: string, dispute: DisputeLike): boolean {
  if (type !== 'charge.dispute.created' && type !== 'charge.dispute.funds_withdrawn') return false;
  return !String(dispute?.status ?? '').startsWith('warning_');
}

/** Whether this dispute event means the money came back. */
export function disputeGaveBack(type: string, dispute: DisputeLike): boolean {
  if (type === 'charge.dispute.funds_reinstated') return true;
  return type === 'charge.dispute.closed' && dispute?.status === 'won';
}

/** The PaymentIntent a dispute is about, when the event names it. */
export function intentOfDispute(dispute: DisputeLike): string | null {
  const pi = dispute?.payment_intent;
  if (typeof pi === 'string' && pi) return pi;
  if (pi && typeof pi === 'object' && typeof (pi as { id?: unknown }).id === 'string') return (pi as { id: string }).id;
  return null;
}

/** The charge a dispute is about, for looking its PaymentIntent up. */
export function chargeOfDispute(dispute: DisputeLike): string | null {
  const ch = dispute?.charge;
  if (typeof ch === 'string' && ch) return ch;
  if (ch && typeof ch === 'object' && typeof (ch as { id?: unknown }).id === 'string') return (ch as { id: string }).id;
  return null;
}
