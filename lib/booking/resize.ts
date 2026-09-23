// ─── A quote is for a number of people ──────────────────────────────────
// A flight is priced per seat and a hotel per room, so a quote made when the
// trip was one person is a quote for one person. That stays true after a
// second person joins: the row still says one seat, the total still reads
// one fare, and "Book everything" would buy exactly that.
//
// So the number a quote was made for is compared with the number now going,
// and a quote that no longer fits is replaced rather than handed back. Only
// while nothing has been bought: 'awaiting_approval' is a proposal and
// 'quoted' is one somebody is holding (lib/booking/charged.ts). A booking
// that is confirmed or pending with a provider is somebody's seat, and a
// person who joins later is kept off it instead (lib/joining.ts).
//
// Restaurants, activities and events are left as they are here. A table's
// party size is not what it costs, and an activity's quote carries no
// headcount to compare against.

/** Proposals and held quotes: priced, and nothing bought. */
export const UNBOUGHT: ReadonlySet<string> = new Set(['awaiting_approval', 'quoted']);

/** One room for every two people, rounded up — the rule the bridge has always quoted by. */
export function roomsFor(party: number): number {
  const n = Number.isFinite(party) ? Math.floor(party) : 1;
  return Math.max(1, Math.ceil(Math.max(1, n) / 2));
}

type Payload = Record<string, unknown> | null | undefined;

/** Which field of a request says how many it is for. */
const SIZED: Record<string, 'seats' | 'rooms'> = { flight: 'seats', hotel: 'rooms' };
function sizedField(vertical: unknown): 'seats' | 'rooms' | null {
  return SIZED[String(vertical)] ?? null;
}

/**
 * How many seats a flight request is for, or rooms a hotel request is for.
 *
 * Null for anything not sized that way. `fallback` is used when the field is
 * absent: 1 for a stored row, because that is what both providers priced an
 * absent field as (`seats || 1`, `rooms || 1`); null for an incoming request,
 * because a request that does not say cannot be said to disagree.
 */
export function sizeOf(req: Payload, fallback: number | null = 1): number | null {
  if (!req || typeof req !== 'object') return null;
  const field = sizedField(req.vertical);
  if (!field) return null;
  const part = req[req.vertical as string] as Record<string, unknown> | undefined;
  if (!part || typeof part !== 'object') return null;
  const n = Number(part[field]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** What a flight or hotel for `party` people should be sized at. */
export function sizeFor(vertical: unknown, party: number): number | null {
  const field = sizedField(vertical);
  if (!field) return null;
  return field === 'seats' ? Math.max(1, Math.floor(party) || 1) : roomsFor(party);
}

/**
 * How many people one booking is for: everybody going, less the members who
 * are not on it. Somebody who joined after it was paid for is recorded as
 * not on it (lib/joining.ts), so a paid-for room for one stays a room for one.
 * Skips by people no longer in the group count for nothing.
 */
export function partyFor(
  party: number, memberIds: string[], skips: { ref: string; userId: string }[], ref: string,
): number {
  const members = new Set(memberIds);
  const off = new Set(skips.filter(s => s.ref === ref && members.has(s.userId)).map(s => s.userId));
  return Math.max(1, Math.floor(party) - off.size);
}

/**
 * A quote made for a different number of people than it is now for, and
 * still unbought — so it can be re-priced rather than bought wrong.
 */
export function isStaleForParty(
  row: { status?: string | null; request_payload?: unknown }, party: number,
): boolean {
  if (!UNBOUGHT.has(String(row.status ?? ''))) return false;
  const req = row.request_payload as Payload;
  const have = sizeOf(req);
  const want = sizeFor(req?.vertical, party);
  return have !== null && want !== null && have !== want;
}

/**
 * The same request, sized for `party`. Everything that pins what was chosen —
 * the hotel's id, the flight's numbers — is kept, so re-pricing for two is
 * the same room and the same flights, not whatever a fresh search finds.
 * Nobody is named at quote time, so travellers go.
 */
export function resized<T extends Record<string, unknown>>(req: T, party: number): T {
  const field = sizedField(req.vertical);
  const want = sizeFor(req.vertical, party);
  const part = req[req.vertical as string] as Record<string, unknown> | undefined;
  if (!field || want === null || !part || typeof part !== 'object') return req;
  return { ...req, travelers: [], [req.vertical as string]: { ...part, [field]: want } };
}

/**
 * The requests that re-price whatever on a plan was quoted for a different
 * number of people than are now going on it — each sized for its own party,
 * less anybody kept off that booking. Nothing once somebody has paid
 * (`paid`): what they paid against is the total, and it does not move.
 */
export function repricing<T = Record<string, unknown>>(
  rows: { id?: unknown; status?: string | null; request_payload?: unknown }[],
  opts: { party: number; memberIds: string[]; skips: { ref: string; userId: string }[]; paid: boolean },
): T[] {
  if (opts.paid) return [];
  const out: T[] = [];
  for (const b of rows ?? []) {
    if (b?.id == null || !b.request_payload || typeof b.request_payload !== 'object') continue;
    const party = partyFor(opts.party, opts.memberIds, opts.skips, String(b.id));
    if (!isStaleForParty(b, party)) continue;
    out.push(resized(b.request_payload as Record<string, unknown>, party) as T);
  }
  return out;
}
