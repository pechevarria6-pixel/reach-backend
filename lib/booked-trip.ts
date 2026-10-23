// ─── A booked trip, as the person going on it reads it ──────────────────
// Once every booking on a plan is confirmed (getNextAction's `allBooked`),
// the Book tab stops being a list of things to do and becomes the trip: the
// days in the order they happen, the reference for each thing that was
// booked, where each place is, what the trip cost, and a calendar file with
// all of it. This file is the part of that which can be tested without a
// screen.
//
// Everything here is read from what the plan already holds — the itinerary
// rows, the booking rows, the money that came in. Nothing is looked up, and
// nothing is filled in:
//
//   - A reference is shown only when a row carries one, and says whose it
//     is. A number somebody typed after booking on the seller's site is
//     "You entered ABC123", because Reach never saw the seller's
//     confirmation (app/api/bookings/[id]/confirmation).
//   - "Where" is a hotel's own address from the provider, or a map search
//     for the venue's name in the plan's town. A search is not an address,
//     and the link says "Map", never a street we do not hold.
//   - The money is what was booked and what came in. Never the budget: the
//     budget is what somebody hoped to spend, and on a booked trip it is the
//     one figure that is certainly not what anything cost.
//   - Times are the wall clock the row was written in, on the plan's own
//     dates (lib/ics.ts, lib/calendar.ts). "Evening" is not seven o'clock.
import { rowWhen, clockOf, type IcsEvent } from './ics.ts';
import { reachBuys } from './booking/charged.ts';

export interface BookedItem {
  id?: string | null;
  venue_phone?: string | null;
  time?: string | null;
  title?: string | null;
  sub?: string | null;
  type?: string | null;
  conf?: string | null;
  venue_name?: string | null;
  venue_website?: string | null;
}

export interface BookedRow {
  id?: string | null;
  itinerary_item_id?: string | null;
  vertical?: string | null;
  status?: string | null;
  mode?: string | null;
  provider?: string | null;
  provider_ref?: string | null;
  confirmation_number?: string | null;
  detail?: string | null;
  response_payload?: unknown;
}

// ── Order within a day ──────────────────────────────────────────────────
// Rows are written "Day 2 · Morning", "Day 2 · 7:30 PM", or for a night out
// "To start", "The main event", "After". A clock time sorts by itself; the
// words a generator uses for a part of the day sort where that part of the
// day is. Anything else keeps its place beside the row written before it —
// a row nobody can place is not moved to the end, which would be a claim
// that it happens last.
//
// "Early" is read last, and only when nothing else is named: "Early
// evening" is the evening and "Early dinner" is dinner. Read first, it put
// drinks at six in the morning, ahead of breakfast.
const PART_OF_DAY: Array<[RegExp, number]> = [
  [/\b(sunrise|dawn)\b/i, 6 * 60],
  [/\bbreakfast\b/i, 8 * 60],
  [/\bmorning\b/i, 9 * 60],
  [/\bbrunch\b/i, 10 * 60 + 30],
  [/\b(lunch|midday|noon)\b/i, 12 * 60 + 30],
  [/\bafternoon\b/i, 14 * 60],
  [/\b(sunset|golden hour)\b/i, 17 * 60 + 30],
  [/\bto start\b/i, 18 * 60],
  [/\b(evening|dinner)\b/i, 19 * 60],
  [/\bmain event\b/i, 20 * 60],
  [/\b(night|late|after|nightcap)\b/i, 22 * 60],
  [/\bearly\b/i, 6 * 60],
];

/** Minutes after midnight the row's own words put it at, or null when they do not say. */
export function slotMinutes(time: unknown): number | null {
  if (typeof time !== 'string') return null;
  const rest = time.replace(/^\s*day\s*\d+\s*(?:[·\-–—:,]|\bat\b)?\s*/i, '').trim();
  if (!rest) return null;
  const c = clockOf(rest);
  if (c) return c.h * 60 + c.m;
  for (const [re, at] of PART_OF_DAY) if (re.test(rest)) return at;
  return null;
}

/**
 * A day's rows in the order they happen. Stable: two rows at the same time
 * keep the order they were written in, and a row with no readable time
 * stays next to the one before it.
 */
export function inTimeOrder<T extends { time?: string | null }>(items: T[]): T[] {
  let carried = -1;
  const keyed = (items || []).map((item, i) => {
    const at = slotMinutes(item?.time);
    if (at !== null) carried = at;
    return { item, i, at: at ?? carried };
  });
  return keyed.sort((a, b) => a.at - b.at || a.i - b.i).map(k => k.item);
}

// ── The booking behind a row ────────────────────────────────────────────
const GONE = new Set(['failed', 'cancelled']);

/** The live booking row for an itinerary line, if it has one. */
export function bookingFor(item: BookedItem, bookings: BookedRow[] | null | undefined): BookedRow | null {
  if (!item?.id) return null;
  return (bookings || []).find(b => b?.itinerary_item_id === item.id && !GONE.has(String(b.status))) ?? null;
}

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

