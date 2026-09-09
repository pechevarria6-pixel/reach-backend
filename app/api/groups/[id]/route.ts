import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

// GET /api/groups/[id] — get a single group with members and plans
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();

  const { data: user } = await supabase
    .from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Verify user is a member of this group
  const { data: membership } = await supabase
    .from('group_members')
    .select('role')
    .eq('group_id', params.id)
    .eq('user_id', user.id)
    .single();

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [groupRes, membersRes, plansRes] = await Promise.all([
    supabase.from('groups').select('*').eq('id', params.id).single(),
    supabase.from('group_members').select('*, users(id, name, email, avatar_url)').eq('group_id', params.id),
    supabase.from('plans').select('*').eq('group_id', params.id).order('created_at', { ascending: false }),
  ]);

  return NextResponse.json({
    group: groupRes.data,
    members: membersRes.data,
    plans: plansRes.data,
    myRole: membership.role,
  });
}

// PATCH /api/groups/[id] — update group name or emoji
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', params.id).eq('user_id', user.id).single();
  if (!membership || membership.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  const body = await req.json();
  const allowed = ['name', 'emoji'];
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));

  const { data } = await supabase.from('groups').update(updates).eq('id', params.id).select().single();
  return NextResponse.json({ group: data });
}

// DELETE /api/groups/[id] — delete a group (admin only)
export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', params.id).eq('user_id', user.id).single();
  if (!membership || membership.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  await supabase.from('groups').delete().eq('id', params.id);
  return NextResponse.json({ success: true });
}
