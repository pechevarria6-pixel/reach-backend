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
import { groupReadiness, tripTravellerIds } from '@/lib/essentials-server';
import { type Gateway } from '@/lib/booking/providers/flights.duffel';
import { arrivalFor } from '@/lib/booking/arrival';
import { partySize as countParty } from '@/lib/participation';
import { tripTiming, today } from '@/lib/calendar';
import { rentalLine } from '@/lib/ground';
import type { BookingItemRequest, Vertical } from '@/lib/booking/types';
import { findProduct } from '@/lib/booking/providers/viator-search';
import { roomsFor } from '@/lib/booking/party';
import { failuresByLine, lockedByPayment } from '@/lib/booking/failures';

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
  /** The venue's own name and number, from the verification pass. Null until
   *  it has run, which is why both are optional and neither is relied on. */
  venue_name?: string | null;
  venue_phone?: string | null;
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
  table: { platform?: string; url?: string | null; phone?: string | null } | null,
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
        rooms: roomsFor(partySize),
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
        // Nobody is named at quote time, and a quote sized off an empty list
        // priced every group's flights for one seat.
        seats: partySize,
        // A trip with an end date is a return. Booking two one-ways when
        // somebody meant a return is both dearer and harder to change.
        ...(plan.end_date && plan.end_date !== plan.start_date
          ? { returnDate: plan.end_date }
          : {}),
      },
    } as BookingItemRequest & { itineraryItemId: string; title: string };
  }

  // A table, booked by the member on the platform the restaurant uses.
  return {
    ...base,
    restaurant: {
      name: item.title,
      city,
      date: plan.start_date ?? '',
      // scheduled_time holds prose on generated itineraries — "Day 3 ·
      // Evening" — which is not a time. The link builder refuses anything
      // that is not a clock, so a bad value costs the prefill and nothing
      // more.
      time: item.scheduled_time || '19:00',
      partySize,
      notes: item.subtitle ?? undefined,
      // Where this restaurant actually takes bookings. Absent means we do
      // not know, and the member gets the phone number rather than a guess.
      platform: (table?.platform as 'resy' | 'opentable' | 'tock' | 'none') ?? 'none',
      externalUrl: table?.url ?? undefined,
      phone: table?.phone ?? null,
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
    // venue_name and venue_phone arrive from the verification pass. They are
    // the only place a venue's actual name is written down: `title` is a
    // sentence somebody reads — "Dinner at the bar counter at Vinny's Italian
    // Grill in the Warehouse District" — and matching a venue list against
    // that found nothing, ever.
    .select('id, type, title, subtitle, scheduled_time, cost_cents, booking_mode, venue_name, venue_phone')
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
  let candidates: Item[] = (items ?? []).filter((i: Item) =>
    i.booking_mode === 'reach' && !alreadyBooked.has(i.id));

  // Nothing is booked ahead for dates that have already come. Moab began on
  // Sep 17 and every open of checkout asked LiteAPI for a room that night,
  // got "No rates available", and printed "Couldn't book" — true, and the
  // wrong answer: the rates are fine, the dates are gone. Say that, and say
  // where to change them, before asking anybody.
  const timing = tripTiming({ startDate: plan.start_date, endDate: plan.end_date }, today());
  if (candidates.length && (timing === 'over' || timing === 'on_now')) {
    const why = timing === 'over'
      ? `this trip's dates (${plan.start_date} to ${plan.end_date}) have passed — change them in Edit plan to book`
      : `this trip began on ${plan.start_date}, so there is nothing left to book ahead — change the dates in Edit plan to book it for later`;
    return NextResponse.json({
      created: 0, failed: 0, failures: [], alreadyBooked: alreadyBooked.size,
      skipped: (candidates as Item[]).map(i => ({ title: i.title, why })),
    });
  }

  // Lines tried before, whose booking failed or was cancelled. Read first:
  // the payment lock below lets them through, and their old rows are then
  // released.
  const triedBefore = new Set<string>();
  let superseded: { id: string; itinerary_item_id: string | null }[] = [];
  if (candidates.length) {
    const { data: stale, error: staleError } = await ctx.db
      .from('bookings')
      .select('id, itinerary_item_id')
      .eq('plan_id', params.planId)
      .in('itinerary_item_id', (candidates as Item[]).map(i => i.id))
      .in('status', ['failed', 'cancelled']);
    if (staleError) {
      console.error('[bookable] could not look for superseded attempts', { planId: params.planId, error: staleError.message });
    }
    superseded = (stale ?? []) as typeof superseded;
    for (const r of superseded) if (r.itinerary_item_id) triedBefore.add(String(r.itinerary_item_id));
  }

  // Nothing new is added to what people have already paid for.
  //
  // Every booking added here raises the total, and with it everybody's
  // share — so after somebody has paid, a new line opened at checkout left
  // the plan short of money it had been told was complete. Said instead,
  // per line. Two kinds of line are not new money and still go through
  // (lockedByPayment): one whose booking failed, whose share is already
  // paid in and would otherwise sit there with nothing to buy, and a table
  // or a ticket, which Reach never charges for.
  // A failed read is treated as paid: the safe answer for a lock is locked.
  const lockedOut: { title: string; why: string }[] = [];
  if (candidates.length) {
    const { data: paid, error: paidError } = await ctx.db.from('contributions')
      .select('id').eq('plan_id', params.planId).eq('status', 'succeeded').limit(1);
    if (paidError) console.error('[bookable] could not check for payments', { planId: params.planId, code: paidError.code });
    if (paidError || paid?.length) {
      const locked = new Set((candidates as Item[]).filter(i => lockedByPayment(i, triedBefore)).map(i => i.id));
      for (const i of candidates as Item[]) {
        if (!locked.has(i.id)) continue;
        lockedOut.push({
          title: i.title,
          why: paidError
            ? 'we could not check the payments just now, so nothing new was added — open checkout again in a moment'
            : "people have already paid for this trip and this wasn't part of what they paid for, so Reach won't add it to what they owe — it's yours to book directly",
        });
      }
      candidates = candidates.filter(i => !locked.has(i.id));
    }
  }

  // Free the slot held by a previous failed attempt.
  //
  // bookings_one_per_itinerary_item is a unique index on itinerary_item_id
  // regardless of status, so a row that failed holds its line's slot for
  // good. A retry could never be linked to the line, the next open could not
  // see it either, and every visit to checkout left another orphan behind —
  // which is how a plan ends up with rows nobody can account for.
  //
  // The superseded attempt keeps its error and its history; it is marked
  // cancelled and unlinked, which is what it is once a new one replaces it.
  // Only for lines that are about to be priced again.
  const retrying = new Set((candidates as Item[]).map(i => i.id));
  const release = superseded.filter(r => r.itinerary_item_id && retrying.has(String(r.itinerary_item_id)));
  if (release.length) {
    const { error } = await ctx.db
      .from('bookings')
      .update({ status: 'cancelled', itinerary_item_id: null })
      .in('id', release.map(r => r.id));
    if (error) console.error('[bookable] could not release a superseded attempt', { planId: params.planId, error: error.message });
  }

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
  const partySize = await countParty(ctx.db, ctx.plan as { group_id?: unknown; solo_mode?: boolean | null });

  const requests: (BookingItemRequest & { itineraryItemId: string; title: string })[] = [];
  const skipped: { title: string; why: string }[] = [...lockedOut];
  const ids = { planId: params.planId, groupId: String(ctx.plan.group_id) };

  // A flight line is skipped for a reason with a name attached to it:
  // "Marco and Sam need to add their travel details" is something the
  // organizer can act on, where "traveller details first" is not. Only asked
  // when the itinerary actually has a flight on it.
  const hasFlight = (candidates as Item[]).some(i => i.type === 'flight');
  const flightWhy = hasFlight
    // Only whoever the trip is for: a solo plan is not held up by somebody
    // else in the group who is not coming.
    ? (await groupReadiness(ctx.db, String(ctx.plan.group_id), tripTravellerIds(ctx.plan))).blocking ?? null
    : null;

  // Where a flight would go, and where it would leave from. Both are asked
  // once rather than per line, and either coming back empty is a real answer:
  // "Moab, Utah, USA" has no airport Duffel will sell to, and plenty of a
  // good trip is somewhere you drive.
  // The city alone is asked second: a search box given "Puerto Vallarta, MX"
  // may not know what "MX" is, and the country only ever narrowed it.
  // Where the trip lands: the town's airport, or the nearest one with flights
  // from home (lib/booking/arrival.ts — the trip options use the same).
  let flightTo: string | null = null;
  let gateway: Gateway | null = null;
  if (hasFlight && !flightWhy) {
    const { data: me } = await ctx.db.from('users').select('home_airport').eq('id', ctx.user.id).maybeSingle();
    const landed = await arrivalFor({
      city, countryCode, named, home: me?.home_airport ?? null,
      start: plan.start_date, end: plan.end_date, seats: partySize,
    });
    flightTo = landed?.iata ?? null;
    gateway = landed?.gateway ?? null;
  }
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

    // Where this restaurant takes bookings, if the harvest has learned it.
    // Looked up here rather than when somebody taps: a third party in the
    // critical path of a screen a person is waiting on is a third party that
    // decides how fast the screen is.
    let table: { platform?: string; url?: string | null; phone?: string | null } | null = null;
    if (item.type === 'restaurant') {
      // The venue's own name, as a source spells it, not the sentence the
      // itinerary wrote around it. This looked up `item.title` — the whole
      // line — against a list of venue names, so it matched nothing on any
      // real itinerary and every restaurant fell through with no platform
      // and no phone number, which is what "provider: none" meant.
      const venueName = (item.venue_name || '').trim();
      const { data: venue, error: venueError } = venueName
        ? await ctx.db
            .from('discovery_venues')
            .select('reservation_platform, reservation_url, phone')
            .ilike('name', venueName)
            .limit(1)
            .maybeSingle()
        : { data: null, error: null };
      // A column that does not exist yet means the migration is pending, and
      // every restaurant falls to the phone lane — which is the honest
      // degraded state, not an error.
      if (venueError && !/reservation_platform|phone|schema cache/i.test(venueError.message || '')) {
        console.error('[bookable] could not read the venue', { code: venueError.code });
      }
      // A number somebody can ring is a real answer, and it is the one we
      // have most often: the map records phone numbers for venues nobody has
      // worked out a booking platform for. Kept even when the venue is not in
      // our own list at all, so the screen can offer a call rather than
      // nothing.
      const phone = venue?.phone ?? item.venue_phone ?? null;
      if (venue || phone) {
        table = {
          platform: venue?.reservation_platform ?? 'none',
          url: venue?.reservation_url ?? null,
          phone,
        };
      }
    }

    const request = asRequest(item, plan, ids, city, countryCode, partySize, product,
      { from: flightFrom, to: flightTo }, table);
    if (request) requests.push(request);
    else skipped.push({
      title: item.title,
      // A flight first. BOOKABLE has a flight entry, so asking it first sent
      // every skipped flight to "this trip has no dates yet" — on Puerto
      // Vallarta, which has dates — and the reasons written for flights
      // below could never be reached.
      why: item.type === 'flight'
        ? (flightWhy
           ?? (!flightTo
               ? `we could not find an airport within 180 miles of ${named || 'this trip'}`
               : !flightFrom
                 ? 'add your home airport in Profile and we can price this flight'
                 : !plan.start_date
                   ? 'this trip has no dates yet'
                   : CANNOT.flight))
        : BOOKABLE[item.type]
          ? (!city || !countryCode ? 'this trip has no destination saved yet' : 'this trip has no dates yet')
          : (CANNOT[item.type] ?? `nothing books a ${item.type} yet`),
    });
  }

  // The car, from the airport the flight actually lands at. Reach cannot book
  // a car — no rental provider is connected — so the car is the traveller's,
  // with the search already open at that airport on the trip's dates.
  //
  // One car line per trip. Rincón had two: the generator's "Car rental full
  // week", marked as something Reach books and skipped at checkout every
  // time, and the rental added here when the flight went into MAZ. An
  // existing car line gets the link; a new one is only added when Reach sent
  // somebody to an airport that is not in the town.
  const arrival = flightTo;
  if (arrival && city && plan.start_date && plan.end_date) {
    const { data: carLines, error: carErr } = await ctx.db.from('itinerary_items')
      .select('id, title, booking_mode, venue_website').eq('plan_id', params.planId).eq('type', 'transport');
    if (carErr) console.error('[bookable] could not read transport lines', { planId: params.planId, code: carErr.code });
    const isCar = (t: string) => /\b(car|rental|hire|drive)\b/i.test(t);
    const cars = (carLines ?? []).filter(l => isCar(l.title || ''));
    const line = rentalLine(gateway ?? { iata: arrival, name: arrival, miles: 0 }, city, plan.start_date, plan.end_date);
    if (line) {
      const needsLink = cars.filter(c => !c.venue_website || c.booking_mode === 'reach');
      for (const c of needsLink) {
        const { error } = await ctx.db.from('itinerary_items').update({
          booking_mode: 'ahead', venue_website: line.venue_website, venue_name: line.venue_name,
          payment_note: 'You book this on your own card — the search is open at your airport and dates',
        }).eq('id', c.id);
        if (error) console.error('[bookable] could not link the car', { planId: params.planId, code: error.code });
      }
      if (!cars.length && gateway) {
        const { error } = await ctx.db.from('itinerary_items').insert({ ...line, plan_id: params.planId, sort_order: -1 });
        if (error) console.error('[bookable] could not add the rental car', { planId: params.planId, code: error.code });
      }
    }
  }
  if (gateway && city) {
    const flightLine = (items as Item[]).find(i => i.type === 'flight');
    if (flightLine && !flightLine.subtitle) {
      const { error } = await ctx.db.from('itinerary_items')
        .update({ subtitle: `Into ${gateway.name} (${gateway.iata}), the nearest airport to ${city} — then a rental car.` })
        .eq('id', flightLine.id);
      if (error) console.error('[bookable] could not note the gateway airport', { planId: params.planId, code: error.code });
    }
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
  const results: { status?: string; error?: string; itineraryItemId?: string }[] = body.results ?? [];
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
    // By the line each result was asked for — see lib/booking/failures.ts.
    failures: failuresByLine(requests, results),
    alreadyBooked: alreadyBooked.size,
    skipped,
  });
}
