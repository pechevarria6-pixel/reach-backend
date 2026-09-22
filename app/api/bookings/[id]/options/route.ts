// ─── /api/bookings/[id]/options — see what else there is, and switch ─────
// GET  → { current, options }  other hotels, or other flights, for the same
//        trip and dates, cheapest first, each by name.
// POST { key } → make that one the choice. Re-priced now, so the plan's
//        total and the booking's price are the new one's, and pinned, so
//        approval books this hotel or these flights and not the cheapest.
//
// Reach picks a hotel and a flight so nobody has to; nobody has to keep
// them either. A change is only offered while it is a quote — nothing has
// been bought. Once it is booked, changing it means cancelling first, and
// the answer says so rather than quietly booking a second one.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { PROVIDERS } from '@/lib/booking/registry';
import { hotelOptions } from '@/lib/booking/providers/hotels.liteapi';
import { flightOptions } from '@/lib/booking/providers/flights.duffel';
import type { BookingItemRequest, Vertical } from '@/lib/booking/types';

const CHANGEABLE = new Set(['quoted', 'awaiting_approval']);
const SWAPPABLE = new Set(['hotel', 'flight']);
const Choose = z.object({ key: z.string().min(1).max(200) });

async function load(id: string) {
  const { data: booking, error } = await createServerClient()
    .from('bookings').select('id, plan_id, vertical, status, request_payload, response_payload, price_cents, detail').eq('id', id).maybeSingle();
  if (error) {
    console.error('[options] could not read booking', { id, code: error.code });
    return { fail: NextResponse.json({ error: 'Could not read that booking just now.' }, { status: 500 }) };
  }
  if (!booking) return { fail: NextResponse.json({ error: 'Booking not found' }, { status: 404 }) };
  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return { fail: ctx.error };
  if (!SWAPPABLE.has(booking.vertical)) {
    return { fail: NextResponse.json({ error: 'Only hotels and flights can be swapped here.' }, { status: 400 }) };
  }
  return { booking, ctx };
}

const lockedMessage = (status: string) => status === 'confirmed'
  ? 'This is already booked. To change it, cancel it first — then pick another.'
  : 'This one cannot be changed right now.';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const got = await load(params.id);
  if (got.fail) return got.fail;
  const { booking } = got;
  const request = booking.request_payload as BookingItemRequest;
  const current = { detail: booking.detail, priceCents: booking.price_cents, status: booking.status,
    raw: booking.response_payload ?? null };
  if (!CHANGEABLE.has(booking.status)) {
    return NextResponse.json({ current, options: [], changeable: false, why: lockedMessage(booking.status) });
  }
  const found = booking.vertical === 'hotel' ? await hotelOptions(request) : await flightOptions(request);
  return NextResponse.json({ current, options: found.options, changeable: true, why: found.error });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const got = await load(params.id);
  if (got.fail) return got.fail;
  const { booking, ctx } = got;
  const parsed = Choose.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Which one?' }, { status: 400 });
  if (!CHANGEABLE.has(booking.status)) {
    return NextResponse.json({ error: lockedMessage(booking.status) }, { status: 409 });
  }

  const request = { ...(booking.request_payload as BookingItemRequest) };
  if (booking.vertical === 'hotel' && request.hotel) {
    request.hotel = { ...request.hotel, hotelId: parsed.data.key, rateId: undefined };
  } else if (booking.vertical === 'flight' && request.flight) {
    request.flight = { ...request.flight, offerKey: parsed.data.key };
  } else {
    return NextResponse.json({ error: 'This booking has nothing to change.' }, { status: 400 });
  }

  // Priced again now. The option list is a minute old and a fare can move;
  // the price stored is the one the provider gives for the choice today.
  const result = await PROVIDERS[booking.vertical as Vertical].quote(request);
  if (result.status !== 'quoted') {
    return NextResponse.json({ error: result.error || 'That one could not be priced — try another.' }, { status: 409 });
  }
  if (booking.vertical === 'hotel' && (result.raw as { hotelId?: string } | undefined)?.hotelId !== parsed.data.key) {
    return NextResponse.json({ error: 'That hotel has no rooms for these dates any more — try another.' }, { status: 409 });
  }

  const { data: updated, error } = await ctx.db.from('bookings').update({
    request_payload: request,
    response_payload: result.raw ?? null,
    provider_ref: result.providerRef ?? null,
    price_cents: result.priceCents ?? null,
    currency: result.currency ?? 'USD',
    detail: result.detail ?? null,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', params.id).in('status', [...CHANGEABLE]).select('id, detail, price_cents, status').maybeSingle();
  if (error) {
    console.error('[options] could not save the new choice', { id: params.id, code: error.code });
    return NextResponse.json({ error: 'Could not save that — try again in a moment.' }, { status: 500 });
  }
  // Approved in the moment between reading and writing: nothing changed.
  if (!updated) return NextResponse.json({ error: lockedMessage('confirmed') }, { status: 409 });
  return NextResponse.json({ booking: updated, previousPriceCents: booking.price_cents });
}
