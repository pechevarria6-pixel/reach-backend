// ─── /api/plans/[planId]/review — the three checks before a trip is ready ─
// GET  → { available, review }
// POST { step, undo? } → sign a step off, or take a sign-off back.
//
// The order is enforced here and not only on the screen: overview, then
// budget, then bookings — and bookings only once nothing is left to book.
// Signing the last one is what makes a trip ready to go. Taking a step back clears every step after it, because a
// budget signed against an overview that has since changed was not checked.
//
// The rules live in lib/plan-steps.ts, shared with the screen.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlanMember, isFail } from '@/lib/auth';
import { STEPS, cannotSign, bookingTracker, type Review } from '@/lib/plan-steps';

const Schema = z.object({ step: z.enum(STEPS), undo: z.boolean().nullish() });

/** PostgREST's word for a column it has not heard of — the migration has not run. */
const missingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST204' || e.code === '42703' || /review/.test(e.message || '') && /column/i.test(e.message || ''));

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const { data, error } = await ctx.db.from('plans').select('review').eq('id', params.planId).maybeSingle();
  if (missingColumn(error)) return NextResponse.json({ available: false, review: null });
  if (error) {
    console.error('[review] could not read sign-offs', { planId: params.planId, code: error.code });
    return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 500 });
  }
  return NextResponse.json({ available: true, review: (data?.review as Review) ?? {} });
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Which check?' }, { status: 400 });
  const { step, undo } = parsed.data;

  const { data: row, error: readErr } = await ctx.db.from('plans').select('review').eq('id', params.planId).maybeSingle();
  if (missingColumn(readErr)) {
    return NextResponse.json({ error: 'Sign-offs are not saved yet — run sql/plan-review-2026-09-22.sql.', available: false }, { status: 503 });
  }
  if (readErr) {
    console.error('[review] could not read sign-offs', { planId: params.planId, code: readErr.code });
    return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 500 });
  }
  const review: Review = { ...((row?.review as Review) ?? {}) };

  if (undo) {
    // This step and everything after it.
    for (const s of STEPS.slice(STEPS.indexOf(step))) delete review[s];
  } else {
    let outstanding = 0;
    if (step === 'bookings') {
      const [lines, bookings] = await Promise.all([
        ctx.db.from('itinerary_items').select('id, type, booking_mode, venue_website, is_confirmed').eq('plan_id', params.planId),
        ctx.db.from('bookings').select('itinerary_item_id, status').eq('plan_id', params.planId),
      ]);
      if (lines.error || bookings.error) {
        console.error('[review] could not count what is left to book', { planId: params.planId });
        return NextResponse.json({ error: 'Could not check your bookings just now.' }, { status: 500 });
      }
      const t = bookingTracker(
        (lines.data ?? []).map(l => ({ ...l, filled: !!l.is_confirmed })),
        bookings.data ?? [],
      );
      outstanding = t.total - t.done;
    }
    const why = cannotSign(step, review, outstanding);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    review[step] = { at: new Date().toISOString(), by: ctx.user.id };
  }

  // Status is left alone. "booked" already means what /approve says it
  // means — everything Reach books is confirmed — and a second writer of the
  // same word would make it mean two things. Ready to go is this sign-off.
  const { error: writeErr } = await ctx.db.from('plans').update({ review }).eq('id', params.planId);
  if (writeErr) {
    console.error('[review] could not save sign-off', { planId: params.planId, step, code: writeErr.code });
    return NextResponse.json({ error: 'Could not save that — try again in a moment.' }, { status: 500 });
  }
  return NextResponse.json({ available: true, review });
}
