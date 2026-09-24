// ─── The booking row, defined once ───────────────────────────────────────
// Same disease as the itinerary item, on the side where it costs money.
//
// The checkout screen builds its rows from a hand-written list of fields,
// and the comments around that list already record two occasions when a
// fact reached the row and not the screen: "a redirected booking finishes
// somewhere else, and until now the screen said so with nothing to tap", and
// "a table the app said it wanted and gave you no way to get".
//
// Both are the dropped-fact bug wearing a different coat, and both were
// found by somebody looking at a screen rather than by anything in the
// stack. So the facts live here and the screen imports them; the screen
// keeps its icons and its wording, which are presentation and belong to it.
import { z } from 'zod';

export const BookingRow = z.object({
  id: z.string(),
  vertical: z.string().nullish(),
  status: z.string().nullish(),
  provider: z.string().nullish(),
  mode: z.string().nullish(),
  provider_ref: z.string().nullish(),
  /** Where a redirected booking is actually finished. */
  redirect_url: z.string().nullish(),
  // A number or a numeric string. PostgREST hands `numeric` and `bigint`
  // back as strings to keep the precision JSON would lose, and a strict
  // `z.number()` here would refuse the row, drop it from the list, and leave
  // its price in the total — a bill with a line missing.
  price_cents: z.union([z.number(), z.string().regex(/^-?\d+$/).transform(Number)]).nullish(),
  currency: z.string().nullish(),
  detail: z.unknown().nullish(),
  response_payload: z.unknown().nullish(),
  itinerary_item_id: z.string().nullish(),
});
export type BookingRow = z.infer<typeof BookingRow>;

/** The facts a checkout row is made of. Presentation is the screen's. */
export interface BookingFacts {
  id: string;
  vertical: string | null;
  status: string | null;
  provider: string | null;
  mode: string | null;
  /** The provider's own booking id — a confirmation number, where there is one. */
  providerRef: string | null;
  priceCents: number | null;
  currency: string;
  /** Where this is finished, when it finishes elsewhere. */
  href: string | null;
  /** A number somebody can ring, when the provider left one. */
  phone: string | null;
  /** The provider's own sentence about this booking, when it left one. */
  note: string | null;
  /**
   * What this booking is of. A string on new rows, an object on old ones,
   * and `itemTitle` handles both — which is why it stays `unknown` here
   * rather than being narrowed to the shape that happens to be commonest.
   */
  detail: unknown;
  /**
   * The provider's response, whole. `note` and `phone` are the two bits any
   * screen reads, but a duplicate handed back to a caller has to return the
   * payload intact or the second answer is thinner than the first.
   */
  payload: unknown;
  itineraryItemId: string | null;
  /**
   * What the provider said about changing, refunding or cancelling it, in
   * its own terms. Null when it said nothing — which the screen has to say
   * out loud, because a blank reads as "no catch".
   */
  conditions: string[] | null;
  /** When the provider stops holding this price (ISO), where it said. */
  priceHeldUntil: string | null;
}

/**
 * Every column the mapper needs.
 *
 * A narrow select is how a fact disappears without anybody touching the
 * mapper — `redirect_url` missing here empties "Finish on their site" and
 * nothing else changes.
 */
export const BOOKING_COLUMNS = [
  'id', 'vertical', 'status', 'provider', 'mode', 'provider_ref',
  'redirect_url', 'price_cents', 'currency', 'detail', 'response_payload',
  'itinerary_item_id',
].join(', ');

