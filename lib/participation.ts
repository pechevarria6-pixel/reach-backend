// ─── Who is sitting what out ─────────────────────────────────────────────
// Read by every route that says what somebody owes — funding, participation,
// the reminder email and the ledger — so none of them can quietly forget it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { canSkip, type Skip } from './money.ts';
import { isSoloPlan } from './booking/approval.ts';
import { sizedFor } from './booking/party.ts';

/** PostgREST's code for a table that does not exist: the migration has not run. */
const NO_TABLE = 'PGRST205';

export async function readSkips(db: SupabaseClient, planId: string): Promise<{ skips: Skip[]; ready: boolean }> {
  const { data, error } = await db.from('item_optouts').select('item_ref, user_id').eq('plan_id', planId);
  // Before sql/preferences-v1.sql runs there is nobody sitting anything out,
  // and every share splits evenly, exactly as it did before this existed.
  if (error?.code === NO_TABLE) return { skips: [], ready: false };
  if (error) {
    // Charging somebody for a dinner they sat out is worse than refusing to
    // charge at all, so a failed read stops the caller rather than reading as
    // "nobody skipped anything".
    console.error('[participation] could not read who is sitting what out', { planId, error: error.message });
    throw new Error('Could not read who is sitting what out');
  }
  return {
    skips: (data || []).map(r => ({ ref: String(r.item_ref), userId: String(r.user_id) })),
    ready: true,
  };
}

export async function planSkips(db: SupabaseClient, planId: string): Promise<Skip[]> {
  return (await readSkips(db, planId)).skips;
}


/**
 * How many people a plan is for. plans.participants was read for this and is
 * not a column, so every plan was two people: a solo trip quoted two seats,
 * a group of four quoted two. One for a solo plan, otherwise the group.
 *
 * It must agree with who approval names — onTheTrip in
 * lib/booking/approval.ts, a solo plan's creator alone while the group is
 * one person — or every flight and
 * hotel on the plan is refused as priced for a different party, for good.
 * Change one, change both; tests/unit/booking-path.test.ts holds them together.
 */
export async function partySize(
  db: SupabaseClient, plan: { group_id?: unknown; solo_mode?: boolean | null },
): Promise<number> {
  const { count, error } = await db.from('group_members')
    .select('user_id', { count: 'exact', head: true }).eq('group_id', String(plan.group_id));
  if (error) console.error('[participation] could not count the group', { code: error.code });
  // Solo only while the group is one person (isSoloPlan): a flag nobody
  // cleared after a join priced for one while funding split between two.
  if (isSoloPlan(plan, count ?? 1)) return 1;
  return Math.max(1, count ?? 1);
}

// ─── "I'll drive / already have a flight" ────────────────────────────────
// Owner decision 8 (2026-09-25): somebody driving, or already holding a
// seat, comes off the group's flight — never the flight off the plan. It is
// an item_optouts row on the flight booking, the same row a skipped dinner
// is, so partyFor (lib/booking/resize.ts) prices the flight again for the
// people still on it and sharesWithSkips splits that fare among them only.
// The generator counts it too (drivingCount: "N flying, M driving").
//
// Somewhere to stay is still the trip: a room is shared, and one person
// leaving does not make it cheaper for anybody else.
//
// Like every opt-out it closes the moment anybody pays — and a seat that is
// held or bought is somebody's seat, so only a proposed flight can lose one.

/** What somebody can come off: a dinner, a show, a day out — or the flight. */
export function canOptOut(vertical: unknown): boolean {
  return canSkip(vertical) || vertical === 'flight';
}

/**
 * A flight nobody holds or has bought a seat on: a proposal, or a quote the
 * group is holding back with Hold ('quoted'). A held quote is the group
 * waiting on a price, not seats in anybody's name — it is out of every money
 * sum (lib/booking/charged.ts), and it is priced again for whoever is flying
 * the moment it is let go (lib/booking/resize.ts). Refusing a driver there
 * said "the seats are already held" when none were.
 */
export const FLIGHT_OPEN: ReadonlySet<string> = new Set(['awaiting_approval', 'quoted']);

export interface OptOutAsk {
  vertical: unknown;
  status: unknown;
  anyonePaid: boolean;
}

/**
 * Why sitting this out (or coming back in) is refused, or null when it may
 * go ahead. The last person off a booking is the route's to check, since it
 * needs the group (lastOut).
 */
export function optOutRefusal(a: OptOutAsk): { status: number; error: string } | null {
  if (!canOptOut(a.vertical)) {
    return { status: 400, error: "Everyone's in for somewhere to stay." };
  }
  if (a.anyonePaid) {
    return { status: 409, error: "Someone has already paid, so who's in for what is set now." };
  }
  if (a.vertical === 'flight' && !FLIGHT_OPEN.has(String(a.status))) {
    return { status: 409, error: 'This flight is already being booked or is booked, so who is flying is set now.' };
  }
  return null;
}

