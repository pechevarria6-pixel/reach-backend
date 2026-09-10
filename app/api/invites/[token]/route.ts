// ─── /api/invites/[token] ────────────────────────────────────────────────
// GET  → who is inviting you, and to what (used by the /invite/[token] page
//        before sign-in, so the address is never revealed)
// POST → accept as the signed-in user
//
// The email-matching claim in lib/invites.ts covers the normal case. This
// exists for the link a person opens directly, including when they sign up
// with a different address than the one that was invited.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const db = createServerClient();
  const { data: invite } = await db
    .from('group_invites')
    .select('status, expires_at, groups(name, emoji), users:invited_by(name)')
    .eq('token', params.token)
    .maybeSingle();

  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });

  const expired = new Date(invite.expires_at).getTime() <= Date.now();
  const group = Array.isArray(invite.groups) ? invite.groups[0] : invite.groups;
  const inviter = Array.isArray(invite.users) ? invite.users[0] : invite.users;

  // Deliberately no email address in this response — the token is shareable
  // and the page is viewable before sign-in.
  return NextResponse.json({
    status: expired ? 'expired' : invite.status,
    groupName: group?.name || null,
    groupEmoji: group?.emoji || null,
    invitedBy: inviter?.name || null,
  });
}

export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const { data: invite } = await ctx.db
    .from('group_invites')
    .select('id, group_id, role, status, expires_at')
    .eq('token', params.token)
    .maybeSingle();

  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  if (invite.status !== 'pending') {
    return NextResponse.json({ error: `This invite was already ${invite.status}` }, { status: 409 });
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    await ctx.db.from('group_invites').update({ status: 'expired' }).eq('id', invite.id);
    return NextResponse.json({ error: 'This invite has expired' }, { status: 409 });
  }

  const { data: existing } = await ctx.db
    .from('group_members').select('id')
    .eq('group_id', invite.group_id).eq('user_id', ctx.user.id).maybeSingle();

  if (!existing) {
    const { error } = await ctx.db.from('group_members').insert({
      group_id: invite.group_id,
      user_id: ctx.user.id,
      role: invite.role || 'member',
    });
    if (error && !String(error.code).startsWith('23')) {
      console.error('[invite accept] join failed', error);
      return NextResponse.json({ error: 'Could not join that group' }, { status: 500 });
    }
  }

  await ctx.db.from('group_invites').update({
    status: 'accepted',
    accepted_at: new Date().toISOString(),
    accepted_by: ctx.user.id,
  }).eq('id', invite.id);

  return NextResponse.json({ joined: true, groupId: invite.group_id });
}
