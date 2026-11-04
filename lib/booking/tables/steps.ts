// ─── quote() and book() for a table platform ────────────────────────────
// What makes a table provider a BookingProvider like the others. Reach books a
// table through lib/reservations/reserve.ts, which drives openings → hold →
// reserve (lib/booking/tables/flow.ts); these are the same steps for anything
// that calls a provider the usual way, and readSlots is the one reading of a
// platform's openings both use.
import type { BookingItemRequest, BookingItemResult, TableQuoteRaw } from '../types.ts';
import { headcount } from '../party.ts';
import { type TableHold, type TableProvider, PLATFORM_LABEL, isRefusal } from './types.ts';

/** What a table request carries once somebody has held a slot and accepted its terms. */
export type HeldRequest = BookingItemRequest & { restaurant?: BookingItemRequest['restaurant'] & { tableHold?: TableHold } };

/** One slot as the platform listed it: its night, time, and whether Reach may book it. */
export interface SlotSeen { date: string; time: string; reachBooks: boolean; handoffUrl: string | null }

/**
 * What a platform's openings say about one night and time, read once, here,
 * for everybody (quoteWith below, and lib/reservations/reserve.ts):
 *
 *   exact  — that time is there and Reach may book it: hold it
 *   card   — it is there (or only card slots are) and wants a card: the
 *            platform's own page, never Reach's to book
 *   other  — not that time, but these times that night: ask the person
 *   none   — the platform answered and has no table that night. The ONLY
 *            reading that may be said as "no table" — a refusal, a timeout or
 *            a key that was not accepted is never this, because it is never
 *            an answer about the restaurant.
 */
export type SlotReading =
  | { kind: 'exact'; slot: SlotSeen }
  | { kind: 'card'; handoffUrl: string | null }
  | { kind: 'other'; times: string[] }
  | { kind: 'none' };

export function readSlots(slots: readonly SlotSeen[], date: string, time: string): SlotReading {
  const night = slots.filter(s => s.date === date);
  const exact = night.find(s => s.time === time);
  if (exact) return exact.reachBooks ? { kind: 'exact', slot: exact } : { kind: 'card', handoffUrl: exact.handoffUrl };
  const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const times = [...new Set(night.filter(s => s.reachBooks).map(s => s.time))]
    .sort((a, b) => Math.abs(minutes(a) - minutes(time)) - Math.abs(minutes(b) - minutes(time)));
  if (times.length) return { kind: 'other', times };
  if (night.length) return { kind: 'card', handoffUrl: night[0].handoffUrl };
  return { kind: 'none' };
}

/**
 * The restaurant's openings for the line's night and time, as a quote
 * (TableQuoteRaw in ../types.ts). Never a booking, and never a hold: the
 * hold is the orchestrator's step, once somebody presses.
 */
export async function quoteWith(p: TableProvider, req: BookingItemRequest): Promise<BookingItemResult> {
  const r = req.restaurant;
  const fail = (error: string, raw?: TableQuoteRaw): BookingItemResult => ({ vertical: 'restaurant', mode: 'native', status: 'failed', provider: p.name, error, raw });
  if (!r) return fail('No restaurant on this request.');
  const venueId = p.venueIdFrom([r.externalUrl]);
  if (!venueId) return fail(`We don't hold this restaurant's ${PLATFORM_LABEL[p.platform]} id, so Reach can't book it there.`);
  if (!r.date || !r.time) return fail('Pick the night and time first.');
  const o = await p.openings(venueId, { date: r.date, time: r.time, covers: headcount({ party: req.party ?? r.partySize, travelers: req.travelers }) });
  // A refusal is the platform's or ours — never "no table".
  if (isRefusal(o)) return fail(o.error);
  const read = readSlots(o.slots.map(s => ({ date: s.date, time: s.time, reachBooks: !s.needsCard, handoffUrl: s.handoffUrl })), r.date, r.time);
  if (read.kind === 'none') return fail('No tables left that night.', { noAvailability: true });
  if (read.kind === 'card') return fail('This time needs a card, which the restaurant takes on its own page.', { cardRequired: true, reserveUrl: read.handoffUrl });
  if (read.kind === 'other') return fail('Not at that time.', { offeredTimes: read.times });
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
