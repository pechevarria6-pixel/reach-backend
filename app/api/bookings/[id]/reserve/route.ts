// ─── POST /api/bookings/[id]/reserve — get this table, the way that works ─
// lib/reservations/reserve.ts decides and does it; this reads the row, the
// line, the venue and the person, and hands it over.
//
// Body (all optional):
//   { path?: 'instant' | 'call' | 'handoff',   // default: what GET /api/plans/[planId]/reservations said
//     time?: 'HH:MM', date?: 'YYYY-MM-DD',     // only when the line has none, or to take an offered time
//     acceptTerms?: string,                    // terms.key from a terms_required answer
//     notBookedElsewhere?: true }              // the row was handed to them; they say they haven't booked it
//
// 200 { outcome: 'confirmed' | 'requested' | 'calling' | 'handed_off', already?, booking, title, body, href?, alternatives }
//       confirmed   — the platform's reservation id is on the row (provider_ref)
//       requested   — the platform has it and has not confirmed: row 'pending'
//       calling     — Reach is on the phone to them: row 'pending'
//       handed_off  — theirs to book (a deposit, a card hold, or no way for Reach): row 'redirected', href the page
//       already     — it was already confirmed; nothing was sent again
// 409 { code: 'terms_required', terms: { key, platformName, cancellationPolicy, depositCents, feeNote, termsUrl, statement } }
//       nothing is booked: show the terms, then POST again with acceptTerms: terms.key
// 409 { code: 'other_time', offeredTimes: ['21:00'] } — not at that time; POST again with time to take one
// 409 { code: 'unavailable' | 'in_progress' | 'calling' | 'booked_elsewhere' | 'ask_first' | 'already_settled' | 'path_unavailable' | 'changed' }
// 422 { code: 'missing_facts', missing: ['date'|'time'] } | 'details_missing' | 'date_outside_trip' | 'date_past' | 'time_past'
// 4xx/5xx { code: 'call_refused', refusal } — the calling assistant would not ring (lib/reservations/call.ts)
// 502 { code: 'provider_failed' } nothing booked · { code: 'outcome_unknown' } it MAY be booked: never offer it again
// Every refusal carries `error` (the sentence to show) and `alternatives` (the next options, on screen with it).
//
// Idempotent: a row already confirmed answers 200 with already: true; a row
// mid-booking or on a call answers 409 and nothing is sent. A table is never
// charged to anybody — Stripe is not reached from here.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { reserveTable, type TableRow } from '@/lib/reservations/reserve';
import { TABLE_ROW, chosenFrom, lineOf, placeOf, planOf, requesterOf, reserveDeps, tableFacts } from '@/lib/reservations/reserve-server';

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { data: found, error } = await createServerClient().from('bookings').select(TABLE_ROW).eq('id', params.id).maybeSingle();
  if (error) {
    console.error('[reserve] could not read the booking', { id: params.id, code: error.code });
    return NextResponse.json({ error: 'Could not read that booking just now. Nothing was booked.' }, { status: 500 });
  }
  if (!found) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const booking = found as TableRow & { itinerary_item_id?: string | null };

  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;
  const plan = ctx.plan as Record<string, any>;

  const [line, where, requester] = await Promise.all([
    lineOf(ctx.db, booking.itinerary_item_id), placeOf(plan), requesterOf(ctx.db, ctx.user.id),
  ]);
  const { facts, venue } = await tableFacts(ctx.db, plan, booking, line, where);

  const result = await reserveTable(
    { booking, facts, plan: planOf(plan), requester, chosen: chosenFrom(body), venue },
    reserveDeps(ctx.db),
  );

  if (result.ok === false) {
    const { ok: _ok, status, ...rest } = result;
    return NextResponse.json(rest, { status });
  }
  const { ok: _ok, row, ...rest } = result;
  return NextResponse.json({ ...rest, booking: row });
}
