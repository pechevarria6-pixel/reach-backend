// ─── One nudge a minute, per trip ────────────────────────────────────────
// "Nudge them by email" on a group trip's wait emails everybody who has not
// answered yet. Nothing stopped it being pressed ten times in a row, and
// every press is another email in somebody's inbox from their friends'
// trip — the fastest way to make people stop opening them.
//
// So a trip can be nudged once a minute, by anybody in it. Recorded in
// audit_logs rather than in a module variable, because a counter in memory is
// per serverless instance: two presses can land on two instances and both
// find nothing there, which is not a limit.
//
// A double-tap is two requests at the same instant, and both would read
// "nothing in the last minute" before either wrote. So each writes its claim
// first and then looks: whichever claim is oldest wins, and a later one takes
// itself back out and is refused. Taking it out matters — a refused press
// left on the record would push the minute along, and somebody pressing
// every few seconds could keep the button shut for ever.
import type { SupabaseClient } from '@supabase/supabase-js';

export const NUDGE_ACTION = 'prefs_nudged';
export const NUDGE_COOLDOWN_MS = 60_000;

/**
 * Which nudges are held to the minute. Every nudge that reaches somebody —
 * the bell, their phone, or their inbox — is: answers still to give, and
 * votes still to cast. Only a nudge that could never reach anyone would be
 * exempt, and there is none. Funding nudges are outside this change and
 * are left as they were.
 */
export function limitsNudge(kind: string): boolean {
  return kind === 'prefs' || kind === 'vote';
}

export interface NudgeClaim {
  allowed: boolean;
  /** Seconds until the next nudge can go, when refused. */
  retryAfterSeconds: number;
  /** The record this nudge holds, so a send that went nowhere can give it back. */
  claimId?: string | null;
}

type Row = { id: string; created_at: string };

function wait(rows: Row[], now: Date): number {
  const first = rows[0] ? new Date(rows[0].created_at).getTime() : now.getTime();
  return Math.max(1, Math.ceil((first + NUDGE_COOLDOWN_MS - now.getTime()) / 1000));
}

/**
 * Claims this minute's nudge for a trip, or says how long until the next.
 *
 * Fails open if the record cannot be read or written: a reminder email that
 * goes twice is a smaller harm than a button that never works, and the read
 * failing is logged.
 */
export async function claimNudge(
  db: SupabaseClient,
  planId: string,
  userId: string,
  now: Date = new Date(),
): Promise<NudgeClaim> {
  const since = new Date(now.getTime() - NUDGE_COOLDOWN_MS).toISOString();
  const recent = () => db
    .from('audit_logs').select('id, created_at')
    .eq('action', NUDGE_ACTION).eq('resource_id', planId)
    .gte('created_at', since)
    .order('created_at', { ascending: true }).order('id', { ascending: true });

  const before = await recent();
  if (before.error) {
    console.error('[nudge] could not read when this trip was last nudged — allowing', { planId, code: before.error.code });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if ((before.data || []).length) {
    return { allowed: false, retryAfterSeconds: wait(before.data as Row[], now) };
  }

  const { data: mine, error: wrote } = await db
    .from('audit_logs')
    .insert({ user_id: userId, action: NUDGE_ACTION, resource: 'plans', resource_id: planId, success: true })
    .select('id').single();
  if (wrote || !mine) {
    console.error('[nudge] could not record this nudge — allowing, uncounted', { planId, code: wrote?.code });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const after = await recent();
  const rows = (after.data || []) as Row[];
  if (after.error || !rows.length || rows[0].id === mine.id) {
    return { allowed: true, retryAfterSeconds: 0, claimId: String(mine.id) };
  }

  // Somebody else's press got there first.
  const { error: undone } = await db.from('audit_logs').delete().eq('id', mine.id);
  if (undone) console.error('[nudge] could not take back a refused claim', { planId, code: undone.code });
  return { allowed: false, retryAfterSeconds: wait(rows, now) };
}

/**
 * Gives a claim back when nothing was sent — email switched off, every send
 * failed — so the next press can try again straight away rather than being
 * told to wait a minute for an email that never went.
 */
export async function releaseNudge(db: SupabaseClient, claimId: string | null | undefined): Promise<void> {
  if (!claimId) return;
  const { error } = await db.from('audit_logs').delete().eq('id', claimId);
  if (error) console.error('[nudge] could not release a nudge that sent nothing', { code: error.code });
}