/**
 * What happens when the last person comes off a booking.
 *
 * A dinner nobody goes to is still paid for, by everybody, so the last
 * person in cannot leave it. A flight is different: nobody has a seat on an
 * open one (optOutRefusal let it through), and with nobody flying there is
 * nothing to buy. Refusing — "someone has to be on this flight" — kept a
 * flight on the plan for a group that was all driving and charged its fare
 * to people with no seat on it. So the flight comes off the plan
 * ('drop_flight'): the booking is cancelled and its line says nobody is
 * flying (lib/away-lines.ts nobodyFlyingLine). It ends the flight for
 * everybody, so it is asked first (wouldDropFlight, DROP_WARNING), and it
 * is not for good: "I'm flying" puts it back until anybody pays.
 */
export function lastOut(vertical: unknown): { action: 'drop_flight' } | { action: 'refuse'; error: string } {
  return vertical === 'flight'
    ? { action: 'drop_flight' }
    : { action: 'refuse', error: 'Someone has to be in for this one.' };
}

// ─── Who chose to be off, and who was kept off ───────────────────────────
// item_optouts holds both: a driver who came off the flight, and somebody
// lib/joining.ts kept off seats bought before they joined. They are not the
// same sentence. "You're driving or have a flight" said of somebody who only
// joined late is a fact about them nobody gave us.
//
// The rows say which. beforeJoining writes a newcomer's rows before their
// membership row exists, so a row no later than the member's joined_at is a
// join's; anybody choosing for themselves is a member already.

export type TimedSkip = Skip & { at: string | null };

export async function readTimedSkips(db: SupabaseClient, planId: string): Promise<TimedSkip[]> {
  const { data, error } = await db.from('item_optouts').select('item_ref, user_id, created_at').eq('plan_id', planId);
  if (error?.code === NO_TABLE) return [];
  if (error) {
    console.error('[participation] could not read who is sitting what out', { planId, error: error.message });
    throw new Error('Could not read who is sitting what out');
  }
  return (data || []).map(r => ({
    ref: String(r.item_ref), userId: String(r.user_id),
    at: typeof r.created_at === 'string' ? r.created_at : null,
  }));
}

/**
 * When each member joined the group; null where it is not recorded.
 *
 * Throws when it cannot be read. An empty map here read as "nobody joined
 * late", so every latecomer on a booked flight was told they were driving,
 * and funding put "✓ In" beside somebody with no seat — while each caller's
 * own "say nothing when it can't be read" fallback never ran.
 */
export async function memberJoins(db: SupabaseClient, groupId: string): Promise<Map<string, string | null>> {
  const { data, error } = await db.from('group_members').select('user_id, joined_at').eq('group_id', groupId);
  if (error) {
    console.error('[participation] could not read when members joined', { code: error.code });
    throw new Error('Could not read when members joined');
  }
  return new Map((data || []).map(r => [String(r.user_id), typeof r.joined_at === 'string' ? r.joined_at : null]));
}

/** A row written by a join (lib/joining.ts), not chosen by the member. */
export function joinedLate(skip: { at?: string | null }, joinedAt: string | null | undefined): boolean {
  const a = Date.parse(String(skip.at ?? ''));
  const j = Date.parse(String(joinedAt ?? ''));
  return Number.isFinite(a) && Number.isFinite(j) && a <= j;
}

// ─── A flight taken off because nobody was flying ────────────────────────
// The last person off a flight takes it off the plan (lastOut). That is
// recorded on the booking itself — cancelled, with `nobody_flying` in its
// request_payload holding what it was and the lines it took with it — and
// never inferred from opt-out rows. Inferred, it broke twice: a friend who
// joined afterwards has no row on a cancelled booking, and two drivers at
// once had the loser's row taken back, and either way the next rebuild put
// a flight back for everybody. The record is also the way back: anybody can
// say "I'm flying" until somebody pays, and the flight and its lines return.

export interface DroppedFlight {
  /** The status it was cancelled from, and is reopened to. */
  from: string;
  /** The flight's own line, and what it said before it said nobody was flying. */
  item_id: string | null;
  line: Record<string, unknown> | null;
  /** The lines that only made sense with a flight — the rental car from the airport, the transfers. */
  removed: Record<string, unknown>[];
  at: string;
}

