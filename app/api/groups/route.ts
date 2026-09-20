import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { normalizeEmail, newInviteToken, INVITE_TTL_DAYS } from '@/lib/invites';
import { z } from 'zod';

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  emoji: z.string().max(80).nullish(),
  memberIds: z.array(z.string().uuid()).nullish(),
  // Addresses that may not have an account yet; each becomes an invite.
  inviteEmails: z.array(z.string().email()).max(50).nullish(),
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

  // Groups, their members and their plans in one round trip. The client used
  // to fetch this list and then issue a further request per group just to get
  // the plans, which is N+1 on every app open.
  const [{ data: groups }, { data: plans }] = await Promise.all([
    supabase
      .from('groups')
      .select('*, group_members(user_id, role, users(id, name, email, avatar_url))')
      .in('id', groupIds),
    supabase
      .from('plans')
      .select('*, itinerary:itinerary_items(*)')
      .in('group_id', groupIds)
      .order('created_at', { ascending: false }),
  ]);

  const roleByGroup = Object.fromEntries((memberships || []).map(m => [m.group_id, m.role]));

  const plansByGroup = new Map<string, any[]>();
  for (const plan of plans || []) {
    const list = plansByGroup.get(plan.group_id) || [];
    list.push(plan);
    plansByGroup.set(plan.group_id, list);
  }

  return NextResponse.json({
    groups: (groups || []).map(g => {
      // Plans belong to the whole group, so its members are the participants.
      const participants = (g.group_members || []).map((m: any) => m.user_id);
      return {
        ...g,
        role: roleByGroup[g.id],
        plans: (plansByGroup.get(g.id) || []).map(p => ({ ...p, participants })),
      };
    }),
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

  // Add creator as admin. If this does not land, they have made a group they
  // are not in — it will not appear on their own screen, and nobody else can
  // be added to it either, because adding members is admin-only.
  const { error: adminErr } = await supabase
    .from('group_members').insert({ group_id: group.id, user_id: user.id, role: 'admin' });
  if (adminErr) {
    console.error('[groups POST] creator not added as admin', { group: group.id, code: adminErr.code });
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
  }

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

  // Invite anyone named by email who has no account yet; anyone who does is
  // added straight away, so the caller doesn't have to know which is which.
  let invited: string[] = [];
  const emails = [...new Set((body.inviteEmails || []).map(normalizeEmail).filter(Boolean))];
  if (emails.length) {
    const { data: known } = await supabase.from('users').select('id, email').in('email', emails);
    const knownByEmail = new Map((known || []).map(u => [u.email, u.id]));

    const directIds = emails
      .map(e => knownByEmail.get(e))
      .filter((id): id is string => !!id && id !== user.id && !extras.includes(id));
    if (directIds.length) {
      const { error: directErr } = await supabase.from('group_members').insert(
        directIds.map(uid => ({ group_id: group.id, user_id: uid, role: 'member' }))
      );
      // Named by email, has an account, and silently not added: they never
      // hear about the trip and nobody is told they are missing.
      if (directErr) console.error('[groups POST] could not add known members', { group: group.id, code: directErr.code });
    }

    const toInvite = emails.filter(e => !knownByEmail.has(e));
    if (toInvite.length) {
      const { error: inviteErr } = await supabase.from('group_invites').insert(
        toInvite.map(email => ({
          group_id: group.id,
          email,
          invited_by: user.id,
          token: newInviteToken(),
          expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString(),
        }))
      );
      if (inviteErr) console.error('[groups POST] invite insert failed', inviteErr);
      else invited = toInvite;
    }
  }

  // An audit trail that loses entries silently is how nine plans once

  // vanished with nothing to read afterwards. Never fails the request; it

  // does have to leave a mark.

  const { error: audit } = await supabase.from('audit_logs').insert({ user_id: user.id, action: 'group_created', resource: 'groups', resource_id: group.id, success: true });
  if (audit) console.error('[audit] could not record group_created', { code: audit.code });

  return NextResponse.json({ group, invited }, { status: 201 });
}
