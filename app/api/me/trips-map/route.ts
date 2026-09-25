import { NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { tripsMap, columnsMissing, type MapPlan } from '@/lib/trip-map';

export const dynamic = 'force-dynamic';

// GET /api/me/trips-map — where I'm going and where I've been.
//
//   { upcoming: MapPin[], past: MapPin[], pending?: string }
//   MapPin = { planId, label, lat, lng, dates: { start, end }, emoji }
//
// Only plans in groups I belong to, and only plans with a point we found
// (lib/trip-map.ts). Past means over by its dates AND at least one confirmed
// booking — somewhere we can say you went, not somewhere you once looked at.
//
// Until sql/trip-map-2026-09-25.sql runs there are no points to show: that
// is answered as two empty lists with `pending` naming the file, not a 500,
// so the map draws its empty state rather than an error.
export async function GET() {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const db = ctx.db;

  const { data: memberships, error: memberErr } = await db
    .from('group_members').select('group_id').eq('user_id', ctx.user.id);
  if (memberErr) {
    console.error('[trips-map] could not read my groups', { code: memberErr.code });
    return NextResponse.json({ error: 'Could not load your map' }, { status: 500 });
  }
  const myGroups = [...new Set((memberships ?? []).map(m => String(m.group_id)))];
  if (!myGroups.length) return NextResponse.json({ upcoming: [], past: [] });

  const { data: plans, error: planErr } = await db
    .from('plans')
    .select('id, group_id, title, type, status, start_date, end_date, destination_lat, destination_lng, destination_label')
    .in('group_id', myGroups)
    .not('destination_lat', 'is', null);
  if (planErr) {
    if (columnsMissing(planErr)) {
      return NextResponse.json({ upcoming: [], past: [], pending: 'sql/trip-map-2026-09-25.sql' });
    }
    console.error('[trips-map] could not read the plans', { code: planErr.code });
    return NextResponse.json({ error: 'Could not load your map' }, { status: 500 });
  }
  const rows = (plans ?? []) as MapPlan[];

  // Which of them had something confirmed. Read only for these plans, and
  // a failed read shows no past pins rather than guessing which were real.
  let confirmedPlans: string[] = [];
  if (rows.length) {
    const { data: booked, error: bookErr } = await db
      .from('bookings').select('plan_id').in('plan_id', rows.map(r => r.id)).eq('status', 'confirmed');
    if (bookErr) console.error('[trips-map] could not read confirmed bookings — showing no past trips', { code: bookErr.code });
    else confirmedPlans = (booked ?? []).map(b => String(b.plan_id));
  }

  return NextResponse.json(tripsMap(rows, { myGroups, confirmedPlans }));
}
