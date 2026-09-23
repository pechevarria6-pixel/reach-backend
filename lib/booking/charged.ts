// ─── What a trip is actually paying for ──────────────────────────────────
// A booking that failed or was cancelled costs nothing, and neither does one
// somebody has chosen to hold off on: it keeps its quote (status 'quoted')
// so it can be booked later at a glance, but it is not in the total, not in
// anybody's share and not approved with the rest. Every sum of money over a
// plan's bookings reads this one filter, so "held" cannot mean "not booked"
// on one screen and "charged for" on another.
export const NOT_CHARGED = '("failed","cancelled","quoted")';

// ─── …and only what Reach itself buys ────────────────────────────────────
// Status is half of it. A redirect — a Ticketmaster seat, a table on Resy, a
// flight handed to the airline's own site — is bought by the person, on
// somebody else's checkout, with their own card. A concierge row is a
// request somebody rings about. Reach pays nobody for either.
//
// Checkout already left those out of the total on the screen, and the server
// did not: funding charged a share of a Ticketmaster ticket's price that the
// screen had just said was not in the total, and approval refused the plan
// with 402 until that money came in. The screen said one number and Stripe
// took another. So the rule lives here, next to NOT_CHARGED, and the checkout
// screen (lib/checkout.ts), funding, approval, the ledger, the reminder
// email, participation, savings and the funded announcement all read it.
//
// Rows from before `mode` existed have none; they were all things Reach
// bought, and they still count.

// reachBuys reads `mode` and `provider`, so every select it filters names
// both — written out, so check:queries can hold them to the schema.

/** Whether Reach pays a provider for this row — the only kind anybody is charged a share of. */
export function reachBuys(row: { mode?: unknown; provider?: unknown }): boolean {
  if (row.mode === 'redirect' || row.mode === 'concierge') return false;
  if (row.provider === 'concierge') return false;
  return true;
}

/**
 * The rows that count towards what a plan owes. The caller has already
 * filtered on NOT_CHARGED in the query; this takes out what Reach does not buy.
 */
export function chargedRows<T extends { mode?: unknown; provider?: unknown }>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(reachBuys);
}
