// ─── The trip wallet ─────────────────────────────────────────────────────
// What somebody reaches for at a check-in desk: every confirmation number,
// the flights, where they are sleeping. It is the one screen Reach keeps for
// when there is no signal (public/sw.js caches this answer and nothing else),
// so it is the one place a wrong fact has nobody to correct it.
//
// Every field is read off a booking row — the provider's own answer or what
// a member typed — and nothing else:
//
//   confirmation numbers   bookings.provider_ref and the provider's payload;
//                          bookings.confirmation_number, said as typed in by
//                          a member and never as checked by Reach. A Duffel
//                          order id (ord_…) is Reach's handle on the order,
//                          not something an airline desk can look up, so it
//                          is not offered as one.
//   the flight strip       the airports and dates the flight was asked for,
//                          and the times and flight numbers where the
//                          provider's payload still carries them.
//   the hotel              the name and address the provider gave, the dates
//                          it was booked for. A check-in time only where the
//                          provider's row states one; "3pm" is common, and
//                          common is not this hotel.
//   terminal and gate      only from FlightAware AeroAPI (`liveFromAero`), for
//                          the flight on the date it was booked for. AeroAPI
//                          answers an ident with every recent and upcoming
//                          flight of that number, and the first one is not
//                          necessarily ours: yesterday's gate is a wrong gate.
//
// Pure, so the rules can be tested; the route does the reading.
import { dedupe, bookedClaim, itemTitle, type CheckoutRow } from './checkout.ts';
import { bookingTracker, type TrackLine } from './plan-steps.ts';
import { isOrderId } from './booking/duffel-map.ts';
import { clockOf, rowWhen, type IcsEvent } from './ics.ts';

export interface WalletBookingRow {
  id: string;
  vertical?: string | null;
  status?: string | null;
  provider?: string | null;
  mode?: string | null;
  provider_ref?: string | null;
  confirmation_number?: string | null;
  detail?: unknown;
  request_payload?: unknown;
  response_payload?: unknown;
  itinerary_item_id?: string | null;
}

export interface WalletConfirmation {
  label: string;
  value: string;
  /** 'provider': the seller's own answer. 'entered': typed by a member, not checked by Reach. */
  source: 'provider' | 'entered';
}

export interface WalletLeg {
  from: string | null;
  to: string | null;
  /** YYYY-MM-DD, the local date at the departure airport. */
  date: string | null;
  /** The provider's local wall-clock time at each airport, "2026-11-02T08:15". Null when it did not say. */
  departs: string | null;
  arrives: string | null;
  /** "AA10, AA204" */
  flights: string | null;
  stops: number | null;
}

export interface WalletLive {
  terminal: string | null;
  gate: string | null;
  source: 'aeroapi';
  checkedAt: string;
}

export interface WalletFlight {
  /** First leg out, as AeroAPI is asked about it. */
  ident: string | null;
  out: WalletLeg | null;
  back: WalletLeg | null;
  /** Departure terminal and gate for `out`, only ever from AeroAPI. */
  live: WalletLive | null;
}

export interface WalletHotel {
  name: string | null;
  address: string | null;
  checkin: string | null;
  checkout: string | null;
  /** Only when the provider's row states it. */
  checkinTime: string | null;
}

export interface WalletEntry {
  bookingId: string;
  vertical: string;
  title: string;
  provider: string | null;
  /** Finished on the seller's own site; its number is one a member typed. */
  bookedElsewhere: boolean;
  confirmations: WalletConfirmation[];
  flight: WalletFlight | null;
  hotel: WalletHotel | null;
  itineraryItemId: string | null;
}

export interface Wallet {
  planId: string;
  title: string | null;
  /** When this answer was built. The offline copy is shown "as of" this. */
  asOf: string;
  entries: WalletEntry[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string | null => {
  const s = str(v)?.slice(0, 10) ?? null;
  return s && DAY.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) ? s : null;
};
/** "2026-11-02T08:15:00" → "2026-11-02T08:15"; anything not shaped like a time is not one. */
const wall = (v: unknown): string | null => {
  const s = str(v);
  const m = s ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s) : null;
  return m ? `${m[1]}T${m[2]}:${m[3]}` : null;
};
/** "15:00", "3:00 PM", "3pm" — a clock time, or nothing (lib/ics.ts reads them the same way). */
const clock = (v: unknown): string | null => {
  const s = str(v);
  return s && clockOf(s) ? s : null;
};

