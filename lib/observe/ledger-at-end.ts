// ─── Who still owes whom, once the trip is over ──────────────────────────
// "Zero post-trip IOUs" (business model §3) is the claim that a trip run
// through Reach ends with nobody chasing anybody for money. The ledger that
// would prove it is computed, not stored: lib/ledger.ts works the balances
// out from expenses, the pot, who sat what out and what has been marked
// paid, every time somebody opens it. Rewriting that in SQL would be a
// second ledger that disagrees with the first in some case nobody tested.
//
// So the same ledger is read once, the day after a trip's last day, and what
// it said is written down as a `ledger_at_trip_end` event: how many lines
// were still open and for how much. A plan with no open lines is a trip that
// ended square. Counts and cents only — never who owes whom.
//
// Run by a daily job (see docs/pilot/METRICS.md for where it is called
// from). Idempotent per plan: a plan that already has the event is skipped,
// so a job run twice in a day, or two runs at once, records it at most once
// in the ordinary case. Two runs racing could both write — the event is
// evidence, not money, and the view reads the earliest.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadLedger, type Ledger } from '../ledger.ts';
import { dayWhere } from '../calendar.ts';
import { track } from '../track.ts';

export interface EndingPlan {
  id: string;
  group_id: string;
  start_date: string | null;
  end_date: string | null;
  destination_lng: number | null;
  status: string | null;
  budget_cents?: unknown;
  [k: string]: unknown;
}

/** How far back a missed run catches up. Older trips are not backfilled. */
export const CATCH_UP_DAYS = 14;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v: unknown) => (typeof v === 'string' && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/**
 * The trip's last day, as its own calendar has it: the end date, or the start
 * for a night out. An end before the start is a typo, read as the start.
 */
export function lastDayOf(plan: Pick<EndingPlan, 'start_date' | 'end_date'>): string | null {
  const start = dayOf(plan.start_date);
  const end = dayOf(plan.end_date);
  if (end && (!start || end >= start)) return end;
  return start;
}

/**
 * Over once its last day has passed where the trip was — not in Greenwich,
 * where a New York evening is already tomorrow (lib/calendar.ts dayWhere).
 */
export function isOver(plan: EndingPlan, now: Date = new Date()): boolean {
  const last = lastDayOf(plan);
  if (!last) return false;
  return last < dayWhere(plan.destination_lng, now);
}

/** What goes in the event. A solo plan has nobody to owe and says so. */
export function ledgerSummary(ledger: Pick<Ledger, 'lines' | 'solo' | 'members'>): Record<string, unknown> {
  const open = (ledger.lines ?? []).filter(l => Number(l.amountCents) > 0);
  return {
    open_lines: open.length,
    open_cents: open.reduce((s, l) => s + Number(l.amountCents), 0),
    members: (ledger.members ?? []).length,
    solo: !!ledger.solo,
  };
}

export interface CloseReport { checked: number; recorded: number; skipped: number; failed: number }

/**
 * Record the ledger for every trip that ended in the last CATCH_UP_DAYS and
 * has not been recorded yet. `load` is the real ledger; a test passes its own.
 */
export async function recordLedgersAtTripEnd(
  db: SupabaseClient,
  now: Date = new Date(),
  load: (db: SupabaseClient, plan: EndingPlan) => Promise<Pick<Ledger, 'lines' | 'solo' | 'members'>> = loadLedger as never,
): Promise<CloseReport> {
  const report: CloseReport = { checked: 0, recorded: 0, skipped: 0, failed: 0 };
  // A day either side of the window, because "over" is decided per plan in
  // its own zone below and the server's date is not that.
  const from = new Date(now.getTime() - (CATCH_UP_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);

  const { data: plans, error } = await db.from('plans')
    .select('id, group_id, start_date, end_date, destination_lng, status, budget_cents, type')
    .neq('status', 'cancelled')
    .gte('start_date', from)
    .lte('start_date', to);
  if (error) {
    console.error('[ledger-at-end] could not read plans', { code: error.code });
    report.failed++;
    return report;
  }

  // Trips longer than the window started before `from`, so they are found by
  // their end date as well.
  const { data: longer, error: longerErr } = await db.from('plans')
    .select('id, group_id, start_date, end_date, destination_lng, status, budget_cents, type')
    .neq('status', 'cancelled')
    .gte('end_date', from)
    .lte('end_date', to);
  if (longerErr) console.error('[ledger-at-end] could not read plans by end date', { code: longerErr.code });

  const byId = new Map<string, EndingPlan>();
  for (const p of [...(plans ?? []), ...(longer ?? [])] as EndingPlan[]) byId.set(String(p.id), p);
  const ended = [...byId.values()].filter(p => {
    const last = lastDayOf(p);
    return isOver(p, now) && !!last && last >= from;
  });
  report.checked = ended.length;
  if (!ended.length) return report;

  const { data: seen, error: seenErr } = await db.from('events')
    .select('plan_id')
    .eq('name', 'ledger_at_trip_end')
    .in('plan_id', ended.map(p => p.id));
  if (seenErr) {
    // Not knowing which are done would write every one again tomorrow.
    console.error('[ledger-at-end] could not read what is already recorded', { code: seenErr.code });
    report.failed++;
    return report;
  }
  const done = new Set((seen ?? []).map(r => String(r.plan_id)));

  for (const plan of ended) {
    if (done.has(String(plan.id))) { report.skipped++; continue; }
    try {
      const ledger = await load(db, plan);
      await track(db, 'ledger_at_trip_end', {
        groupId: String(plan.group_id), planId: String(plan.id),
        props: { ...ledgerSummary(ledger), last_day: lastDayOf(plan) },
      });
      report.recorded++;
    } catch (e) {
      // One unreadable ledger is that plan's problem, not the run's.
      console.error('[ledger-at-end] could not read a ledger', { plan: plan.id, error: e instanceof Error ? e.message : 'unknown' });
      report.failed++;
    }
  }
  return report;
}
