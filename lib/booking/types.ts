// ─── Reach Booking Engine — unified types ────────────────────────────────
// One pipeline for all five verticals. Every provider implements
// BookingProvider; the orchestrator doesn't care which industry it is.

export type Vertical = 'flight' | 'hotel' | 'activity' | 'event' | 'restaurant';

// How a booking gets fulfilled:
//   native    → booked in-app via provider API, we hold the confirmation
//   redirect  → user completes purchase on a prefilled partner page
//   concierge → request captured; fulfilled by ops (or a future API swap-in)
export type FulfillmentMode = 'native' | 'redirect' | 'concierge';

export type BookingStatus =
  | 'quoted'             // priced, not yet committed
  | 'awaiting_approval'  // proposed; group lead must approve before execution
  // Claimed by one approval and at the provider right now. Written by a
  // conditional update from awaiting_approval, so two approvals of the same
  // row cannot both reach the provider — see app/api/bookings/[id]/approve.
  | 'booking'
  | 'pending'       // submitted, awaiting provider/ops confirmation
  | 'confirmed'     // booked — confirmation number available
  | 'redirected'    // handed to partner checkout
  | 'failed'
  | 'cancelled';

export interface TravelerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string; // required for flights
  /** female | male | x | unspecified — only ever read at approval, never stored. */
  gender?: string;
}

export interface BookingItemRequest {
  vertical: Vertical;
  planId: string;
  groupId: string;
  travelers: TravelerInfo[];
  /**
   * How many people this is for. Set when the thing is quoted, from the
   * party, and checked again at approval against everybody actually on the
   * booking. Every provider sizes from this: seats, rooms' occupants, an
   * activity's travellers, a table. It used to be `travelers.length`, and
   * nobody is named at quote time, so every quote was for one person.
   */
  party?: number;
  /**
   * Our own id for this booking, sent to the provider where it takes one
   * (LiteAPI clientReference, Viator partnerBookingRef), so an order at the
   * provider can always be traced back to the row that asked for it.
   */
  reference?: string;
  /**
   * The most the group has paid in for this, set by approval: book() refuses
   * to pay a provider more. Duffel's book() prices the offer again and used
   * to pay whatever came back, so a fare that rose between the check and the
   * order was paid for out of Reach's pocket. Never stored.
   */
  maxPriceCents?: number;
  // Vertical-specific payloads (only the relevant one is set)
  flight?: {
    origin: string;        // IATA, e.g. "SFO"
    destination: string;   // IATA
    departDate: string;    // YYYY-MM-DD
    returnDate?: string;
    cabin?: 'M' | 'W' | 'C' | 'F';
    /** Seats to price when nobody is named yet — the party size. */
    seats?: number;
    /** The exact flights chosen (offerKey), so approval books those and not the cheapest. */
    offerKey?: string;
    /**
     * The fare terms shown for those flights when they were priced
     * (lib/booking/pin.ts). Duffel's quote takes only an offer on exactly
     * these terms, so the fare bought is the fare the group was shown.
     */
    fareTerms?: string[];
  };
  hotel?: {
    hotelId?: string;      // LiteAPI hotel id if already selected
    city?: string;
    countryCode?: string;  // ISO-2. LiteAPI refuses a city on its own.
    checkin: string;
    checkout: string;
    rooms: number;
    rateId?: string;       // from a prior quote
  };
  activity?: {
    productCode: string;   // Viator product code
    date: string;
    optionCode?: string;
  };
  event?: {
    eventId: string;       // Ticketmaster event id
    quantity: number;
  };
  restaurant?: {
    name: string;
    city: string;
    date: string;
    time: string;
    partySize: number;
    notes?: string;
    externalUrl?: string;  // OpenTable/Resy page if known
    // Where this restaurant actually takes bookings, learned at harvest time
    // rather than looked up while somebody waits. Absent means we do not
    // know, which sends them to the phone rather than to a guess.
    platform?: 'resy' | 'opentable' | 'tock' | 'none';
    // For the places with no platform at all: the number you ring.
    phone?: string | null;
  };
}