/** The record dropFlight leaves on a flight booking, or null when it is not one. */
export function droppedFlight(b: { vertical?: unknown; status?: unknown; request_payload?: unknown }): DroppedFlight | null {
  if (b.vertical !== undefined && b.vertical !== 'flight') return null;
  if (String(b.status) !== 'cancelled') return null;
  const req = b.request_payload;
  if (!req || typeof req !== 'object') return null;
  const mark = (req as { nobody_flying?: unknown }).nobody_flying;
  if (!mark || typeof mark !== 'object') return null;
  const m = mark as Partial<DroppedFlight>;
  return {
    from: FLIGHT_OPEN.has(String(m.from)) ? String(m.from) : 'awaiting_approval',
    item_id: typeof m.item_id === 'string' ? m.item_id : null,
    line: m.line && typeof m.line === 'object' ? m.line as Record<string, unknown> : null,
    removed: Array.isArray(m.removed) ? m.removed.filter(r => r && typeof r === 'object') as Record<string, unknown>[] : [],
    at: typeof m.at === 'string' ? m.at : '',
  };
}

/**
 * Whether tapping "I'll drive" here takes the flight off the plan for
 * everybody — said before it happens, and only done when they confirm it.
 */
export function wouldDropFlight(vertical: unknown, memberIds: string[], offAfter: Set<string>): boolean {
  return vertical === 'flight' && memberIds.length > 0 && memberIds.every(id => offAfter.has(id));
}

export const DROP_WARNING = "You're the last one flying. Coming off takes the flight off the plan for everyone — anyone can put it back with \u201cI'm flying\u201d until somebody pays.";

/**
 * Who is not flying: off every flight still on the plan. A flight taken off
 * because nobody was flying counts as off for everybody. Empty when there is
 * no flight on the plan at all — then nobody is anything.
 */
export function offEveryFlight(
  flights: { id: unknown; status: unknown; vertical?: unknown; request_payload?: unknown }[],
  skips: { ref: string; userId: string }[],
  memberIds: string[],
): Set<string> {
  const live = (flights ?? []).filter(f => !['failed', 'cancelled'].includes(String(f.status))).map(f => String(f.id));
  const dropped = (flights ?? []).some(f => droppedFlight({ ...f, vertical: 'flight' }));
  if (!live.length) return dropped ? new Set(memberIds) : new Set();
  const off = new Set(skips.map(s => `${s.ref}|${s.userId}`));
  return new Set(memberIds.filter(m => live.every(ref => off.has(`${ref}|${m}`))));
}

/**
 * Who is off the group's flights: driving or already holding a seat (their
 * own choice), or kept off for joining after the seats were booked — and
 * whether nobody is flying at all.
 *
 * Flights are one booking per departure airport, so somebody is off only
 * when they are off every one. A flight taken off because nobody was on it
 * (droppedFlight) is off for everybody, whoever joined since, so a rebuild
 * never puts it back; `nobodyFlying` says so, and the people counted as
 * driving are only those who said they were. Any other cancelled or failed
 * flight is nothing to be on.
 */
export function whoIsOff(
  flights: { id: unknown; status: unknown; request_payload?: unknown }[],
  skips: TimedSkip[],
  memberIds: string[],
  joins: Map<string, string | null> = new Map(),
): { driving: number; late: number; nobodyFlying: boolean } {
  const members = new Set(memberIds);
  const live = new Set<string>();
  const dropped = new Set<string>();
  for (const f of flights ?? []) {
    const id = String(f.id);
    const status = String(f.status);
    if (status === 'failed') continue;
    if (status === 'cancelled') {
      if (droppedFlight({ ...f, vertical: 'flight' })) dropped.add(id);
      continue;
    }
    live.add(id);
  }
  if (!live.size && !dropped.size) return { driving: 0, late: 0, nobodyFlying: false };
  // What decides it: the flights still on the plan, or — with none left —
  // the one that was taken off, for who said what about it.
  const ids = live.size ? live : dropped;
  let driving = 0;
  let late = 0;
  for (const m of members) {
    const rows = skips.filter(s => s.userId === m && ids.has(s.ref));
    if (new Set(rows.map(r => r.ref)).size !== ids.size) continue;
    if (rows.some(r => joinedLate(r, joins.get(m)))) late++;
    else driving++;
  }
  return { driving, late, nobodyFlying: !live.size };
}

/**
 * What a flight costs the people still on it. A proposal priced for more
 * seats than are flying now is worked out from its own per-seat price —
 * the quote's, not a guess — and marked, until checkout quotes it again.
 */
export function flightNow(
  b: { vertical: unknown; status: unknown; price_cents?: number | null; request_payload?: unknown },
  flying: number,
): { priceCents: number; repriced: boolean } {
  const price = b.price_cents || 0;
  if (b.vertical !== 'flight' || b.status !== 'awaiting_approval') return { priceCents: price, repriced: false };
  const seats = sizedFor(b);
  if (seats === null || seats < 1 || seats === flying || flying < 1) return { priceCents: price, repriced: false };
  return { priceCents: Math.round(price / seats) * flying, repriced: true };
}
