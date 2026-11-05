// ─── Something Reach keeps an eye on for somebody ───────────────────────
// Owner, 2026-11-05: a restaurant that is hard to get into, watched until a
// table opens inside the trip. A table is the only kind built; a flight
// price or a hotel rate is the same shape — something to ask a provider
// again and again, politely, until an answer is worth telling somebody — so
// the scheduler (run.ts) and the store (store.ts) know nothing about tables.
// Each kind brings its own Watcher.
//
// The row is sql/table-watches-2026-11-05.sql's `watches`. Until that has
// run there is no table, and every route says watching is not switched on
// yet rather than pretending to have saved something.

/** The kinds the table allows. A new kind is a migration and a Watcher. */
export type WatchKind = 'table';

export type WatchStatus =
  /** Being checked on schedule. */
  | 'active'
  /** Something is held for the person right now (a table's five-minute hold). Still checked, to see how it ends. */
  | 'held'
  /** Done: what was watched for was got. */
  | 'booked'
  /** The person said stop. */
  | 'stopped'
  /** The window it was for has gone. */
  | 'expired'
  /** Reach stopped it for a reason it said (a table already booked another way, holds missed three times). */
  | 'ended';

export const LIVE: readonly WatchStatus[] = ['active', 'held'];

export interface WatchRow {
  id: string;
  kind: WatchKind;
  user_id: string;
  plan_id: string | null;
  booking_id: string | null;
  item_id: string | null;
  /** What is watched. For a table: the discovery_venues row's id, never a name. */
  target_ref: string;
  /** How it is watched. For a table: 'platform' (Reach asks the platform) or 'call_list' (asked on Reach's call). */
  method: string;
  platform: string | null;
  /** The kind's own facts: a table's nights, times and party. */
  spec: Record<string, unknown>;
  status: WatchStatus;
  expires_at: string;
  next_check_at: string;
  last_checked_at: string | null;
  /** What the last check found, for the screen and the log. Never a person's details. */
  last_result: Record<string, unknown> | null;
  /** What has already been held or told, so nothing is held or told twice. */
  seen: string[];
  /** What is held right now, while status is 'held'. */
  hold: Record<string, unknown> | null;
  created_at?: string;
  updated_at: string;
}

/** What one check decided: the row's next state, and anything to tell its person. */
export interface WatchStep {
  patch: Partial<Pick<WatchRow, 'status' | 'last_result' | 'seen' | 'hold' | 'next_check_at' | 'platform' | 'spec'>>;
  note?: WatchNote | null;
  /** Requests made to providers, counted against the run's budget. */
  calls: number;
  /** The provider asked Reach to slow down: nothing more is sent to it this run. */
  throttled?: string | null;
}

export interface WatchNote {
  title: string;
  body: string;
  url: string;
  planId: string | null;
}

export interface CheckCtx {
  now: Date;
  /** Calls this check may still make. */
  budget: number;
  /** Providers that asked Reach to slow down earlier in this run. */
  throttled: ReadonlySet<string>;
}

export interface Watcher {
  kind: WatchKind;
  check(row: WatchRow, ctx: CheckCtx): Promise<WatchStep>;
}

export type Claim = { ok: true; version: string } | { ok: false };

export interface WatchStore {
  /** Live watches whose time has come, oldest first. `missing` when the table is not there yet. */
  due(now: Date, limit: number): Promise<{ rows: WatchRow[]; missing: boolean; error?: string }>;
  /**
   * Take a row for this run, only if it is still at `version`: two runs (a
   * retried job, a manual run beside the schedule) never check one watch at
   * once. Moves next_check_at on, so a run that dies leaves it to come back
   * later rather than stuck.
   */
  claim(row: WatchRow, until: string): Promise<Claim>;
  /** Write a check's result, only at the version the claim left. */
  save(id: string, version: string, patch: WatchStep['patch'] & { last_checked_at: string }): Promise<boolean>;
  notify(userId: string, note: WatchNote): Promise<void>;
}

/** A missing table, as PostgREST or Postgres says it. */
export const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message || ''));
