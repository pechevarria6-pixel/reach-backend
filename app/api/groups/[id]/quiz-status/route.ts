import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';

// GET /api/groups/[id]/quiz-status — who has had their say, and who has not
//
// Readiness, and nothing else. This used to hand every member's email, their
// top two preferences and their budget range to anybody else in the group —
// so joining a trip disclosed what you eat, what you listen to and what you
// can afford to everyone else on it. Being in a group is not consent to be
// read that way.
//
// The group is entitled to know who it is waiting for. It is not entitled to
// their answers. Same rule as travel essentials, for the same reason.
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireGroupMember(params.id);
  if (isFail(ctx)) return ctx.error;
  const supabase = ctx.db;

  // Get all group members with their preference data
  const { data: members } = await supabase
    .from('group_members')
    .select(`
      role,
      users(
        id, name, email, avatar_url,
        cuisines, music_genres, activity_vibe,
        budget_range, dietary_needs, no_way_jose
      )
    `)
    .eq('group_id', params.id);

  if (!members) return NextResponse.json({ members: {} });

  const result: Record<string, object> = {};

  for (const m of members) {
    const u = (m as any).users;
    if (!u) continue;

    // Quiz is "done" if they have answered ANY question including optional ones
    const quizDone = !!(
      (u.cuisines?.length > 0) ||
      (u.music_genres?.length > 0) ||
      (u.activity_vibe?.length > 0) ||
      (u.no_way_jose?.length > 0) ||
      (u.dining_vibe) ||
      (u.drink_style) ||
      (u.nightlife_style) ||
      u.budget_range
    );

    result[u.id] = {
      id: u.id,
      // A name the group already sees on its own member list. Not the email:
      // deriving a display name from one is still handing the email over.
      name: u.name || 'Member',
      avatar: u.avatar_url,
      quizDone,
    };
  }

  const completedCount = Object.values(result).filter((m: any) => m.quizDone).length;
  const totalCount = Object.keys(result).length;

  return NextResponse.json({
    members: result,
    completedCount,
    totalCount,
    allComplete: completedCount >= totalCount && totalCount > 0,
  });
}
