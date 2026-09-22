// ─── POST /api/bookings/[id]/cancel — actually undo it ──────────────────
// Reach could book a flight and could not unbook it. The provider interface
// was quote and book, for every lane, with nothing to undo anything — so the
// only way to tidy a duplicate order was to mark our own row 'cancelled',
// which changes exactly nothing at the airline. The row said cancelled and
// the seat was still bought and still paid for.
//
// That is the worst shape a booking bug can take: the app and the world
// disagreeing, with the app the more comforting of the two.
//
// Two steps, because a refund is rarely the whole fare:
//
//   POST  {}                  → what you would get back, and nothing changes
//   POST  { confirm: true }   → it is cancelled, and the row says so
//
// Nobody should cancel a flight without being told first what it costs them.
import { NextRequest, NextResponse } from 'next/server';
import { isOrderId } from '@/lib/booking/duffel-map';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { cancelDuffelOrder } from '@/lib/booking/providers/flights.duffel';

/** What each lane can undo, and what to say when it cannot. */
const CANNOT: Record<string, string> = {
  restaurant: 'That table was booked on the restaurant’s own site, so it is cancelled there. Their number and link are on the plan.',
  hotel: 'Reach cannot cancel this room yet — the confirmation email from the hotel has the way to do it.',
  activity: 'Reach cannot cancel this one yet — the booking page it came from can.',
  event: 'Tickets are refunded by whoever sold them, under their own policy.',
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = createServerClient();
  const body = await req.json().catch(() => ({}));
  const confirm = body?.confirm === true;

  const { data: booking, error } = await db
    .from('bookings')
    .select('id, plan_id, vertical, provider, provider_ref, status, price_cents, response_payload')
    .eq('id', params.id)
    .maybeSingle();
  if (error) {
    console.error('[cancel] could not read the booking', { id: params.id, code: error.code });
    return NextResponse.json({ error: 'We could not check that booking just now.' }, { status: 500 });
  }
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // Only somebody on the trip, same as everywhere else money is involved.
  const ctx = await requirePlanMember(booking.plan_id as string);
  if (isFail(ctx)) return ctx.error;

  if (booking.status === 'cancelled') {
    return NextResponse.json({ status: 'cancelled', alreadyCancelled: true });
  }

  // Only Duffel can be undone from here today. Saying which lane cannot,
  // and where it can be, beats a generic refusal — the whole point of this
  // route is that somebody is trying to undo something and needs it done.
  if (booking.provider !== 'duffel' || !booking.provider_ref) {
    return NextResponse.json(
      { error: CANNOT[String(booking.vertical)] ?? 'Reach cannot cancel this one yet.' },
      { status: 400 },
    );
  }

  // Duffel's order id, not the airline's booking reference. provider_ref
  // holds the reference ("MHW2Y3") because that is what a traveller reads,
  // and sending it as order_id earned Duffel's "does not exist" — which was
  // then read as proof two orders were orphaned. It proved nothing.
  const payload = (booking.response_payload ?? {}) as { orderId?: string };
  const orderId = payload.orderId || (isOrderId(booking.provider_ref) ? String(booking.provider_ref) : null);
  if (!orderId) {
    return NextResponse.json({ error: "We don't hold the airline's order number for this one, so it can't be cancelled from here." }, { status: 400 });
  }
  const result = await cancelDuffelOrder(orderId, { confirm });

  if (result.status === 'failed') {
    // The provider has already logged why. This records which booking it
    // was about, because "could not be cancelled" in a log with no id is a
    // sentence nobody can act on.
    console.error('[cancel] the airline refused', {
      id: params.id, order: booking.provider_ref, confirm, error: result.error,
    });
    return NextResponse.json({ error: result.error ?? 'That booking could not be cancelled.' }, { status: 502 });
  }

  // Priced, not cancelled. Nothing has changed anywhere.
  if (result.status === 'quoted') {
    return NextResponse.json({
      status: 'quoted',
      refundCents: result.refundCents ?? 0,
      currency: result.currency ?? 'USD',
      paidCents: booking.price_cents ?? null,
    });
  }

  // Cancelled at the airline. Record it — and if this write fails, say so
  // loudly rather than reporting success: the seat is genuinely gone and a
  // row still reading 'confirmed' is the disagreement this route exists to
  // prevent, only in the other direction.
  const { error: marked } = await db
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id);
  if (marked) {
    console.error('[cancel] the airline cancelled it and the row still says otherwise', {
      id: params.id, order: booking.provider_ref, code: marked.code,
    });
    return NextResponse.json({
      status: 'cancelled',
      refundCents: result.refundCents ?? 0,
      currency: result.currency ?? 'USD',
      warning: 'It is cancelled with the airline, but we could not update your plan — it may still show as booked.',
    });
  }

  return NextResponse.json({
    status: 'cancelled',
    refundCents: result.refundCents ?? 0,
    currency: result.currency ?? 'USD',
  });
}
