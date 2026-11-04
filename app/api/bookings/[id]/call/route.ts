// ─── /api/bookings/[id]/call — ask the AI assistant to ring for a table ─
// The UI this needs (nothing in components/reach-app.jsx calls it yet):
//
// GET  → 200 {
//          available: boolean,     // false while RESERVATION_CALLS_MODE is off,
//                                  // live is not approved, or no provider keys
//          test: boolean,          // true in test mode: it rings Reach's test number
//          message: string | null, // why not, in words for the screen
//          call: null | { status, outcome, title, body, offeredTime },
//          handoff: { reserveUrl, phone }  // always — the next option stays on screen
//        }
//        Show "Ask Reach to call" only when available and call is null.
//        Show call.title / call.body once there is a call. Keep the
//        "Reserve online" and "Call them" buttons on screen in every state.
//
// POST body { date: 'YYYY-MM-DD', time: 'HH:MM', partySize?: number, notes?: string }
//   The person picks the date and clock time. Nothing is defaulted: the
//   bookable route sends the trip's first day and '19:00' when it has
//   nothing better, and a call must never ask a restaurant for a guess.
//   → 200 { call, title, body }                         — ringing now
//   → 409/422/429/503 { refusal, error, missing?, handoff } — not called;
//     `error` is the sentence to show, `handoff` the buttons to show with it.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { heldVenueNear } from '@/lib/discovery/held-venue';
import { locatePlan } from '@/lib/discovery/geocode';
import { pushSender } from '@/lib/push';
import { createServerClient } from '@/lib/supabase';
import { gate } from '@/lib/reservations/gate';
import { placeCall, callWording, wordingFor, REFUSAL_COPY, type BookingRow, type Refusal } from '@/lib/reservations/call';
import { supabaseStore, MIGRATION } from '@/lib/reservations/store';
import { providerFor } from '@/lib/reservations/providers';
import { twilioLookup } from '@/lib/reservations/policy';

const BOOKING = 'id, plan_id, vertical, mode, provider, status, redirect_url, request_payload';

const STATUS: Partial<Record<Refusal, number>> = {
  calls_off: 503, live_not_approved: 503, no_test_number: 503, no_provider: 503, not_migrated: 503,
  disclosure_failed_before: 503, store_error: 503,
  already_called: 409, already_settled_booking: 409, do_not_call: 409, reach_buys: 409, not_a_table: 409,
  daily_cap: 429, provider_unknown: 502, provider_refused: 502,
};

async function load(id: string) {
  const { data: booking, error } = await createServerClient().from('bookings').select(BOOKING).eq('id', id).maybeSingle();
  if (error) console.error('[booking call] could not read the booking', { id, code: error.code });
  return booking as BookingRow | null;
}

async function venueFor(db: any, booking: BookingRow, plan: Record<string, any>) {
  const name = String(booking.request_payload?.restaurant?.name ?? '').trim();
  if (!name) return null;
  const lat = Number(plan.destination_lat), lng = Number(plan.destination_lng);
  const at = plan.destination_lat != null && plan.destination_lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng, countryCode: null as string | null }
    : await locatePlan(plan).catch(() => null);
  const country = at?.countryCode || (/^[A-Z]{2}$/i.test(String(plan.destination_country || '')) ? String(plan.destination_country) : null);
  const { venue, error } = await heldVenueNear(db, name, at, { country });
  if (error) console.error('[booking call] could not read the venue', { name, code: error.code });
  if (!venue) return null;
  return { name, phone: venue.phone, opening_hours: venue.opening_hours ?? null, lng: venue.lng ?? null, reserveUrl: venue.reservation_url };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const booking = await load(params.id);
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;

  const g = gate(process.env);
  const store = supabaseStore(ctx.db, null);
  const mode = g.mode === 'live' ? 'live' : 'test';
  const found = g.ok ? await store.callFor(booking.id, mode) : { ok: true as const, value: null };
  const handoff = {
    reserveUrl: booking.redirect_url ?? booking.request_payload?.restaurant?.externalUrl ?? null,
    phone: (booking.request_payload?.restaurant as { phone?: string | null } | undefined)?.phone ?? null,
  };
  const row = found.ok ? found.value : null;
  let call = null;
  if (row) {
    const w = row.status === 'settled' && row.outcome
      ? callWording({ state: 'settled', outcome: row.outcome, offeredTime: (row.outcome_detail?.offeredTime as string) ?? undefined }, wordingFor(row.request, row.venue_phone, row.mode === 'test'))
      : row.status === 'unknown'
        ? { title: REFUSAL_COPY.provider_unknown, body: 'Call them to check before you go.' }
        : callWording({ state: 'calling' }, wordingFor(row.request, row.venue_phone, row.mode === 'test'));
    call = { status: row.status, outcome: row.outcome, title: w.title, body: w.body, offeredTime: row.outcome_detail?.offeredTime ?? null };
  }
  return NextResponse.json({
    available: g.ok && found.ok,
    test: g.ok && g.mode === 'test',
    message: !g.ok ? REFUSAL_COPY[g.refusal!] : !found.ok ? REFUSAL_COPY.not_migrated : null,
    call,
    handoff,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({})) as { date?: unknown; time?: unknown; partySize?: unknown; notes?: unknown };
  const booking = await load(params.id);
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;
  const plan = ctx.plan as Record<string, any>;

  const { data: me, error: meErr } = await ctx.db.from('users').select('first_name, name').eq('id', ctx.user.id).maybeSingle();
  if (meErr) console.error('[booking call] could not read the caller', { code: meErr.code });
  const firstName = String(me?.first_name || String(me?.name || '').split(/\s+/)[0] || '').trim() || null;

  const result = await placeCall({
    booking,
    plan: {
      id: String(plan.id), group_id: plan.group_id ?? null, solo: plan.solo_mode === true,
      start_date: plan.start_date ?? null, end_date: plan.end_date ?? null,
    },
    requester: { id: ctx.user.id, firstName },
    venue: await venueFor(ctx.db, booking, plan),
    chosen: {
      date: typeof body.date === 'string' ? body.date : undefined,
      time: typeof body.time === 'string' ? body.time : undefined,
      partySize: body.partySize == null ? undefined : Number(body.partySize),
      notes: typeof body.notes === 'string' ? body.notes : null,
    },
  }, {
    env: process.env,
    store: supabaseStore(ctx.db, pushSender()),
    lookup: twilioLookup(process.env),
    provider: g => providerFor(g.provider!, process.env),
  });

  if (result.ok === false) {
    if (result.refusal === 'not_migrated') console.error(`[booking call] no reservation_calls table — run ${MIGRATION}`);
    return NextResponse.json(
      { refusal: result.refusal, error: result.message, missing: result.missing, handoff: result.handoff },
      { status: STATUS[result.refusal] ?? 422 },
    );
  }
  return NextResponse.json({ call: { id: result.call.id, status: result.call.status, mode: result.call.mode }, title: result.wording.title, body: result.wording.body });
}