export interface BookingItemResult {
  vertical: Vertical;
  mode: FulfillmentMode;
  status: BookingStatus;
  provider: string;              // 'liteapi' | 'duffel' | 'viator' | 'ticketmaster' | 'airline' | a table platform
  providerRef?: string;          // provider booking id / confirmation number
  redirectUrl?: string;          // for mode=redirect
  priceCents?: number;
  currency?: string;
  detail?: string;               // human-readable summary
  raw?: unknown;                 // provider response for auditing
  error?: string;
  /** The itinerary line this was asked for, echoed back by POST /api/bookings. */
  itineraryItemId?: string;
  /**
   * A failure that left a booking in the total at a price for a different
   * number of people (lib/booking/reprice.ts) — as opposed to one that left
   * the line out of the total altogether. Checkout says the two differently.
   */
  stillPriced?: boolean;
  /** A booking already on the plan priced again in place for a new headcount — not a new one. */
  repriced?: boolean;
}

export interface BookingProvider {
  vertical: Vertical;
  name: string;
  /** Price/availability check. Should never charge. */
  quote(req: BookingItemRequest): Promise<BookingItemResult>;
  /** Commit the booking (or produce redirect/concierge ticket). */
  book(req: BookingItemRequest): Promise<BookingItemResult>;
  /**
   * Undo one, where the provider allows it.
   *
   * Optional because not every lane can: a table booked on the
   * restaurant's own site is cancelled on the restaurant's own site, and
   * pretending otherwise would be the same false promise as "Reach will
   * book this" over a dinner.
   *
   * Two steps on purpose. Asking without `confirm` returns what would come
   * back — airlines refund a fraction, or nothing — and only a second call
   * with `confirm` actually does it. Nobody should cancel a flight without
   * being told first what it costs them.
   */
  cancel?(ref: string, opts?: { confirm?: boolean }): Promise<CancelResult>;
}

export interface CancelResult {
  /** 'quoted' — here is what you would get back. 'cancelled' — it is done. */
  status: 'quoted' | 'cancelled' | 'failed';
  refundCents?: number;
  currency?: string;
  /** The provider's handle for this pending cancellation, for the confirm. */
  cancellationRef?: string;
  error?: string;
  raw?: unknown;
}

export const isConfigured = (envKey: string) =>
  typeof process.env[envKey] === 'string' && process.env[envKey]!.length > 0;

/**
 * Thrown by a provider's book() when the order may exist and we cannot tell:
 * the request was sent and the answer never came, or came back as a server
 * error. Approval leaves such a row mid-booking and reports it, rather than
 * marking it failed — a failed row leaves the total and can be booked again,
 * which is a second order if the first one went through.
 *
 * Anything thrown before the order is sent is an ordinary failure.
 */
export class OutcomeUnknown extends Error {
  readonly outcomeUnknown = true;
  constructor(message: string) {
    super(message);
    this.name = 'OutcomeUnknown';
  }
}

/** Whether an error says the provider may have taken the order. */
export function isOutcomeUnknown(e: unknown): boolean {
  return e instanceof OutcomeUnknown || (!!e && typeof e === 'object' && (e as { outcomeUnknown?: unknown }).outcomeUnknown === true);
}

/**
 * The commit call to a provider — the one that buys something. A network
 * failure or a 5xx after it was sent means the order may exist; a 4xx is the
 * provider saying no, and nothing was bought.
 */
export async function commitFetch(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new OutcomeUnknown(`No answer from the provider after the order was sent: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status >= 500) throw new OutcomeUnknown(`The provider answered ${res.status} after the order was sent.`);
  return res;
}

/**
 * Whether a price is above the most approval said the group had paid in for
 * it. No ceiling set (a caller that is not approval) is never over.
 */
export function overMax(priceCents: number | null | undefined, maxPriceCents: number | null | undefined): boolean {
  const max = Number(maxPriceCents);
  if (!Number.isFinite(max) || max <= 0) return false;
  return Number(priceCents) > max;
}
