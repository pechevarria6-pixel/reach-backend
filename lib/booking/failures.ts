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
