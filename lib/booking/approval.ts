// ─── What approval decides, before anything is bought ───────────────────
// POST /api/bookings/[id]/approve spends the group's money at an airline or a
// hotel. Everything it decides on the way there lives here, where a test can
// put each wrong answer back and watch it fail, rather than in a route file
// the test runner cannot import.
//
// The order matters and is the route's: price first, then money, then claim
// the row, then book. A price rise checked after the money would pass a plan
// funded for the old price.
import { missingFor } from '../essentials.ts';

type Contribution = { status?: unknown; amount_cents?: unknown; refunded_cents?: unknown; user_id?: unknown };

/**
 * Money actually held for a plan: every payment that went through, less
 * whatever Stripe has since given back.
 *
 * `refunded_cents` arrives in a migration of its own. The row is read with
 * `*` so that it counts from the moment that migration runs; until then it
 * is absent, and absent means nothing has been refunded.
 */
export function netCollectedCents(contribs: Contribution[] | null | undefined, userId?: string): number {
  return (contribs ?? [])
    .filter(c => c.status === 'succeeded' && (userId === undefined || c.user_id === userId))
    .reduce((s, c) => {
      const paid = Math.max(0, Number(c.amount_cents) || 0);
      const back = Math.min(paid, Math.max(0, Number(c.refunded_cents) || 0));
      return s + paid - back;
    }, 0);
}

export interface Funding { targetCents: number; collectedCents: number; shortfallCents: number; funded: boolean }

/**
 * Whether what is held covers what is owed. `bookings` is every row that
 * counts towards the total — the caller filters with NOT_CHARGED.
 */
export function fundingOf(
  bookings: { price_cents?: unknown }[] | null | undefined,
  contribs: Contribution[] | null | undefined,
): Funding {
  const targetCents = (bookings ?? []).reduce((s, b) => s + Math.max(0, Number(b.price_cents) || 0), 0);
  const collectedCents = netCollectedCents(contribs);
  const shortfallCents = Math.max(0, targetCents - collectedCents);
  return { targetCents, collectedCents, shortfallCents, funded: shortfallCents === 0 };
}

/** A rise worth asking about: more than $25, or more than 5%. */
export function priceRose(oldCents: number, newCents: number | null | undefined): boolean {
  if (!oldCents || !newCents || newCents <= oldCents) return false;
  const drift = newCents - oldCents;
  return drift > 2500 || drift / oldCents > 0.05;
}

/**
 * The new price somebody is agreeing to, or null.
 *
 * `acceptNewPrice` came straight from the request body and was honoured on
 * its own, so any member could send it and skip the price check entirely. It
 * now means "yes to the price you told me about", and only counts when there
 * is such a price: one approval recorded in `pending_price_cents`.
 */
export function acceptedPrice(
  body: { acceptNewPrice?: unknown; acceptedCents?: unknown } | null | undefined,
  booking: { pending_price_cents?: unknown },
): number | null {
  if (body?.acceptNewPrice !== true) return null;
  const pending = Number(booking.pending_price_cents);
  if (!(Number.isFinite(pending) && pending > 0)) return null;
  // Yes to the price that was shown, and only that one. "Accept" used to be
  // sent for every waiting row and took whatever rise each one held — a rise
  // on a row the screen never named, or a newer, higher one recorded from
  // another device after the screen loaded.
  return Number(body.acceptedCents) === Math.round(pending) ? Math.round(pending) : null;
}

/**
 * Somebody accepted a price, and it is not the one now waiting on the row:
 * it moved again after they saw it. Said as a new rise, never taken.
 */
export function acceptedStale(
  body: { acceptNewPrice?: unknown; acceptedCents?: unknown } | null | undefined,
  booking: { pending_price_cents?: unknown },
): boolean {
  return body?.acceptNewPrice === true && acceptedPrice(body, booking) === null
    && Number(booking.pending_price_cents) > 0;
}

/** Things Reach buys with the group's money. */
const BOUGHT = new Set(['flight', 'hotel', 'activity']);

/**
 * Whether this row is one Reach pays a provider for. Redirects — a table, a
 * ticket, a flight handed to the airline's own site — cost the group nothing
 * through Reach, and need nobody's passport.
 */
export function isPurchase(row: { vertical?: unknown; mode?: unknown }): boolean {
  if (!BOUGHT.has(String(row.vertical))) return false;
  return row.mode === 'native' || row.mode === null || row.mode === undefined;
}

/** A purchase with no price is refused: nobody paid a share of it. */
export function unpriced(row: { vertical?: unknown; mode?: unknown; price_cents?: unknown }): boolean {
  return isPurchase(row) && !(Number(row.price_cents) > 0);
}

/**
 * Whether the plan is booked now: nothing waiting, nothing mid-booking,
 * nothing pending, nothing failed, and at least one thing actually done.
 *
 * `pending` used to be allowed through, on the grounds that somebody was
 * holding it. Nobody was: a pending row is a table nobody has rung for yet,
 * or a flight the priced-concierge lane had taken money for and that no
 * process existed to book. A plan does not say "booked" over either.
 */
