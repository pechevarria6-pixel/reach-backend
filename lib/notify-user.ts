// ─── Telling somebody something ──────────────────────────────────────────
// A nudge goes where the person already is. Every notification is written
// to their bell in the app; if they have let Reach notify their phone, it is
// pushed there too. Who could not be reached on a phone comes back to the
// caller, which decides whether an email is the fallback — the owner's rule
// is that email is only for people with no notifications turned on.
//
// The sender is passed in, so this is testable without a phone and so a
// deployment with no push keys still writes the bell and says so.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Note {
  kind: string;
  title: string;
  body?: string | null;
  url?: string | null;
  planId?: string | null;
}
export interface Subscription { id?: string; user_id: string; endpoint: string; p256dh: string; auth: string }
export type Sender = (sub: Subscription, payload: string) => Promise<{ ok: true } | { ok: false; gone: boolean; detail?: string }>;

export interface Delivery {
  /** Rows written to the bell. 0 when the table is not there yet. */
  inApp: number;
  /** Whether the bell could be written at all (the migration may not have run). */
  stored: boolean;
  /** People a phone notification reached. */
  pushed: string[];
  /** People no phone notification reached — the email fallback list. */
  unreached: string[];
  /**
   * People who turned off notifications about this plan
   * (plan_notification_mutes). Sent nothing — not the bell, not the phone —
   * and not on the email list either: "stop" means stop, whichever channel
   * the caller would have tried next.
   */
  muted: string[];
}

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message || ''));

/**
 * Who among `userIds` has muted this plan.
 *
 * Before sql/pings-2026-09-25.sql runs there is no table and nobody has
 * muted anything, so that reads as nobody. Any other failure to read is
 * also read as nobody, and logged: a nudge a friend sent on purpose is not
 * dropped because the mute list could not be read for a moment. The
 * scheduled pings ask this before they claim anything, so for them a failed
 * read stops the run instead (`ok: false`) — a reminder nobody asked a
 * person for is the one that must not go to somebody who said stop.
 */
export async function mutedFor(
  db: SupabaseClient, planId: string | null | undefined, userIds: string[],
): Promise<{ ok: boolean; muted: Set<string> }> {
  const people = [...new Set(userIds.filter(Boolean))];
  if (!planId || !people.length) return { ok: true, muted: new Set() };
  const { data, error } = await db.from('plan_notification_mutes')
    .select('user_id').eq('plan_id', planId).in('user_id', people);
  if (error) {
    if (missingTable(error)) return { ok: true, muted: new Set() };
    console.error('[notify] could not read who muted this plan', { planId, code: error.code });
    return { ok: false, muted: new Set() };
  }
  return { ok: true, muted: new Set((data ?? []).map(r => String((r as { user_id: unknown }).user_id))) };
}

export async function notifyUsers(
  db: SupabaseClient, userIds: string[], note: Note, send: Sender | null,
): Promise<Delivery> {
  const asked = [...new Set(userIds.filter(Boolean))];
  if (!asked.length) return { inApp: 0, stored: true, pushed: [], unreached: [], muted: [] };

  // Somebody who turned this plan off hears nothing about it, from anybody.
  const { muted } = await mutedFor(db, note.planId, asked);
  const people = asked.filter(p => !muted.has(p));
  if (!people.length) return { inApp: 0, stored: true, pushed: [], unreached: [], muted: [...muted] };

  const { error: wrote } = await db.from('notifications').insert(people.map(user_id => ({
    user_id, kind: note.kind, title: note.title, body: note.body ?? null,
    url: note.url ?? null, plan_id: note.planId ?? null,
  })));
  const stored = !wrote;
  if (wrote && !missingTable(wrote)) console.error('[notify] could not write to the bell', { kind: note.kind, code: wrote.code });
  if (wrote && missingTable(wrote)) console.error('[notify] no bell yet — run sql/notifications-2026-09-23.sql');

  const pushed = new Set<string>();
  if (send) {
    const { data: subs, error: subErr } = await db.from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth').in('user_id', people);
    if (subErr && !missingTable(subErr)) console.error('[notify] could not read phones', { code: subErr.code });
    const payload = JSON.stringify({ title: note.title, body: note.body ?? '', url: note.url ?? '/home' });
    for (const sub of (subs ?? []) as Subscription[]) {
      const r = await send(sub, payload) as { ok: boolean; gone?: boolean; detail?: string };
      if (r.ok) {
        pushed.add(sub.user_id);
        // Bookkeeping only: when a device was last reached. Unchecked on
        // purpose — failing to note it must never undo a delivered nudge.
        await db.from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).eq('id', sub.id);
      } else if (r.gone) {
        // The phone unsubscribed or the app was removed. Keeping the row
        // would retry a dead address on every nudge.
        const { error } = await db.from('push_subscriptions').delete().eq('id', sub.id);
        if (error) console.error('[notify] could not drop a dead subscription', { code: error.code });
      } else {
        console.error('[notify] push failed', { user: sub.user_id, detail: r.detail });
      }
    }
  }
  return {
    inApp: stored ? people.length : 0,
    stored,
    pushed: [...pushed],
    unreached: people.filter(p => !pushed.has(p)),
    muted: [...muted],
  };
}
