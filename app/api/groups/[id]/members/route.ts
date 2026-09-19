// ─── /api/groups/[id]/members ────────────────────────────────────────────
// POST   { userId } | { email }  → add a member, or invite them if they have
//                                  no account yet
// DELETE { userId }              → remove a member (admin, or yourself)
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';
import { normalizeEmail, newInviteToken, INVITE_TTL_DAYS } from '@/lib/invites';
import { sendGroupInvite } from '@/lib/email';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireGroupMember(params.id);
  if (isFail(ctx)) return ctx.error;
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const userId = typeof body.userId === 'string' ? body.userId : null;
  if (!userId && !email) {
    return NextResponse.json({ error: 'userId or email required' }, { status: 400 });
  }

  const supabase = ctx.db;

  // ── Someone who already has an account joins immediately ───────────────
  let targetUser: { id: string } | null = null;
  if (userId) {
    const { data } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
    if (!data) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    targetUser = data;
  } else {
    const { data } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    targetUser = data;
  }

  if (targetUser) {
    const { data: existing } = await supabase
      .from('group_members').select('id')
      .eq('group_id', params.id).eq('user_id', targetUser.id).maybeSingle();
    if (existing) return NextResponse.json({ error: 'Already a member' }, { status: 409 });

    const { error } = await supabase
      .from('group_members')
      .insert({ group_id: params.id, user_id: targetUser.id, role: 'member' });
    if (error) {
      console.error('[members POST] insert failed', error);
      return NextResponse.json({ error: 'Could not add that member' }, { status: 500 });
    }
    return NextResponse.json({ added: true, userId: targetUser.id }, { status: 201 });
  }

  // ── Nobody by that address yet: invite them ────────────────────────────
  // This used to be a flat 404, so a group could only ever contain people who
  // had already signed up. The invite is claimed automatically the first time
  // they authenticate with this address.
  const { data: existingInvite } = await supabase
    .from('group_invites')
    .select('id, token, expires_at')
    .eq('group_id', params.id)
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle();

  const token = existingInvite?.token || newInviteToken();
  let invite = existingInvite;

  if (!existingInvite) {
    const { data, error } = await supabase.from('group_invites').insert({
      group_id: params.id,
      email,
      invited_by: ctx.user.id,
      token,
      expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString(),
    }).select('id, token, expires_at').single();
    if (error) {
      console.error('[members POST] invite insert failed', error);
      return NextResponse.json({ error: 'Could not create that invite' }, { status: 500 });
    }
    invite = data;
  }

  // Email delivery is best-effort. The invite is already valid without it,
  // and the caller gets a link it can share by other means.
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const acceptUrl = `${base.replace(/\/$/, '')}/invite/${token}`;
  let emailed = false;

  if (process.env.RESEND_API_KEY) {
    try {
      const [{ data: group }, { data: inviter }] = await Promise.all([
        supabase.from('groups').select('name, emoji').eq('id', params.id).single(),
        supabase.from('users').select('name').eq('id', ctx.user.id).maybeSingle(),
      ]);
      // The result, not the absence of a throw. lib/email reports a failure
      // by returning { sent: false } — it deliberately never throws into a
      // request that was doing something more important — so this said
      // emailed: true whenever the key was rejected, and the screen told
      // somebody an invitation had gone out that never left the building.
      const result = await sendGroupInvite(email, {
        groupName: group?.name || 'a group',
        groupEmoji: group?.emoji,
        inviterName: inviter?.name,
        acceptUrl,
      });
      emailed = result.sent;
      if (!result.sent) {
        console.error('[members POST] invite not sent', { reason: result.reason, detail: result.detail });
      }
    } catch (e) {
      console.error('[members POST] invite email failed', e);
    }
  }

  return NextResponse.json(
    { invited: true, email, emailed, acceptUrl, expiresAt: invite?.expires_at },
    { status: 201 }
  );
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireGroupMember(params.id);
  if (isFail(ctx)) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const targetUserId = body.userId;
  if (!targetUserId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  // Admins can remove anyone; everyone else can only remove themselves.
  if (ctx.role !== 'admin' && ctx.user.id !== targetUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Don't strand a group with no admin.
  if (ctx.role === 'admin') {
    const { data: admins } = await ctx.db
      .from('group_members').select('user_id').eq('group_id', params.id).eq('role', 'admin');
    const adminIds = (admins || []).map(a => a.user_id);
    if (adminIds.length === 1 && adminIds[0] === targetUserId) {
      return NextResponse.json(
        { error: 'Promote another admin before leaving — a group needs one.' },
        { status: 409 }
      );
    }
  }

  await ctx.db.from('group_members')
    .delete().eq('group_id', params.id).eq('user_id', targetUserId);
  return NextResponse.json({ success: true });
}
