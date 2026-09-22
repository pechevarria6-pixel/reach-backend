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
