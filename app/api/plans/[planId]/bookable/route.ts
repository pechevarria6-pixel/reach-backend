// ─── POST /api/plans/[planId]/bookable — the itinerary becomes bookings ──
// The gap the whole booking flow fell through. A plan's itinerary is written
// by generation and shown on the screen; checkout then asks for the plan's
// bookings and gets an empty list, because nothing ever turned one into the
// other. So people paid their share against a target of nothing, and approval
// had nothing to approve — which is why the success screen had to stop saying
// "You're all booked".
//
// This is that bridge. The organizer opening checkout is the trigger: it is
// the moment somebody asks to book, the prices are on the screen in front of
// them, and it is the same screen that already fetches the booking list.
//
// Safe to call as often as checkout is opened. Each itinerary line carries its
// id onto the booking made from it, and a line already booked is skipped — so
// re-opening checkout adds what is missing and touches nothing else.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import type { BookingItemRequest, Vertical } from '@/lib/booking/types';

export const maxDuration = 60;

// What a provider can actually find from a line of an itinerary.
//
// A generated itinerary says "Two nights at a small hotel near the harbour"
// and "Kayak tour of the bay". A provider needs a rate to sell: LiteAPI will
// search a city and dates, so a hotel line is enough to quote. Viator needs
// its own productCode and Ticketmaster its own eventId — neither exists on a
// line nobody picked from a provider's catalogue, so those are reported as
// needing a choice rather than quoted from prose. Restaurants go to the
// concierge lane, which is a person reading the name.
const BOOKABLE: Record<string, Vertical> = {
  hotel: 'hotel',
  restaurant: 'restaurant',
};

/** Why a line cannot be quoted, in words the screen can show. */
const CANNOT: Record<string, string> = {
  activity: 'needs picking from the activity listings first',
  event: 'tickets are bought on the seller\'s own site',
  flight: 'flights need everyone\'s traveller details first',
  transport: 'not something Reach books',
};

type Item = {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  scheduled_time: string | null;
  cost_cents: number;
  booking_mode?: string | null;
};

/**
 * What a provider needs, from what the itinerary knows. Deliberately thin:
 * these are quotes, and the provider's own quote step fills in the rest.
 */
