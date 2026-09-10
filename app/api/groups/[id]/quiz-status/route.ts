import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';

// GET /api/groups/[id]/quiz-status — who has completed their preference quiz
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  // This returns every member's name, email and preferences, so it must be
  // restricted to the group itself rather than any signed-in user.
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

    // Top prefs for display
    const topPrefs = [
      ...(u.cuisines || []).slice(0, 1),
      ...(u.music_genres || []).slice(0, 1),
      ...(u.activity_vibe || []).slice(0, 1),
    ].slice(0, 2);

    result[u.id] = {
      id: u.id,
      name: u.name || u.email?.split('@')[0] || 'Member',
      email: u.email,
      avatar: u.avatar_url,
      quizDone,
      topPrefs,
      budgetRange: u.budget_range,
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
