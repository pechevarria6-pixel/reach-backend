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
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = req.nextUrl.searchParams.get('q') || '';
  // PostgREST parses .or() as an expression: an unescaped comma, paren, or
  // backslash in the term rewrites the filter rather than matching text.
  const q = raw.trim().replace(/[,()\\%*]/g, '').slice(0, 60);
  if (q.length < 2) return NextResponse.json({ users: [] });

  const supabase = createServerClient();
  const { data: me, error: meError } = await supabase
    .from('users').select('id').eq('clerk_id', clerkId).maybeSingle();
  if (meError) {
    console.error('[users/search] could not identify the caller', meError);
    return NextResponse.json({ error: 'Could not search just now' }, { status: 500 });
  }
  if (!me) return NextResponse.json({ users: [] });

  // The groups the caller is in, then everybody in those groups.
  const { data: mine, error: minesError } = await supabase
    .from('group_members').select('group_id').eq('user_id', me.id);
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
  const ids = [...new Set((circle || []).map(r => r.user_id))].filter(id => id !== me.id);
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
