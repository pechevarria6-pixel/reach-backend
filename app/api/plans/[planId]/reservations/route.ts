// ─── GET /api/plans/[planId]/reservations — how each table gets booked ──
// One entry per restaurant line on the plan, in itinerary order, from
// lib/reservations/reserve.ts decide():
//
// 200 { reservations: [{
//   bookingId: string | null,      // null: no booking row yet — /bookable makes it; reserve needs one
//   itemId, restaurant,
//   when: { date, time, said },    // the line's own night (lib/line-when.ts); said: "Sat, Nov 7 at 7:30 PM"
//                                  //   — or, once booked, the night and time it was booked at
//   partySize,
//   path: 'instant' | 'call' | 'handoff',
//   open: boolean,                 // false: booked, maybe booked, or being booked — offer nothing
//   what: string,                  // what will happen, one sentence (where it stands, when not open)
//   needs: ('date'|'time')[],      // ask before the path runs; never defaulted
//   alternatives: [{ kind: 'instant'|'call'|'handoff'|'link'|'phone'|'confirm', label, what, href? }],   // [] when not open
//   terms: null | { platform, platformName, cancellationPolicy, depositCents, feeNote, termsUrl, statement },
//   ownAccount: null | { label: 'Book on your own OpenTable', href, perk },   // beside Reach's booking
//   status, state, offeredTimes, title, body,   // where it stands, from the row
// }] }
//
// Reads only. Nothing is held, quoted or rung from here: a platform's slot
// hold starts a five-minute clock, and that happens on POST
// /api/bookings/[id]/reserve, when somebody presses.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { decide, type TableRow } from '@/lib/reservations/reserve';
import { TABLE_ROW, placeOf, reserveDeps, tableFacts, type Line } from '@/lib/reservations/reserve-server';

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const plan = ctx.plan as Record<string, any>;

  const [lines, rows] = await Promise.all([
    ctx.db.from('itinerary_items').select('id, type, title, scheduled_time, venue_name, venue_phone, sort_order')
      .eq('plan_id', params.planId).eq('type', 'restaurant').order('sort_order', { ascending: true }),
    ctx.db.from('bookings').select(TABLE_ROW).eq('plan_id', params.planId).eq('vertical', 'restaurant')
      .not('status', 'in', '("cancelled")').order('created_at', { ascending: false }),
  ]);
  if (lines.error || rows.error) {
    console.error('[reservations] could not read the plan', { planId: params.planId, code: lines.error?.code ?? rows.error?.code });
    return NextResponse.json({ error: 'Could not read the tables on this plan just now.' }, { status: 500 });
  }

  // The newest live row for each line; a failed one is kept only when it is
  // all there is, because its reason and next option are the point of it.
  const byLine = new Map<string, TableRow & { itinerary_item_id?: string | null }>();
  const loose: (TableRow & { itinerary_item_id?: string | null })[] = [];
  for (const r of (rows.data ?? []) as (TableRow & { itinerary_item_id?: string | null })[]) {
    const key = r.itinerary_item_id;
    if (!key) { loose.push(r); continue; }
    const had = byLine.get(key);
    if (!had || (had.status === 'failed' && r.status !== 'failed')) byLine.set(key, r);
  }

  const deps = reserveDeps(ctx.db);
  const where = await placeOf(plan);
  const pairs: Array<[TableRow | null, Line | null]> = [
    ...((lines.data ?? []) as Line[]).map(l => [byLine.get(l.id) ?? null, l] as [TableRow | null, Line]),
    ...loose.map(r => [r, null] as [TableRow, null]),
  ];

  const reservations = [];
  for (const [row, line] of pairs) {
    const { facts } = await tableFacts(ctx.db, plan, row, line, where);
    // The call check is cheap while the gate is shut (every day until the
    // lawyer signs off) and a line-type lookup once it is open.
    const call = await deps.callCheck(facts.phone);
    reservations.push(decide(facts, { instant: deps.instantFor(facts.platform), call }, row));
  }
  return NextResponse.json({ reservations });
}
