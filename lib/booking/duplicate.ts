// ─── Booking the same thing twice ───────────────────────────────────────
// POST /api/bookings ends in a plain insert. No idempotency key, no check
// for what is already there. So every call creates a row: a double-tapped
// "Book everything", a retry after a dropped connection, a refresh at the
// wrong moment. The bookings table shows what that looks like — the same
// RDU → PVR flight on the same date four times over, two of them sitting in
// `pending` behind one that is already `confirmed`.
//
// For a restaurant that is a duplicated table. For a flight it is a second
// order with a real fare attached to it.
//
// The durable fix is a unique index, and that needs a migration the owner
// runs. This is the part that works today and works regardless: before
// writing, look at what this plan already has, and if the very same thing is
// already live, hand that back instead of booking it again.

/** What identifies the thing being booked, per vertical. */
export interface BookingLike {
  vertical?: string | null;
  status?: string | null;
  request_payload?: unknown;
}

/**
 * Statuses that mean "this booking is already in play".
 *
 * A failed or cancelled booking is not a duplicate — it is the reason
 * somebody is pressing the button again, and refusing them would be worse
 * than the bug this prevents.
 */
const LIVE = new Set(['quoted', 'awaiting_approval', 'pending', 'confirmed']);

/**
 * The part of a request that says which thing this is.
 *
 * Deliberately not the whole payload. Travellers, notes and whatever the
 * client happened to attach are not what makes two bookings the same
 * booking; the flight, the room, the table and the ticket are.
 */
export function identityOf(item: Record<string, unknown> | null | undefined): string | null {
  if (!item || typeof item !== 'object') return null;
  const vertical = String((item as { vertical?: unknown }).vertical ?? '');
  if (!vertical) return null;

  const payload = (item as Record<string, unknown>)[vertical];
  if (!payload || typeof payload !== 'object') return null;

  // Which keys actually identify the thing. Anything else — notes, a party
  // size somebody nudged, a cabin preference — may differ between two
  // presses of the same button.
  const KEYS: Record<string, string[]> = {
    flight: ['origin', 'destination', 'departDate', 'returnDate'],
    hotel: ['hotelId', 'city', 'checkin', 'checkout'],
    activity: ['productCode', 'date', 'optionCode'],
    event: ['eventId'],
    restaurant: ['name', 'city', 'date', 'time'],
  };
  const keys = KEYS[vertical];
  if (!keys) return null;

  const p = payload as Record<string, unknown>;
  const parts = keys.map(k => {
    const v = p[k];
    return v === undefined || v === null ? '' : String(v).trim().toLowerCase();
  });
  // Every identifying field empty means we cannot tell one from another, and
  // guessing that two unknowns are the same thing would block a real booking.
  if (parts.every(part => !part)) return null;
  return `${vertical}:${parts.join('|')}`;
}

/**
 * A booking this plan already holds for the same thing, or null.
 *
 * `existing` is what the plan has now; `item` is what is being asked for.
 */
export function findDuplicate<T extends BookingLike>(
  existing: T[],
  item: Record<string, unknown>,
): T | null {
  const wanted = identityOf(item);
  if (!wanted) return null;

  for (const row of existing ?? []) {
    if (!LIVE.has(String(row.status ?? ''))) continue;
    const theirs = identityOf(row.request_payload as Record<string, unknown>);
    if (theirs && theirs === wanted) return row;
  }
  return null;
}
