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
}

export interface BookingItemRequest {
  vertical: Vertical;
  planId: string;
  groupId: string;
  travelers: TravelerInfo[];
  // Vertical-specific payloads (only the relevant one is set)
  flight?: {
    origin: string;        // IATA, e.g. "SFO"
    destination: string;   // IATA
    departDate: string;    // YYYY-MM-DD
    returnDate?: string;
    cabin?: 'M' | 'W' | 'C' | 'F';
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
  };
}

export interface BookingItemResult {
  vertical: Vertical;
  mode: FulfillmentMode;
  status: BookingStatus;
  provider: string;              // 'liteapi' | 'kiwi' | 'viator' | 'ticketmaster' | 'concierge'
  providerRef?: string;          // provider booking id / confirmation number
  redirectUrl?: string;          // for mode=redirect
  priceCents?: number;
  currency?: string;
  detail?: string;               // human-readable summary
  raw?: unknown;                 // provider response for auditing
  error?: string;
}

export interface BookingProvider {
  vertical: Vertical;
  name: string;
  /** Price/availability check. Should never charge. */
  quote(req: BookingItemRequest): Promise<BookingItemResult>;
  /** Commit the booking (or produce redirect/concierge ticket). */
  book(req: BookingItemRequest): Promise<BookingItemResult>;
}

export const isConfigured = (envKey: string) =>
  typeof process.env[envKey] === 'string' && process.env[envKey]!.length > 0;
