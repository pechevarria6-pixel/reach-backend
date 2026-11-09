// ─── "Booked it ✓" becomes something to settle up (directive P3) ─────────
// A redirect item is paid by one member on the seller's own site, with their
// own card. Reach takes none of it — so the only way it is shared fairly is
// settle-up, and settle-up only knows what is in `expenses`. Before this the
// person who bought four concert tickets pressed "Booked it ✓", the trip
// showed them as booked, and the ledger said nobody owed them anything.
//
// The amount is what they say they paid when they say it, otherwise the
// price the line was listed at when it was booked — labelled as that, since
// nobody at Reach saw the seller's receipt. With neither, no expense is
// written: a number nobody gave us is not one to ask friends for.
//
// One expense per booking: expenses.booking_id with a unique index
// (sql/rail-expense-booking-2026-11-08.sql). Before that runs, the route only
// writes on the press that moved the row to confirmed, which a double tap
// cannot do twice (the write is conditional on the row's version).
type Booking = {
  id: unknown; plan_id?: unknown; group_id?: unknown; vertical?: unknown;
  provider?: unknown; detail?: unknown; price_cents?: unknown;
};

export const EXPENSE_BOOKING_MIGRATION = 'sql/rail-expense-booking-2026-11-08.sql';

const NOUN: Record<string, string> = {
  flight: 'Flights', hotel: 'Stay', activity: 'Activity', event: 'Tickets', restaurant: 'Dinner',
};

const PROVIDER: Record<string, string> = {
  ticketmaster: 'Ticketmaster', stubhub: 'StubHub', seatgeek: 'SeatGeek', resy: 'Resy',
  opentable: 'OpenTable', yelp: 'Yelp', airbnb: 'Airbnb', vrbo: 'Vrbo', expedia: 'Expedia',
  viator: 'Viator', duffel: 'the airline', airline: 'the airline',
};

/** A whole number of cents somebody typed, or null. */
export function statedCents(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return null;
  return Math.round(n);
}

export type ExpenseRow = {
  plan_id: string; group_id: string | null; paid_by: string; description: string;
  amount_cents: number; split_between: string[]; booking_id: string;
};

/**
 * The expense a "Booked it ✓" writes, or null when there is nothing honest
 * to write: no amount, or nobody but the payer to share it with.
 */
export function expenseForBooking(
  booking: Booking,
  who: { paidBy: string; members: string[]; skips: { ref: string; userId: string }[] },
  stated: number | null,
): ExpenseRow | null {
  const listed = Math.max(0, Math.round(Number(booking.price_cents) || 0));
  const amount = stated ?? (listed > 0 ? listed : null);
  if (!amount) return null;

  const out = new Set(who.skips.filter(s => s.ref === String(booking.id)).map(s => s.userId));
  const sharing = who.members.filter(id => !out.has(id));
  // A payer with nobody to share it with has nothing to settle.
  if (!sharing.length || (sharing.length === 1 && sharing[0] === who.paidBy)) return null;

  const what = typeof booking.detail === 'string' && booking.detail.trim()
    ? booking.detail.trim().slice(0, 120)
    : NOUN[String(booking.vertical)] ?? 'Booking';
  const where = PROVIDER[String(booking.provider ?? '').toLowerCase()];
  const description = `${what}${where ? ` — booked on ${where}` : ''}${stated === null ? ' (listed price)' : ''}`;

  return {
    plan_id: String(booking.plan_id),
    group_id: booking.group_id == null ? null : String(booking.group_id),
    paid_by: who.paidBy,
    description,
    amount_cents: amount,
    split_between: sharing,
    booking_id: String(booking.id),
  };
}

/** PostgREST's answers for a column it does not know. */
export function bookingIdMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === '42703' || e.code === 'PGRST204' || /booking_id/.test(String(e.message ?? '')));
}

/**
 * Write it. 23505 is the unique index saying this booking already has its
 * expense — the other half of a double tap — and is not an error.
 */
export async function writeBookingExpense(
  db: { from: (t: string) => any },
  row: ExpenseRow,
): Promise<{ ok: true; kept: 'written' | 'already' | 'without_link' } | { ok: false; code?: string }> {
  let { error } = await db.from('expenses').insert(row);
  if (!error) return { ok: true, kept: 'written' };
  if (error.code === '23505') return { ok: true, kept: 'already' };
  if (bookingIdMissing(error)) {
    const { booking_id: _drop, ...without } = row;
    ({ error } = await db.from('expenses').insert(without));
    if (!error) {
      console.error(`[confirmation] expenses.booking_id is missing — run ${EXPENSE_BOOKING_MIGRATION}; written without the link`);
      return { ok: true, kept: 'without_link' };
    }
  }
  return { ok: false, code: error.code };
}

/**
 * Take a booking's expense back off the trip — "Not booked after all". Only
 * the one this booking wrote, which needs the link column; before it, the
 * expense stays and can be removed from the ledger by hand.
 */
export async function removeBookingExpense(
  db: { from: (t: string) => any },
  bookingId: string,
): Promise<{ ok: boolean; code?: string }> {
  const { error } = await db.from('expenses').delete().eq('booking_id', bookingId);
  if (!error || bookingIdMissing(error)) return { ok: true };
  return { ok: false, code: error.code };
}
