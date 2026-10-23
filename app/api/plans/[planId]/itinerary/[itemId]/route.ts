// ─── PATCH /api/plans/[planId]/itinerary/[itemId] — swap one line ───────
// { to: "<ref>" } → that place on this line, from GET .../alternatives.
//
// One line, changed in place: its id stays, so every other line's booking
// and this line's suggestions stay where they are (lib/itinerary-replace.ts
// replaceLine). The place must be one the line's own alternatives offer —
// the same kind of line, from the verified menu, near the rest of the day and
// open then — so a swap can name nothing the generator could not have.
//
// Who (lib/itinerary-change.ts): the organiser, or the one person on a trip
// for one. Before Lock it in, anybody else suggests instead (403 'suggest').
// After it, only the organiser or whoever booked this line (403
// 'locked_out'); a booking not yet made goes with the old place and the line
// is booked again from the Book tab, and a booking that is made is refused
// with where to cancel it — Reach cannot cancel a room, a table or a ticket
// for anybody (409 'booked').
//
// Hotels and flights are not picked from a menu: they are changed through
// /api/bookings/[id]/options, which prices them (409 'use_options').
//
// { to, title } is "Something else…": the one-slot rewrite from
// POST /api/trips/generate (`slot`) answers with the ref of the menu place
// it named (`to`) and its own line (`slot.plan`). The place may be of any
// menu type, held to everything else an alternative is; the title is kept
// only while it names that place (titleNaming).
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlanMember, isFail } from '@/lib/auth';
import { readLine, menuFor, swapLine, candidateFor, suggestionsMissing, type SwapReason } from '@/lib/itinerary-change-server';
import { refusal } from '@/lib/itinerary-change';
import { BOOKING_TYPES } from '@/lib/itinerary-alternatives';

export const dynamic = 'force-dynamic';

const Swap = z.object({ to: z.string().regex(/^v:[0-9a-f]{8}$/), title: z.string().trim().min(1).max(200).nullish() });

export async function PATCH(req: NextRequest, { params }: { params: { planId: string; itemId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const parsed = Swap.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Which place?' }, { status: 400 });

  const got = await readLine(ctx, params.itemId);
  if ('fail' in got) return got.fail;
  const lc = got.line;

  if (BOOKING_TYPES.has(String(lc.item.type))) {
    return NextResponse.json({
      code: 'use_options',
      error: 'Hotels and flights are changed from their options, which price them.',
      bookingId: lc.booking?.id ?? null,
    }, { status: 409 });
  }
  if (lc.right !== 'apply') {
    return NextResponse.json({ code: lc.right, error: refusal(lc.right, lc.organiserName) }, { status: 403 });
  }

  const places = await menuFor(ctx.db, lc.plan);
  const title = parsed.data.title ?? null;
  const place = candidateFor(lc, places, parsed.data.to, { anyType: !!title });
  if (!place) {
    return NextResponse.json({
      code: 'not_offered',
      error: "That place isn't one we can put on this line now — reopen Change to see what is.",
    }, { status: 409 });
  }

  const reason: SwapReason = lc.solo ? 'solo' : lc.organiser ? 'organiser' : 'booker';
  const swapped = await swapLine(ctx, lc, places, place, reason, { title });
  if (swapped.ok && !lc.solo) {
    // Somebody had suggested exactly this: it is now what the line says, so
    // the card under it is marked applied rather than left asking for 👍.
    // Before the suggestions SQL there is nothing to mark.
    const { error } = await ctx.db.from('itinerary_item_suggestions')
      .update({ status: 'applied', decided_by: ctx.user.id, decided_at: new Date().toISOString() })
      .eq('item_id', params.itemId).eq('candidate_ref', parsed.data.to).eq('status', 'open');
    if (error && !suggestionsMissing(error)) {
      console.error('[itinerary item] swapped, and could not mark the matching suggestion applied', { item: params.itemId, code: error.code });
    }
  }
  return swapped;
}
