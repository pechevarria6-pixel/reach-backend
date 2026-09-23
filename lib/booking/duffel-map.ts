// ─── Turning what Reach knows into what Duffel accepts ──────────────────
// Pure, so every awkward case is settled in a test rather than discovered by
// somebody whose ticket did not issue. The shapes here come from one real
// offer request against the test token, not from the documentation:
//
//   total_amount   "240.84"   — a string, not a number
//   expires_at     ISO 8601   — an offer is a held price, and it lapses
//   passengers[].id "pas_…"   — an order must echo the id the offer gave it
//
// See /api/health/providers?sample=duffel, which is what printed them.
import type { Essentials } from '@/lib/essentials';

/**
 * Duffel prices are decimal strings. Number("240.84") * 100 is 24083.999…,
 * so this rounds rather than truncates: a cent lost per booking is a cent
 * the group's split does not add up by.
 */
export function amountToCents(amount: string | number | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * An offer is a price held for a while. Booking against a lapsed one fails at
 * the airline, so the quote is re-requested instead — and "a while" is often
 * under an hour, which is shorter than a group takes to agree on anything.
 */
export function offerExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;           // no expiry stated is not an expired one
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t <= now.getTime();
}

/** Minutes left on a held price, for a screen that should say so. */
export function minutesLeft(expiresAt: string | null | undefined, now = new Date()): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - now.getTime()) / 60000));
}

/**
 * Duffel takes 'm' or 'f' and nothing else.
 *
 * Reach stores four answers, because a passport can carry an X and a person
 * is allowed to decline. Two of those four cannot be sent here, and the
 * honest thing is to say so rather than pick one — a ticket issued under the
 * wrong marker is refused at the gate, and choosing on somebody's behalf is
 * not ours to do. Those flights are handed to the airline's own site — see
 * airlineHandoff below.
 */
export function duffelGender(gender: string | null | undefined): 'm' | 'f' | null {
  const g = (gender ?? '').trim().toLowerCase();
  if (g === 'male') return 'm';
  if (g === 'female') return 'f';
  return null;
}

/** Duffel wants a title, and derives nothing from the gender for us. */
export function duffelTitle(gender: string | null | undefined): 'mr' | 'ms' | null {
  const g = duffelGender(gender);
  return g === 'm' ? 'mr' : g === 'f' ? 'ms' : null;
}

export interface DuffelPassenger {
  id: string;
  given_name: string;
  family_name: string;
  born_on: string;
  gender: 'm' | 'f';
  title: 'mr' | 'ms';
  email: string;
  // Required, not optional. A real order came back "Field 'phone_number'
  // can't be blank", which the type said was fine to omit — so every flight
  // booking failed for everybody, and the only reason it was noticed is that
  // a test of the X-marker path happened to book a male passenger first.
  phone_number: string;
}

/**
 * Why a traveller cannot be sent to the airline as they are.
 *
 * The distinction that matters: 'gender' is not something they can fix. An X
 * passport marker is correct, and the automated channel simply does not carry
 * it — so that booking belongs with a person, not on an error screen. The
 * others are blanks on a form, and telling somebody which one is useful.
 */
export type PassengerProblem = 'name' | 'dob' | 'gender' | 'email' | 'phone';

export type PassengerResult =
  | { ok: true; passenger: DuffelPassenger }
  | { ok: false; why: string; problem: PassengerProblem };

/**
 * One traveller, ready for an order — or the reason they are not.
 *
 * `passengerId` is the id the offer issued. Duffel matches an order's
 * passengers to the offer's by it, and inventing one is an order that is
 * refused after the group has already paid.
 *
 * The failure strings name a field, never a value: they end up in a response
 * the whole group can read.
 */
export function toDuffelPassenger(
  passengerId: string,
  who: Essentials & { email?: string | null; phone?: string | null },
  displayName = 'This traveller',
): PassengerResult {
  const given = (who.firstName ?? '').trim();
  const family = (who.lastName ?? '').trim();
  if (!given || !family) return { ok: false, why: `${displayName} has no legal name saved`, problem: 'name' };
  if (!who.dateOfBirth) return { ok: false, why: `${displayName} has no date of birth saved`, problem: 'dob' };

  const gender = duffelGender(who.gender);
  const title = duffelTitle(who.gender);
  if (!gender || !title) {
    // Deliberately specific. "Details missing" would send somebody to a form
    // they have already filled in.
    return {
      ok: false,
      // Not a fault of theirs and not a blank to fill in. The marker is
      // right; the automated channel is what is narrow.
      why: `${displayName}'s gender marker can't go through automatic booking`,
      problem: 'gender',
    };
  }
  const email = (who.email ?? '').trim();
  if (!email) return { ok: false, why: `${displayName} has no email address`, problem: 'email' };
  // The airline will not take an order without one.
  const phone = String(who.phone ?? '').trim();
  if (!phone) return { ok: false, why: `${displayName} has no phone number saved`, problem: 'phone' };

  return {
    ok: true,
    passenger: {
      id: passengerId,
      given_name: given,
      family_name: family,
      born_on: who.dateOfBirth,
      gender,
      title,
      email,
      phone_number: phone,
    },
  };
}

