// ─── Bookings that outlive the line they came from ───────────────────────
// Saving an itinerary writes every line afresh, with new ids, and removes the
// old ones. Bookings point at a line by id, so after any save every booking
// on the plan pointed at a line that no longer existed — and nothing noticed.
//
// The Downtown Raleigh Italian Evening shows what that costs. Its dinner was
// Vinny's Italian Grill; the evening was rebuilt around Vic's; the Vinny's
// booking stayed, pending, pointing at nothing. Checkout lists the itinerary's
// dinner and the plan's bookings, so the one person on that trip was told to
// sort out two Italian dinners on the same night.
//
// After a save, each booking whose line is gone is matched to the new line
// that is the same thing — same type, same words — and moved onto it. What
// matches nothing was dropped from the plan, and a booking nobody has made
// yet goes with it. A confirmed one stays exactly where it is: that is a real
// reservation somewhere, and quietly cancelling our record of it would not
// cancel it with anyone.

export interface LineRef { id: string; type?: string | null; title?: string | null }
export interface BookingRef { id: string; itinerary_item_id: string | null; status: string }

/** Not yet made anywhere, so it can go when its line does. */
const UNMADE = new Set(['quoted', 'awaiting_approval', 'pending', 'redirected']);

const key = (l: LineRef) =>
  `${String(l.type ?? '').toLowerCase()}|${String(l.title ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}`;

export function reconcileBookings(
  oldLines: LineRef[],
  newLines: LineRef[],
  bookings: BookingRef[],
): { relink: { bookingId: string; itemId: string }[]; retire: string[] } {
  const current = new Set(newLines.map(l => l.id));
  const oldById = new Map(oldLines.map(l => [l.id, l]));
  const newByKey = new Map<string, string>();
  for (const l of newLines) if (!newByKey.has(key(l))) newByKey.set(key(l), l.id);
  const taken = new Set(bookings.map(b => b.itinerary_item_id).filter((id): id is string => !!id && current.has(id)));

  const relink: { bookingId: string; itemId: string }[] = [];
  const retire: string[] = [];
  for (const b of bookings) {
    if (!b.itinerary_item_id || current.has(b.itinerary_item_id)) continue;
    const was = oldById.get(b.itinerary_item_id);
    const same = was ? newByKey.get(key(was)) : undefined;
    // One booking per line: the index says so, and so does sense.
    if (same && !taken.has(same)) {
      relink.push({ bookingId: b.id, itemId: same });
      taken.add(same);
    } else if (UNMADE.has(b.status)) {
      retire.push(b.id);
    }
  }
  return { relink, retire };
}

// ─── One line changed in place ───────────────────────────────────────────
// A swap (PATCH /api/plans/[id]/itinerary/[itemId]) keeps the line's id, so
// every other booking on the plan stays exactly where it is — the whole
// reason it is not a save of the whole itinerary. The line's own booking is
// the one question: it was for the place that is going.
//
//   nothing on it               swap
//   not made anywhere yet       swap, and the booking goes with the old place
//                               (the same rule as UNMADE above); the line is
//                               then booked again through the Book tab, the
//                               ordinary path, for the new place
//   at the provider right now   refused: somebody is booking it this minute
//   made                        refused: a real reservation somewhere, which
//                               Reach saying "changed" would not cancel. Where
//                               Reach cannot cancel it, the answer says so,
//                               and where it can be cancelled
//   bought on the seller's site refused the same way: a confirmation number
//   (a confirmation recorded)   means somebody holds a real one

export interface LineBooking {
  id: string;
  status: string;
  mode?: string | null;
  vertical?: string | null;
  approved_at?: string | null;
  updated_at?: string | null;
  confirmation_number?: string | null;
  booked_by?: string | null;
}

export type SwapBooking =
  | { action: 'none' }
  | { action: 'retire'; bookingId: string }
  | { action: 'refuse'; code: 'booking_now' | 'booked'; message: string };

/**
 * What cancelling a made booking means, by what it is. Reach cancels only a
 * Duffel flight (POST /api/bookings/[id]/cancel); everything else is undone
 * where it was made, and the sentence says where.
 */
export const CANNOT_CANCEL: Record<string, string> = {
  hotel: "This room is already booked, and Reach can't cancel it for you — the hotel's confirmation email says how, if their policy allows it. Once it's cancelled there, you can pick another.",
  restaurant: "This table is already booked on the restaurant's own site, and Reach can't cancel it for you — cancel it there first, then pick another.",
  activity: "This is already booked, and Reach can't cancel it for you — the booking page it came from can. Cancel it there first, then pick another.",
  event: 'These tickets are already bought. Whoever sold them refunds them, under their own policy — Reach can\'t cancel them for you.',
  flight: 'These flights are already booked. Cancel them from the trip first — you will see what you would get back before anything changes — then pick others.',
};
const CANNOT_CANCEL_ELSE = "This is already booked, and Reach can't cancel it for you — cancel it where it was booked first, then pick another.";

/** "Somebody is booking this right now" — mirrors midClaim in lib/booking/claim.ts. */
function atProvider(b: LineBooking): boolean {
  if (b.status === 'booking') return true;
  if (b.status !== 'awaiting_approval' || !b.approved_at || !b.updated_at) return false;
  return Date.parse(b.approved_at) === Date.parse(b.updated_at);
}

export function bookingOnSwap(booking: LineBooking | null | undefined): SwapBooking {
  if (!booking || booking.status === 'failed' || booking.status === 'cancelled') return { action: 'none' };
  if (atProvider(booking)) {
    return { action: 'refuse', code: 'booking_now', message: 'Somebody is booking this right now — wait a moment, then try again.' };
  }
  const boughtElsewhere = !!String(booking.confirmation_number ?? '').trim();
  const lane = String(booking.vertical ?? '');
  if (booking.status === 'confirmed' || boughtElsewhere) {
    return { action: 'refuse', code: 'booked', message: CANNOT_CANCEL[lane] ?? CANNOT_CANCEL_ELSE };
  }
  if (UNMADE.has(booking.status)) return { action: 'retire', bookingId: booking.id };
  // A status this file has never heard of is not something to discard.
  return { action: 'refuse', code: 'booked', message: 'This one cannot be changed right now.' };
}
