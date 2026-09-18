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
import { groupReadiness } from '@/lib/essentials-server';
import { resolveAirport } from '@/lib/booking/providers/flights.duffel';
import type { BookingItemRequest, Vertical } from '@/lib/booking/types';
import { findProduct } from '@/lib/booking/providers/viator-search';

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
  // An activity is bookable once the line has been matched to a real product
  // in the provider's catalogue — see findProduct below. Until that match
  // exists there is nothing to sell.
  activity: 'activity',
  // A flight is bookable once three things are true: everybody on the trip
  // has their travel essentials, the destination resolves to an airport, and
  // somebody has told us where they are flying from.
  flight: 'flight',
};

/** Why a line cannot be quoted, in words the screen can show. */
const CANNOT: Record<string, string> = {
  activity: 'we could not find this as a bookable activity — it stays yours to arrange',
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
  countryCode: string,
  partySize: number,
  product: { productCode: string; title: string; priceCents: number | null } | null,
  flight: { from: string | null; to: string | null },
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
    // Dates and a place are the whole quote. Without either, LiteAPI has
    // nothing to price and answers with an error rather than a rate.
    if (!plan.start_date || !plan.end_date || !city || !countryCode) return null;
    return {
      ...base,
      hotel: {
        city,
        countryCode,
        checkin: plan.start_date,
        checkout: plan.end_date,
        // One room per two people, rounded up: the group can change it, and
        // a quote for one room when six are going is a misleading number.
        rooms: Math.max(1, Math.ceil(partySize / 2)),
      },
    } as BookingItemRequest & { itineraryItemId: string; title: string };
  }

  if (vertical === 'activity') {
    // A date is required to check availability, and the trip's first day is
    // the honest default until somebody says otherwise.
    if (!product || !plan.start_date) return null;
    return {
      ...base,
      // The product's own title, not the itinerary's wording: this is what
      // was actually booked and what the confirmation will say.
      title: product.title,
      activity: { productCode: product.productCode, date: plan.start_date },
    } as BookingItemRequest & { itineraryItemId: string; title: string };
  }

  if (vertical === 'flight') {
    // Both ends and a date, or there is nothing to price. Each of these is
    // reported separately by the caller, because "we could not find an
    // airport for Moab" and "tell us your home airport" send somebody to
    // completely different places.
    if (!flight.from || !flight.to || !plan.start_date) return null;
    return {
      ...base,
      flight: {
        origin: flight.from,
        destination: flight.to,
        departDate: plan.start_date,
        // A trip with an end date is a return. Booking two one-ways when
        // somebody meant a return is both dearer and harder to change.
        ...(plan.end_date && plan.end_date !== plan.start_date
          ? { returnDate: plan.end_date }
          : {}),
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

  const plan = ctx.plan as {
    start_date?: string | null; end_date?: string | null; title?: string;
    destination_city?: string | null; destination_country?: string | null;
  };

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

  // Where the trip is. destination_style is a style — "city", "beach" — and
  // the title is prose, so neither is a place a provider can search. A trip
  // with no destination stored cannot be quoted, and says so.
  const city = (plan.destination_city || '').trim();
  // Trips made before the destination was captured as its own column keep it
  // in the title — "Puerto Vallarta, Mexico" is a plan title in the database
  // right now, and without this nothing on those trips can be booked at all.
  //
  // The title is prose and generally not a place ("E2E test weekend", "Test"),
  // so it is never trusted on its own. It is only offered to the two lanes
  // that check a name against a real catalogue before using it: Duffel's
  // place lookup, and Viator's destination taxonomy. Both answer nothing for
  // a name that is not a place, which is exactly the right outcome. The hotel
  // lane, which cannot check, still requires the stored city and country.
  const named = city || (plan.title || '').trim();
  const countryCode = (plan.destination_country || '').trim().toUpperCase();
  // Everybody in the group, unless somebody has sat this one out.
  const partySize = Math.max(1, (ctx.plan.participants as unknown[] | null)?.length ?? 2);

  const requests: (BookingItemRequest & { itineraryItemId: string; title: string })[] = [];
  const skipped: { title: string; why: string }[] = [];
  const ids = { planId: params.planId, groupId: String(ctx.plan.group_id) };

  // A flight line is skipped for a reason with a name attached to it:
  // "Marco and Sam need to add their travel details" is something the
  // organizer can act on, where "traveller details first" is not. Only asked
  // when the itinerary actually has a flight on it.
  const hasFlight = (candidates as Item[]).some(i => i.type === 'flight');
  const flightWhy = hasFlight
    ? (await groupReadiness(ctx.db, String(ctx.plan.group_id))).blocking ?? null
    : null;

  // Where a flight would go, and where it would leave from. Both are asked
  // once rather than per line, and either coming back empty is a real answer:
  // "Moab, Utah, USA" has no airport Duffel will sell to, and plenty of a
  // good trip is somewhere you drive.
  const flightTo = hasFlight && !flightWhy
    ? await resolveAirport(city ? [city, countryCode].filter(Boolean).join(', ') : named)
    : null;
  const flightFrom = hasFlight && !flightWhy && flightTo
    ? (await ctx.db.from('users').select('home_airport').eq('id', ctx.user.id).single())
      .data?.home_airport ?? null
    : null;

  for (const item of candidates as Item[]) {
    // An activity has to become a real product before it can be quoted. The
    // itinerary says "brewery tour"; Viator sells product 5638853P1. When
    // nothing matches well enough the line stays the traveller's own — plenty
    // of a good trip is not a ticketed product, and a walk on the beach
    // should not be booked as a sunset cruise because both mention the sea.
    let product: Awaited<ReturnType<typeof findProduct>> = null;
    if (item.type === 'activity') {
      if (!named) {
        skipped.push({ title: item.title, why: 'this trip has no destination saved yet' });
        continue;
      }
      product = await findProduct(named, item.title, plan.start_date, plan.end_date);
      if (!product) {
        skipped.push({ title: item.title, why: CANNOT.activity });
        continue;
      }
    }

    const request = asRequest(item, plan, ids, city, countryCode, partySize, product,
      { from: flightFrom, to: flightTo });
    if (request) requests.push(request);
    else skipped.push({
      title: item.title,
      why: BOOKABLE[item.type]
        ? (!city || !countryCode ? 'this trip has no destination saved yet' : 'this trip has no dates yet')
        : item.type === 'flight'
          ? (flightWhy
             ?? (!flightTo
                 ? `we could not find an airport for ${named || 'this trip'} — this one looks like a drive`
                 : !flightFrom
                   ? 'add your home airport in Profile and we can price this flight'
                   : CANNOT.flight))
        : (CANNOT[item.type] ?? `nothing books a ${item.type} yet`),
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
