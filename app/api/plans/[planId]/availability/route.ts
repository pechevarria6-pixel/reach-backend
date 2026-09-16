// ─── /api/plans/[planId]/availability — when the group can actually go ──
// Everybody says which dates work for them; this finds the stretch the most
// of them can make. Nobody has to run a poll in a group chat and count.
//
// GET  ?nights=  → the best stretches, how many have answered, and your own
//                  answer so you can see what you said.
// POST { ranges: [{ start, end }] } → your dates, replacing what you said
//                  before.
//
// Members of the plan's group only. Every id is a users.id UUID.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { bestWindows, cleanRanges, MAX_RANGES } from '@/lib/availability';
import { nightsBetween } from '@/lib/dates';

/** PostgREST's code for a table that does not exist: the migration has not run. */
const NO_TABLE = 'PGRST205';

export async function GET(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const [{ data: rows, error }, memberIds] = await Promise.all([
    ctx.db.from('availability_windows').select('user_id, start_date, end_date').eq('plan_id', params.planId),
    groupMemberIds(ctx.db, ctx.plan.group_id),
  ]);
  // Before sql/preferences-v1.sql runs there is nowhere to keep answers. The
  // screen stays quiet rather than every plan logging a 500.
  if (error?.code === NO_TABLE) return NextResponse.json({ ready: false });
  if (error) {
    console.error('[availability] could not read dates', { planId: params.planId, error: error.message });
    return NextResponse.json({ error: 'Could not load when people can go' }, { status: 500 });
  }

  // The length of the trip decides which stretches fit. The plan's own dates
  // say how long it is; a plan without them is a long weekend until told.
  const asked = Number(req.nextUrl.searchParams.get('nights'));
  const planNights = nightsBetween(ctx.plan.start_date, ctx.plan.end_date);
  const nights = asked > 0 ? asked : planNights && planNights > 0 ? planNights : 3;

  // Somebody who has left the group no longer gets a say in when it goes.
  const ranges = (rows || [])
    .filter(r => memberIds.includes(r.user_id))
    .map(r => ({ userId: String(r.user_id), start: String(r.start_date), end: String(r.end_date) }));

  return NextResponse.json({
    ready: true,
    nights,
    bestWindows: bestWindows(ranges, nights),
    respondents: new Set(ranges.map(r => r.userId)).size,
    members: memberIds.length,
    mine: ranges.filter(r => r.userId === ctx.user.id).map(({ start, end }) => ({ start, end })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const ranges = cleanRanges(body?.ranges);
  if (!ranges) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_RANGES} date ranges, each ending on or after the day it starts.` },
      { status: 400 },
    );
  }
  const me = ctx.user.id;

  // The new answer goes in before the old one comes out, so a failure part way
  // leaves somebody's previous dates in place rather than none at all.
  const { data: old, error: readError } = await ctx.db
    .from('availability_windows').select('id').eq('plan_id', params.planId).eq('user_id', me);
  if (readError) {
    if (readError.code === NO_TABLE) {
      // Not a fault in the request: sql/preferences-v1.sql has not been run on
      // this deployment. Said plainly here so it is one line to diagnose.
      console.error('[availability] availability_windows is missing — run sql/preferences-v1.sql', { planId: params.planId });
      return NextResponse.json({ error: 'Picking dates together is not switched on yet.' }, { status: 503 });
    }
    console.error('[availability] could not read your dates', { planId: params.planId, error: readError.message });
    return NextResponse.json({ error: 'Those dates did not save — try again.' }, { status: 500 });
  }

  const { error: insertError } = await ctx.db.from('availability_windows').insert(
    ranges.map(r => ({ plan_id: params.planId, user_id: me, start_date: r.start, end_date: r.end })),
  );
  if (insertError) {
    console.error('[availability] could not save your dates', { planId: params.planId, error: insertError.message });
    return NextResponse.json({ error: 'Those dates did not save — try again.' }, { status: 500 });
  }

  const oldIds = (old || []).map(r => r.id);
  if (oldIds.length) {
    const { error: deleteError } = await ctx.db.from('availability_windows').delete().in('id', oldIds);
    // The new dates are saved; stale ones left behind only widen what counts
    // as free, so this is worth a log line and not a failed request.
    if (deleteError) console.error('[availability] could not clear old dates', { planId: params.planId, error: deleteError.message });
  }

  return NextResponse.json({ ok: true, saved: ranges.length });
}
