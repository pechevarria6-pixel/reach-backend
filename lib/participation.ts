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
 * flying (lib/away-lines.ts nobodyFlyingLine).
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

/** When each member joined the group; null where it is not recorded. */
export async function memberJoins(db: SupabaseClient, groupId: string): Promise<Map<string, string | null>> {
  const { data, error } = await db.from('group_members').select('user_id, joined_at').eq('group_id', groupId);
  if (error) console.error('[participation] could not read when members joined', { code: error.code });
  return new Map((data || []).map(r => [String(r.user_id), typeof r.joined_at === 'string' ? r.joined_at : null]));
}

/** A row written by a join (lib/joining.ts), not chosen by the member. */
export function joinedLate(skip: { at?: string | null }, joinedAt: string | null | undefined): boolean {
  const a = Date.parse(String(skip.at ?? ''));
  const j = Date.parse(String(joinedAt ?? ''));
  return Number.isFinite(a) && Number.isFinite(j) && a <= j;
}

/**
 * Who is off the group's flights: driving or already holding a seat (their
 * own choice), or kept off for joining after the seats were booked.
 *
 * Flights are one booking per departure airport, so somebody is off only
 * when they are off every one. A flight the group dropped because nobody
 * was on it (lastOut) is cancelled and still counts — everybody on it is
 * driving — so rebuilding the days does not put a flight back. Any other
 * cancelled or failed flight is nothing to be on.
 */
export function whoIsOff(
  flights: { id: unknown; status: unknown }[],
  skips: TimedSkip[],
  memberIds: string[],
  joins: Map<string, string | null> = new Map(),
): { driving: number; late: number } {
  const members = new Set(memberIds);
  const offOf = (ref: string) => new Set(skips.filter(s => s.ref === ref && members.has(s.userId)).map(s => s.userId));
  const ids = new Set<string>();
  for (const f of flights ?? []) {
    const id = String(f.id);
    const status = String(f.status);
    if (status === 'failed') continue;
    if (status === 'cancelled') {
      const off = offOf(id);
      if (!memberIds.length || !memberIds.every(m => off.has(m))) continue;
    }
    ids.add(id);
  }
  if (!ids.size) return { driving: 0, late: 0 };
  let driving = 0;
  let late = 0;
  for (const m of members) {
    const rows = skips.filter(s => s.userId === m && ids.has(s.ref));
    if (new Set(rows.map(r => r.ref)).size !== ids.size) continue;
    if (rows.some(r => joinedLate(r, joins.get(m)))) late++;
    else driving++;
  }
  return { driving, late };
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
