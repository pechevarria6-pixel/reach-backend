// ─── How many people a booking is for ────────────────────────────────────
// Every quote used to be sized off `travelers.length`, and nobody is named
// when a trip is priced — so every flight was one seat, every hotel room held
// "two to a room" whatever the group was, and every activity was for one.
// The price on the screen was for a smaller trip than the one being paid for.
//
// A booking now carries `party`: the number of people it was quoted for,
// written when it is priced. Approval names everybody actually on it and
// compares, because a booking for three bought with two names on it is either
// a seat nobody can use or somebody left at the gate.
//
// Pure, so every case is settled in tests/unit/booking-party.test.ts.
import type { BookingItemRequest } from './types.ts';

/** One room per two people, rounded up. */
export function roomsFor(party: number): number {
  return Math.max(1, Math.ceil(Math.max(1, Math.floor(party || 1)) / 2));
}

/**
 * The people spread across the rooms, as evenly as they go: three people in
 * two rooms is two and one, never three and zero. Every room has somebody in
 * it, because a hotel will not sell an empty one.
 */
export function occupancies(party: number, rooms: number): { adults: number }[] {
  const r = Math.max(1, Math.floor(rooms || 1));
  const p = Math.max(r, Math.floor(party || 0));
  return Array.from({ length: r }, (_, i) => ({ adults: Math.floor(p / r) + (i < p % r ? 1 : 0) }));
}

/** The number a provider sizes from: the party, else whoever is named, else one. */
export function headcount(req: Pick<BookingItemRequest, 'party' | 'travelers'>, fallback = 1): number {
  const party = Number(req.party);
  if (Number.isFinite(party) && party >= 1) return Math.floor(party);
  const named = req.travelers?.length ?? 0;
  return named > 0 ? named : Math.max(1, fallback);
}

/**
 * How many people this was priced for, or null when the row does not say.
 *
 * Rows priced before `party` existed still say it in their own terms: a
 * flight's seats, a table's party size, a ticket's quantity. A hotel from
 * then says only how many rooms, and was priced at two to a room.
 */
export function quotedParty(req: Partial<BookingItemRequest> | null | undefined): number | null {
  if (!req) return null;
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 1 ? Math.floor(Number(v)) : null);
  return n(req.party) ?? n(req.flight?.seats) ?? n(req.restaurant?.partySize) ?? n(req.event?.quantity) ?? null;
}

export interface PartyChange { quoted: number; now: number }

/**
 * Whether the people on a booking are the people it was priced for.
 *
 * Seats and rooms are the strict case: a flight is never bought with fewer
 * passengers than seats paid for, or more people than seats, and a hotel is
 * never booked for more people than its rooms were priced to hold. Either
 * way the answer is to price it again for who is going, not to book the old
 * number and hope.
 *
 * An activity is sized to whoever is on it at the moment of booking; the
 * re-quote that approval runs first catches any change in price.
 */
export function partyChange(
  req: Partial<BookingItemRequest> | null | undefined, travellers: number,
): PartyChange | null {
  if (!req) return null;
  const now = Math.max(0, Math.floor(travellers));
  if (req.vertical === 'flight') {
    const quoted = quotedParty(req);
    if (quoted !== null && quoted !== now) return { quoted, now };
    return null;
  }
  if (req.vertical === 'hotel') {
    const explicit = Number(req.party);
    if (Number.isFinite(explicit) && explicit >= 1) {
      return Math.floor(explicit) === now ? null : { quoted: Math.floor(explicit), now };
    }
    // Priced before `party` existed, at two to a room.
    const rooms = Math.max(1, Math.floor(req.hotel?.rooms || 1));
    return now > rooms * 2 ? { quoted: rooms * 2, now } : null;
  }
  return null;
}

type Row = { id?: unknown; vertical?: unknown; status?: unknown; mode?: unknown; request_payload?: unknown };
const SEATS_AND_ROOMS = new Set(['flight', 'hotel']);

/**
 * Flights and hotels waiting to be booked that were priced for a different
 * number of people than are now going.
 *
 * Money must not be taken against these: a share of a two-seat fare is not a
 * share of the three-seat fare that will actually be charged. Only rows that
 * say what they were sized for are judged — a hotel from before `party`
 * existed does not say, and guessing would lock a plan nobody can unlock.
 *
 * Only what Reach buys. A flight handed to the airline's own site costs the
 * group nothing through Reach, and stopped everybody paying for the hotel
 * the moment somebody joined.
 *
 * `party` is a number for the whole plan, or the number for each row — the
 * group less anybody kept off that booking (partyFor in lib/booking/resize.ts),
 * which is who approval names. One number for the plan refused, for good, a
 * trip somebody joined after paying: they are kept off what was paid for, so
 * it is rightly still priced for one, and approval books it for one.
 */
export function staleForParty<T extends Row>(
  rows: T[] | null | undefined, party: number | ((row: T) => number),
): T[] {
  return (rows ?? []).filter(r => {
    if (r.status !== 'awaiting_approval') return false;
    if (!SEATS_AND_ROOMS.has(String(r.vertical))) return false;
    if (r.mode === 'redirect' || r.mode === 'concierge') return false;
    const sized = sizedFor(r);
    return sized !== null && sized !== (typeof party === 'function' ? party(r) : party);
  });
}

/**
 * How many people a flight or hotel row says it was priced for, or null when
 * it does not say. A flight says it in seats if nothing else; a hotel only in
 * `party`, because its rooms were priced at two to a room and one room holds
 * one person or two.
 */
export function sizedFor(r: { vertical?: unknown; request_payload?: unknown }): number | null {
  const req = (r.request_payload ?? null) as Partial<BookingItemRequest> | null;
  if (r.vertical === 'flight') return quotedParty(req);
  if (r.vertical === 'hotel') {
    return Number.isFinite(Number(req?.party)) && Number(req?.party) >= 1 ? Math.floor(Number(req?.party)) : null;
  }
  return null;
}
