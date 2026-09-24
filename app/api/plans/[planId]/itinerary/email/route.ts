// ─── /api/plans/[planId]/itinerary/email ─────────────────────────────────
// Sends the whole trip — every day, every cost, what each place takes — to
// the group. A plan is only useful on the day if it is somewhere findable
// without signal and without opening an app.
//
// POST { everyone?: boolean }  → just you, or the whole group
import { NextRequest, NextResponse } from 'next/server';
import { appUrl } from '@/lib/app-url';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { sendItinerary } from '@/lib/email';
import { formatDates } from '@/lib/dates';
import { itineraryLines } from '@/lib/itinerary-email';

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const db = ctx.db;

  const body = await req.json().catch(() => ({}));
  const everyone = body?.everyone === true;

  const { data: plan } = await db
    .from('plans').select('id, title, group_id, start_date, end_date').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const { data: items } = await db
    .from('itinerary_items')
    .select('id, type, title, subtitle, scheduled_time, cost_cents, booking_mode, payment_note')
    .eq('plan_id', params.planId).order('sort_order');

  if (!items?.length) {
    return NextResponse.json(
      { error: "This trip has no day-by-day plan yet — build one first and it'll be worth sending." },
      { status: 409 },
    );
  }

  const { data: group } = await db.from('groups').select('name').eq('id', plan.group_id).single();

  // Each Reach line says where its booking stands, so the rows are read.
  // Unreadable: said as not yet booked, which is the claim that promises least.
  const { data: bookings, error: bookingsError } = await db
    .from('bookings').select('itinerary_item_id, status, provider_ref').eq('plan_id', params.planId);
  if (bookingsError) console.error('[itinerary email] could not read bookings', { planId: params.planId, code: bookingsError.code });
  const { fixed, days } = itineraryLines(items, bookings ?? []);

  // Who gets it: just the person asking, or everybody on the trip.
  const members = await groupMemberIds(db, plan.group_id);
  let recipients = [ctx.user.id];
  if (everyone) recipients = members;
  const { data: people } = await db.from('users').select('id, email').in('id', recipients);

  const base = appUrl(req);
  const dates = formatDates(plan.start_date, plan.end_date);

  let sent = 0;
  const failures: string[] = [];
  for (const person of people || []) {
    if (!person.email) continue;
    const result = await sendItinerary(person.email, {
      planTitle: plan.title, dates, groupName: group?.name || 'Your trip',
      fixed, days, url: `${base}/home`, memberCount: members.length,
    });
    if (result.sent) sent++;
    else failures.push(result.reason || 'error');
  }

  if (!sent) {
    const reason = failures[0];
    console.error('[itinerary email] nothing sent', { planId: params.planId, reason, attempted: failures.length });
    return NextResponse.json({
      sent: 0,
      error: reason === 'no_key'
        ? 'Email is not switched on for this deployment yet.'
        : 'Could not send that — please try again.',
    }, { status: 503 });
  }

  return NextResponse.json({ sent, attempted: (people || []).length });
}
