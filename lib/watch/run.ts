// ─── One scheduled pass over every watch that is due ────────────────────
// Run by GitHub Actions through /api/cron/watches (.github/workflows/
// watches.yml), not vercel.json: this account is on Hobby, where a cron runs
// once a day and a sub-daily schedule silently rejects the deployment.
//
// Polite by construction, because no platform publishes how often a partner
// may ask (the research for this, 2026-11-05: OpenTable "may vary by endpoint
// and use case", Yelp answers 429 without saying at what):
//
//   · a run makes at most `budget` provider requests in all, whatever is due;
//   · each watch says when it next wants checking (lib/watch/tables.ts
//     nextCheck), never sooner than every fifteen minutes;
//   · a provider that answers 429 is asked nothing more for the rest of the
//     run, and the watches waiting on it are put back an hour.
//
// Every row is claimed on its version before it is checked, so two runs —
// a retried job, a manual run beside the schedule — never check one watch at
// once, and never hold two tables for it. A claim moves next_check_at on
// first: a run killed mid-check leaves the watch to come back later, never
// stuck and never checked in a loop.
//
// The answer is counts only: the workflow's log is public.
import type { Watcher, WatchStore, WatchKind, WatchStep } from './types.ts';

export interface RunReport {
  due: number;
  checked: number;
  calls: number;
  held: number;
  told: number;
  /** Rows another run had already taken. */
  skipped: number;
  /** Checks that threw: logged, and the watch tried again next time. */
  failed: number;
  /** Watches left for the next run because the budget ran out. */
  deferred: number;
  /** Why nothing ran at all: the table is not there yet, or could not be read. */
  stopped?: 'not_migrated' | 'unreadable';
}

/** A claim is good for this long: past it, the next run may take the row again. */
export const CLAIM_MS = 10 * 60_000;
/** Pushed back this far when a provider asked Reach to slow down. */
export const THROTTLE_MS = 60 * 60_000;

export async function runWatches(
  store: WatchStore,
  watchers: readonly Watcher[],
  opts: { now?: Date; budget?: number; limit?: number; dry?: boolean } = {},
): Promise<RunReport> {
  const now = opts.now ?? new Date();
  const report: RunReport = { due: 0, checked: 0, calls: 0, held: 0, told: 0, skipped: 0, failed: 0, deferred: 0 };
  const due = await store.due(now, opts.limit ?? 100);
  if (due.missing) return { ...report, stopped: 'not_migrated' };
  if (due.error) return { ...report, stopped: 'unreadable' };
  report.due = due.rows.length;
  if (opts.dry) return report;

  const byKind = new Map<WatchKind, Watcher>(watchers.map(w => [w.kind, w]));
  let budget = Math.max(0, opts.budget ?? 60);
  const throttled = new Set<string>();

  for (const row of due.rows) {
    const watcher = byKind.get(row.kind);
    if (!watcher) continue;
    if (budget <= 0) { report.deferred++; continue; }
    const claim = await store.claim(row, new Date(now.getTime() + CLAIM_MS).toISOString());
    if (claim.ok === false) { report.skipped++; continue; }

    let step: WatchStep;
    try {
      step = await watcher.check(row, { now, budget, throttled });
    } catch (e) {
      // Our fault or a provider's, never a fact about the restaurant: the
      // watch stays as it was and is tried again once the claim runs out.
      report.failed++;
      console.error('[watch] a check threw', { watch: row.id, kind: row.kind, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    budget -= step.calls;
    report.calls += step.calls;
    report.checked++;
    if (step.throttled) throttled.add(step.throttled);
    if (step.patch.status === 'held') report.held++;

    const saved = await store.save(row.id, claim.version, { ...step.patch, last_checked_at: now.toISOString() });
    if (!saved) {
      // Somebody stopped it while it was being checked: their word stands,
      // and nothing is told about a watch they ended.
      console.error('[watch] a check could not be saved', { watch: row.id, status: step.patch.status ?? null });
      continue;
    }
    if (step.note) {
      await store.notify(row.user_id, step.note);
      report.told++;
    }
  }
  return report;
}