/**
 * The one reference line for a row, and whose it is — or null. One, because
 * the itinerary row's own confirmation and the booking's are the same fact
 * and showing both is the same thing twice.
 *
 *   Reach bought it      the provider's reference: "Booking ref ORD123"
 *   booked elsewhere     what the person typed: "You entered ABC123"
 *   neither              the itinerary row's own: "Confirmation ABC123"
 */
export function referenceLine(item: BookedItem, booking: BookedRow | null): string | null {
  if (booking) {
    const ref = clean(booking.provider_ref);
    if (reachBuys(booking) && ref) return `Booking ref ${ref}`;
    const typed = clean(booking.confirmation_number);
    if (typed) return `You entered ${typed}`;
  }
  const conf = clean(item?.conf);
  return conf ? `Confirmation ${conf}` : null;
}

// ── Where it is ─────────────────────────────────────────────────────────
export interface Where {
  /** What the map is asked for. */
  query: string;
  /** A real street address from the provider, shown as one. Null for a search. */
  address: string | null;
  url: string;
}

const hotelOf = (b: BookedRow | null): { name?: unknown; address?: unknown } | null => {
  const p = b?.response_payload as { hotel?: { name?: unknown; address?: unknown } } | null | undefined;
  return p && typeof p === 'object' && p.hotel && typeof p.hotel === 'object' ? p.hotel : null;
};

/**
 * A booked hotel's name, from the line Reach wrote when it found it ("Casa
 * Azul · 4★ · 2 rooms"). After booking, the provider's book response
 * carries no hotel, and the itinerary line only ever says "7 nights in
 * Puerto Vallarta" — so the detail is the one place the name survives.
 */
function hotelNameFromDetail(item: BookedItem, booking: BookedRow | null): string | null {
  const type = String(booking?.vertical || item?.type || '');
  if (type !== 'hotel') return null;
  const first = clean(booking?.detail)?.split(' · ')[0];
  return clean(first);
}

/** A maps link anyone's phone opens: Apple Maps on iOS hands off, Google everywhere else. */
export function mapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Where a row happens, or null when we hold nothing to point a map at. A
 * flight is at an airport the booking names and the itinerary does not;
 * "Drive to the coast" is not a place. Neither gets a map.
 */
export function whereOf(item: BookedItem, booking: BookedRow | null, city?: string | null): Where | null {
  const type = String(item?.type || booking?.vertical || '');
  if (type === 'flight' || type === 'transport') return null;
  const town = clean(city);
  const hotel = hotelOf(booking);
  const address = clean(hotel?.address);
  if (address) {
    const name = clean(hotel?.name);
    const query = name ? `${name}, ${address}` : address;
    return { query, address, url: mapsUrl(query) };
  }
  const name = clean(item?.venue_name) ?? clean(hotel?.name) ?? hotelNameFromDetail(item, booking);
  if (!name) return null;
  const query = town && !name.toLowerCase().includes(town.toLowerCase()) ? `${name}, ${town}` : name;
  return { query, address: null, url: mapsUrl(query) };
}

// ── What else the row already knew ──────────────────────────────────────
/**
 * What Reach found for a line it booked — the hotel by name, the airline
 * and the route — which the line's own title never says. Null when the
 * booking holds nothing more than the title already does.
 */
export function bookedDetail(item: BookedItem, booking: BookedRow | null): string | null {
  const detail = clean(booking?.detail);
  if (!detail) return null;
  const title = clean(item?.title);
  return title && title.toLowerCase() === detail.toLowerCase() ? null : detail;
}

export interface Contact { kind: 'site' | 'phone'; url: string; label: string }

/**
 * The venue's own website and phone, kept on a booked row. Being booked
 * does not make the opening hours, the menu or the number to ring when you
 * are running late any less worth having. An event's `venue_website` is the
 * ticket seller, not the venue, so it is not offered as "their site"; and a
 * ticketed line never carries a phone (slotRow).
 */
export function bookedContacts(item: BookedItem): Contact[] {
  const out: Contact[] = [];
  const ticketed = item?.type === 'event' && !!clean(item?.venue_website);
  const site = item?.type !== 'event' ? clean(item?.venue_website) : null;
  if (site) out.push({ kind: 'site', url: site, label: clean(item?.venue_name) ?? 'Their site' });
  const phone = !ticketed ? clean(item?.venue_phone) : null;
  if (phone) out.push({ kind: 'phone', url: `tel:${phone.replace(/[^0-9+]/g, '')}`, label: phone });
  return out;
}

// ── The calendar ────────────────────────────────────────────────────────
export interface CalendarPlan { id: string; title?: string | null; startDate?: string | null; city?: string | null }

/**
 * Every row of the plan as a calendar event, in one file's worth. A row we
 * cannot put on a real date is left out (buildIcs does the same) — a dinner
 * on the wrong day is worse than a dinner missing from the calendar.
 */