/** A hand-off to the seller's own site that is still open. Mirrors lib/next-action.ts. */
const handedOff = (r: WalletBookingRow) => (r.mode === 'redirect' || r.status === 'redirected')
  && !['confirmed', 'failed', 'cancelled'].includes(String(r.status ?? ''));
/** Bought on the seller's site, with the number to show for it. */
export const gotElsewhere = (r: WalletBookingRow) => handedOff(r) && !!str(r.confirmation_number);

/** Whether a row belongs in the wallet at all: confirmed, or bought elsewhere and said so. */
export function inWallet(r: WalletBookingRow): boolean {
  return r.status === 'confirmed' || gotElsewhere(r);
}

export function confirmationsOf(r: WalletBookingRow): WalletConfirmation[] {
  const out: WalletConfirmation[] = [];
  const add = (label: string, value: string | null, source: WalletConfirmation['source']) => {
    if (!value || out.some(c => c.value.toLowerCase() === value.toLowerCase())) return;
    out.push({ label, value, source });
  };
  const p = obj(r.response_payload);
  const ref = str(r.provider_ref);
  if (r.status === 'confirmed') {
    if (r.vertical === 'flight') {
      add('Booking reference', str(p.bookingReference) ?? str(p.booking_reference), 'provider');
      if (ref && !isOrderId(ref)) add('Booking reference', ref, 'provider');
    } else if (r.vertical === 'hotel') {
      add("Hotel's confirmation", str(p.hotelConfirmationCode) ?? str(p.confirmationNumber), 'provider');
      add('Booking ID', ref ?? str(p.bookingId), 'provider');
    } else {
      add('Confirmation', ref, 'provider');
    }
  }
  add('Confirmation number', str(r.confirmation_number), 'entered');
  return out;
}

function legOf(provided: unknown, asked: { from: string | null; to: string | null; date: string | null } | null): WalletLeg | null {
  const p = obj(provided);
  const has = Object.keys(p).length > 0;
  if (!has && !asked) return null;
  const departs = wall(p.departs);
  const stops = typeof p.stops === 'number' && Number.isInteger(p.stops) && p.stops >= 0 ? p.stops : null;
  return {
    from: str(p.from) ?? asked?.from ?? null,
    to: str(p.to) ?? asked?.to ?? null,
    date: (departs ? departs.slice(0, 10) : null) ?? asked?.date ?? null,
    departs,
    arrives: wall(p.arrives),
    flights: str(p.flights),
    stops,
  };
}

export function flightOf(r: WalletBookingRow): WalletFlight {
  const req = obj(obj(r.request_payload).flight);
  const p = obj(r.response_payload);
  const option = obj(p.option);
  const origin = str(req.origin), destination = str(req.destination);
  const departDate = day(req.departDate), returnDate = day(req.returnDate);
  const out = legOf(option.out, origin || destination || departDate ? { from: origin, to: destination, date: departDate } : null);
  const back = legOf(option.back, returnDate ? { from: destination, to: origin, date: returnDate } : null);
  const ident = str(p.flightIdent) ?? str(req.flightNumber)
    ?? (out?.flights ? out.flights.split(',')[0].trim() || null : null);
  return { ident, out, back, live: null };
}

export function hotelOf(r: WalletBookingRow): WalletHotel {
  const req = obj(obj(r.request_payload).hotel);
  const p = obj(r.response_payload);
  const h = obj(p.hotel);
  const times = obj(h.checkinCheckoutTimes ?? p.checkinCheckoutTimes);
  return {
    name: str(h.name) ?? str(p.hotelName),
    address: str(h.address) ?? str(p.address),
    checkin: day(p.checkin) ?? day(req.checkin),
    checkout: day(p.checkout) ?? day(req.checkout),
    checkinTime: clock(h.checkinTime) ?? clock(p.checkinTime) ?? clock(times.checkin),
  };
}

