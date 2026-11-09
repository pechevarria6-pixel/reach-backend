// ─── Who deleted which plan, and what it held ────────────────────────────
// REACH-PILOT-GATE-2026-11-08.md §A4: an audit row on DELETE /api/plans/*.
// audit_logs already gets a line; this is the record somebody can answer
// "where did our trip go?" from — the title, the status it was in, how many
// bookings and payments it had, and the plan row itself as it was.
//
// public.plan_deletions arrives in sql/pilot-gate-2026-11-08.sql. Until that
// has run, the insert is refused with PGRST205 / 42P01; that is logged and
// the delete goes on — the table being late must never stop somebody tidying
// up their own trip.
import { schemaPending } from './stamp.ts';

export interface DeletionInput {
  planId: string;
  deletedBy: string;
  plan: Record<string, unknown>;
  bookings: number;
  contributions: number;
  itinerary?: { type?: unknown; title?: unknown; booking_mode?: unknown }[] | null;
}

/** The row written. Pure, so what is kept can be tested. */
export function deletionRow(i: DeletionInput): Record<string, unknown> {
  const p = i.plan;
  return {
    plan_id: i.planId,
    group_id: p.group_id ?? null,
    deleted_by: i.deletedBy,
    title: typeof p.title === 'string' ? p.title : null,
    status: typeof p.status === 'string' ? p.status : null,
    bookings: Math.max(0, Math.floor(i.bookings || 0)),
    contributions: Math.max(0, Math.floor(i.contributions || 0)),
    snapshot: {
      plan: p,
      // What the days were, not every column of them: enough to recognise
      // the trip and rebuild it by hand.
      itinerary: (i.itinerary ?? []).map(l => ({ type: l.type ?? null, title: l.title ?? null, booking_mode: l.booking_mode ?? null })),
    },
  };
}

type Db = {
  from: (t: string) => {
    insert: (v: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
  };
};

/** 'written', 'pending' (table not there yet) or 'failed'. Never throws. */
export async function recordPlanDeletion(db: Db, input: DeletionInput): Promise<'written' | 'pending' | 'failed'> {
  try {
    const { error } = await db.from('plan_deletions').insert(deletionRow(input));
    if (!error) return 'written';
    if (schemaPending(error)) {
      console.error('[audit] plan_deletions is not there yet — run sql/pilot-gate-2026-11-08.sql', { plan: input.planId, code: error.code });
      return 'pending';
    }
    console.error('[audit] could not record the plan deletion', { plan: input.planId, code: error.code });
    return 'failed';
  } catch (e) {
    console.error('[audit] could not record the plan deletion', { plan: input.planId, error: e instanceof Error ? e.message : String(e) });
    return 'failed';
  }
}
