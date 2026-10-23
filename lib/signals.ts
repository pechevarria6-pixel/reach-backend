// ─── Taste signals: the rows we already hold, read as one list ──────────
// There is no signals table. Owner decision 20: every signal the taste
// profile learns from is already a row somewhere (votes, vetoes, feedback,
// bookings, the quiz), so a second, append-only copy would be a second record
// of each fact that could disagree with the first. The view
// v_taste_signals (sql/user-taste-profile-2026-09-25.sql) unions them; this
// file reads it, and lib/taste-profile.ts distils what it reads.
//
// What the view leaves out is the privacy promise, enforced by what it
// selects: dietary needs and every PRIVATE quiz key, all contact, identity and
// payment fields, and anybody scheduled for deletion. One thing it does pass
// through is the per-trip answers object, which holds a few typed sentences
// (goalBlurb, noWay, mustDo). The distill reads only the keys it names and
// never copies a string it did not choose from a fixed list — see
// lib/taste-profile.ts.
//
// Service role only. Nothing under NEXT_PUBLIC reads any of this, and no
// response a person can reach carries it.
import type { SupabaseClient } from '@supabase/supabase-js';

export type SignalSource = 'declared' | 'behavioural';

/** Every `kind` the view can produce. A new branch in the view adds one here. */
export const SIGNAL_KINDS = [
  'profile', 'trip_input',
  'feedback_done', 'feedback_not_interested',
  'veto', 'vote', 'skip', 'dates_offered', 'booked',
  'itinerary_item_swapped', 'recommendation_dismissed', 'quiz_dial_adjusted',
  'plan_created', 'next_trip_started_from_close',
] as const;
export type SignalKind = typeof SIGNAL_KINDS[number];

export interface Signal {
  user_id: string;
  source: SignalSource;
  kind: SignalKind | string;
  ref: string | null;
  plan_id: string | null;
  group_id: string | null;
  detail: Record<string, unknown> | null;
  /** ISO timestamp. */
  at: string | null;
}

const PAGE = 1000;

/**
 * Every signal, grouped by person, in pages. Ordered by user so a person's
 * rows arrive together and nobody's profile is distilled from half of them:
 * a person whose rows straddle the row cap is left out of this run rather
 * than written from what fitted.
 */
export async function readSignals(
  db: SupabaseClient,
  opts: { maxRows: number; deadline: number },
): Promise<{ byUser: Map<string, Signal[]>; rows: number; truncated: boolean; error: string | null }> {
  const byUser = new Map<string, Signal[]>();
  let rows = 0;
  let from = 0;
  let truncated = false;
  let failed: string | null = null;
  for (;;) {
    if (Date.now() > opts.deadline || rows >= opts.maxRows) { truncated = true; break; }
    const { data, error } = await db
      .from('v_taste_signals')
      .select('user_id, source, kind, ref, plan_id, group_id, detail, at')
      // Every column in the order, so a page boundary is the same boundary
      // on every read and offset paging neither skips nor repeats a row.
      .order('user_id').order('at', { nullsFirst: true }).order('kind').order('ref', { nullsFirst: true })
      .order('plan_id', { nullsFirst: true })
      .range(from, from + PAGE - 1);
    // A failed page is a cut like any other: the person whose rows straddle
    // it is dropped below, never written from the half that arrived.
    if (error) { failed = `${error.code ?? ''} ${error.message}`.trim(); truncated = true; break; }
    const page = (data ?? []) as Signal[];
    for (const s of page) {
      if (!s?.user_id) continue;
      const list = byUser.get(s.user_id);
      if (list) list.push(s); else byUser.set(s.user_id, [s]);
    }
    rows += page.length;
    if (page.length < PAGE) break;
    from += PAGE;
  }
  // The last person read may be cut off mid-way; leave them for a run that
  // reads all of them.
  if (truncated && byUser.size) {
    const last = [...byUser.keys()].pop()!;
    byUser.delete(last);
  }
  return { byUser, rows, truncated, error: failed };
}
