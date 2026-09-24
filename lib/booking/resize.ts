// ─── A quote is for a number of people ──────────────────────────────────
// A flight is priced per seat and a hotel per room, so a quote made when the
// trip was one person is a quote for one person. That stays true after a
// second person joins: the row still says one seat, the total still reads
// one fare, and "Book everything" would buy exactly that.
//
// So the number a quote was made for is compared with the number now going,
// and a quote that no longer fits is priced again rather than handed back.
//
// One decision, read everywhere. Which rows are stale is staleForParty in
// lib/booking/party.ts, judged per booking against partyFor below — the group
// less anybody kept off that booking, which is exactly who approval names
// (travellersFor, then partyChange). Funding refuses money against a stale
// row with that same call, and /bookable, the hold route and /api/bookings
// price one again with it. Two rules for "stale" is how a plan ends up
// refused at payment for something the re-pricer thinks is fine.
//
// Only a proposal ('awaiting_approval') is ever re-priced on its own. A held
// quote ('quoted') is somebody deliberately keeping that price; it is out of
// every money sum (lib/booking/charged.ts), so a stale one costs nobody
// anything, and it is priced again the moment it is let go (the hold route).
// A booking that is confirmed or pending with a provider is somebody's seat,
// and a person who joins later is kept off it instead (lib/joining.ts).
//
// Restaurants, activities and events are left as they are here. A table's
// party size is not what it costs, and an activity's quote carries no
// headcount to compare against.
import { roomsFor, staleForParty, sizedFor } from './party.ts';
import { identityOf, LIVE } from './duplicate.ts';
import { midClaim } from './claim.ts';

export { roomsFor };

/** What is priced per head: seats, and rooms at two to a room. */
const SIZED_BY_HEAD: ReadonlySet<string> = new Set(['flight', 'hotel']);

type Skip = { ref: string; userId: string };
type Payload = Record<string, unknown> | null | undefined;

/**
 * How many people one booking is for: everybody going, less the members who
 * are not on it. Somebody who joined after it was paid for is recorded as
 * not on it (lib/joining.ts), so a paid-for room for one stays a room for one.
 * Skips by people no longer in the group count for nothing.
 */
export function partyFor(party: number, memberIds: string[], skips: Skip[], ref: string): number {
  const members = new Set(memberIds);
  const off = new Set(skips.filter(s => s.ref === ref && members.has(s.userId)).map(s => s.userId));
  return Math.max(1, Math.floor(party) - off.size);
}

/**
 * Rooms for `party` people, given the rooms it had. More rooms than before
 * are never taken away from a group that grew, but a hotel will not sell an
 * empty room, so there are never more rooms than people.
 */
export function roomsAt(had: unknown, party: number): number {
  const before = Number.isFinite(Number(had)) && Number(had) >= 1 ? Math.floor(Number(had)) : 1;
  const people = Math.max(1, Math.floor(party) || 1);
  return Math.min(Math.max(before, roomsFor(people)), people);
}

/**
 * The same request, sized for `party`. Everything that pins what was chosen —
 * the hotel's id, the flight's numbers — is kept, so re-pricing for two is
 * the same room and the same flights, not whatever a fresh search finds.
 * Nobody is named at quote time, so travellers go.
 *
 * `party` is written as well as seats or rooms: it is what approval compares
 * a hotel against (partyChange), and a room re-sized without it still said
 * "one" and was refused as priced for a different party for good.
 */
export function resized<T extends Record<string, unknown>>(req: T, party: number): T {
  const vertical = String(req.vertical ?? '');
  const part = req[vertical] as Record<string, unknown> | undefined;
  const sizedByHead = SIZED_BY_HEAD.has(vertical);
  if (!part || typeof part !== 'object' || !sizedByHead) return req;
  const n = Math.max(1, Math.floor(party) || 1);
  const sized = vertical === 'flight' ? { ...part, seats: n } : { ...part, rooms: roomsAt(part.rooms, n) };
  return { ...req, travelers: [], party: n, [vertical]: sized };
}

