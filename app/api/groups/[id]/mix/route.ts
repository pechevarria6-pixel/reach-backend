// ─── /api/groups/[id]/mix ────────────────────────────────────────────────
// GET → { mix: { members: [{ id, name, profile }], sentence } | null }
//
// The group mix card: who in the group chases what, and one sentence about
// how they fit. Members see each other's result and dials. They never see
// what anybody cannot eat, their hard nos, or anything they typed — so this
// selects traveler_profile, quiz_version (to count only people who finished)
// and a first name, and nothing else — and even that
// passes through publicProfile before it leaves (lib/traveler-profile).
//
// Same rule as /quiz-status: being in a group is not consent to be read.
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';
import { mixFromRows } from '@/lib/traveler-profile';
import { quizColumnsMissing } from '@/lib/quiz-store';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireGroupMember(params.id);
  if (isFail(ctx)) return ctx.error;

  const { data, error } = await ctx.db
    .from('group_members')
    .select('user_id, users(id, name, traveler_profile, quiz_version)')
    .eq('group_id', params.id);

  if (error) {
    // Before the migration there are no profiles to mix. Not an error for
    // the screen: the card simply is not there yet.
    if (quizColumnsMissing(error)) return NextResponse.json({ mix: null, reason: 'not_ready' });
    console.error('[groups/mix] could not read the group', { code: error.code });
    return NextResponse.json({ error: "Couldn't load the group's mix" }, { status: 500 });
  }

  return NextResponse.json({ mix: mixFromRows(data ?? []) });
}
