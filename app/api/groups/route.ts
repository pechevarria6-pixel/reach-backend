import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { z } from 'zod';

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  emoji: z.string().max(80).optional(),
  memberIds: z.array(z.string().uuid()).optional(),
});

// GET /api/groups — get all groups for the current user
export async function GET() {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();

  let { data: user } = await supabase
    .from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ groups: [] });

  const { data: memberships } = await supabase
    .from('group_members')
    .select('groups(*), role')
    .eq('user_id', user.id);

  return NextResponse.json({ groups: memberships?.map(m => ({ ...m.groups, role: m.role })) || [] });
}

// POST /api/groups — create a new group
export async function POST(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = CreateGroupSchema.parse(await req.json());
  const supabase = createServerClient();

  let { data: user } = await supabase
    .from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) {
    const cu = await currentUser();
    const email = cu?.primaryEmailAddress?.emailAddress
      ?? cu?.emailAddresses?.[0]?.emailAddress
      ?? `${clerkId}@no-email.reach`;
    const name = [cu?.firstName, cu?.lastName].filter(Boolean).join(' ') || null;
    const { data: created, error: userErr } = await supabase.from('users').insert({ clerk_id: clerkId, email, name }).select('id').single();
    if (userErr || !created) {
      console.error('[groups POST] user insert failed', userErr);
      return NextResponse.json({ error: "Couldn't set up your profile" }, { status: 500 });
    }
    user = created;
  }

  // Create group
  const { data: group, error } = await supabase
    .from('groups')
    .insert({ name: body.name, emoji: body.emoji, created_by: user.id })
    .select().single();

  if (error || !group) {
    console.error('[groups POST] group insert failed', error);
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
  }

  // Add creator as admin
  await supabase.from('group_members').insert({ group_id: group.id, user_id: user.id, role: 'admin' });

  // Add additional members if provided
  if (body.memberIds?.length) {
    await supabase.from('group_members').insert(
      body.memberIds.map(uid => ({ group_id: group.id, user_id: uid, role: 'member' }))
    );
  }

  await supabase.from('audit_logs').insert({ user_id: user.id, action: 'group_created', resource: 'groups', resource_id: group.id, success: true });

  return NextResponse.json({ group }, { status: 201 });
}