export function calendarEvents(plan: CalendarPlan, items: BookedItem[], bookings: BookedRow[] | null | undefined): IcsEvent[] {
  const out: IcsEvent[] = [];
  (items || []).forEach((item, i) => {
    const title = clean(item?.title);
    if (!title) return;
    const when = rowWhen(item.time ?? '', plan.startDate ?? null);
    if (!when) return;
    const booking = bookingFor(item, bookings);
    const where = whereOf(item, booking, plan.city);
    const ref = referenceLine(item, booking);
    out.push({
      uid: `${plan.id}-${item.id || `row-${i}`}`,
      title,
      date: when.date,
      time: when.time,
      location: where ? (where.address ?? where.query) : null,
      description: [ref, clean(item.sub)].filter(Boolean).join('\n') || null,
      url: clean(item.venue_website),
    });
  });
  return out;
}

/** The file name a calendar download is saved under: the trip's own name. */
export function calendarFileName(title: unknown): string {
  const base = String(title ?? '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'trip'}.ics`;
}

// ── The money ───────────────────────────────────────────────────────────
export interface FundingView {
  targetCents?: number | null;
  collectedCents?: number | null;
  myPaidCents?: number | null;
}
export interface MoneyLine { key: 'booked' | 'mine' | 'group'; label: string; cents: number }

const cents = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/**
 * What the booked trip cost and what came in, from the bookings and the
 * contributions — the server's funding read. Never the budget. Empty when
 * there was nothing to pay for: a night out of walk-ins has no money strip,
 * rather than one reading $0.
 *
 * A trip of one has one person paying, so it reads "You paid" and no group
 * line; a group's own line is only there when it differs from yours.
 */
export function moneyLines(f: FundingView | null | undefined, solo: boolean): MoneyLine[] {
  if (!f) return [];
  const booked = cents(f.targetCents), mine = cents(f.myPaidCents), all = cents(f.collectedCents);
  if (!booked && !all) return [];
  const out: MoneyLine[] = [];
  if (booked) out.push({ key: 'booked', label: 'Booked via Reach', cents: booked });
  out.push({ key: 'mine', label: solo ? 'You paid' : 'You put in', cents: mine });
  if (!solo && all !== mine) out.push({ key: 'group', label: 'Everyone together', cents: all });
  return out;
}

// ── The moment it is all booked ─────────────────────────────────────────
/**
 * The celebration's words. A trip goes somewhere; a night out is the night
 * itself. A trip of one is "You're going", never anything about a group.
 */
export function celebrationTitle(p: { city?: string | null; title?: string | null; night?: boolean; solo: boolean }): string {
  const place = clean(p.city);
  const name = clean(p.title);
  if (!p.night && place) return p.solo ? `You're going to ${place}` : `You're all going to ${place}`;
  if (name) return p.solo ? `You're set for ${name}` : `You're all set for ${name}`;
  return "You're all set";
}

/** Whatever this one person still needs, from the server's funding read: `notOnBooked[me]`. */
export type NotOnBooked = Record<string, unknown[] | null | undefined> | null | undefined;

/**
 * Whether the trip is booked *for this person*. getNextAction's `allBooked`
 * is about the plan's rows; somebody who joined after the flight and the
 * hotel were bought is on none of them (funding.notOnBooked), and telling
 * them they are booked — "Your trip", a green booking reference on a seat
 * that is not theirs, a celebration — is the one thing the screen must not
 * say. Their Overview already tells them what they still need.
 */
export function bookedForMe(allBooked: boolean | null | undefined, notOnBooked: NotOnBooked, me: string | null | undefined): boolean {
  if (!allBooked) return false;
  const missing = me && notOnBooked ? notOnBooked[me] : null;
  return !(Array.isArray(missing) && missing.length > 0);
}

/**
 * Whether the celebration is due: booked for this person, and the trip not
 * already over. "You're going to Lisbon" over a trip that ended last month,
 * opened for the first time from the group's past plans, is a sentence
 * about the future that is about the past. A trip with no dates is not
 * known to be over.
 */
export function celebrationDue(booked: boolean, timing: string | null | undefined): boolean {
  return !!booked && timing !== 'over';
}

/** The localStorage key that remembers the celebration on a device whose server cannot. */
export const celebratedKey = (planId: string) => `reach:celebrated:${planId}`;

/**
 * What the server's claim said, read generously: POST
 * /api/plans/[planId]/celebrated answers `{ first: true }` the one time per
 * plan per person it is new. `claimed` is accepted as the same word. Anything
 * else is "not this time" — a celebration we are unsure of is not shown.
 */
export function claimWasFirst(body: unknown): boolean {
  const b = body as { first?: unknown; claimed?: unknown } | null;
  return !!b && (b.first === true || b.claimed === true);
}

// ── Your map, when it has nothing on it ─────────────────────────────────
/**
 * The sentence over an empty map. "Your first trip goes here" is only true
 * of somebody with no trips. A person with trips whose places we have not
 * put on the map yet — before sql/trip-map-2026-09-25.sql runs (`pending`),
 * or before the backfill gives their plans a point — is looking at our gap,
 * and is told that, not something about themselves. `trips` is the plans
 * this person holds, counted from what the app has loaded, not from the map.
 */
export function mapEmptyLine(p: { pins: number; trips: number }): string | null {
  if (p.pins > 0) return null;
  if (p.trips > 0) return p.trips === 1 ? "Your trip isn't on the map yet" : "Your trips aren't on the map yet";
  return 'Your first trip goes here';
}