export function bookingFacts(row: Record<string, unknown>): BookingFacts {
  const r = BookingRow.parse(row);
  const payload = (r.response_payload ?? {}) as { note?: unknown; phone?: unknown };
  return {
    id: r.id,
    vertical: r.vertical ?? null,
    status: r.status ?? null,
    provider: r.provider ?? null,
    mode: r.mode ?? null,
    providerRef: r.provider_ref ?? null,
    priceCents: r.price_cents ?? null,
    currency: r.currency ?? 'USD',
    href: r.redirect_url ?? null,
    phone: typeof payload.phone === 'string' ? payload.phone : null,
    note: typeof payload.note === 'string' ? payload.note : null,
    detail: r.detail ?? null,
    payload: r.response_payload ?? null,
    itineraryItemId: r.itinerary_item_id ?? null,
    conditions: conditionsOf(r.vertical ?? null, r.response_payload),
    priceHeldUntil: heldUntilOf(r.response_payload),
  };
}

/**
 * The fare or room terms the quote kept in its payload.
 *
 * Flights: the Duffel quote stores `conditions`, already in words
 * (describeConditions in lib/booking/duffel-map.ts). An empty list is Duffel
 * saying nothing about either, which is null here, not "no conditions".
 *
 * Hotels: the LiteAPI rate is stored whole, and its
 * `cancellationPolicies.refundableTag` is the rate's own flag — RFN or NRFN.
 * Anything else is not guessed at.
 */
export function conditionsOf(vertical: string | null, payload: unknown): string[] | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    conditions?: unknown; cancellationPolicies?: { refundableTag?: unknown } | null;
  };
  if (vertical === 'flight') {
    const said = Array.isArray(p.conditions)
      ? p.conditions.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      : [];
    return said.length ? said : null;
  }
  if (vertical === 'hotel') {
    const tag = p.cancellationPolicies?.refundableTag;
    if (tag === 'NRFN') return ['Non-refundable'];
    if (tag === 'RFN') return ['Refundable, on the hotel\'s cancellation terms'];
    return null;
  }
  return null;
}

/** The offer's own expiry, as the flight quote stored it. */
function heldUntilOf(payload: unknown): string | null {
  const at = (payload && typeof payload === 'object' ? payload : {}) as { expiresAt?: unknown };
  return typeof at.expiresAt === 'string' && !Number.isNaN(Date.parse(at.expiresAt)) ? at.expiresAt : null;
}

/**
 * The same, for a screen.
 *
 * `bookingFacts` throws, which is right on a server and behind a test. On the
 * checkout screen a throw would white-screen the one place somebody decides
 * to pay, over a single old row — so a row that will not parse is dropped and
 * the rest of the list renders. Identical bargain to `itemsFromRows`.
 */
export function bookingFactsFrom(rows: unknown): BookingFacts[] {
  if (!Array.isArray(rows)) return [];
  const out: BookingFacts[] = [];
  for (const row of rows) {
    try {
      out.push(bookingFacts(row as Record<string, unknown>));
    } catch (e) {
      // Dropped, not thrown. One unreadable row is not the whole screen.
      //
      // But never silently: the checkout total is worked out from the raw
      // rows, before this runs, so a row dropped here still counts toward the
      // number somebody is asked to pay while not appearing among the lines
      // that explain it. That is the worst shape this file has — a total that
      // does not match its rows — so it goes to the log, which is where the
      // bugs here actually get found.
      console.error('[booking-contract] a booking row would not parse and is missing from the list', {
        id: (row as { id?: unknown })?.id, why: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

/**
 * The facts that must reach a screen, and what each one costs when it does
 * not. Every line here is something that has actually gone missing.
 */
export const BOOKING_FACTS_THAT_MUST_SURVIVE: { row: keyof BookingRow; fact: keyof BookingFacts; costs: string }[] = [
  { row: 'detail', fact: 'detail', costs: 'every line reading "Trip item (details coming)"' },
  { row: 'redirect_url', fact: 'href', costs: '"Finish on their site" with no site' },
  { row: 'price_cents', fact: 'priceCents', costs: 'a total that does not match its rows' },
  { row: 'provider', fact: 'provider', costs: 'finishing somewhere unnamed' },
  { row: 'status', fact: 'status', costs: '"all booked" over something quoted' },
  { row: 'itinerary_item_id', fact: 'itineraryItemId', costs: 'two rows for one dinner' },
];
