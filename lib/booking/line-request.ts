// ─── An itinerary line, as what a provider needs to quote it ─────────────
// Lifted out of app/api/plans/[planId]/bookable so the request a line
// becomes can be tested on its own — the dinner asked for on the wrong night
// lived here, and nothing could check it without a database.
import type { BookingItemRequest, Vertical } from './types.ts';
import { roomsFor } from './party.ts';
import { lineWhen } from '../line-when.ts';

// What a provider can actually find from a line of an itinerary.
//
// A generated itinerary says "Two nights at a small hotel near the harbour"
// and "Kayak tour of the bay". A provider needs a rate to sell: LiteAPI will
// search a city and dates, so a hotel line is enough to quote. Viator needs
// its own productCode and Ticketmaster its own eventId — neither exists on a
// line nobody picked from a provider's catalogue, so those are reported as
// needing a choice rather than quoted from prose. Restaurants go to the
// concierge lane, which is a person reading the name.
export const BOOKABLE: Record<string, Vertical> = {
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

export type BookableLine = {
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
export function asRequest(
  item: BookableLine,
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

  // The line's own date and clock: "Day 3 · Evening" is the third day, not
  // the first. Every dinner and every tour was asked for on plan.start_date,
  // so a day-three dinner was requested for day one. See lib/line-when.ts.
  const when = lineWhen(item.scheduled_time, { startDate: plan.start_date, endDate: plan.end_date });

  if (vertical === 'activity') {
    // A date is required to check availability, and it is the line's own.
    // A line that does not say its day, on a trip of more than one, has no
    // date to book — the caller says so rather than booking day one.
    if (!product || !when.date) return null;
    return {
      ...base,
      // The product's own title, not the itinerary's wording: this is what
      // was actually booked and what the confirmation will say.
      title: product.title,
      activity: { productCode: product.productCode, date: when.date },
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
      // The night the line is on. Empty when it cannot be known (a line with
      // no day on a longer trip): the link then carries no date, and the
      // screen says none is set, rather than asking for the first night.
      date: when.date ?? '',
      // Only a time somebody gave. "Evening" was sent as "19:00", which is a
      // time nobody chose; an evening with no time is asked for with none,
      // and the screen says so (lib/line-when.ts whenSaid).
      time: when.clock,
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
