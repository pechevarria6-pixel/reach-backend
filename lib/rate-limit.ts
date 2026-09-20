// ─── Asking too often ───────────────────────────────────────────────────
// Generating a trip calls a model twice and costs real money every time.
// Nothing stopped one account doing it in a loop — a stuck retry, a leaning
// finger, or somebody who found the endpoint — and the first anybody would
// know is the bill.
//
// Counted in the database rather than in memory, because the app runs as
// serverless functions: a counter in a module variable is per-instance, and
// a limit that resets whenever a new instance starts is not a limit. The
// audit log is already written on every generation, already indexed by user
// and time, and already the thing you would read afterwards to find out what
// happened — so it is what gets counted.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Allowance {
  allowed: boolean;
  used: number;
  limit: number;
  /** When the oldest one drops out of the window, for the message. */
  retryAfterMinutes: number;
}

/** Enough for a real afternoon of planning; far short of a loop. */
export const PER_HOUR = 10;

/**
 * How many times this person has done this in the last hour.
 *
 * Fails open. A rate limiter that refuses because it could not read its own
 * counter turns a database blip into an outage of the main feature, and the
 * thing it is protecting against — a loop — is rarer than the blip.
 */
export async function allowance(
  db: SupabaseClient,
  userId: string,
  action: string,
  limit = PER_HOUR,
  now: Date = new Date(),
): Promise<Allowance> {
  const since = new Date(now.getTime() - 3600_000).toISOString();

  const { data, error } = await db
    .from('audit_logs')
    .select('created_at')
    .eq('user_id', userId)
    .eq('action', action)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[rate-limit] could not count recent attempts — allowing', { action, code: error.code });
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
 * What to say when somebody has had their ten.
 *
 * Their own words back: they have been planning, not abusing anything, and
 * almost everybody who hits this is retrying something that looked stuck.
 */
export function tooOften(a: Allowance): string {
  const wait = a.retryAfterMinutes <= 1
    ? 'a minute'
    : a.retryAfterMinutes < 60
      ? `${a.retryAfterMinutes} minutes`
      : 'an hour';
  return `That's ${a.limit} trips planned in an hour — give it ${wait} and you can carry on. `
    + 'If something looked stuck rather than finished, tell us and we will look.';
}
