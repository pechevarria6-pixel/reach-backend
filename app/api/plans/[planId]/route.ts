import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { z } from 'zod';

const UpdatePlanSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['planning','voting','approved','booked','completed','cancelled']).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  budget_cents: z.number().min(0).optional(),
  accommodation: z.string().optional(),
  vibe: z.string().optional(),
  destination_style: z.string().optional(),
  dealbreakers: z.array(z.string()).optional(),
  vote_options: z.array(z.string()).optional(),
});

// GET /api/plans/[id] — get a single plan with itinerary and votes
export async function GET(_: NextRequest, { params }: { params: { planId: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: plan } = await supabase.from('plans').select('*').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Verify user is in the group
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [itineraryRes, votesRes] = await Promise.all([
    supabase.from('itinerary_items').select('*').eq('plan_id', params.planId).order('sort_order'),
    supabase.from('votes').select('option, user_id').eq('plan_id', params.planId),
  ]);

  // Build vote tally
  const tally: Record<string, number> = {};
  votesRes.data?.forEach(v => { tally[v.option] = (tally[v.option] || 0) + 1; });
  const myVote = votesRes.data?.find(v => v.user_id === user.id)?.option || null;

  return NextResponse.json({
    plan,
    itinerary: itineraryRes.data || [],
    votes: tally,
    myVote,
    totalVotes: votesRes.data?.length || 0,
  });
}

// PATCH /api/plans/[id] — update a plan
export async function PATCH(req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = UpdatePlanSchema.parse(await req.json());
  const supabase = createServerClient();

  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: plan } = await supabase.from('plans').select('group_id').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Handle status-specific timestamps
  const updates: any = { ...body };
  if (body.status === 'approved') updates.approved_at = new Date().toISOString();
  if (body.status === 'booked') updates.booked_at = new Date().toISOString();

  const { data: updated } = await supabase.from('plans').update(updates).eq('id', params.planId).select().single();
  return NextResponse.json({ plan: updated });
}

// DELETE /api/plans/[id] — delete a plan
export async function DELETE(_: NextRequest, { params }: { params: { planId: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

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
