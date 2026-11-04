// ─── quote() and book() for a table platform ────────────────────────────
// What makes a table provider a BookingProvider like the others. The screen
// drives openings → hold → reserve itself (lib/booking/tables/flow.ts); these
// are the same steps for anything that calls a provider the usual way.
import type { BookingItemRequest, BookingItemResult } from '../types.ts';
import { headcount } from '../party.ts';
import { type TableHold, type TableProvider, PLATFORM_LABEL, isRefusal } from './types.ts';

/** What a table request carries once somebody has held a slot and accepted its terms. */
export type HeldRequest = BookingItemRequest & { restaurant?: BookingItemRequest['restaurant'] & { tableHold?: TableHold } };

/** The restaurant's openings for the line's night and time, as a quote. Never a booking. */
export async function quoteWith(p: TableProvider, req: BookingItemRequest): Promise<BookingItemResult> {
  const r = req.restaurant;
  const fail = (error: string): BookingItemResult => ({ vertical: 'restaurant', mode: 'native', status: 'failed', provider: p.name, error });
  if (!r) return fail('No restaurant on this request.');
  const venueId = p.venueIdFrom([r.externalUrl]);
  if (!venueId) return fail(`We don't hold this restaurant's ${PLATFORM_LABEL[p.platform]} id, so Reach can't book it there.`);
  if (!r.date || !r.time) return fail('Pick the night and time first.');
  const o = await p.openings(venueId, { date: r.date, time: r.time, covers: headcount({ party: req.party ?? r.partySize, travelers: req.travelers }) });
  if (isRefusal(o)) return fail(o.error);
  const bookable = o.slots.filter(s => !s.needsCard);
  if (!bookable.length) return fail(o.slots.length ? 'Every time left needs a card, which the restaurant takes on its own page.' : 'No tables left that night.');
  return {
    vertical: 'restaurant', mode: 'native', status: 'quoted', provider: p.name, priceCents: 0,
    detail: r.name, raw: { venueId, slots: o.slots },
  };
}

/** Book a slot somebody held and accepted. Without one there is nothing to book. */
export async function bookWith(p: TableProvider, req: HeldRequest): Promise<BookingItemResult> {
  const hold = req.restaurant?.tableHold;
  const lead = req.travelers?.[0];
  const fail = (error: string): BookingItemResult => ({ vertical: 'restaurant', mode: 'native', status: 'failed', provider: p.name, error });
  if (!hold || hold.platform !== p.platform) return fail('Pick a time and accept the restaurant’s policy first — nothing was booked.');
  if (!lead?.firstName || !lead.lastName || !lead.email || !lead.phone) return fail('We need a name, email and phone number for whoever the table is under.');
  const out = await p.reserve(hold, {
    firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone, notes: req.restaurant?.notes ?? null,
  }, { reference: req.reference || `${req.planId}-${hold.holdId}` });
  if (isRefusal(out)) return { ...fail(out.error), redirectUrl: out.handoffUrl ?? undefined };
  return { ...out, detail: req.restaurant?.name };
}
