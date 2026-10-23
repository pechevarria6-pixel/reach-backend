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
  provider?: string | null;
  vertical?: string | null;
  approved_at?: string | null;
  updated_at?: string | null;
  confirmation_number?: string | null;
  booked_by?: string | null;
  /** Who said it was done (PATCH /api/bookings/[id], the confirmation route) — the person who booked it. */
  fulfilled_by?: string | null;
}

/** The line itself, as far as whether somebody has already reserved it. */
export interface LineMark {
  /** "I reserved it" on the line (itinerary_items.is_confirmed). */
  filled?: boolean | null;
  venue_name?: string | null;
  booking_mode?: string | null;
}

export type SwapBooking =
  | { action: 'none' }
  | { action: 'retire'; bookingId: string }
  | { action: 'refuse'; code: 'booking_now' | 'booked'; message: string };

/**
 * A booking Reach bought itself, made: nothing in Reach can take it off
 * 'confirmed' except the flight cancel (POST /api/bookings/[id]/cancel), so
 * no sentence here may say "then pick another" unless that route undoes it.
 * Only a flight's does. A room or an activity stays on the plan, and the
 * sentence says where it is cancelled and that it stays — not a path back
 * that does not exist.
 */
export const CANNOT_CANCEL: Record<string, string> = {
  hotel: "This room is already booked, and Reach can't cancel it or swap it for you — the hotel's confirmation email says how to cancel, if their policy allows it. It stays on the plan as booked.",
  restaurant: "This table is already booked, and Reach can't cancel it or swap it for you — the restaurant can, on their own site or by phone. It stays on the plan as booked.",
  activity: "This is already booked, and Reach can't cancel it or swap it for you — whoever it was booked through can, if their policy allows it. It stays on the plan as booked.",
  event: 'These tickets are already bought. Whoever sold them refunds them, under their own policy — Reach can\'t cancel them for you.',
  flight: 'These flights are already booked. Cancel them from the trip first — you will see what you would get back before anything changes — then pick others.',
};
const CANNOT_CANCEL_ELSE = "This is already booked, and Reach can't cancel it or swap it for you — cancel it where it was booked. It stays on the plan as booked.";

/**
 * Booked by a person on the seller's own site (a redirect, a concierge
 * request). The way back is real only where the Book tab offers "Not booked
 * after all" for the line — a line somebody books ahead (lib/plan-steps.ts
 * bookingTracker, who 'you') — which takes the row back to 'pending' and lets
 * the swap through. Anywhere else nothing in Reach takes the row off
 * 'confirmed', so the sentence does not offer a way back.
 */
const UNDO = 'then tap “Not booked after all” on the Book tab, and you can pick another.';
const BOOKED_THERE_ELSE = "Somebody has booked this on the seller's own site, and Reach can't cancel it or swap it for you — cancel it there if you need to. It stays on the plan as booked.";
/** "Sam reserved it" on the line, with no booking row behind it: cancel it there, untick, then swap. */
export function reservedOnLine(venue: string | null | undefined): string {
  const at = String(venue ?? '').trim();
  return `Somebody has marked this one reserved${at ? ` at ${at}` : ''}. Cancel it with ${at ? 'them' : 'the place'} first, ${UNDO}`;
}

/** Whether Reach paid a provider for this row — mirrors reachBuys in lib/booking/charged.ts. */
function reachBought(b: LineBooking): boolean {
  if (b.mode === 'redirect' || b.mode === 'concierge') return false;
  return b.provider !== 'concierge';
}

/**
 * What a made booking is told on a swap: where it is undone, and only a path
 * back that exists. `lineMode` is the line's booking_mode: 'ahead' is the
 * line the Book tab can untick.
 */
export function madeRefusal(b: LineBooking, lineMode?: string | null): string {
  const lane = String(b.vertical ?? '');
  // A Duffel flight is the one Reach-bought row the cancel route undoes.
  if (reachBought(b)) return CANNOT_CANCEL[lane] ?? CANNOT_CANCEL_ELSE;
  if (lineMode === 'ahead' && lane !== 'event') {
    return `Somebody has booked this already. Cancel it ${lane === 'restaurant' ? 'with the restaurant' : 'where it was booked'} first, ${UNDO}`;
  }
  return BOOKED_THERE_ELSE;
}

/** "Somebody is booking this right now" — mirrors midClaim in lib/booking/claim.ts. */
function atProvider(b: LineBooking): boolean {
  if (b.status === 'booking') return true;
  if (b.status !== 'awaiting_approval' || !b.approved_at || !b.updated_at) return false;
  return Date.parse(b.approved_at) === Date.parse(b.updated_at);
}

/**
 * What the line's booking — and the line's own "I reserved it" — means for
 * a swap. The line matters as much as the row: a table booked by phone has
 * no booking row at all (/bookable makes rows only for what Reach books), so
 * the tick on the line is the only record that somebody holds a real one.
 */
export function bookingOnSwap(booking: LineBooking | null | undefined, line?: LineMark | null): SwapBooking {
  const live = !!booking && booking.status !== 'failed' && booking.status !== 'cancelled';
  if (live && atProvider(booking!)) {
    return { action: 'refuse', code: 'booking_now', message: 'Somebody is booking this right now — wait a moment, then try again.' };
  }
  if (live) {
    const b = booking!;
    // "Not booked after all" writes 'pending' and leaves the number it was
    // given, so a number on a pending row is the one taken back, not a
    // reservation somebody holds.
    const boughtElsewhere = !!String(b.confirmation_number ?? '').trim() && b.status !== 'pending';
    if (b.status === 'confirmed' || boughtElsewhere) return { action: 'refuse', code: 'booked', message: madeRefusal(b, line?.booking_mode ?? null) };
  }
  if (line?.filled) return { action: 'refuse', code: 'booked', message: reservedOnLine(line.venue_name) };
  if (!live) return { action: 'none' };
  const b = booking!;
  if (UNMADE.has(b.status)) return { action: 'retire', bookingId: b.id };
  // A status this file has never heard of is not something to discard.
  return { action: 'refuse', code: 'booked', message: 'This one cannot be changed right now.' };
}
