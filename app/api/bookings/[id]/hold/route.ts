// ─── /api/bookings/[id]/hold — book it with the rest, or not yet ─────────
// POST { hold: boolean }
//
// The flights and the hotel book together, in one press, once the trip is
// paid for. Somebody who wants to wait on one part — the hotel until they
// know who is coming, the flight until a fare drops — holds it: it keeps its
// quote, leaves the total and everybody's share, and is skipped when the
// rest is booked. Unholding puts it back.
//
// Held is status 'quoted' (see lib/booking/charged.ts). Not allowed once
// anybody has paid: the total is what they paid against, and moving it
// under them leaves somebody over- or under-paid.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { atVersion, midClaim } from '@/lib/booking/claim';

const Body = z.object({ hold: z.boolean() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Hold it or book it?' }, { status: 400 });

  const { data: booking, error: readErr } = await createServerClient()
    .from('bookings').select('id, plan_id, status, approved_at, updated_at').eq('id', params.id).maybeSingle();
  if (readErr) {
    console.error('[hold] could not read booking', { id: params.id, code: readErr.code });
    return NextResponse.json({ error: 'Could not read that booking just now.' }, { status: 500 });
  }
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;

  // Mid-booking (before M1 it still reads awaiting_approval): holding it
  // now moved it to 'quoted' under an approval at the provider, which lost
  // its claim and cancelled an order that was ours.
  if (midClaim(booking)) {
    return NextResponse.json({ error: 'Somebody is booking this right now.' }, { status: 409 });
  }

  const from = parsed.data.hold ? 'awaiting_approval' : 'quoted';
  const to = parsed.data.hold ? 'quoted' : 'awaiting_approval';
  if (booking.status === to) return NextResponse.json({ status: to });
  if (booking.status !== from) {
    return NextResponse.json({ error: booking.status === 'confirmed'
      ? 'This is already booked.' : 'This one cannot be held right now.' }, { status: 409 });
  }

  const { data: paid, error: paidErr } = await ctx.db.from('contributions')
    .select('id').eq('plan_id', booking.plan_id).eq('status', 'succeeded').limit(1);
  // Unknown is treated as paid: the safe answer for a lock is "locked".
  if (paidErr || paid?.length) {
    return NextResponse.json({ error: 'Somebody has already paid towards this trip, so what it covers is set.' }, { status: 409 });
  }

  const { data: updated, error } = await atVersion(ctx.db.from('bookings')
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq('id', params.id).eq('status', from), booking.updated_at).select('id, status').maybeSingle();
  if (error) {
    console.error('[hold] could not save', { id: params.id, code: error.code });
    return NextResponse.json({ error: 'Could not save that — try again in a moment.' }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'It changed while you were looking — reopen it.' }, { status: 409 });
  return NextResponse.json({ status: updated.status });
}