/** "AA10 · RDU → LIS · 2 Nov" — what a person reads on the booking list. */
export function describeOffer(offer: {
  owner?: { name?: string } | null;
  total_amount?: string;
  total_currency?: string;
  slices?: { origin?: { iata_code?: string }; destination?: { iata_code?: string };
             segments?: { departing_at?: string }[] }[];
}): string {
  const slice = offer.slices?.[0];
  const from = slice?.origin?.iata_code ?? '';
  const to = slice?.destination?.iata_code ?? '';
  const when = slice?.segments?.[0]?.departing_at?.slice(0, 10) ?? '';
  const airline = offer.owner?.name ?? 'Airline';
  return [`${airline}`, from && to ? `${from} → ${to}` : '', when].filter(Boolean).join(' · ');
}

/**
 * The operating carrier and number of the first leg, which is what
 * /api/plans/[planId]/live asks AeroAPI about.
 */
export function flightIdent(offer: {
  slices?: { segments?: { marketing_carrier?: { iata_code?: string };
                          marketing_carrier_flight_number?: string }[] }[];
}): string | null {
  const seg = offer.slices?.[0]?.segments?.[0];
  if (!seg) return null;
  const code = seg.marketing_carrier?.iata_code ?? '';
  const number = seg.marketing_carrier_flight_number ?? '';
  return code && number ? `${code}${number}` : null;
}


/** What a fare actually allows. Duffel nests it; a person reads words. */
export interface FareConditions {
  change_before_departure?: { allowed?: boolean; penalty_amount?: string | null; penalty_currency?: string | null };
  refund_before_departure?: { allowed?: boolean; penalty_amount?: string | null; penalty_currency?: string | null };
}

/** The fare's terms, in words a person reads rather than a nested object. */
export function describeConditions(c: FareConditions | undefined): string[] {
  const out: string[] = [];
  const change = c?.change_before_departure;
  const refund = c?.refund_before_departure;
  if (change) {
    out.push(change.allowed
      ? `Changes allowed${change.penalty_amount ? ` for ${change.penalty_amount} ${change.penalty_currency ?? ''}`.trimEnd() : ''}`
      : 'No changes once booked');
  }
  if (refund) {
    out.push(refund.allowed
      ? `Refundable before departure${refund.penalty_amount ? `, less ${refund.penalty_amount} ${refund.penalty_currency ?? ''}`.trimEnd() : ''}`
      : 'Non-refundable');
  }
  return out;
}

/**
 * A departure date that has been.
 *
 * Compared as calendar days, not instants: a flight later today has not
 * departed, and comparing timestamps would say it had. Duffel answers a past
 * date with "Field 'departure_date' must be after …", which is written for
 * whoever wrote the API rather than whoever reads this app, so the check
 * happens here instead.
 */
export function departed(departDate: string | null | undefined, today = new Date()): boolean {
  if (!departDate || !/^\d{4}-\d{2}-\d{2}$/.test(departDate)) return false;
  const todayYmd = today.toISOString().slice(0, 10);
  return departDate < todayYmd;
}


type Seg = {
  marketing_carrier?: { iata_code?: string; name?: string };
  marketing_carrier_flight_number?: string;
  departing_at?: string; arriving_at?: string;
  origin?: { iata_code?: string }; destination?: { iata_code?: string };
};
type SliceLike = { origin?: { iata_code?: string }; destination?: { iata_code?: string }; segments?: Seg[] };

/**
 * Every flight number on the offer, both ways. What a person chose, as
 * opposed to "the cheapest", and stable across searches where an offer id
 * lasts half an hour: "AA1234.AA567/AA890".
 */
export function offerKey(offer: { slices?: SliceLike[] }): string | null {
  const slices = offer.slices ?? [];
  if (!slices.length) return null;
  const parts: string[] = [];
  for (const sl of slices) {
    const segs = sl.segments ?? [];
    if (!segs.length) return null;
    const codes = segs.map(seg => {
      const c = seg.marketing_carrier?.iata_code, n = seg.marketing_carrier_flight_number;
      return c && n ? `${c}${n}` : null;
    });
    // One unnamed leg and the key could match a different itinerary.
    if (codes.some(c => !c)) return null;
    parts.push(codes.join('.'));
  }
  return parts.join('/');
}

/** One way of a flight, as somebody choosing between them reads it. */
export interface Leg { from: string; to: string; departs: string | null; arrives: string | null; stops: number; flights: string }

function leg(sl: SliceLike | undefined): Leg | null {
  const segs = sl?.segments ?? [];
  if (!segs.length) return null;
  return {
    from: sl?.origin?.iata_code ?? segs[0].origin?.iata_code ?? '',
    to: sl?.destination?.iata_code ?? segs[segs.length - 1].destination?.iata_code ?? '',
    departs: segs[0].departing_at ?? null,
    arrives: segs[segs.length - 1].arriving_at ?? null,
    stops: segs.length - 1,
    flights: segs.map(s => `${s.marketing_carrier?.iata_code ?? ''}${s.marketing_carrier_flight_number ?? ''}`).join(', '),
  };
}

