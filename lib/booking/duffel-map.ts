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
 * not ours to do. Those bookings go to the concierge lane instead.
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
  phone_number?: string;
}

export type PassengerResult =
  | { ok: true; passenger: DuffelPassenger }
  | { ok: false; why: string };

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
  if (!given || !family) return { ok: false, why: `${displayName} has no legal name saved` };
  if (!who.dateOfBirth) return { ok: false, why: `${displayName} has no date of birth saved` };

  const gender = duffelGender(who.gender);
  const title = duffelTitle(who.gender);
  if (!gender || !title) {
    // Deliberately specific. "Details missing" would send somebody to a form
    // they have already filled in.
    return {
      ok: false,
      why: `${displayName}'s gender marker cannot be ticketed by this airline automatically`,
    };
  }
  const email = (who.email ?? '').trim();
  if (!email) return { ok: false, why: `${displayName} has no email address` };

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
      ...(who.phone ? { phone_number: String(who.phone).trim() } : {}),
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
