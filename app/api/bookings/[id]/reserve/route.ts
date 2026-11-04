// ─── POST /api/bookings/[id]/reserve — get this table, the way that works ─
// The one way the screen books a table. lib/reservations/reserve.ts decides
// and does it (Reach on a platform, a call, or the hand-off); this reads the
// row, the line, the venue and the person, and hands it over. "Book it" in
// checkout (/approve) runs the same code and gives the same answers. To read
// how each table will go, without holding or ringing anything: GET
// /api/plans/[planId]/reservations. To cancel a table Reach booked: POST
// /api/bookings/[id]/cancel. There is no other table route.
//
// Body (all optional):
//   { path?: 'instant' | 'call' | 'handoff',   // default: what GET …/reservations said
//     time?: 'HH:MM', date?: 'YYYY-MM-DD',     // only when the line has none, or to take an offered time
//     notBookedElsewhere?: true,               // the row was handed to them; they say they haven't booked it
//     holdId?: string,                         // press two: the hold from terms_required …
//     accept?: { terms: hold.terms?.version ?? null, policy: true },  // … and what was accepted on screen
//     notes?: string,                          // for the restaurant (300 characters)
//     change?: true }                          // move a table Reach booked to { time, date } (OpenTable only)
//
// Instant is two presses, and nothing is booked by the first:
//   1. POST {}                     → 409 terms_required: the exact slot is HELD (five minutes), not booked
//   2. POST { holdId, accept }     → 200 confirmed, with the platform's reservation id
//
// 200 { outcome, already?, booking, title, body, href?, warning?, alternatives }
//       confirmed   — the platform's reservation id is on the row (provider_ref), or staff said yes
//                     on a recorded call; href is the platform's confirmation page. alternatives: []
//       card_owed   — the platform holds it until a card is added on ITS page (href): NOT booked.
//                     alternatives: that page, their number. Show "Not booked yet".
//       calling     — Reach is on the phone to them: row 'pending'. Booked only if they say yes.
//       handed_off  — theirs to book (a card or deposit, or no way for Reach): row 'redirected', href the page
//       already     — it was already confirmed; nothing was sent again
//       warning     — booked at the platform, and the plan could not be updated to say so: show it
// 409 { code: 'terms_required', hold, button, title, body, changeNote }
//       hold: { holdId, platform, platformLabel, date, time, covers, expiresAt,
//               cancellationPolicy, policies[], terms: { text, links[{label,url}], version } | null,
//               fee: { label, amountCents, taxCents, currency } | null, cancelBy, notes, editable }
//       Before the button show: cancellationPolicy and policies (the restaurant's words), terms.text
//       with its links, fee exactly as given when not null, a countdown to expiresAt, and
//       changeNote when set (Yelp cannot move a booking later). The button reads exactly `button`
//       ("Complete reservation" on OpenTable). Then POST { holdId, accept }.
// 409 { code: 'other_time', offeredTimes: ['21:00'] } — not at that time; nothing held; POST { time } to take one
// 409 { code: 'unavailable' }  the platform answered and has no table that night (the only "no table")
// 409 { code: 'pending_card', platformUrl }  a table Reach asked for still owes a card on the platform's page
// 409 { code: 'in_progress' | 'calling' | 'booked_elsewhere' | 'ask_first' | 'already_settled'
//            | 'path_unavailable' | 'changed' | 'no_change' | 'hold_missing' | 'hold_expired'
//            | 'slot_gone' | 'needs_card' | 'duplicate' }
//       ask_first: POST again with notBookedElsewhere: true if they haven't booked it.
//       hold_missing / hold_expired / slot_gone: nothing was booked — POST {} again for a new hold.
// 422 { code: 'missing_facts', missing: ['date'|'time'] } | 'details_missing' { missing } | 'terms_not_accepted'
//     | 'date_outside_trip' | 'date_past' | 'time_past' | 'party_size' | 'bad_request'
// 4xx/5xx { code: 'call_refused', refusal } — the calling assistant would not ring (lib/reservations/call.ts)
// 502/503/429 { code: 'provider_failed' | 'platform_down' | 'auth' | 'rate_limited' | 'disabled' | 'not_bookable_here' }
//       our side or the platform's, never a fact about the restaurant: nothing booked, row left as it was
// 502 { code: 'outcome_unknown' } — it MAY be booked: never offer it again (alternatives: [])
// Every refusal carries `error` (the sentence to show) and `alternatives` (the next options, on screen
// with it), and `platformUrl` when the platform gave its own page for exactly this slot.
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
    { booking, facts, plan: planOf(plan), requester, chosen: chosenFrom(body), venue, line },
    reserveDeps(ctx.db),
  );

  if (result.ok === false) {
    const { ok: _ok, status, ...rest } = result;
    return NextResponse.json(rest, { status });
  }
  const { ok: _ok, row, ...rest } = result;
  // The platform steps write the row themselves; read it back as it now stands.
  let now: Record<string, unknown> | null = row;
  if (!now) {
    const { data, error: reread } = await ctx.db.from('bookings').select(TABLE_ROW).eq('id', params.id).maybeSingle();
    if (reread) console.error('[reserve] could not read the booking back', { id: params.id, code: reread.code });
    now = (data as Record<string, unknown> | null) ?? null;
  }
  return NextResponse.json({ ...rest, booking: now });
}
