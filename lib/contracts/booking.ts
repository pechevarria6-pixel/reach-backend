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
import { cancelChargeFrom } from '../booking/pin.ts';

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
  /**
   * What the member typed on "I've got it" after finishing it elsewhere
   * (sql/booking-confirmation-2026-09-25.sql). Absent until that runs — which
   * is why it is not in BOOKING_COLUMNS: a narrow select naming it would fail
   * the whole read with 42703 before the migration. GET /api/bookings reads
   * `*`, so it arrives the moment the column exists.
   */
  confirmation_number: z.string().nullish(),
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
   * The confirmation number the member entered on "I've got it". Typed by a
   * person, not seen by Reach: a screen shows it as "You entered ABC123",
   * never as confirmed by Reach.
   */
  confirmationNumber: string | null;
  /**
   * What the provider said about changing, refunding or cancelling it, in
   * its own terms. Null when it said nothing — which the screen has to say
   * out loud, because a blank reads as "no catch".
   */
  conditions: string[] | null;
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
    confirmationNumber: r.confirmation_number?.trim() || null,
    conditions: conditionsOf(r.vertical ?? null, r.response_payload),
  };
}

// ─── "I've got it" ───────────────────────────────────────────────────────
// Somebody finished a booking on the seller's own site and came back. The
// one fact worth keeping is the number the seller gave them. It is optional
// — plenty of places send nothing but an email — and it is theirs to type,
// so it is kept as typed, trimmed, and never checked against anything.

/** Longest confirmation number kept; matches the SQL CHECK. */
export const CONFIRMATION_MAX = 100;

/**
 * The number from the request body: trimmed, inner runs of space collapsed,
 * and an empty one read as "I didn't get one" (null). Refused only when it is
 * too long or holds control characters — never for its shape, since every
 * seller writes theirs differently.
 */
export function confirmationInput(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'The confirmation number should be text.' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw.replace(/[\t\n\r]/g, ' '))) {
    return { ok: false, error: "That confirmation number has characters in it we can't keep — type it again." };
  }
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return { ok: true, value: null };
  if (value.length > CONFIRMATION_MAX) {
    return { ok: false, error: `That's longer than any confirmation number we've seen — ${CONFIRMATION_MAX} characters at most.` };
  }
  return { ok: true, value };
}

/**
 * The write refused because bookings.confirmation_number is not there yet —
 * sql/booking-confirmation-2026-09-25.sql has not run. PostgREST says
 * PGRST204 for a column missing from its cache, Postgres says 42703.
 */
export function confirmationColumnMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  // The shape CHECK names the column too, and is a real refusal of what was
  // typed — never a reason to drop it and carry on.
  if (error.code === '23514') return false;
  return error.code === 'PGRST204' || error.code === '42703' || /confirmation_number/.test(error.message ?? '');
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
 * "Refundable" on its own left out when: a refundable rate is refundable
 * until a deadline the hotel sets. That comes from the rate's
 * `cancellationPolicies.cancelPolicyInfos` — the earliest `cancelTime` from
 * which the hotel lists a charge — said in the hotel's own words, since which
 * clock it is in is not given. Not checked against a live LiteAPI answer (the
 * key in .env.local is a placeholder), so when that list is missing or
 * unreadable the line says the deadline was not sent rather than inventing
 * one. Anything else is not guessed at.
 */
export function conditionsOf(vertical: string | null, payload: unknown): string[] | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    conditions?: unknown;
    cancellationPolicies?: { refundableTag?: unknown; cancelPolicyInfos?: unknown } | null;
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
    if (tag === 'RFN') {
      const from = cancelChargeFrom(p.cancellationPolicies?.cancelPolicyInfos);
      return [from
        ? `Refundable on the hotel's cancellation terms — the hotel lists a charge for cancelling from ${from}`
        : "Refundable on the hotel's cancellation terms. The hotel didn't send its cancellation deadline, so check it with them before counting on a refund"];
    }
    return null;
  }
  return null;
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
