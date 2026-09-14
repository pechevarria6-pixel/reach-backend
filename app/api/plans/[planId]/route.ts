import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { toDateOrNull } from '@/lib/dates';
import { z } from 'zod';

const UpdatePlanSchema = z.object({
  title: z.string().min(1).max(200).nullish(),
  status: z.enum(['planning','voting','approved','booked','completed','cancelled']).nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  budget_cents: z.number().min(0).nullish(),
  accommodation: z.string().nullish(),
  vibe: z.string().nullish(),
  destination_style: z.string().nullish(),
  dealbreakers: z.array(z.string()).nullish(),
  vote_options: z.array(z.string()).nullish(),
});

// GET /api/plans/[id] — get a single plan with itinerary and votes
export async function GET(_: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const user = ctx.user;

  const { data: plan } = await supabase.from('plans').select('*').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Verify user is in the group
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [itineraryRes, votesRes, membersRes] = await Promise.all([
    supabase.from('itinerary_items').select('*').eq('plan_id', params.planId).order('sort_order'),
    supabase.from('votes').select('option, user_id').eq('plan_id', params.planId),
    supabase.from('group_members').select('user_id, users(id, name, email, avatar_url)').eq('group_id', plan.group_id),
  ]);

  // Build vote tally
  const tally: Record<string, number> = {};
  votesRes.data?.forEach(v => { tally[v.option] = (tally[v.option] || 0) + 1; });
  const myVote = votesRes.data?.find(v => v.user_id === user.id)?.option || null;

  const participants = (membersRes.data || []).map(m => m.user_id);

  return NextResponse.json({
    plan: { ...plan, participants },
    participants,
    members: membersRes.data || [],
    itinerary: itineraryRes.data || [],
    votes: tally,
    myVote,
    totalVotes: votesRes.data?.length || 0,
  });
}

// PATCH /api/plans/[id] — update a plan
export async function PATCH(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  // safeParse, not parse: a throw here surfaces as an opaque 500 and the
  // client cannot tell bad input from a server fault.
  const parsed = UpdatePlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const supabase = ctx.db;

  const user = ctx.user;

  const { data: plan } = await supabase.from('plans').select('group_id').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Handle status-specific timestamps
  const updates: any = { ...body };
  // Same guard as POST /api/plans: never hand Postgres a display string.
  if ('start_date' in updates) updates.start_date = toDateOrNull(updates.start_date);
  if ('end_date' in updates) updates.end_date = toDateOrNull(updates.end_date);
  if (body.status === 'approved') updates.approved_at = new Date().toISOString();
  if (body.status === 'booked') updates.booked_at = new Date().toISOString();

  const { data: updated } = await supabase.from('plans').update(updates).eq('id', params.planId).select().single();
  return NextResponse.json({ plan: updated });
}

// DELETE /api/plans/[id] — delete a plan
export async function DELETE(_: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const user = ctx.user;

  const { data: plan } = await supabase.from('plans').select('group_id, created_by').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Only creator or group admin can delete
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership || (membership.role !== 'admin' && plan.created_by !== user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await supabase.from('plans').delete().eq('id', params.planId);
  return NextResponse.json({ success: true });
}
