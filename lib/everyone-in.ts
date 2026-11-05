// ─── "Everyone's in" ─────────────────────────────────────────────────────
// A group trip waits for every member's answers before any trip ideas are
// found. The moment the last person answers, everybody hears it — in the
// app, and on their phone if they have let Reach notify it — rather than
// having to keep checking a wait screen.
//
// Once per trip, however many answers land at the same moment: the same
// first-write-wins claim the nudge uses, keyed on the trip, with no window.
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyUsers, type Sender } from './notify-user.ts';
import { wentAheadWith } from './plan-readiness.ts';

export const EVERYONE_IN_ACTION = 'everyone_in_announced';

/** Whether this group trip has just become ready to find trips for. */
export function everyoneIn(memberIds: string[], answeredIds: string[]): boolean {
  if (memberIds.length < 2) return false;
  const answered = new Set(answeredIds);
  return memberIds.every(id => answered.has(id));
}

/**
 * First write wins: true for exactly one caller per (action, key), however
 * many arrive at once. Also used for "Everyone has voted", keyed on the set
 * of ideas (lib/trip-vote.ts), and for the booked-moment celebration, keyed
 * on plan and person (POST /api/plans/[planId]/celebrated).
 */
export async function claimOnce(
  db: SupabaseClient, planId: string, userId: string,
  action: string = EVERYONE_IN_ACTION, key: string = planId,
): Promise<boolean> {
  return (await claimOnceOutcome(db, planId, userId, action, key)) === 'first';
}

/**
 * The same claim, saying why it was not won: 'taken' when somebody (or an
 * earlier tap) already holds it, 'error' when the table could not be read or
 * written — which a caller that answers a screen has to tell apart from
 * "already done".
 *
 * Insert, then read back the earliest row. Reading first and inserting only
 * on "nothing there" is not a claim: a double tap is two requests at once,
 * and both read nothing. Here both may insert, and both then read the same
 * earliest row, so exactly one of them is the winner.
 */
export async function claimOnceOutcome(
  db: SupabaseClient, planId: string, userId: string,
  action: string = EVERYONE_IN_ACTION, key: string = planId,
): Promise<'first' | 'taken' | 'error'> {
  // resource_id is always the plan, and a finer key goes in the metadata. A
  // key like '<plan>:votes' in resource_id was refused by the live table —
  // never checked in, and every other writer puts a uuid there — so
  // "Everyone has voted" was claimed as an error and told nobody
  // (2026-11-05). The plain per-plan claim reads exactly as it always has.
  const keyed = key !== planId;
  const first = () => {
    let q = db.from('audit_logs').select('id').eq('action', action).eq('resource_id', planId);
    if (keyed) q = q.eq('metadata->>key', key);
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1);
  };
  const before = await first();
  if (before.error) {
    // Better silent than twice: this one is a courtesy, not a gate.
    console.error('[claim-once] could not check whether it was claimed', { planId, action, code: before.error.code });
    return 'error';
  }
  if (before.data?.length) return 'taken';
  const { data: mine, error } = await db.from('audit_logs')
    .insert({ user_id: userId, action, resource: 'plans', resource_id: planId, success: true, metadata: keyed ? { plan: planId, key } : { plan: planId } })
    .select('id').single();
  if (error || !mine) {
    console.error('[claim-once] could not record the claim', { planId, action, code: error?.code });
    return 'error';
  }
  const after = await first();
  if (after.error) return 'error';
  return after.data?.[0]?.id === mine.id ? 'first' : 'taken';
}

/**
 * Whether every member of the group has answered for this plan — the fact,
 * apart from whether anybody was told it. Null when the group could not be
 * read. POST /preferences answered `everyoneIn: false` with both members of
 * the QA group answered (2026-11-05): it was sending back whether this
 * request made the announcement, which is false on any trip whose place is
 * already set, once it has been made, or after a go-ahead.
 */
export async function everyoneHasAnswered(db: SupabaseClient, planId: string, groupId: string): Promise<boolean | null> {
  const [{ data: members, error: mErr }, { data: said, error: sErr }] = await Promise.all([
    db.from('group_members').select('user_id').eq('group_id', groupId),
    db.from('plan_preferences').select('user_id, submitted_at').eq('plan_id', planId),
  ]);
  if (mErr || sErr) return null;
  return everyoneIn((members ?? []).map(m => String(m.user_id)),
    (said ?? []).filter(r => r.submitted_at).map(r => String(r.user_id)));
}

export async function announceIfEveryoneIn(
  db: SupabaseClient,
  plan: { id: string; group_id: string; title?: string | null; type?: string | null; destination_style?: string | null; status?: string | null },
  byUserId: string,
  send: Sender | null,
): Promise<boolean> {
  // Only a trip still waiting on answers. Once a destination is picked the
  // answers are for the days, and nobody needs telling.
  if (plan.destination_style !== 'undecided') return false;
  // A called-off or finished trip announces nothing — "Everyone's in, find
  // your ideas" about a plan the organiser called off is a false start.
  if (plan.status && plan.status !== 'planning' && plan.status !== 'voting') return false;
  const [{ data: members, error: mErr }, { data: said, error: sErr }] = await Promise.all([
    db.from('group_members').select('user_id').eq('group_id', plan.group_id),
    db.from('plan_preferences').select('user_id, submitted_at').eq('plan_id', plan.id),
  ]);
  if (mErr || sErr) {
    console.error('[everyone-in] could not read the group', { planId: plan.id });
    return false;
  }
  const memberIds = (members ?? []).map(m => String(m.user_id));
  const answeredIds = (said ?? []).filter(r => r.submitted_at).map(r => String(r.user_id));
  if (!everyoneIn(memberIds, answeredIds)) return false;
  // The organiser went ahead with who had answered, so the ideas were built
  // before this last answer: "built from every one of your answers" would
  // be untrue.
  if (await wentAheadWith(db, plan.id)) return false;
  if (!(await claimOnce(db, plan.id, byUserId))) return false;

  const night = plan.type === 'restaurant';
  await notifyUsers(db, memberIds, {
    kind: 'everyone_in',
    title: "Everyone's in",
    body: night
      ? 'All of you have answered — find your ideas for the night.'
      // Nothing is built until somebody presses Find; "are built" said it was.
      : 'All of you have answered — find your trip ideas, made from every one of your answers.',
    url: `/home?waiting=${encodeURIComponent(plan.id)}&group=${encodeURIComponent(plan.group_id)}`,
    planId: plan.id,
  }, send);
  return true;
}

/**
 * After somebody leaves a group: every trip still waiting on answers that
 * their going has completed. Leaving never told anybody, so if the last
 * person who had not answered left or was removed, "Everyone's in" was never
 * sent and only somebody watching the wait screen noticed. A failed read
 * tells nobody; this is a courtesy, never a gate.
 */
export async function announceWhereLeavingCompletesAnswers(
  db: SupabaseClient, groupId: string, actorId: string, send: Sender | null,
): Promise<void> {
  const { data, error } = await db.from('plans')
    .select('id, group_id, title, type, destination_style, status')
    .eq('group_id', groupId).eq('destination_style', 'undecided').in('status', ['planning', 'voting']);
  if (error) {
    console.error('[everyone-in] could not read the waiting trips after somebody left', { groupId, code: error.code });
    return;
  }
  for (const plan of (data ?? []) as Array<Parameters<typeof announceIfEveryoneIn>[1]>) {
    await announceIfEveryoneIn(db, plan, actorId, send).catch(e => {
      console.error('[everyone-in] could not announce after a leave', { planId: plan.id, error: e instanceof Error ? e.message : String(e) });
      return false;
    });
  }
}
