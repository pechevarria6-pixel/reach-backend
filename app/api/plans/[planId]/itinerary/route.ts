import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { z } from 'zod';
import { replaceItinerary, outcomeMessage } from '@/lib/itinerary-replace';
import { reconcileBookings } from '@/lib/itinerary-bookings';
import { rowFromItem } from '@/lib/contracts/itinerary-item';

const ItemSchema = z.object({
  // 'event' was missing, so a concert could only ever be filed as an
  // activity or a restaurant — and the thing that sells tickets is neither.
  type: z.enum(['flight','hotel','activity','restaurant','transport','event']),
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
  venue_website: z.string().url().max(500).nullish(),
  venue_name: z.string().max(200).nullish(),
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

  // The order of these two writes is the whole safety property, so it lives
  // in lib/itinerary-replace.ts with a test that fails if anybody puts the
  // delete back in front of the insert.
  // One shape, defined in lib/contracts/itinerary-item.ts and imported by
  // every layer that touches it. This used to be a hand-written field list,
  // and so did the two in the client — which is how the ticket URL, the
  // venue's website and what is on there each reached the row and never the
  // screen. Adding a fact to the contract now carries it here for free.
  const rows = (items ?? []).map((item: Record<string, unknown>, idx: number) => ({
    plan_id: params.planId,
    ...rowFromItem(item, idx),
  }));

  // What the lines were, so a booking on one can follow it to its new id.
  const { data: oldLines } = await supabase.from('itinerary_items')
    .select('id, type, title').eq('plan_id', params.planId);

  const outcome = await replaceItinerary(supabase, params.planId, rows, async (toWrite) => {
    const { error } = await supabase.from('itinerary_items').insert(toWrite);
    if (!error) return null;

    // booking_mode and payment_note arrive in a migration. Until it is run,
    // save the days without them rather than losing the whole itinerary —
    // the practical details are worth having, the days are worth more.
    // PostgREST reports a missing column as PGRST204 with "Could not find
    // the 'x' column of 'y' in the schema cache" — not "column does not
    // exist". Matching only the latter meant the fallback never fired and
    // every itinerary save failed outright until the migration was run.
    const missingColumn = error.code === 'PGRST204'
      || /column .* does not exist|could not find the .* column/i.test(error.message || '');
    if (!missingColumn) return error.message || 'insert failed';

    console.error('[itinerary] optional columns missing, saving without them —'
      + ' run sql/itinerary-practicals-2026-09-14.sql and'
      + ' sql/itinerary-because-2026-09-18.sql');
    const { error: retry } = await supabase.from('itinerary_items').insert(
      toWrite.map(({ booking_mode, payment_note, because, ...rest }: any) => rest),
    );
    return retry ? (retry.message || 'insert failed') : null;
  });

  if (outcome.status !== 'replaced') {
    console.error('[itinerary] replace did not complete', { plan: params.planId, outcome });
    // Duplicated is not a failure to save — the days are there twice — so it
    // is reported as a conflict to tidy rather than as a save that did not
    // happen.
    return NextResponse.json(
      { error: outcomeMessage(outcome), ...(outcome.status === 'duplicated' ? { duplicated: true } : {}) },
      { status: outcome.status === 'duplicated' ? 409 : 500 },
    );
  }

  const { data: newItems } = await supabase.from('itinerary_items')
    .select('*').eq('plan_id', params.planId).order('sort_order');

  // Every line has a new id now. See lib/itinerary-bookings.ts for why the
  // bookings have to be told, and what happens to one whose line is gone.
  const { data: live } = await supabase.from('bookings')
    .select('id, itinerary_item_id, status').eq('plan_id', params.planId)
    .not('status', 'in', '("failed","cancelled")');
  const { relink, retire } = reconcileBookings(oldLines ?? [], newItems ?? [], live ?? []);
  for (const r of relink) {
    const { error } = await supabase.from('bookings').update({ itinerary_item_id: r.itemId }).eq('id', r.bookingId);
    if (error) console.error('[itinerary] could not move a booking onto its line', { plan: params.planId, booking: r.bookingId, code: error.code });
  }
  if (retire.length) {
    const { error } = await supabase.from('bookings')
      .update({ status: 'cancelled', itinerary_item_id: null }).in('id', retire);
    if (error) console.error('[itinerary] could not retire bookings for removed lines', { plan: params.planId, count: retire.length, code: error.code });
  }

  return NextResponse.json({ itinerary: newItems || [] });
}
