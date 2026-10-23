// ─── Who is sitting what out ─────────────────────────────────────────────
// Read by every route that says what somebody owes — funding, participation,
// the reminder email and the ledger — so none of them can quietly forget it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { canSkip, type Skip } from './money.ts';
import { isSoloPlan } from './booking/approval.ts';

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

/** A flight still only proposed: nobody holds or has bought a seat on it. */
const FLIGHT_OPEN = new Set(['awaiting_approval']);

export interface OptOutAsk {
  vertical: unknown;
  status: unknown;
  anyonePaid: boolean;
}

/**
 * Why sitting this out (or coming back in) is refused, or null when it may
 * go ahead. The last person off a booking is the route's to check, since it
 * needs the group.
 */
export function optOutRefusal(a: OptOutAsk): { status: number; error: string } | null {
  if (!canOptOut(a.vertical)) {
    return { status: 400, error: "Everyone's in for somewhere to stay." };
  }
  if (a.anyonePaid) {
    return { status: 409, error: "Someone has already paid, so who's in for what is set now." };
  }
  if (a.vertical === 'flight' && !FLIGHT_OPEN.has(String(a.status))) {
    return { status: 409, error: 'The seats on this flight are already held, so who is flying is set now.' };
  }
  return null;
}

/** Said when the last person tries to leave a booking. */
export function lastOneOut(vertical: unknown): string {
  return vertical === 'flight'
    ? "Someone has to be on this flight, so the last person on it can't come off."
    : 'Someone has to be in for this one.';
}
