// ─── /api/bookings/[id]/options — see what else there is, and switch ─────
// GET  → { current, options }  other hotels, or other flights, for the same
//        trip and dates, cheapest first, each by name.
// POST { key } → make that one the choice. Re-priced now, so the plan's
//        total and the booking's price are the new one's, and pinned, so
//        approval books this hotel or these flights and not the cheapest.
// POST { reprice: true } → the same choice, priced again for who is going
//        now: how a quote refused as `stale_quotes` or `party_changed`, or
//        priced by a provider Reach no longer books through, is put right.
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
import { partySize } from '@/lib/participation';
import { roomsFor } from '@/lib/booking/party';
import { atVersion, changeRefusal } from '@/lib/booking/claim';
import { travellersFor } from '@/lib/essentials-server';
import { airlineOnly } from '@/lib/booking/approval';
import { airlineHandoff } from '@/lib/booking/duffel-map';

/**
 * The request sized for who is going now, not who was going when it was
 * first priced. This is how a quote that funding refuses as `stale_quotes`
 * gets priced again: pick it (or another) here, and it comes back for the
 * current party. Flights and hotels are never sat out, so that is everybody.
 */
async function sizedNow(
  db: Parameters<typeof partySize>[0], plan: Parameters<typeof partySize>[1], request: BookingItemRequest,
): Promise<BookingItemRequest> {
  const party = await partySize(db, plan);
  return {
    ...request,
    party,
    ...(request.flight ? { flight: { ...request.flight, seats: party } } : {}),
    ...(request.hotel ? { hotel: { ...request.hotel, rooms: Math.max(request.hotel.rooms || 1, roomsFor(party)) } } : {}),
  };
}

const CHANGEABLE = ['quoted', 'awaiting_approval'];
const SWAPPABLE = new Set(['hotel', 'flight']);
const Choose = z.object({
  key: z.string().min(1).max(200).nullish(),
  reprice: z.literal(true).nullish(),
}).refine(b => !!b.key || b.reprice === true);

async function load(id: string) {
  const { data: booking, error } = await createServerClient()
    .from('bookings')
    .select('id, plan_id, vertical, status, mode, provider, approved_at, updated_at, request_payload, response_payload, price_cents, detail')
    .eq('id', id).maybeSingle();
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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const got = await load(params.id);
  if (got.fail) return got.fail;
  const { booking, ctx } = got;
  const request = await sizedNow(ctx.db, ctx.plan, booking.request_payload as BookingItemRequest);
  const current = { detail: booking.detail, priceCents: booking.price_cents, status: booking.status,
    raw: booking.response_payload ?? null };
  const refused = changeRefusal(booking);
  if (refused) return NextResponse.json({ current, options: [], changeable: false, why: refused });
  const found = booking.vertical === 'hotel' ? await hotelOptions(request) : await flightOptions(request);
  return NextResponse.json({ current, options: found.options, changeable: true, why: found.error });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const got = await load(params.id);
  if (got.fail) return got.fail;
  const { booking, ctx } = got;
  const parsed = Choose.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Which one?' }, { status: 400 });
  const refused = changeRefusal(booking);
  if (refused) return NextResponse.json({ error: refused }, { status: 409 });

  const request = await sizedNow(ctx.db, ctx.plan, booking.request_payload as BookingItemRequest);
  // `reprice` keeps the choice as it is — the same hotel, the same flights
  // — and only prices it again. A hotel or flight priced before either was
  // pinned has nothing to keep, and is priced afresh.
  const key = parsed.data.key
    ?? (booking.vertical === 'hotel' ? request.hotel?.hotelId : request.flight?.offerKey)
    ?? undefined;
  if (booking.vertical === 'hotel' && request.hotel) {
    request.hotel = { ...request.hotel, hotelId: key, rateId: undefined };
  } else if (booking.vertical === 'flight' && request.flight) {
    request.flight = { ...request.flight, offerKey: key };
  } else {
    return NextResponse.json({ error: 'This booking has nothing to change.' }, { status: 400 });
  }

  // Priced again now. The option list is a minute old and a fare can move;
  // the price stored is the one the provider gives for the choice today.
  let result = await PROVIDERS[booking.vertical as Vertical].quote(request);
  if (result.status !== 'quoted') {
    return NextResponse.json({ error: result.error || 'That one could not be priced — try another.' }, { status: 409 });
  }
  if (booking.vertical === 'hotel' && key && (result.raw as { hotelId?: string } | undefined)?.hotelId !== key) {
    return NextResponse.json({ error: 'That hotel has no rooms for these dates any more — try another.' }, { status: 409 });
  }
  // The same rule the first quote follows (/api/bookings): a flight with
  // somebody on it whose passport marker automatic booking cannot carry is
  // handed to the airline, with no price and in nobody's share.
  if (booking.vertical === 'flight' && request.flight) {
    let toAirline: boolean;
    try {
      toAirline = airlineOnly(await travellersFor(ctx.db, ctx.plan));
    } catch (e) {
      console.error('[options] could not read who is travelling', { id: params.id, error: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: 'Could not check who is travelling just now — try again in a moment.' }, { status: 500 });
    }
    if (toAirline) result = airlineHandoff(result, request.flight);
  }

  // Taken only on the row as it was read: an approval that claimed it in the
  // meantime, or another change, wins, and this one is refused.
  const { data: updated, error } = await atVersion(ctx.db.from('bookings').update({
    request_payload: request,
    response_payload: result.raw ?? null,
    // Whoever priced it now is who books it: a flight priced by Kiwi and
    // picked again here is Duffel's from now on, which is what lets
    // approval book it.
    provider: result.provider,
    mode: result.mode,
    provider_ref: result.providerRef ?? null,
    redirect_url: result.redirectUrl ?? null,
    price_cents: result.priceCents ?? null,
    currency: result.currency ?? 'USD',
    detail: result.detail ?? null,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', params.id).in('status', CHANGEABLE), booking.updated_at)
    .select('id, detail, price_cents, status, mode').maybeSingle();
  if (error) {
    console.error('[options] could not save the new choice', { id: params.id, code: error.code });
    return NextResponse.json({ error: 'Could not save that — try again in a moment.' }, { status: 500 });
  }
  // Claimed or changed in the moment between reading and writing: nothing changed.
  if (!updated) return NextResponse.json({ error: 'This changed while you were looking — reopen it.' }, { status: 409 });
  // A price rise approval was holding for the old choice is not a price for
  // this one, and accepting it later would put the wrong fare on the row.
  // Before sql/wave1-bookings-2026-09-22.sql the column does not exist and
  // there is nothing to clear.
  const { error: cleared } = await ctx.db.from('bookings')
    .update({ pending_price_cents: null }).eq('id', params.id).not('pending_price_cents', 'is', null);
  if (cleared && !(cleared.code === 'PGRST204' || cleared.code === '42703' || /pending_price_cents/.test(cleared.message ?? ''))) {
    console.error('[options] could not clear a price rise held for the old choice', { id: params.id, code: cleared.code });
  }
  return NextResponse.json({ booking: updated, previousPriceCents: booking.price_cents });
}