const RANK: Record<string, number> = { flight: 0, hotel: 1, event: 2, activity: 3, restaurant: 4 };

/**
 * The wallet for one person. Rows they sit out are not theirs to show at a
 * desk; everything else confirmed on the plan is.
 */
export function buildWallet(input: {
  planId: string;
  title?: string | null;
  bookings: WalletBookingRow[] | null | undefined;
  /** Booking ids this reader sits out (item_optouts). */
  mySkips?: string[] | null;
  /** Item titles by id, for a booking whose own detail names nothing. */
  itemTitles?: Record<string, string> | null;
  now?: Date;
}): Wallet {
  const skip = new Set(input.mySkips ?? []);
  const rows = (input.bookings ?? []).filter(r => r?.id && inWallet(r) && !skip.has(r.id));
  const live = dedupe(rows.map(r => ({ ...r, vertical: r.vertical ?? '' }) as CheckoutRow)) as unknown as WalletBookingRow[];
  const entries = live.map((r): WalletEntry => {
    const vertical = String(r.vertical ?? '');
    const fallback = r.itinerary_item_id ? input.itemTitles?.[r.itinerary_item_id] ?? null : null;
    return {
      bookingId: r.id,
      vertical,
      title: itemTitle({ ...r, vertical } as CheckoutRow, fallback),
      provider: str(r.provider),
      bookedElsewhere: gotElsewhere(r),
      confirmations: confirmationsOf(r),
      flight: vertical === 'flight' ? flightOf(r) : null,
      hotel: vertical === 'hotel' ? hotelOf(r) : null,
      itineraryItemId: r.itinerary_item_id ?? null,
    };
  });
  const when = (e: WalletEntry) => e.flight?.out?.departs ?? e.flight?.out?.date ?? e.hotel?.checkin ?? '';
  entries.sort((a, b) => (RANK[a.vertical] ?? 9) - (RANK[b.vertical] ?? 9) || when(a).localeCompare(when(b)));
  return { planId: input.planId, title: input.title ?? null, asOf: (input.now ?? new Date()).toISOString(), entries };
}

// ─── Terminal and gate, from AeroAPI only ────────────────────────────────

export interface AeroFlight {
  ident_iata?: string | null;
  scheduled_out?: string | null;
  origin?: { code_iata?: string | null; timezone?: string | null } | null;
  terminal_origin?: string | null;
  gate_origin?: string | null;
}

/** The local date at the airport, from an instant and the airport's own zone. Null when either is missing. */
export function localDate(instant: unknown, timeZone: unknown): string | null {
  if (typeof instant !== 'string' || typeof timeZone !== 'string' || !timeZone) return null;
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  } catch {
    return null;
  }
}

/**
 * Terminal and gate for our flight: the AeroAPI flight that leaves the
 * booked airport on the booked local date. No match, no terminal — never the
 * first flight of the number, which may be yesterday's.
 */
export function liveFromAero(
  flights: AeroFlight[] | null | undefined,
  leg: { date: string | null; from: string | null },
  checkedAt: Date = new Date(),
): WalletLive | null {
  if (!leg.date) return null;
  const match = (flights ?? []).find(f =>
    localDate(f?.scheduled_out, f?.origin?.timezone) === leg.date
    && (!leg.from || !f?.origin?.code_iata || f.origin.code_iata.toUpperCase() === leg.from.toUpperCase()));
  if (!match) return null;
  const terminal = str(match.terminal_origin), gate = str(match.gate_origin);
  if (!terminal && !gate) return null;
  return { terminal, gate, source: 'aeroapi', checkedAt: checkedAt.toISOString() };
}

