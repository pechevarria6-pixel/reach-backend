import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { z } from 'zod';

const ItemSchema = z.object({
  type: z.enum(['flight','hotel','activity','restaurant','transport']),
  title: z.string().min(1),
  subtitle: z.string().nullish(),
  booking_mode: z.enum(['reach','ahead','walk_in']).nullish(),
  payment_note: z.string().max(120).nullish(),
  // Whose wish this slot answers, when it answers one.
  because: z.string().max(200).nullish(),
  scheduled_time: z.string().nullish(),
  confirmation_number: z.string().nullish(),
  is_confirmed: z.boolean().nullish(),
  cost_cents: z.number().nullish(),
  sort_order: z.number().nullish(),
});

// POST /api/plans/[id]/itinerary — add item
export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  // safeParse, not parse: a throw here surfaces as an opaque 500 and the
  // client cannot tell bad input from a server fault.
  const parsed = ItemSchema.safeParse(await req.json().catch(() => null));
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

  const { data: item } = await supabase.from('itinerary_items')
    .insert({ plan_id: params.planId, ...body, is_confirmed: !!body.confirmation_number })
    .select().single();

  return NextResponse.json({ item }, { status: 201 });
}

// PUT /api/plans/[id]/itinerary — replace entire itinerary
export async function PUT(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const { items } = await req.json();
  const supabase = ctx.db;

  const user = ctx.user;

  const { data: plan } = await supabase.from('plans').select('group_id').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Delete all existing items and replace with new ones
  await supabase.from('itinerary_items').delete().eq('plan_id', params.planId);

  if (items && items.length > 0) {
    const rows = items.map((item: any, idx: number) => ({
        plan_id: params.planId,
        type: item.type,
        title: item.title,
        subtitle: item.sub || item.subtitle || null,
        scheduled_time: item.time || item.scheduled_time || null,
        confirmation_number: item.conf || item.confirmation_number || null,
        is_confirmed: !!(item.conf || item.confirmation_number),
        cost_cents: item.cost_cents || 0,
        // How you get in and what they take. Reach books what it can; for
        // everything else the traveller needs these before they arrive.
        booking_mode: item.booking_mode || null,
        payment_note: item.payment_note || null,
        because: item.because || null,
        sort_order: idx,
    }));

    const { error } = await supabase.from('itinerary_items').insert(rows);
    if (error) {
      // booking_mode and payment_note arrive in a migration. Until it is run,
      // save the days without them rather than losing the whole itinerary —
      // the practical details are worth having, the days are worth more.
      // PostgREST reports a missing column as PGRST204 with "Could not find
      // the 'x' column of 'y' in the schema cache" — not "column does not
      // exist". Matching only the latter meant the fallback never fired and
      // every itinerary save failed outright until the migration was run.
      const missingColumn = error.code === 'PGRST204'
        || /column .* does not exist|could not find the .* column/i.test(error.message || '');
      if (missingColumn) {
        console.error('[itinerary] optional columns missing, saving without them —'
          + ' run sql/itinerary-practicals-2026-09-14.sql and'
          + ' sql/itinerary-because-2026-09-18.sql');
        const { error: retry } = await supabase.from('itinerary_items').insert(
          rows.map(({ booking_mode, payment_note, because, ...rest }: any) => rest),
        );
        if (retry) {
          console.error('[itinerary] save failed', retry);
          return NextResponse.json({ error: 'Could not save those days' }, { status: 500 });
        }
      } else {
        console.error('[itinerary] save failed', error);
        return NextResponse.json({ error: 'Could not save those days' }, { status: 500 });
      }
    }
  }

  const { data: newItems } = await supabase.from('itinerary_items')
    .select('*').eq('plan_id', params.planId).order('sort_order');

  return NextResponse.json({ itinerary: newItems || [] });
}
