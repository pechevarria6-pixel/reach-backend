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
// Readiness is therefore about this trip and nothing else. Having done the
// taste quiz once does not make somebody ready to vote on where the group
// goes in March; it says what they like, not what they want this time.
//
// One grace: a plan with no preferences at all predates this being asked, so
// it is not gated. Trips already in flight do not freeze because the rule
// changed under them. The moment one member answers for a trip, the trip is
// running the new way and everybody is counted.
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSoloCount } from './joining.ts';
import { PLANNED_WITH_ANSWERED } from './group-answers.ts';

export interface MemberReadiness {
  userId: string;
  /** What the group already calls them. Never an email. */
  name: string;
  ready: boolean;
  /**
   * Has actually answered for this trip. `ready` is lenient — on a trip
   * nobody has been asked about, everybody is ready — and this is not. A
   * group trip waiting for its options is gated on this one.
   */
  answered: boolean;
}

export interface ReadinessReport {
  members: MemberReadiness[];
  allReady: boolean;
  /** First names only, for "waiting on Marco and Sam". */
  waitingOn: string[];
  /** Solo trips have nobody to wait for. */
  solo: boolean;
  /**
   * The organiser chose to plan with who had answered (lib/group-answers.ts,
   * mayGoAhead). Nobody is waited on after that — the ideas, their days and
   * the vote all go ahead — but `answered` stays strict, so the prompt still
   * knows whose wishes it has.
   */
  wentAhead?: boolean;
}

/**
 * Whether the organiser went ahead with who had answered. A failed read is
 * "no": the wait stays shut rather than opening on a guess.
 */
export async function wentAheadWith(db: SupabaseClient, planId: string): Promise<boolean> {
  try {
    const { data, error } = await db.from('audit_logs').select('id')
      .eq('action', PLANNED_WITH_ANSWERED).eq('resource_id', planId).limit(1);
    if (error) {
      console.error('[readiness] could not check whether the organiser went ahead', { planId, code: error.code });
      return false;
    }
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

/**
 * Whether somebody has ever filled in the standing taste quiz.
 *
 * No longer part of readiness: that profile is what Discover is built on —
 * what a person is into, generally — and it says nothing about what they
 * want from one particular trip. Kept because "have they set up an account
 * properly" is still a real question elsewhere, and it is the answer to it.
 */
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

/**
 * The same wait, for a trip with nothing to vote on yet.
 *
 * "Votes open when everyone's in" on a trip with no options promised a vote
 * that was never coming: what the group is waiting for there is the answers
 * the options get built from, so that is what it says.
 */
export function answersSentence(names: string[]): string | null {
  if (!names.length) return null;
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Waiting on ${list} to say what they want from this trip.`;
}

export async function planReadiness(
  db: SupabaseClient,
  planId: string,
  groupId: string,
  soloMode: boolean,
): Promise<ReadinessReport> {
  const { data: members, error } = await db
    .from('group_members')
    .select('user_id, users(id, name)')
    .eq('group_id', groupId);

  if (error) {
    // Never swallowed: a readiness check that failed must not read as
    // "everyone is ready" and open the vote.
    console.error('[readiness] could not read the group', { planId, code: error.code });
    throw new Error('readiness unavailable');
  }

  // The flag is written once, when the plan is made, and a trip for one can
  // become a trip for two. Joining clears it (lib/joining.ts), but the rule
  // is not left resting on that write: somebody who is in the group is asked,
  // whatever the plan was created as.
  if (soloMode && isSoloCount((members ?? []).length)) {
    return { members: [], allReady: true, waitingOn: [], solo: true };
  }
  if (soloMode) {
    console.error('[readiness] plan still marked solo with more than one person in the group', { planId, members: (members ?? []).length });
  }

  // Who has answered for this trip. A missing table would mean the migration
  // had not run; then nobody has answered, which lands on the grace below
  // rather than on an error.
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

  // Nobody has been asked about this trip yet, so nobody can be behind on it.
  const asked = submitted.size > 0;

  const rows: MemberReadiness[] = (members ?? []).map(m => {
    const record = m as Record<string, unknown>;
    const raw = record.users as Record<string, unknown> | Record<string, unknown>[] | null;
    const u = ((Array.isArray(raw) ? raw[0] : raw) ?? {}) as Record<string, unknown>;
    const userId = String(record.user_id);
    // The email is deliberately not a fallback name: it is somebody's email.
    const name = String(u.name || '').trim() || 'A traveller';
    const answered = submitted.has(userId);
    return { userId, name, ready: !asked || answered, answered };
  });

  const allReady = rows.length > 0 && rows.every(r => r.ready);
  // Asked unless everybody has actually answered: that trip has nothing to
  // go ahead past. Not gated on the lenient allReady — on a trip nobody has
  // answered for, allReady is true, the row was never read, and the ideas a
  // go-ahead had built could not have their days written.
  const everyoneAnswered = rows.length > 0 && rows.every(r => r.answered);
  if (!everyoneAnswered && rows.length > 0 && await wentAheadWith(db, planId)) {
    return {
      members: rows.map(r => ({ ...r, ready: true })),
      allReady: true, waitingOn: [], solo: false, wentAhead: true,
    };
  }
  return {
    members: rows,
    allReady,
    waitingOn: rows.filter(r => !r.ready).map(r => firstNameOf(r.name)),
    solo: false,
  };
}