/** A flight offer as a choice: who, when, how many stops, how much. */
export function offerOption(offer: {
  owner?: { name?: string } | null; total_amount?: string; total_currency?: string; slices?: SliceLike[];
}) {
  return {
    key: offerKey(offer),
    airline: offer.owner?.name ?? 'Airline',
    priceCents: amountToCents(offer.total_amount),
    currency: offer.total_currency || 'USD',
    out: leg(offer.slices?.[0]),
    back: leg(offer.slices?.[1]),
  };
}


/** Duffel's own order id, as opposed to the airline booking reference a traveller reads. */
export function isOrderId(ref: unknown): boolean {
  return typeof ref === 'string' && /^ord_[A-Za-z0-9]+$/.test(ref);
}

// ─── A flight Reach cannot buy, handed to the airline ────────────────────
// Duffel carries male or female and nothing else. When anybody on a flight
// has an X marker, or would rather not say, this flight used to become a
// "concierge" row with the fare on it: the group paid for it and no process
// anywhere booked it. Now it is said at the quote, before anybody pays: Reach
// is not buying this one, here is where to, and it is not in the total.

/**
 * The airline's own site, from what the airline itself told Duffel.
 *
 * Duffel gives each airline a conditions-of-carriage page, and its origin is
 * usually the airline's site — but not always: some airlines keep that page
 * on a help centre (help.…, support.…, a Zendesk) or a file host (a CDN, an
 * S3 bucket), and the note then sent people to "{airline}'s own site" at a
 * PDF server. Those hosts are not a place to buy a ticket, so they give
 * null, and the handoff falls back to a flight search that sells every
 * airline on the route. Nothing is guessed from a name.
 */
const NOT_A_SHOP = /^(help|support|faq|cdn\d*|static|assets?|media|files?|docs?|content|img|images|s3|storage|legal)\./i;
const FILE_HOSTS = /(\.|^)(cloudfront\.net|amazonaws\.com|akamaized\.net|azureedge\.net|blob\.core\.windows\.net|cloudinary\.com|ctfassets\.net|contentful\.com|zendesk\.com|freshdesk\.com|salesforce\.com|force\.com|googleusercontent\.com|storage\.googleapis\.com|sharepoint\.com|box\.com|dropbox\.com|duffel\.com)$/i;

export function airlineSite(conditionsUrl: unknown): string | null {
  if (typeof conditionsUrl !== 'string') return null;
  try {
    const u = new URL(conditionsUrl);
    if (u.protocol !== 'https:') return null;
    if (NOT_A_SHOP.test(u.hostname) || FILE_HOSTS.test(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** A search for this route and date that sells every airline flying it. */
export function flightSearchUrl(f: { origin?: string; destination?: string; departDate?: string; returnDate?: string }): string | null {
  if (!f.origin || !f.destination || !f.departDate) return null;
  const q = `Flights from ${f.origin} to ${f.destination} on ${f.departDate}${f.returnDate ? ` returning ${f.returnDate}` : ''}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

export interface Handoff {
  vertical: 'flight';
  mode: 'redirect';
  status: 'quoted';
  provider: 'airline';
  redirectUrl?: string;
  priceCents?: undefined;
  currency?: string;
  detail: string;
  raw: Record<string, unknown>;
}

/**
 * A priced Duffel quote turned into a flight the group books themselves.
 *
 * No price travels on the row, so it is in nobody's share and no approval
 * can charge for it. The fare is kept as what it is — what it cost when we
 * looked — and said as an estimate. Nobody is named: which traveller carries
 * which marker is theirs to tell the group, not ours.
 */
export function airlineHandoff(
  quote: { priceCents?: number; currency?: string; detail?: string; raw?: unknown },
  flight: { origin?: string; destination?: string; departDate?: string; returnDate?: string },
): Handoff {
  const raw = (quote.raw ?? {}) as Record<string, unknown>;
  const airline = String((raw.option as { airline?: string } | undefined)?.airline ?? '').trim() || 'the airline';
  const site = typeof raw.airlineSite === 'string' ? raw.airlineSite : null;
  const url = site ?? flightSearchUrl(flight);
  const fare = typeof quote.priceCents === 'number' && quote.priceCents > 0
    ? ` It was about $${Math.round(quote.priceCents / 100).toLocaleString('en-US')} for everyone when we checked.`
    : '';
  const where = site ? `on ${airline}'s own site` : 'with the airline directly';
  return {
    vertical: 'flight',
    mode: 'redirect',
    status: 'quoted',
    provider: 'airline',
    redirectUrl: url ?? undefined,
    priceCents: undefined,
    currency: quote.currency,
    detail: `${quote.detail ?? 'Flight'} · book ${where}`,
    raw: {
      ...raw,
      handoff: 'gender-marker',
      estimateCents: quote.priceCents ?? null,
      note: `Automatic booking only carries a male or female passport marker, so Reach isn't buying this flight and it isn't in the trip's total. Book it ${where}.${fare}`,
    },
  };
}