export function planBooked(states: unknown[]): boolean {
  const s = states.map(String);
  if (!s.length) return false;
  if (s.some(x => x === 'awaiting_approval' || x === 'booking' || x === 'pending' || x === 'failed')) return false;
  return s.some(x => x === 'confirmed' || x === 'redirected');
}

export interface Person {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Who on a booking is missing something the provider will not book without.
 *
 * A flight needs everything an airline checks against a passport. A room or
 * an activity needs a legal name and somewhere to send the confirmation.
 * Names only come back: this list is shown to the group.
 */
export function travellersMissing(vertical: string, people: Person[], today = new Date()): string[] {
  return people.filter(p => {
    if (vertical === 'flight') {
      return missingFor({
        firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth,
        gender: p.gender, phone: p.phone,
      }, today).length > 0 || !(p.email ?? '').trim();
    }
    return !(p.firstName ?? '').trim() || !(p.lastName ?? '').trim() || !(p.email ?? '').trim();
  }).map(p => p.name);
}

/**
 * Anybody whose passport marker an automated airline booking cannot carry.
 * Duffel takes male or female; an X marker, or somebody who would rather not
 * say, cannot be sent — and choosing one for them is not ours to do.
 */
export function airlineOnly(people: { gender?: string | null }[]): boolean {
  return people.some(p => {
    const g = (p.gender ?? '').trim().toLowerCase();
    return g !== '' && g !== 'male' && g !== 'female';
  });
}

/**
 * Funding, with this booking counted at the price it is about to be bought at.
 *
 * The check used each row's stored price. A rise under the $25 / 5% line is
 * not asked about, so it went through with the group funded for the old
 * fare and Reach paying the difference — and the booking's price then rose
 * to the new one, so the next row in "book everything" was refused 402 after
 * the first was already bought. Counting this row at the higher of the two
 * settles it before anything is bought.
 */
export function fundingAt(
  rows: { id?: unknown; price_cents?: unknown }[] | null | undefined,
  contribs: Contribution[] | null | undefined,
  bookingId: string,
  priceCents: number,
): Funding {
  const at = Math.max(0, Math.round(Number(priceCents) || 0));
  let seen = false;
  const priced = (rows ?? []).map(r => {
    if (String(r.id) !== bookingId) return r;
    seen = true;
    return { ...r, price_cents: Math.max(Number(r.price_cents) || 0, at) };
  });
  if (!seen && at > 0) priced.push({ id: bookingId, price_cents: at });
  return fundingOf(priced, contribs);
}

/**
 * Whether a plan is a trip for one: flagged solo AND a group of one.
 *
 * The flag is set once, at creation, and cleared when somebody joins
 * (afterJoining in lib/joining.ts) — but that clearing is a write that can
 * fail, and the person is let in either way. Trusting the flag alone then
 * priced and booked for one while funding split the total across two: the
 * newcomer paid half of a one-seat booking they were never on. The member
 * count is read wherever the flag is, and a group of two is never solo.
 * planReadiness already counted this way; now quote, the stale check,
 * readiness and approval do too.
 */
export function isSoloPlan(plan: { solo_mode?: unknown }, memberCount: number): boolean {
  return plan.solo_mode === true && !(memberCount > 1);
}

/**
 * Who a plan's bookings are for.
 *
 * A trip for one is its creator's. The quote was sized for one (partySize)
 * and approval named every member — so on a solo trip another member's
 * missing details blocked it, and their passport marker sent the traveller's
 * own flight to the airline. Quote, stale check and approval all read this.
 *
 * `memberCount` is the whole group, before anybody sitting this booking out
 * is taken off: a group of more than one is not a solo trip, whatever the
 * flag still says (isSoloPlan).
 *
 * A solo plan whose creator is gone from the record names nobody, rather
 * than guessing which member it was for.
 */
export function onTheTrip<T extends { userId: string }>(
  plan: { solo_mode?: unknown; created_by?: unknown },
  people: T[],
  memberCount: number,
): T[] {
  if (!isSoloPlan(plan, memberCount)) return people;
  const me = typeof plan.created_by === 'string' && plan.created_by ? plan.created_by : null;
  return me ? people.filter(p => p.userId === me) : [];
}

/**
 * What to tell somebody about a purchase that cannot be booked as it stands,
 * with a way forward that exists. "Price it again from checkout" named a
 * button nobody had built.
 *
 * Hotels and flights are priced again from the trip's itinerary, where each
 * has "See the hotel · change it" / "See the flights · change them" — the
 * options route, which now prices with the provider Reach books through. An
 * activity has no such panel: approval sets the row aside as failed, and the
 * next open of checkout prices its line afresh.
 */
export function repriceAdvice(vertical: string, fromItinerary: boolean): string {
  if (vertical === 'hotel') return 'Open the trip\'s itinerary and use "See the hotel · change it" to price it again.';
  if (vertical === 'flight') return 'Open the trip\'s itinerary and use "See the flights · change them" to price it again.';
  return fromItinerary
    ? 'It has been set aside, and opening checkout again prices it afresh.'
    : 'It has been set aside. Nobody has paid for it, and it can be booked directly with whoever runs it.';
}