/** Whether AeroAPI is worth asking: it only knows gates for flights a day or two out. */
export function worthAsking(date: string | null, now: Date = new Date()): boolean {
  if (!date) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  const diff = (t - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  return diff >= -1 && diff <= 2;
}

// ─── Whether the booked moment may be celebrated ─────────────────────────
// POST /api/plans/[planId]/celebrated spends a once-only claim, so it is not
// spent on a plan that is not booked: a screen that asked too early would
// otherwise use up the one celebration on a trip with a gap in it. This is
// the end of getNextAction's own test (lib/next-action.ts, `allBooked`): the
// rows that count all confirmed, and nothing left on the Book tab's list.
// tests/unit/wallet.test.ts holds the two together.

export interface CelebrationInput {
  bookings: (WalletBookingRow & { scheduled_date?: string | null })[] | null | undefined;
  lines: (TrackLine & { title?: string | null })[] | null | undefined;
  skips: { ref: string; userId: string }[] | null | undefined;
  memberCount: number;
}

export function celebrationDue(input: CelebrationInput): boolean {
  const rows = (input.bookings ?? []).map(r => ({ ...r, vertical: r.vertical ?? '' }) as CheckoutRow & WalletBookingRow);
  const live = dedupe(rows) as (CheckoutRow & WalletBookingRow)[];
  const skipCount = new Map<string, number>();
  for (const s of input.skips ?? []) skipCount.set(s.ref, (skipCount.get(s.ref) ?? 0) + 1);
  const counted = live.filter(r => !gotElsewhere(r)
    && !(r.id && input.memberCount > 0 && (skipCount.get(r.id) ?? 0) >= input.memberCount));
  if (!counted.length || bookedClaim(counted) !== 'all_booked') return false;
  const tracker = bookingTracker(input.lines ?? [], live.map(r => ({
    itinerary_item_id: r.itinerary_item_id ?? null,
    status: gotElsewhere(r) ? 'confirmed' : String(r.status ?? ''),
  })));
  return tracker.items.every(i => i.done);
}

// ─── The itinerary as calendar events ────────────────────────────────────
// For GET /api/plans/[planId]/itinerary/ics. lib/ics.ts places each line on
// its date and writes the file; this decides what each event says. A
// confirmation number goes in only from a confirmed booking of that line,
// or as typed in by a member — never "booked" on a line nobody booked.

export interface IcsItem {
  id?: string | null;
  title: string;
  subtitle?: string | null;
  scheduled_time?: string | null;
  confirmation_number?: string | null;
  venue_name?: string | null;
  venue_website?: string | null;
}

export function itineraryEvents(input: {
  items: IcsItem[] | null | undefined;
  bookings: WalletBookingRow[] | null | undefined;
  startDate: unknown;
  /** Booking ids the reader sits out: those lines are not on their calendar. */
  mySkips?: string[] | null;
}): IcsEvent[] {
  const skip = new Set(input.mySkips ?? []);
  const byLine = new Map<string, WalletBookingRow[]>();
  for (const b of input.bookings ?? []) {
    if (!b?.itinerary_item_id || b.status === 'cancelled') continue;
    byLine.set(b.itinerary_item_id, [...(byLine.get(b.itinerary_item_id) ?? []), b]);
  }
  const out: IcsEvent[] = [];
  for (const item of input.items ?? []) {
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    if (!item?.id || !title) continue;
    const rows = byLine.get(item.id) ?? [];
    if (rows.length && rows.every(r => skip.has(r.id))) continue;
    const when = rowWhen(item.scheduled_time, input.startDate);
    if (!when) continue;
    const held = rows.find(inWallet);
    const notes: string[] = [];
    const sub = str(item.subtitle);
    if (sub) notes.push(sub);
    const typed = str(item.confirmation_number);
    if (held) {
      for (const c of confirmationsOf(held)) {
        notes.push(c.source === 'entered' ? `${c.label} (typed in on Reach): ${c.value}` : `${c.label}: ${c.value}`);
      }
    } else if (typed) {
      notes.push(`Confirmation number (typed in on Reach): ${typed}`);
    }
    const venue = str(item.venue_name);
    out.push({
      uid: item.id,
      title,
      date: when.date,
      time: when.time,
      location: venue && venue.toLowerCase() !== title.toLowerCase() ? venue : null,
      description: notes.length ? notes.join('\n') : null,
      url: str(item.venue_website),
    });
  }
  return out;
}
