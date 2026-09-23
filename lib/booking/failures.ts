// ─── Which line failed ──────────────────────────────────────────────────
// /bookable sends a list of itinerary lines to be priced and names the ones
// that could not be. It filtered the results down to the failures and then
// looked each title up by its position in that shorter list — so with a
// hotel that priced and a flight that did not, checkout said the hotel had
// failed. Somebody about to pay was told the wrong thing was missing.
//
// Each result now carries the itineraryItemId it was asked for, and the
// title is found by that.

type Req = { itineraryItemId: string; title: string };
type Res = { status?: string; error?: string; itineraryItemId?: string };

export function failuresByLine(requests: Req[], results: Res[]): { title: string; error: string }[] {
  const titles = new Map(requests.map(r => [r.itineraryItemId, r.title]));
  return results
    .filter(r => r.status === 'failed')
    .map(r => ({
      title: (r.itineraryItemId && titles.get(r.itineraryItemId)) || 'an item',
      error: r.error ?? 'could not be quoted',
    }));
}

// ─── What a payment locks ────────────────────────────────────────────────
// Once somebody has paid, /bookable stops adding new lines to the plan:
// each one raises the total under money paid against the old one. It
// turned away every line, and two of them wrongly:
//
//   * a line whose booking failed. Its money is already in — the failed row
//     simply left the total — and turning it away left that money held with
//     nothing to spend it on and the person told to "book it directly".
//   * a table or a ticket. Somebody books those on the seller's own site;
//     they are never in the total, so they cannot move it.

/** Itinerary types that become a booking Reach never charges for. */
const NEVER_CHARGED = new Set(['restaurant', 'event']);

/**
 * Whether money already paid stops this line being priced now. `triedBefore`
 * holds the lines with a failed or cancelled booking on this plan.
 */
export function lockedByPayment(item: { id: string; type?: string | null }, triedBefore: Set<string>): boolean {
  if (triedBefore.has(item.id)) return false;
  if (NEVER_CHARGED.has(String(item.type))) return false;
  return true;
}
