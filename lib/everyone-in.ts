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

export const EVERYONE_IN_ACTION = 'everyone_in_announced';

/** Whether this group trip has just become ready to find trips for. */
export function everyoneIn(memberIds: string[], answeredIds: string[]): boolean {
  if (memberIds.length < 2) return false;
  const answered = new Set(answeredIds);
  return memberIds.every(id => answered.has(id));
}

async function claimOnce(db: SupabaseClient, planId: string, userId: string): Promise<boolean> {
  const first = () => db.from('audit_logs').select('id')
    .eq('action', EVERYONE_IN_ACTION).eq('resource_id', planId)
    .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1);
  const before = await first();
  if (before.error) {
    // Better silent than twice: this one is a courtesy, not a gate.
    console.error('[everyone-in] could not check whether it was announced', { planId, code: before.error.code });
    return false;
  }
  if (before.data?.length) return false;
  const { data: mine, error } = await db.from('audit_logs')
    .insert({ user_id: userId, action: EVERYONE_IN_ACTION, resource: 'plans', resource_id: planId, success: true })
    .select('id').single();
  if (error || !mine) {
    console.error('[everyone-in] could not record the announcement — not sending', { planId, code: error?.code });
    return false;
  }
  const after = await first();
  return !after.error && after.data?.[0]?.id === mine.id;
}

export async function announceIfEveryoneIn(
  db: SupabaseClient,
  plan: { id: string; group_id: string; title?: string | null; type?: string | null; destination_style?: string | null },
  byUserId: string,
  send: Sender | null,
): Promise<boolean> {
  // Only a trip still waiting on answers. Once a destination is picked the
  // answers are for the days, and nobody needs telling.
  if (plan.destination_style !== 'undecided') return false;
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
  if (!(await claimOnce(db, plan.id, byUserId))) return false;

  const night = plan.type === 'restaurant';
  await notifyUsers(db, memberIds, {
    kind: 'everyone_in',
    title: "Everyone's in",
    body: night
      ? 'All of you have answered — find your ideas for the night.'
      : 'All of you have answered — your trip ideas are built from every one of your answers.',
    url: `/home?waiting=${encodeURIComponent(plan.id)}&group=${encodeURIComponent(plan.group_id)}`,
    planId: plan.id,
  }, send);
  return true;
}
