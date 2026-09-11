// ─── POST /api/bookings/[id]/approve — the human trigger ─────────────────
// Nothing books until this fires. On approval:
//   native lanes (hotel/flight/activity) → provider.book() executes now
//   redirect lane (events)               → returns the prefilled URL to open
//                                          in the in-app browser, where the
//                                          user's own signed-in session
//                                          completes checkout in 1–2 taps
//   concierge lane (restaurants)         → ticket moves to 'pending' for ops
// Body (optional): { note?: string }
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { BookingItemRequest, BookingProvider, Vertical } from '@/lib/booking/types';
import { liteApiHotels } from '@/lib/booking/providers/hotels.liteapi';
import { kiwiFlights, viatorActivities, ticketmasterEvents, conciergeRestaurants } from '@/lib/booking/providers/rest';

const supabase = createServerClient;

const PROVIDERS: Record<Vertical, BookingProvider> = {
  hotel: liteApiHotels,
  flight: kiwiFlights,
  activity: viatorActivities,
  event: ticketmasterEvents,
  restaurant: conciergeRestaurants,
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Look the booking up first so we know which plan to authorize against.
  // Approval executes a real purchase, so this endpoint used to let any
  // signed-in user spend another group's money.
  const lookup = supabase();
  const { data: booking, error: fetchErr } = await lookup
    .from('bookings').select('*').eq('id', params.id).single();
  if (fetchErr || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;
  const db = ctx.db;

  if (booking.status !== 'awaiting_approval') {
    return NextResponse.json({ error: `Cannot approve a booking in status '${booking.status}'` }, { status: 409 });
  }

  // ── GATE 1: collect-then-approve ──────────────────────────────────────
  // Execution is blocked until every member's share is collected.
  // Override per-call with { skipFundingCheck: true } (e.g. solo trips).
  const body = await req.json().catch(() => ({}));
  if (body.skipFundingCheck !== true) {
    const { data: planBookings } = await db
      .from('bookings').select('price_cents,status').eq('plan_id', booking.plan_id)
      .not('status', 'in', '("failed","cancelled")');
    const targetCents = (planBookings || []).reduce((s, b) => s + (b.price_cents || 0), 0);
    const { data: contribs } = await db
      .from('contributions').select('amount_cents,status').eq('plan_id', booking.plan_id);
    const collectedCents = (contribs || [])
      .filter(c => c.status === 'succeeded')
      .reduce((s, c) => s + c.amount_cents, 0);
    if (targetCents > 0 && collectedCents < targetCents) {
      return NextResponse.json({
        error: 'Plan not fully funded',
        funding: { targetCents, collectedCents, shortfallCents: targetCents - collectedCents },
      }, { status: 402 });
    }
  }

  const provider = PROVIDERS[booking.vertical as Vertical];
  const request = booking.request_payload as BookingItemRequest;

  // ── GATE 2: quote freshness ───────────────────────────────────────────
  // Prices drift between propose and approve. Re-quote; if the price moved
  // more than 5% or $25, surface it for re-approval instead of silently
  // charging more. Drops just proceed (and show as wins in the detail).
  if (booking.price_cents && body.acceptNewPrice !== true) {
    try {
      const fresh = await provider.quote(request);
      if (fresh.priceCents && fresh.priceCents > booking.price_cents) {
        const driftCents = fresh.priceCents - booking.price_cents;
        const driftPct = driftCents / booking.price_cents;
        if (driftCents > 2500 || driftPct > 0.05) {
          await db.from('bookings').update({
            price_cents: fresh.priceCents,
            detail: `${booking.detail} · price rose $${(driftCents / 100).toFixed(2)} since proposal`,
            updated_at: new Date().toISOString(),
          }).eq('id', params.id);
          return NextResponse.json({
            error: 'Price changed since proposal — re-approve to accept',
            oldPriceCents: booking.price_cents,
            newPriceCents: fresh.priceCents,
            reapproveWith: { acceptNewPrice: true },
          }, { status: 409 });
        }
      }
    } catch { /* quote refresh is best-effort; proceed on failure */ }
  }

  try {
    const result = await provider.book(request);
    const { data: updated, error: updErr } = await db
      .from('bookings')
      .update({
        status: result.status,               // confirmed | pending | redirected | failed
        provider_ref: result.providerRef || booking.provider_ref,
        redirect_url: result.redirectUrl || booking.redirect_url,
        price_cents: result.priceCents ?? booking.price_cents,
        detail: result.detail || booking.detail,
        response_payload: result.raw || booking.response_payload,
        error: result.error || null,
        approved_by: ctx.user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ booking: updated, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Execution failed';
    await db.from('bookings').update({
      status: 'failed', error: msg,
      approved_by: ctx.user.id, approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', params.id);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
