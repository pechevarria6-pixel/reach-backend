// ─── /api/groups/[id]/invites ────────────────────────────────────────────
// GET                        → pending invites for this group
// DELETE { id } | { email }  → revoke one (admin only)
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';
import { normalizeEmail } from '@/lib/invites';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireGroupMember(params.id);
  if (isFail(ctx)) return ctx.error;

  const { data } = await ctx.db
    .from('group_invites')
    .select('id, email, status, created_at, expires_at')
    .eq('group_id', params.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const now = Date.now();
  // Don't show invites that have aged out; the claim path retires them.
  const invites = (data || []).filter(i => new Date(i.expires_at).getTime() > now);

  return NextResponse.json({ invites });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireGroupMember(params.id);
  if (isFail(ctx)) return ctx.error;
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const id = typeof body.id === 'string' ? body.id : null;
  if (!id && !email) {
    return NextResponse.json({ error: 'id or email required' }, { status: 400 });
  }

  let q = ctx.db.from('group_invites')
    .update({ status: 'revoked' })
    .eq('group_id', params.id)
    .eq('status', 'pending');
  q = id ? q.eq('id', id) : q.eq('email', email);

  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
