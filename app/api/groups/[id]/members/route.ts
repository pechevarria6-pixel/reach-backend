import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

// POST /api/groups/[id]/members — add a member
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { email, userId } = await req.json();
  const supabase = createServerClient();

  const { data: requester } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!requester) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Must be admin to add members
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', params.id).eq('user_id', requester.id).single();
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
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId: targetUserId } = await req.json();
  const supabase = createServerClient();

  const { data: requester } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!requester) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', params.id).eq('user_id', requester.id).single();

  // Admin can remove anyone, members can only remove themselves
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (membership.role !== 'admin' && requester.id !== targetUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await supabase.from('group_members').delete().eq('group_id', params.id).eq('user_id', targetUserId);
  return NextResponse.json({ success: true });
}
