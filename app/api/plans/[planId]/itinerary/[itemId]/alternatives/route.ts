// ─── GET /api/plans/[planId]/itinerary/[itemId]/alternatives ────────────
// What else could go on this line: up to three places of the same kind, from
// the verified menu only, near the rest of that day and open then, each with
// one line on why built from the row (lib/itinerary-alternatives.ts).
//
// Price: no venue row holds a price, so `price.deltaPerPersonCents` is null
// and `price.note` says the line's estimate stays. Hotels and flights carry
// real prices and are answered by their booking's options instead
// (status 'booking_line', with the booking to ask).
//
// Read only. `right` says what this person can do with the answer: 'apply'
// (PATCH the line), 'suggest' (POST .../suggestions), or 'locked_out';
// `held` is non-null when somebody already holds a booking for this line,
// with what to do before it can be changed.
import { NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { readLine, menuFor } from '@/lib/itinerary-change-server';
import { refusal, suggestionsClosed } from '@/lib/itinerary-change';
import { alternativesFor } from '@/lib/itinerary-alternatives';
import { bookingOnSwap } from '@/lib/itinerary-bookings';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { planId: string; itemId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const got = await readLine(ctx, params.itemId);
  if ('fail' in got) return got.fail;
  const lc = got.line;

  const who = {
    right: lc.right,
    locked: lc.locked,
    solo: lc.solo,
    // Suggestions are a group's, before Lock it in. Never on a trip for one.
    canSuggest: lc.right === 'suggest' && !suggestionsClosed(lc),
    why: refusal(lc.right, lc.organiserName),
    // Somebody already holds a real booking here — on its row, or "I
    // reserved it" on the line — so a swap would be refused (409 'booked').
    // Said up front, with what to do, rather than after a pick.
    held: (() => {
      const on = bookingOnSwap(lc.booking, { filled: lc.item.filled, venue_name: lc.item.venue_name, booking_mode: lc.item.booking_mode });
      return on.action === 'refuse' ? { code: on.code, why: on.message } : null;
    })(),
  };

  const places = await menuFor(ctx.db, lc.plan);
  const result = alternativesFor({
    line: { id: String(lc.item.id), type: lc.item.type, title: lc.item.title, scheduled_time: lc.item.time,
      venue_name: lc.item.venue_name, booking_mode: lc.item.booking_mode },
    lines: lc.lines, places, nightOut: lc.nightOut,
    startDate: lc.plan.start_date ?? null, countryCode: lc.plan.destination_country ?? null,
  });

  if (result.status === 'booking_line') {
    return NextResponse.json({
      ...result, ...who,
      bookingId: lc.booking?.id ?? null,
      // Where the priced options are. With no booking yet there is nothing
      // priced to compare against, and the answer says that rather than
      // implying a search will follow.
      optionsPath: lc.booking ? `/api/bookings/${lc.booking.id}/options` : null,
      ...(lc.booking ? {} : { reason: `There's no ${result.type} priced for this trip yet, so there is nothing to compare it with.` }),
    });
  }
  return NextResponse.json({ ...result, ...who });
}