function asRequest(
  item: Item,
  plan: { start_date?: string | null; end_date?: string | null },
  ctxIds: { planId: string; groupId: string },
  city: string,
  partySize: number,
): (BookingItemRequest & { itineraryItemId: string; title: string }) | null {
  const vertical = BOOKABLE[item.type];
  if (!vertical) return null;

  const base = {
    vertical,
    planId: ctxIds.planId,
    groupId: ctxIds.groupId,
    // Filled at approval, from whoever is actually travelling. A quote needs
    // none of it, and holding traveller details here would copy them into a
    // request payload for no reason.
    travelers: [],
    itineraryItemId: item.id,
    title: item.title,
  };

  if (vertical === 'hotel') {
    // Dates are the whole quote. Without them LiteAPI has nothing to price.
    if (!plan.start_date || !plan.end_date) return null;
    return {
      ...base,
      hotel: {
        city,
        checkin: plan.start_date,
        checkout: plan.end_date,
        // One room per two people, rounded up: the group can change it, and
        // a quote for one room when six are going is a misleading number.
        rooms: Math.max(1, Math.ceil(partySize / 2)),
      },
    } as BookingItemRequest & { itineraryItemId: string; title: string };
  }

  // Concierge: a person reads this and calls the restaurant.
  return {
    ...base,
    restaurant: {
      name: item.title,
      city,
      date: plan.start_date ?? '',
      time: item.scheduled_time || '19:00',
      partySize,
      notes: item.subtitle ?? undefined,
    },
  } as BookingItemRequest & { itineraryItemId: string; title: string };
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const plan = ctx.plan as { start_date?: string | null; end_date?: string | null; title?: string; destination_style?: string | null };

  const { data: items, error: itemsError } = await ctx.db
    .from('itinerary_items')
    .select('id, type, title, subtitle, scheduled_time, cost_cents, booking_mode')
    .eq('plan_id', params.planId)
    .order('sort_order');
  if (itemsError) {
    console.error('[bookable] could not read the itinerary', { planId: params.planId, error: itemsError.message });
    return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 500 });
  }

  // Already booked, in any state that is not a dead end. A failed or cancelled
  // row is not a booking and its line can be tried again.
  const { data: existing, error: existingError } = await ctx.db
    .from('bookings')
    .select('id, itinerary_item_id, status')
    .eq('plan_id', params.planId)
    .not('status', 'in', '("failed","cancelled")');
  if (existingError) {
    console.error('[bookable] could not read existing bookings', { planId: params.planId, error: existingError.message });
    return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 500 });
  }
  const alreadyBooked = new Set((existing ?? []).map(b => b.itinerary_item_id).filter(Boolean));

  // "reach" is the itinerary's own word for a line Reach can book. Anything
  // marked ahead or walk_in is somebody else's to arrange, and a line with no
  // mode at all predates that field and is left alone rather than guessed at.
  // Everything the itinerary says Reach books and that is not on the list
  // already. Types no provider can quote stay in, so the loop below can say
  // why rather than dropping them where nobody sees it.
  const candidates = (items ?? []).filter((i: Item) =>
    i.booking_mode === 'reach' && !alreadyBooked.has(i.id));

  const city = (plan.destination_style || plan.title || '').toString();
  // Everybody in the group, unless somebody has sat this one out.
  const partySize = Math.max(1, (ctx.plan.participants as unknown[] | null)?.length ?? 2);

  const requests: (BookingItemRequest & { itineraryItemId: string; title: string })[] = [];
  const skipped: { title: string; why: string }[] = [];
  for (const item of candidates as Item[]) {
    const request = asRequest(item, plan, { planId: params.planId, groupId: String(ctx.plan.group_id) }, city, partySize);
    if (request) requests.push(request);
    else skipped.push({
      title: item.title,
      why: BOOKABLE[item.type] ? 'this trip has no dates yet' : (CANNOT[item.type] ?? `nothing books a ${item.type} yet`),
    });
  }

  if (!requests.length) {
    return NextResponse.json({
      created: 0,
      alreadyBooked: alreadyBooked.size,
      skipped,
      // Not an error: a plan whose lines are all booked, or all somebody
      // else's to arrange, is a perfectly good plan.
      message: alreadyBooked.size ? 'Everything bookable is already on the list.' : 'Nothing here is booked through Reach.',
    });
  }

  // The existing machinery does the quoting and the storing. Called in-process
  // rather than over HTTP so the caller's session is not re-established and a
  // failure here cannot be mistaken for a network problem.
  const { POST: createBookings } = await import('../../../bookings/route');
  const inner = new NextRequest(new URL('/api/bookings', req.url), {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify({ planId: params.planId, items: requests }),
  });
  const res = await createBookings(inner);
  const body = await res.json().catch(() => null);

  if (!res.ok || !body) {
    console.error('[bookable] the booking machinery refused', { planId: params.planId, status: res.status, body });
    return NextResponse.json({ error: 'Could not add these to your booking list.' }, { status: 502 });
  }

  // Stamp each new row with the line it came from, so the next open of
  // checkout knows it is already there.
  const results: { status?: string; error?: string }[] = body.results ?? [];
  const failed = results.filter(r => r.status === 'failed');

  const { data: fresh } = await ctx.db
    .from('bookings')
    .select('id, itinerary_item_id, request_payload, status')
    .eq('plan_id', params.planId)
    .is('itinerary_item_id', null);
  for (const row of fresh ?? []) {
    const id = (row.request_payload as { itineraryItemId?: string } | null)?.itineraryItemId;
    if (!id) continue;
    const { error } = await ctx.db.from('bookings').update({ itinerary_item_id: id }).eq('id', row.id);
    if (error) console.error('[bookable] could not link a booking to its itinerary line', { booking: row.id, error: error.message });
  }

  return NextResponse.json({
    created: results.length - failed.length,
    failed: failed.length,
    // Named, because a line that could not be quoted is a line somebody is
    // about to pay for and will not receive.
    failures: failed.map((f, i) => ({ title: requests[i]?.title ?? 'an item', error: f.error ?? 'could not be quoted' })),
    alreadyBooked: alreadyBooked.size,
    skipped,
  });
}
