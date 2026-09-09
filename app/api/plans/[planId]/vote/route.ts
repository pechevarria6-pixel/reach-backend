import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

// POST /api/plans/[id]/vote — cast a vote
export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { option } = await req.json();
  if (!option) return NextResponse.json({ error: 'option is required' }, { status: 400 });

  const supabase = createServerClient();
  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Verify plan exists and is in voting status
  const { data: plan } = await supabase.from('plans').select('*, groups(group_members(*))').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  if (plan.status !== 'voting') return NextResponse.json({ error: 'Plan is not in voting status' }, { status: 400 });

  // Verify option is valid
  if (!plan.vote_options.includes(option)) return NextResponse.json({ error: 'Invalid vote option' }, { status: 400 });

  // Check user hasn't already voted (enforced by DB unique constraint too)
  const { data: existingVote } = await supabase
    .from('votes').select('id').eq('plan_id', params.planId).eq('user_id', user.id).single();
  if (existingVote) return NextResponse.json({ error: 'You have already voted' }, { status: 409 });

  const { data: vote } = await supabase
    .from('votes').insert({ plan_id: params.planId, user_id: user.id, option }).select().single();

  return NextResponse.json({ vote }, { status: 201 });
}

// GET /api/plans/[id]/vote — get current vote tallies
export async function GET(_: NextRequest, { params }: { params: { planId: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  const { data: votes } = await supabase.from('votes').select('option').eq('plan_id', params.planId);

  const tally: Record<string, number> = {};
  votes?.forEach(v => { tally[v.option] = (tally[v.option] || 0) + 1; });

  return NextResponse.json({ tally, total: votes?.length || 0 });
}
