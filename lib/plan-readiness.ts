// ─── Who has had their say, and who the trip is waiting on ──────────────
// Voting before everyone has given their preferences decides the trip on
// behalf of whoever was slowest to answer. So votes open when nobody is left
// to hear from.
//
// Readiness is a yes or a no and a first name. It is never anybody's answers:
// the group is entitled to know who it is waiting for, and not to read what
// they said. That is the same rule travel essentials follows, for the same
// reason — being in a group is not consent to be read.
//
// The definition is a union on purpose, and it is worth saying why. A member
// counts as ready if they have submitted preferences for this trip, or, when
// they have no row for it, if they have answered the standing quiz. Gating
// only on the new table would have locked every group that exists today out
// of voting the moment this shipped, because nothing had written a row yet.
// As trips collect their own preferences the first half takes over.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MemberReadiness {
  userId: string;
  /** What the group already calls them. Never an email. */
  name: string;
  ready: boolean;
}

export interface ReadinessReport {
  members: MemberReadiness[];
  allReady: boolean;
  /** First names only, for "waiting on Marco and Sam". */
  waitingOn: string[];
  /** Solo trips have nobody to wait for. */
  solo: boolean;
}

/** The quiz counts as answered if they told us anything at all. */
export function answeredStandingQuiz(u: Record<string, unknown> | null | undefined): boolean {
  if (!u) return false;
  const filled = (v: unknown) => Array.isArray(v) ? v.length > 0 : !!v;
  return filled(u.cuisines) || filled(u.music_genres) || filled(u.activity_vibe)
    || filled(u.no_way_jose) || filled(u.dining_vibe) || filled(u.drink_style)
    || filled(u.nightlife_style) || filled(u.budget_range);
}

export function firstNameOf(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || 'someone';
}

/** "Marco", "Marco and Sam", "Marco, Sam and Priya". */
export function waitingSentence(names: string[]): string | null {
  if (!names.length) return null;
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Votes open when everyone's in — waiting on ${list}.`;
}

export async function planReadiness(
  db: SupabaseClient,
  planId: string,
  groupId: string,
  soloMode: boolean,
): Promise<ReadinessReport> {
  if (soloMode) return { members: [], allReady: true, waitingOn: [], solo: true };

  const { data: members, error } = await db
    .from('group_members')
    .select('user_id, users(id, name, email, cuisines, music_genres, activity_vibe, no_way_jose, dining_vibe, drink_style, nightlife_style, budget_range)')
    .eq('group_id', groupId);

  if (error) {
    // Never swallowed: a readiness check that failed must not read as
    // "everyone is ready" and open the vote.
    console.error('[readiness] could not read the group', { planId, code: error.code });
    throw new Error('readiness unavailable');
  }

  // Who has submitted for this trip specifically. A missing table means the
  // migration has not run yet, which is not an error here — the standing
  // quiz answers the question until it does.
  const submitted = new Set<string>();
  const { data: prefs, error: prefsError } = await db
    .from('plan_preferences')
    .select('user_id, submitted_at')
    .eq('plan_id', planId);
  if (prefsError) {
    if (!/does not exist|schema cache|PGRST205/i.test(`${prefsError.code} ${prefsError.message}`)) {
      console.error('[readiness] could not read plan preferences', { planId, code: prefsError.code });
    }
  } else {
    for (const row of prefs ?? []) if (row.submitted_at) submitted.add(String(row.user_id));
  }

  const rows: MemberReadiness[] = (members ?? []).map(m => {
    const record = m as Record<string, unknown>;
    const raw = record.users as Record<string, unknown> | Record<string, unknown>[] | null;
    const u = ((Array.isArray(raw) ? raw[0] : raw) ?? {}) as Record<string, unknown>;
    const userId = String(record.user_id);
    // The email is deliberately not a fallback name: it is somebody's email.
    const name = String(u.name || '').trim() || 'A traveller';
    return {
      userId,
      name,
      ready: submitted.has(userId) || answeredStandingQuiz(u),
    };
  });

  return {
    members: rows,
    allReady: rows.length > 0 && rows.every(r => r.ready),
    waitingOn: rows.filter(r => !r.ready).map(r => firstNameOf(r.name)),
    solo: false,
  };
}
