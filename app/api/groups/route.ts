import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { z } from 'zod';

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  emoji: z.string().max(80).optional(),
  memberIds: z.array(z.string().uuid()).optional(),
});

// GET /api/groups — get all groups for the current user
export async function GET() {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const { db: supabase, user } = ctx;

  const { data: memberships } = await supabase
    .from('group_members')
    .select('group_id, role')
    .eq('user_id', user.id);

  const groupIds = (memberships || []).map(m => m.group_id);
  if (groupIds.length === 0) return NextResponse.json({ groups: [] });

  // Fetch the groups themselves plus every member of each, so the client can
  // render avatars without a second round trip per group.
  const { data: groups } = await supabase
    .from('groups')
    .select('*, group_members(user_id, role, users(id, name, email, avatar_url))')
    .in('id', groupIds);

  const roleByGroup = Object.fromEntries((memberships || []).map(m => [m.group_id, m.role]));

  return NextResponse.json({
    groups: (groups || []).map(g => ({ ...g, role: roleByGroup[g.id] })),
  });
}

// POST /api/groups — create a new group
export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const { db: supabase, user } = ctx;

  // safeParse, not parse: a throw here surfaces as an opaque 500 and the
  // client cannot tell bad input from a server fault.
  const parsed = CreateGroupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;

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

  // Add additional members if provided. The creator is already an admin, so
  // including them again would violate the (group_id, user_id) unique
  // constraint and drop the whole batch.
  const extras = [...new Set(body.memberIds || [])].filter(uid => uid !== user.id);
  if (extras.length) {
    const { error: memberErr } = await supabase.from('group_members').insert(
      extras.map(uid => ({ group_id: group.id, user_id: uid, role: 'member' }))
    );
    if (memberErr) console.error('[groups POST] member insert failed', memberErr);
  }

  await supabase.from('audit_logs').insert({ user_id: user.id, action: 'group_created', resource: 'groups', resource_id: group.id, success: true });

  return NextResponse.json({ group }, { status: 201 });
}
