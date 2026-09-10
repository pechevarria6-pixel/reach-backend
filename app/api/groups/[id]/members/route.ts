import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';

// POST /api/groups/[id]/members — add a member
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const { email, userId } = await req.json();
  const supabase = ctx.db;

  const user = ctx.user;

  // Must be admin to add members
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', params.id).eq('user_id', ctx.user.id).single();
  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  // Find user by email or userId
  let targetUser;
  if (userId) {
    const { data } = await supabase.from('users').select('id').eq('id', userId).single();
    targetUser = data;
  } else if (email) {
    const { data } = await supabase.from('users').select('id').eq('email', email).single();
    targetUser = data;
  }

  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Check if already a member
  const { data: existing } = await supabase
    .from('group_members').select('id').eq('group_id', params.id).eq('user_id', targetUser.id).single();
  if (existing) return NextResponse.json({ error: 'Already a member' }, { status: 409 });

  await supabase.from('group_members').insert({ group_id: params.id, user_id: targetUser.id, role: 'member' });
  return NextResponse.json({ success: true }, { status: 201 });
}

// DELETE /api/groups/[id]/members — remove a member
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const { userId: targetUserId } = await req.json();
  const supabase = ctx.db;

  const user = ctx.user;

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', params.id).eq('user_id', ctx.user.id).single();

  // Admin can remove anyone, members can only remove themselves
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (membership.role !== 'admin' && ctx.user.id !== targetUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await supabase.from('group_members').delete().eq('group_id', params.id).eq('user_id', targetUserId);
  return NextResponse.json({ success: true });
}
