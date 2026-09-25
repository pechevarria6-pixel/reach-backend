// ─── Which line failed ──────────────────────────────────────────────────
// /bookable sends a list of itinerary lines to be priced and names the ones
// that could not be. It filtered the results down to the failures and then
// looked each title up by its position in that shorter list — so with a
// hotel that priced and a flight that did not, checkout said the hotel had
// failed. Somebody about to pay was told the wrong thing was missing.
//
// Each result now carries the itineraryItemId it was asked for, and the
// title is found by that.

type Req = { itineraryItemId: string; title: string; vertical?: string };
type Res = { status?: string; error?: string; itineraryItemId?: string; stillPriced?: boolean };

// ─── Nothing for these dates ─────────────────────────────────────────────
// A search that found nothing is not the same failure as one that broke.
// "No flights found for those dates" from Duffel, or "No rates available"
// from LiteAPI for a city search, says the dates are the problem — and a
// line that just reads "Couldn't book" leaves somebody with nothing to do.
// The spec's rule: never drop the slot; offer nearby dates; log it.
//
// Only a search nothing was pinned to counts. "That hotel has no rooms left"
// is about one hotel, and its next step is another hotel (the options
// route), not other dates.

/** The code a screen keys the nearby-dates offer on. */
export const TRY_NEARBY_DATES = 'try_nearby_dates' as const;

// The providers' own words (lib/booking/providers): the quote's and the
// option list's. Anchored, so an error that merely mentions flights — "the
// flights you chose are no longer on sale" — is not read as an empty search.
const NOTHING_FOUND: Record<string, RegExp> = {
  flight: /^no (other )?flights found\b/i,
  hotel: /^(no rates available|no other hotels have rooms for those dates)\b/i,
};

/** Whether a provider's failure means "searched, found nothing for these dates". */
export function nothingFound(vertical: string | null | undefined, error: string | null | undefined): boolean {
  const re = NOTHING_FOUND[String(vertical)];
  return !!re && re.test(String(error ?? '').trim());
}

/** The question the screen asks. An offer to search again, never a promise that it will find anything. */
export function nearbyAsk(vertical: string | null | undefined): string {
  return vertical === 'hotel'
    ? "We couldn't find a room for these dates — try nearby dates?"
    : "We couldn't find a flight for these dates — try nearby dates?";
}

const DAY = 86_400_000;
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** Calendar arithmetic on a date with no time and no zone: noon UTC cannot roll a day. */
function shift(day: string, by: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + by * DAY).toISOString().slice(0, 10);
}

/**
 * The same length of trip moved a day or three either way, nearest first,
 * none starting before `today` (the local day — lib/calendar today()).
 * Suggestions to search, not dates anything was found on.
 */
export function nearbyDates(
  start: string | null | undefined, end: string | null | undefined, today: string, max = 4,
): { start: string; end: string }[] {
  if (!isDay(start)) return [];
  const last = isDay(end) && end >= start ? end : start;
  const out: { start: string; end: string }[] = [];
  for (const by of [-1, 1, -2, 2, -3, 3]) {
    const s = shift(start, by);
    if (s < today) continue;
    out.push({ start: s, end: shift(last, by) });
    if (out.length >= max) break;
  }
  return out;
}

export interface LineFailure {
  title: string;
  error: string;
  stillPriced?: true;
  /** Set when the search found nothing for these dates: the screen offers nearby ones. */
  reason?: typeof TRY_NEARBY_DATES;
  ask?: string;
  nearby?: { start: string; end: string }[];
  vertical?: string;
}

/**
 * `stillPriced` marks a line that is in the total at its old price because
 * pricing it again for who is going failed: it is not missing from the
 * total, and checkout must not say it is.
 *
 * `dates`, when given, turns a found-nothing failure into the nearby-dates
 * offer (reason TRY_NEARBY_DATES, the question, and the windows to try).
 */
export function failuresByLine(
  requests: Req[], results: Res[],
  dates?: { start?: string | null; end?: string | null; today: string } | null,
): LineFailure[] {
  const byLine = new Map(requests.map(r => [r.itineraryItemId, r]));
  return results
    .filter(r => r.status === 'failed')
    .map(r => {
      const req = r.itineraryItemId ? byLine.get(r.itineraryItemId) : undefined;
      const error = r.error ?? 'could not be quoted';
      const empty = !r.stillPriced && nothingFound(req?.vertical, error);
      return {
        title: req?.title || 'an item',
        error,
        ...(r.stillPriced ? { stillPriced: true as const } : {}),
        ...(req?.vertical ? { vertical: req.vertical } : {}),
        ...(empty ? {
          reason: TRY_NEARBY_DATES,
          ask: nearbyAsk(req?.vertical),
          nearby: dates ? nearbyDates(dates.start, dates.end, dates.today) : [],
        } : {}),
      };
    });
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
