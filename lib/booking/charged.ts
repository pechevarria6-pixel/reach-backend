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
  // A table Reach books on Yelp or OpenTable is booked in-app ('native') and
  // still costs nothing: Reach takes no deposit and pays the platform nothing
  // per table, so nobody owes a share of it (lib/booking/tables/).
  if (row.provider === 'yelp' || row.provider === 'opentable') return false;
  return true;
}

// ─── …and what Reach booked itself, whatever it cost ─────────────────────
// reachBuys is about money, and a table Reach books on Yelp or OpenTable
// costs nothing — but it is still Reach's booking, with a live reservation
// at the platform under somebody's name. The status PATCH and "I've got it"
// used reachBuys as "Reach booked this one", so the day tables stopped
// counting as money they also became settable by hand: "Not booked after
// all" moved a live OpenTable table to pending, "Couldn't book" moved it to
// failed and the table route booked a second one, "cancelled" marked it
// cancelled without telling OpenTable (a no-show), and "I've got it" called
// a table that still owed OpenTable a card confirmed. Two questions, two
// functions.
//
// Only a live one: a table that lapsed or failed is the person's to book
// again any way they like, so it goes back to being settable by hand.

/** Whether Reach itself holds a live booking for this row at a platform — never settled by somebody saying so. */
export function reachBooked(row: { mode?: unknown; provider?: unknown; status?: unknown }): boolean {
  if (row.mode !== 'native') return false;
  if (row.provider !== 'yelp' && row.provider !== 'opentable') return false;
  return row.status !== 'failed' && row.status !== 'cancelled' && row.status !== 'quoted';
}

/**
 * Why a member may not set how this booking went by hand, or null when they
 * may. The status PATCH and the confirmation route both read this.
 */
export function settledByReach(row: { mode?: unknown; provider?: unknown; status?: unknown }): string | null {
  if (reachBooked(row)) {
    const p = row.provider === 'yelp' ? 'Yelp' : 'OpenTable';
    return `Reach booked this table on ${p}, so it is changed or cancelled there through Reach, not marked here.`;
  }
  if (reachBuys(row)) return 'Reach books this one itself, so how it went comes from the booking, not from here.';
  return null;
}

/**
 * The rows that count towards what a plan owes. The caller has already
 * filtered on NOT_CHARGED in the query; this takes out what Reach does not buy.
 */
export function chargedRows<T extends { mode?: unknown; provider?: unknown }>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(reachBuys);
}
