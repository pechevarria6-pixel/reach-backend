// ─── "Mute reminders for this trip" ──────────────────────────────────────
// One row in plan_notification_mutes per person per plan (sql/pings-
// 2026-09-25.sql). lib/notify-user.ts reads it before anything is sent about
// that plan — the countdown pings, the settle-up reminder, a friend's nudge —
// so the row is the whole switch: there is it, or there is not.
//
// Turning it on is an upsert that ignores a duplicate, because a double tap
// is two concurrent inserts and the primary key is what stops the second.
// Turning it off is a delete, which is the same however many times it runs.
import type { SupabaseClient } from '@supabase/supabase-js';

export const MUTE_SQL = 'sql/pings-2026-09-25.sql';

export const muteTableMissing = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205'
    || (/plan_notification_mutes/.test(e.message || '') && /schema cache|does not exist|could not find/i.test(e.message || '')));

export type MuteRead = { ok: true; muted: boolean; available: boolean } | { ok: false };

/** Whether this person has muted this plan. A failed read is said as one, never as "not muted". */
export async function readMute(db: SupabaseClient, planId: string, userId: string): Promise<MuteRead> {
  const { data, error } = await db.from('plan_notification_mutes')
    .select('user_id').eq('plan_id', planId).eq('user_id', userId).maybeSingle();
  if (error) {
    if (muteTableMissing(error)) return { ok: true, muted: false, available: false };
    console.error('[mute] could not read', { planId, code: error.code });
    return { ok: false };
  }
  return { ok: true, muted: !!data, available: true };
}

export type MuteWrite = { ok: true; muted: boolean } | { ok: false; missing: boolean };

/** Mute (`on`) or unmute this plan for this person. Safe to repeat. */
export async function writeMute(db: SupabaseClient, planId: string, userId: string, on: boolean): Promise<MuteWrite> {
  const { error } = on
    ? await db.from('plan_notification_mutes')
      .upsert({ plan_id: planId, user_id: userId }, { onConflict: 'plan_id,user_id', ignoreDuplicates: true })
    : await db.from('plan_notification_mutes').delete().eq('plan_id', planId).eq('user_id', userId);
  if (error) {
    const missing = muteTableMissing(error);
    if (!missing) console.error('[mute] could not write', { planId, on, code: error.code });
    return { ok: false, missing };
  }
  return { ok: true, muted: on };
}
