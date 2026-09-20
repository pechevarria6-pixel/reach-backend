import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';

// GET /api/groups/[id] — get a single group with members and plans
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;

  const user = ctx.user;

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
    // Itinerary items come along, aliased to `itinerary` so the client reads
    // the same shape it gets from /api/plans/[planId]. Without this a group
    // refresh replaced every plan's itinerary with an empty array, so a
    // day-by-day plan vanished until the plan screen refetched it.
    supabase.from('plans').select('*, itinerary:itinerary_items(*)')
      .eq('group_id', params.id).order('created_at', { ascending: false }),
  ]);

  // Plans are group-wide, so everyone in the group is a participant. The
  // client renders traveler counts and avatars from this; without it every
  // server-loaded plan showed "0 travelers" and no faces.
  const participants = (membersRes.data || []).map(m => m.user_id);

  return NextResponse.json({
    group: groupRes.data,
    members: membersRes.data,
    plans: (plansRes.data || []).map(p => ({ ...p, participants })),
    myRole: membership.role,
  });
}

// PATCH /api/groups/[id] — update group name or emoji
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const user = ctx.user;

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
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const user = ctx.user;

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', params.id).eq('user_id', user.id).single();
  if (!membership || membership.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  // A group takes its trips with it, and a trip can be holding a real
  // reservation. Deleting the group does not un-book a hotel, so the same
  // rule as deleting one trip: say what is booked and refuse, rather than
  // leave somebody with a booking they can no longer see.
  const { data: plans, error: plansErr } = await supabase
    .from('plans').select('id, title').eq('group_id', params.id);
  if (plansErr) {
    console.error('[groups] could not read the group’s trips', { group: params.id, code: plansErr.code });
    return NextResponse.json({ error: "We couldn't check this group's trips — nothing was deleted" }, { status: 500 });
  }

  const planIds = (plans ?? []).map(p => p.id);
  if (planIds.length) {
    const { data: held, error: heldErr } = await supabase
      .from('bookings').select('id, status, plan_id')
      .in('plan_id', planIds)
      .in('status', ['confirmed', 'redirected', 'pending']);
    if (heldErr) {
      console.error('[groups] could not read what the trips are holding', { group: params.id, code: heldErr.code });
      return NextResponse.json({ error: "We couldn't check this group's bookings — nothing was deleted" }, { status: 500 });
    }
    if (held?.length) {
      const titles = [...new Set(held.map(b => (plans ?? []).find(p => p.id === b.plan_id)?.title).filter(Boolean))];
      return NextResponse.json({
        error: 'This group has trips with things still booked. Cancel those first and the group will delete cleanly.',
        holding: titles,
      }, { status: 409 });
    }
  }

  const { error: removed } = await supabase.from('groups').delete().eq('id', params.id);
  if (removed) {
    console.error('[groups] could not delete the group', { group: params.id, code: removed.code });
    return NextResponse.json({ error: "We couldn't delete that just now" }, { status: 500 });
  }

  const { error: audit } = await supabase.from('audit_logs').insert({
    user_id: user.id, action: 'group_deleted', resource: 'groups', resource_id: params.id, success: true,
    metadata: { plans_removed: planIds.length },
  });
  if (audit) console.error('[audit] could not record group_deleted', { group: params.id, code: audit.code });

  return NextResponse.json({ success: true, plansRemoved: planIds.length });
}
