// ─── One group asking too often ──────────────────────────────────────────
// lib/rate-limit.ts holds each person to ten new trips and thirty rebuilds
// an hour. That bounds one account and nothing else: a group of eight, each
// inside their own allowance, can still ask for 320 paid generations in an
// hour, and a shared retry loop (a stuck screen open on every phone) is
// exactly the case nobody would notice before the bill.
//
// Counted from the same audit_logs rows the per-person limit counts —
// /api/trips/generate already writes one per attempt with the group's id in
// resource_id — so there is no new table and nothing to migrate.
//
// The number is set so a real group cannot reach it planning. The heaviest
// afternoon on record is one person rebuilding six plans after a generator
// fix; a whole group planning hard is everyone pressing Find a few times and
// the organiser rebuilding the days a few times more. Sixty in an hour is
// several times that, and a quarter of what the per-person limits allow a
// group of eight.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Allowance } from '../rate-limit.ts';

export const GROUP_PER_HOUR = 60;

/** Both kinds of generation: one budget for the group, whatever was asked. */
export const GROUP_ACTIONS = ['trip_generated', 'itinerary_rebuilt'] as const;

/**
 * How many generations this group has asked for in the last hour.
 *
 * Fails open, like the per-person limit and for the same reason: refusing
 * because the counter could not be read turns a database blip into an
 * outage of the main feature.
 */
export async function groupAllowance(
  db: SupabaseClient,
  groupId: string,
  limit = GROUP_PER_HOUR,
  now: Date = new Date(),
): Promise<Allowance> {
  const since = new Date(now.getTime() - 3600_000).toISOString();
  const { data, error } = await db
    .from('audit_logs')
    .select('created_at')
    .eq('resource', 'groups')
    .eq('resource_id', groupId)
    .in('action', GROUP_ACTIONS as unknown as string[])
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[group-rate] could not count recent generations — allowing', { code: error.code });
    return { allowed: true, used: 0, limit, retryAfterMinutes: 0 };
  }

  const used = data?.length ?? 0;
  const oldest = data?.[0]?.created_at;
  const freesUpIn = oldest
    ? Math.max(1, Math.ceil((new Date(oldest).getTime() + 3600_000 - now.getTime()) / 60_000))
    : 0;
  return { allowed: used < limit, used, limit, retryAfterMinutes: freesUpIn };
}

/**
 * What the person is told. They have done nothing wrong — everyone together
 * has asked a lot — so it says how long, and that nothing was lost.
 */
export function groupTooOften(a: Allowance): string {
  const wait = a.retryAfterMinutes <= 1
    ? 'a minute'
    : a.retryAfterMinutes < 60
      ? `${a.retryAfterMinutes} minutes`
      : 'an hour';
  // Worded for whoever reads it: a person on their own cannot reach this
  // (their own limits add up to less than it), but nothing here assumes so.
  return `A lot of plans have been asked for here in the last hour — give it ${wait} and you can carry on. `
    + 'Everything already planned is still here.';
}
