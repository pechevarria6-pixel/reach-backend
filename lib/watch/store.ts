// ─── Watches, in Supabase ───────────────────────────────────────────────
// sql/table-watches-2026-11-05.sql. Every write after the first is on the
// row's updated_at as it was read, so a stop pressed while a check is
// running wins: the check's save matches nothing and tells nobody.
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyUsers, type Sender } from '../notify-user.ts';
import { LIVE, missingTable, type WatchRow, type WatchStore } from './types.ts';

export const WATCH_COLUMNS = 'id, kind, user_id, plan_id, booking_id, item_id, target_ref, method, platform, spec, status, expires_at, next_check_at, last_checked_at, last_result, seen, hold, created_at, updated_at';

export function rowOf(r: Record<string, unknown>): WatchRow {
  return {
    ...(r as unknown as WatchRow),
    seen: Array.isArray(r.seen) ? (r.seen as unknown[]).filter((s): s is string => typeof s === 'string') : [],
    spec: r.spec && typeof r.spec === 'object' ? r.spec as Record<string, unknown> : {},
  };
}

export function supabaseWatchStore(db: SupabaseClient, send: Sender | null): WatchStore {
  return {
    async due(now, limit) {
      const { data, error } = await db.from('watches').select(WATCH_COLUMNS)
        .in('status', LIVE as string[]).lte('next_check_at', now.toISOString())
        .order('next_check_at', { ascending: true }).limit(limit);
      if (error) {
        if (missingTable(error)) return { rows: [], missing: true };
        console.error('[watch] could not read what is due', { code: error.code });
        return { rows: [], missing: false, error: error.message };
      }
      return { rows: (data ?? []).map(r => rowOf(r as Record<string, unknown>)), missing: false };
    },

    async claim(row, until) {
      const at = new Date().toISOString();
      const { data, error } = await db.from('watches')
        .update({ next_check_at: until, updated_at: at })
        .eq('id', row.id).eq('updated_at', row.updated_at).in('status', LIVE as string[])
        .select('updated_at');
      if (error) {
        console.error('[watch] could not claim a watch', { watch: row.id, code: error.code });
        return { ok: false };
      }
      const got = (data ?? [])[0] as { updated_at?: string } | undefined;
      return got?.updated_at ? { ok: true, version: got.updated_at } : { ok: false };
    },

    async save(id, version, patch) {
      const { data, error } = await db.from('watches')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id).eq('updated_at', version).in('status', LIVE as string[])
        .select('id');
      if (error) {
        console.error('[watch] could not save a check', { watch: id, code: error.code });
        return false;
      }
      return (data ?? []).length > 0;
    },

    async notify(userId, note) {
      const delivery = await notifyUsers(db, [userId], { kind: 'watch', ...note }, send);
      if (!delivery.stored) console.error('[watch] the bell was not written', { planId: note.planId });
    },
  };
}

/** A run happened in the last two hours: the only proof the schedule is on. */
export async function scheduleRunning(db: SupabaseClient, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - 2 * 3_600_000).toISOString();
  const { data, error } = await db.from('watch_runs').select('id').gte('ran_at', since).limit(1);
  if (error) {
    if (!missingTable(error)) console.error('[watch] could not read the last run', { code: error.code });
    return false;
  }
  return (data ?? []).length > 0;
}

/** Whether the watches table is there yet. */
export async function watchesMigrated(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from('watches').select('id').limit(1);
  if (error && !missingTable(error)) console.error('[watch] could not read watches', { code: error.code });
  return !error;
}