type Row = {
  id?: unknown; vertical?: unknown; status?: unknown; mode?: unknown;
  request_payload?: unknown; approved_at?: unknown; updated_at?: unknown;
};

/**
 * The flights and hotels on a plan that were priced for a different number
 * of people than are now on them. Funding refuses to take money while any
 * are left; everything else here prices them again.
 */
export function staleOnPlan<T extends Row>(
  rows: T[] | null | undefined, opts: { party: number; memberIds: string[]; skips: Skip[] },
): T[] {
  return staleForParty(rows, r => partyFor(opts.party, opts.memberIds, opts.skips, String(r.id)));
}

/**
 * The requests that price again whatever on a plan is stale, each sized for
 * its own party. Nothing once somebody has paid (`paid`): what they paid
 * against is the total, and it does not move. Nothing mid-booking: an
 * approval is at the provider with it.
 */
export function repricing<T = Record<string, unknown>>(
  rows: Row[] | null | undefined,
  opts: { party: number; memberIds: string[]; skips: Skip[]; paid: boolean },
): T[] {
  if (opts.paid) return [];
  return staleOnPlan(rows, opts)
    .filter(r => !midClaim(r) && r.request_payload && typeof r.request_payload === 'object')
    .map(r => resized(r.request_payload as Record<string, unknown>,
      partyFor(opts.party, opts.memberIds, opts.skips, String(r.id))) as T);
}

/**
 * The size a request says it is for: `party`, else a flight's seats. Null
 * when it does not say, and a request that does not say is never taken as
 * asking for a re-price.
 */
export function requestSize(item: Payload): number | null {
  if (!item || typeof item !== 'object') return null;
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 1 ? Math.floor(Number(v)) : null);
  const part = item[String(item.vertical ?? '')] as Record<string, unknown> | undefined;
  return n(item.party) ?? (item.vertical === 'flight' ? n(part?.seats) : null);
}

export type Match<T> =
  | { kind: 'new' }
  /** Already on the list: hand this back rather than making another. */
  | { kind: 'twin'; row: T }
  /** On the list, stale, and this request asks for exactly the right size: price that row again. */
  | { kind: 'stale'; row: T; party: number };

/**
 * What POST /api/bookings does with a request for something the plan already
 * has. `expectedFor` is the route's own count of who is on each booking
 * (partyFor), never the request's: any member can post a flight with
 * `seats: 9`, and before this that retired the quote and wrote a nine-seat
 * one into everybody's share. Null when that count could not be read, and
 * then nothing is re-priced on a guess.
 *
 * In order:
 *   1. a live row of the right size, or one that is bought, held or
 *      mid-booking, is handed back — it wins over re-pricing a stale twin;
 *   2. a stale proposal is priced again only when the request asks for
 *      exactly the number the route counts for it;
 *   3. anything else is handed back as it is.
 *
 * Whether anybody has paid is the caller's to settle, and again just before
 * it writes: this is only what the rows say.
 */
export function matchFor<T extends Row>(
  existing: T[] | null | undefined, item: Payload, expectedFor: ((row: T) => number) | null,
): Match<T> {
  const wanted = identityOf(item ?? null);
  if (!wanted) return { kind: 'new' };
  const same = (existing ?? []).filter(r =>
    LIVE.has(String(r.status ?? '')) && identityOf(r.request_payload as Payload) === wanted);
  if (!same.length) return { kind: 'new' };
  const stale = expectedFor
    ? new Set(staleForParty(same, expectedFor).filter(r => !midClaim(r)))
    : new Set<T>();
  const fits = same.find(r => !stale.has(r));
  if (fits) return { kind: 'twin', row: fits };
  const row = same[0];
  const party = expectedFor!(row);
  return requestSize(item) === party ? { kind: 'stale', row, party } : { kind: 'twin', row };
}

/** What a row was priced for, for a sentence. */
export function pricedFor(row: Row): number | null {
  return sizedFor(row);
}
