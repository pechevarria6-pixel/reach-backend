// ─── GET /api/users/search?q= — find someone you already travel with ─────
// This used to answer any signed-in caller with every account whose name or
// address matched, address included. Two letters at a time — "gm", "ai" —
// walked the whole user table, ten rows a page, and handed back working email
// addresses belonging to strangers.
//
// Two changes. It searches only people who share a group with the caller, so
// the answer is drawn from their own circle rather than the database; and it
// never returns an address. Somebody not yet in a shared group is added by
// email through POST /api/groups/[id]/members, which sends them an invite and
// tells the caller nothing about whether that address already has an account.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';

export async function GET(req: NextRequest) {
  // Through the one boundary, so the Clerk id is turned into this app's id
  // once and nothing downstream has to know there are two kinds.
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const raw = req.nextUrl.searchParams.get('q') || '';
  // PostgREST parses .or() as an expression: an unescaped comma, paren, or
  // backslash in the term rewrites the filter rather than matching text.
  const q = raw.trim().replace(/[,()\\%*]/g, '').slice(0, 60);
  if (q.length < 2) return NextResponse.json({ users: [] });

  // requireUser has already found or made the row, so there is no "who?"
  // case left to handle here.
  const supabase = ctx.db;

  // The groups the caller is in, then everybody in those groups.
  const { data: mine, error: minesError } = await supabase
    .from('group_members').select('group_id').eq('user_id', ctx.user.id);
  if (minesError) {
    console.error('[users/search] could not read the caller\'s groups', minesError);
    return NextResponse.json({ error: 'Could not search just now' }, { status: 500 });
  }
  const groupIds = (mine || []).map(r => r.group_id);
  if (!groupIds.length) return NextResponse.json({ users: [] });

  const { data: circle, error: circleError } = await supabase
    .from('group_members').select('user_id').in('group_id', groupIds);
  if (circleError) {
    console.error('[users/search] could not read group members', circleError);
    return NextResponse.json({ error: 'Could not search just now' }, { status: 500 });
  }
  const ids = [...new Set((circle || []).map(r => r.user_id))].filter(id => id !== ctx.user.id);
  if (!ids.length) return NextResponse.json({ users: [] });

  // Names only. An address is never part of the answer, so a match cannot be
  // turned back into somebody's email.
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, avatar_url')
    .in('id', ids)
    .ilike('name', `%${q}%`)
    .limit(10);
  if (error) {
    console.error('[users/search] query failed', error);
    return NextResponse.json({ error: 'Could not search just now' }, { status: 500 });
  }

  return NextResponse.json({ users: users || [] });
}
