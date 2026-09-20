// ─── Replacing an itinerary without a moment where it does not exist ────
// Saving days deleted every existing row and then inserted the new ones.
// Two failures sit between those halves and neither said anything: a delete
// that worked followed by an insert that did not is an itinerary gone, and a
// delete that failed followed by an insert that worked is every day twice.
//
// PostgREST gives no transaction to wrap them in, so the order changes
// instead. New days go in first and live alongside the old ones for a
// moment; only once they are stored are the old ones removed, named by the
// exact ids read before the insert.
//
// That makes both failures survivable, in opposite directions:
//
//   insert fails  nothing was removed — the itinerary is as it was
//   delete fails  the days are doubled: visible, annoying, and fixed by
//                 saving again, which a wipe is not
//
// The order is the whole fix, which is why it lives here with a test that
// fails if anybody puts the delete back in front.
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReplaceOutcome =
  /** New days stored, old ones gone. */
  | { status: 'replaced'; removed: number }
  /** Nothing was written and nothing was removed. */
  | { status: 'insert_failed'; detail: string }
  /** New days are stored; the old ones are still showing beside them. */
  | { status: 'duplicated'; stale: number }
  /** Could not even read what is there, so nothing was touched. */
  | { status: 'unreadable'; detail: string };

/** Inserts the rows, returning an error message or null. */
export type InsertRows = (rows: Record<string, unknown>[]) => Promise<string | null>;

export async function replaceItinerary(
  db: SupabaseClient,
  planId: string,
  rows: Record<string, unknown>[],
  insert: InsertRows,
): Promise<ReplaceOutcome> {
  const { data: existing, error: readOld } = await db
    .from('itinerary_items').select('id').eq('plan_id', planId);
  if (readOld) {
    return { status: 'unreadable', detail: readOld.message || 'could not read the current days' };
  }
  const oldIds = (existing ?? []).map(r => (r as { id: string }).id);

  if (rows.length) {
    const failed = await insert(rows);
    // Nothing has been removed at this point, by design.
    if (failed) return { status: 'insert_failed', detail: failed };
  }

  if (!oldIds.length) return { status: 'replaced', removed: 0 };

  // Named by id rather than by plan, so a row written since this began
  // cannot be swept up by it.
  const { error: swept } = await db.from('itinerary_items').delete().in('id', oldIds);
  if (swept) return { status: 'duplicated', stale: oldIds.length };

  return { status: 'replaced', removed: oldIds.length };
}

/** What to tell somebody, per outcome. Never "something went wrong". */
export function outcomeMessage(outcome: ReplaceOutcome): string | null {
  switch (outcome.status) {
    case 'replaced': return null;
    case 'insert_failed':
      return 'Could not save those days — the ones you had are still there.';
    case 'duplicated':
      return "Your days are saved, but the old ones are still showing too. Save again and we'll clear them.";
    case 'unreadable':
      return "We couldn't save those days just now.";
  }
}
