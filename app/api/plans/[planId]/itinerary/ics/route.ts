// ─── GET /api/plans/[planId]/itinerary/ics — Add to calendar ─────────────
// The trip's itinerary as a calendar file for the person's own calendar app.
// lib/ics.ts places each line on the date it is on (local dates, never the
// server's UTC day) and invents no time and no duration; itineraryEvents in
// lib/wallet.ts decides what each event says.
//
// → 200 text/calendar, as a download named after the trip
// → 409 { error } when there is nothing that can be put on a calendar: no
//   itinerary yet, or no dates to put it on. An empty calendar file would
//   import as "done" and leave nothing on the calendar.
//
// Signed in, a member of the plan: the link is opened from the app, where
// the session cookie travels with it.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { buildIcs, validDay } from '@/lib/ics';
import { readSkips } from '@/lib/participation';
import { itineraryEvents, type IcsItem, type WalletBookingRow } from '@/lib/wallet';

function fileName(title: string): string {
  const slug = title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${slug || 'trip'}.ics`;
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const db = ctx.db;
  const plan = ctx.plan as { title?: string | null; start_date?: string | null };

  if (!validDay(plan.start_date)) {
    return NextResponse.json({ error: "This plan has no dates yet, so there's nothing to put on a calendar." }, { status: 409 });
  }

  const [{ data: items, error: iErr }, { data: bookings, error: bErr }] = await Promise.all([
    db.from('itinerary_items')
      .select('id, title, subtitle, scheduled_time, confirmation_number, venue_name, venue_website, sort_order')
      .eq('plan_id', params.planId).order('sort_order'),
    db.from('bookings').select('*').eq('plan_id', params.planId),
  ]);
  if (iErr) {
    console.error('[ics] could not read the itinerary', { planId: params.planId, code: iErr.code });
    return NextResponse.json({ error: 'Could not read the itinerary just now.' }, { status: 503 });
  }
  // Without the bookings the events carry no confirmation numbers, which
  // claims less, not more.
  if (bErr) console.error('[ics] could not read bookings', { planId: params.planId, code: bErr.code });

  let mySkips: string[] = [];
  try {
    mySkips = (await readSkips(db, params.planId)).skips.filter(s => s.userId === ctx.user.id).map(s => s.ref);
  } catch {
    // Unread: every line goes on the calendar, which can be deleted there.
  }

  const events = itineraryEvents({
    items: (items ?? []) as IcsItem[],
    bookings: (bookings ?? []) as WalletBookingRow[],
    startDate: plan.start_date,
    mySkips,
  });
  if (!events.length) {
    return NextResponse.json({ error: "This plan has no day-by-day itinerary yet, so there's nothing to put on a calendar." }, { status: 409 });
  }

  const name = plan.title?.trim() || 'Trip';
  return new NextResponse(buildIcs(events, { name }), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName(name)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
