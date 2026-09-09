import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { z } from 'zod';

const ItemSchema = z.object({
  type: z.enum(['flight','hotel','activity','restaurant','transport']),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  scheduled_time: z.string().optional(),
  confirmation_number: z.string().optional(),
  is_confirmed: z.boolean().optional(),
  cost_cents: z.number().optional(),
  sort_order: z.number().optional(),
});

// POST /api/plans/[id]/itinerary — add item
export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = ItemSchema.parse(await req.json());
  const supabase = createServerClient();

  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: plan } = await supabase.from('plans').select('group_id').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: item } = await supabase.from('itinerary_items')
    .insert({ plan_id: params.planId, ...body, is_confirmed: !!body.confirmation_number })
    .select().single();

  return NextResponse.json({ item }, { status: 201 });
}

// PUT /api/plans/[id]/itinerary — replace entire itinerary
export async function PUT(req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { items } = await req.json();
  const supabase = createServerClient();

  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: plan } = await supabase.from('plans').select('group_id').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Delete all existing items and replace with new ones
  await supabase.from('itinerary_items').delete().eq('plan_id', params.planId);

  if (items && items.length > 0) {
    await supabase.from('itinerary_items').insert(
      items.map((item: any, idx: number) => ({
        plan_id: params.planId,
        type: item.type,
        title: item.title,
        subtitle: item.sub || item.subtitle || null,
        scheduled_time: item.time || item.scheduled_time || null,
        confirmation_number: item.conf || item.confirmation_number || null,
        is_confirmed: !!(item.conf || item.confirmation_number),
        cost_cents: item.cost_cents || 0,
        sort_order: idx,
      }))
    );
  }

  const { data: newItems } = await supabase.from('itinerary_items')
    .select('*').eq('plan_id', params.planId).order('sort_order');

  return NextResponse.json({ itinerary: newItems || [] });
}
