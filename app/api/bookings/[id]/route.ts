// ─── PATCH /api/bookings/[id] — how it actually went ────────────────────
// Restaurants are booked by the member, on the platform the restaurant uses
// and with their own card, so their card's dining benefits survive. Reach
// hands them over and then has no way of knowing whether there was a table
// — only they do. This is where they say: body { status:
// 'confirmed'|'failed'|'cancelled', providerRef?, detail? }.
//
// It is also where a future Resy or OpenTable integration would report back,
// and where the old ops queue used to confirm its own rows. The frontend
// only ever watches `status`, so none of those callers can tell each other
// apart, which is the point.
//
// Only for what the person books themselves — a redirect or a concierge
// request. Any member could set any status on any row, including a flight
// Reach bought or one mid-booking: a stuck row "unstuck" to failed dropped
// out of the total and was bought a second time, and a row moved while the
// provider was answering lost approval its claim. Reach's own purchases are
// settled by approval and cancel, never by somebody saying so.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { settledByReach } from '@/lib/booking/charged';
import { atVersion, midClaim } from '@/lib/booking/claim';
import { settleUpLine, takeOffSettleUp } from '@/lib/rail/settle-up-line';

const supabase = createServerClient;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const allowed = ['confirmed', 'failed', 'cancelled', 'pending'];
  if (!allowed.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${allowed.join(', ')}` }, { status: 400 });
  }

  const { data: booking } = await supabase()
    .from('bookings').select('id, plan_id, group_id, vertical, detail, price_cents, status, mode, provider, approved_at, updated_at').eq('id', params.id).maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // Anyone signed in could previously mark any booking confirmed.
  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;

  if (midClaim(booking)) {
    return NextResponse.json({ error: 'Somebody is booking this right now.' }, { status: 409 });
  }
  // Not reachBuys: that is about money, and a table Reach booked costs nothing.
  const settled = settledByReach(booking);
  if (settled) return NextResponse.json({ error: settled }, { status: 409 });

  const { data, error } = await atVersion(ctx.db
    .from('bookings')
    .update({
      status: body.status,
      provider_ref: body.providerRef ?? undefined,
      detail: body.detail ?? undefined,
      fulfilled_by: ctx.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id), booking.updated_at)
    .select()
    .maybeSingle();
  if (error) {
    console.error('[bookings PATCH] update failed', { id: params.id, error });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'This changed while you were looking — reopen it.' }, { status: 409 });

  // Settle-up follows what the person said (directive P3): paid for on the
  // seller's site is an expense the group shares; "not booked after all"
  // takes it back off. Never fails the answer — the status is what they came
  // to set, and it is set.
  if (body.status === 'confirmed' && booking.status !== 'confirmed') {
    await settleUpLine(ctx, booking as Record<string, unknown>, null);
  } else if (body.status !== 'confirmed' && booking.status === 'confirmed') {
    await takeOffSettleUp(ctx.db, params.id);
  }
  return NextResponse.json({ booking: data });
}
