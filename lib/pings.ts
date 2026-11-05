// ─── Countdown pings: the trip tells you what is next, once ─────────────
// Task 8d of the checkout spec (2026-09-25). Four pings, each from a row we
// hold, each to one person, each at most once per local day:
//
//   packing         T-7 before an overnight trip that is locked in and has
//                   something confirmed: a packing list built from its own
//                   dates and lines (lib/packing.ts). No list, no ping.
//   flight_checkin  T-1 before a CONFIRMED flight booking row — never a
//                   flight line somebody typed, never a quote. "Check in
//                   with the airline"; no check-in time, because we hold none.
//   flight_day      the morning of that flight: what FlightAware's AeroAPI
//                   says about it right now. No AEROAPI_KEY, no ping — the
//                   ping is skipped, never sent with the status guessed.
//   tonight         an evening of the trip with a confirmed or reserved line
//                   on it that has a clock time: "Tonight: Vic's, 7:30 PM".
//                   A line nobody reserved is the plan, not a reservation,
//                   and is not announced as one.
//   settle_up       money still owed on the trip's ledger, three days after
//                   the ledger last moved: "Sam is still waiting on $42", to
//                   the person who owes it and nobody else, and then at most
//                   once every three days. Never on a trip of one. See
//                   dueSettleUps below.
//   weather         the day before an outdoor line, when the cached forecast
//                   (MET Norway, or the NWS in the US) spoils its part of the
//                   day: "Rain likely tomorrow afternoon (70%)", linking to
//                   Change on that line, with the source's credit. Once per
//                   line per person per day. See dueWeatherPings below.
//
// ── Once ──
//
// A schedule runs twice sooner or later (a retried job, a manual re-run, two
// runs overlapping). So a ping is CLAIMED before it is sent: a row in
// ping_log, whose unique index on (plan, user, kind, local_day) refuses the
// second run's insert (sql/pings-2026-09-25.sql). The insert is the check;
// there is no read before it. A claimed ping that then fails to send is not
// retried that day — a missed ping beats a doubled one. With no ping_log
// table the run sends nothing at all, because it could not promise once.
//
// ── Whose day ──
//
// The trip's, never UTC's. At eight in the evening in New York the UTC date
// has turned over, and "Tonight" keyed on it would announce tomorrow's
// dinner. The day and hour come from the destination's longitude, exactly
// as lib/calendar.ts dayWhere works it out, so the two can never disagree;
// a plan with no point on the map has no local clock we can read, and gets
// no pings rather than pings at a guessed hour.
//
// The flight pings are the exception, and must be: a flight's departDate is
// the departure airport's date, not the destination's. New York to Rome,
// keyed on Rome's clock, said "AA123 today" at eleven the night before in
// New York; Los Angeles to Tokyo said "Your flight is tomorrow" two days
// out. So "today" and "tomorrow" for a flight are read on the departure
// airport's own clock — its IANA zone from AIRPORT_ZONES below, by the IATA
// code the booking was made with. A departure airport not in the table gets
// no flight pings (counted as skipped.flight_no_origin_zone), never pings at
// the destination's hour. The morning-of ping is checked a second time
// against the zone AeroAPI itself names for the flight.
//
// ── Who ──
//
// The plan's group; a solo plan's creator alone (lib/booking/approval.ts
// isSoloPlan, the same rule approval uses). Somebody sitting a booking out
// (item_optouts) is not pinged about it. Somebody who muted the plan
// (plan_notification_mutes) is pinged about nothing. Every ping is written
// to one person in the second person, so a trip for one reads exactly as it
// should and no ping ever speaks for people who are not there.
//
// Delivery is the bell plus push (lib/notify-user.ts). Email is not used:
// it is broken in production and is optional by the owner's rule.
import type { SupabaseClient } from '@supabase/supabase-js';
import tzlookup from '@photostructure/tz-lookup';
import { notifyUsers, mutedFor, type Note, type Sender } from './notify-user.ts';
import { rowWhen, clockOf, validDay } from './ics.ts';
import { tripTiming } from './calendar.ts';
import { nightsBetween } from './away.ts';
import { packingList, packingLine, type PackLine } from './packing.ts';
import { isSoloPlan } from './booking/approval.ts';
import { isOrderId } from './booking/duffel-map.ts';
import { loadLedger, settleNote, type Ledger } from './ledger.ts';
import { SOURCES, forecastPoint, worryHeadline, rainFigure, type ForecastSource } from './forecast.ts';
import { forecastFor, type HeldDay, type PlaceForecast } from './forecast-store.ts';
import { lineWeatherFrom, partOfLine, partFor } from './forecast-plan.ts';
import type { SettleLine } from './money.ts';

export const PING_KINDS = ['packing', 'flight_checkin', 'flight_day', 'tonight', 'settle_up', 'weather'] as const;
export type PingKind = typeof PING_KINDS[number];

// ── The trip's clock ─────────────────────────────────────────────────────

/** The IANA zone at a point, or null. A fixed fact of the map, never a guess. */
export function zoneAt(lat: unknown, lng: unknown): string | null {
  const y = typeof lat === 'number' ? lat : typeof lat === 'string' && lat.trim() ? Number(lat) : NaN;
  const x = typeof lng === 'number' ? lng : typeof lng === 'string' && lng.trim() ? Number(lng) : NaN;
  if (!Number.isFinite(y) || !Number.isFinite(x) || Math.abs(y) > 90 || Math.abs(x) > 180) return null;
  if (Math.abs(y) < 0.01 && Math.abs(x) < 0.01) return null;
  try { return tzlookup(y, x) || null; } catch { return null; }
}

/**
 * The day and the hour where the trip is. With the point's latitude too,
 * read on the zone the point is in, so daylight saving and real borders
 * count: by longitude alone every US trip ran an hour behind all summer, and
 * a 7:30 PM dinner in Raleigh got "Tonight" at 7:40 PM. Without one, the
 * longitude's rounding, the same as dayWhere.
 */
export function localClock(lng: unknown, now: Date = new Date(), lat?: unknown): { day: string; hour: number } | null {
  const deg = typeof lng === 'number' ? lng : typeof lng === 'string' && lng.trim() ? Number(lng) : NaN;
  // Null is not 0: a plan nobody placed is not in Greenwich.
  if (!Number.isFinite(deg) || deg < -180 || deg > 180) return null;
  const zone = lat === undefined ? null : zoneAt(lat, deg);
  const inZone = zone ? zoneClock(zone, now) : null;
  if (inZone) return inZone;
  const hours = Math.max(-12, Math.min(14, Math.round(deg / 15)));
  const there = new Date(now.getTime() + hours * 3_600_000);
  return { day: there.toISOString().slice(0, 10), hour: there.getUTCHours() };
}

/**
 * The IANA zone of a departure airport, by IATA code. A fixed fact per
 * airport, not a guess: every airport lib/airports.ts hands out as a home
 * airport, plus the large international departure points, plus the
 * destination airports trips have been booked to — a return flight leaves
 * from there (flightLegs). Absent is absent — see the header.
 */
export const AIRPORT_ZONES: Record<string, string> = {
  // US Eastern
  JFK: 'America/New_York', LGA: 'America/New_York', EWR: 'America/New_York', PHL: 'America/New_York',
  JAX: 'America/New_York', CMH: 'America/New_York', CLT: 'America/New_York', IND: 'America/Indiana/Indianapolis',
  BOS: 'America/New_York', MIA: 'America/New_York', FLL: 'America/New_York', ATL: 'America/New_York',
  DTW: 'America/Detroit', BWI: 'America/New_York', DCA: 'America/New_York', IAD: 'America/New_York',
  SDF: 'America/Kentucky/Louisville', RDU: 'America/New_York', ORF: 'America/New_York', CLE: 'America/New_York',
  TPA: 'America/New_York', MCO: 'America/New_York', PIT: 'America/New_York', RIC: 'America/New_York',
  CVG: 'America/New_York', BUF: 'America/New_York', SAV: 'America/New_York', CHS: 'America/New_York',
  // US Central
  ORD: 'America/Chicago', MDW: 'America/Chicago', IAH: 'America/Chicago', HOU: 'America/Chicago',
  SAT: 'America/Chicago', DFW: 'America/Chicago', DAL: 'America/Chicago', AUS: 'America/Chicago',
  BNA: 'America/Chicago', MSP: 'America/Chicago', MSY: 'America/Chicago', MEM: 'America/Chicago',
  MKE: 'America/Chicago', MCI: 'America/Chicago', OMA: 'America/Chicago', TUL: 'America/Chicago',
  ICT: 'America/Chicago', BHM: 'America/Chicago', STL: 'America/Chicago', XNA: 'America/Chicago',
  // US Mountain, Pacific, beyond
  PHX: 'America/Phoenix', TUS: 'America/Phoenix', DEN: 'America/Denver', COS: 'America/Denver',
  ABQ: 'America/Denver', SLC: 'America/Denver', BOI: 'America/Boise',
  LAX: 'America/Los_Angeles', SAN: 'America/Los_Angeles', SJC: 'America/Los_Angeles', SFO: 'America/Los_Angeles',
  OAK: 'America/Los_Angeles', SEA: 'America/Los_Angeles', PDX: 'America/Los_Angeles', LAS: 'America/Los_Angeles',
  FAT: 'America/Los_Angeles', SMF: 'America/Los_Angeles', LGB: 'America/Los_Angeles', SNA: 'America/Los_Angeles',
  BFL: 'America/Los_Angeles', BUR: 'America/Los_Angeles',
  ANC: 'America/Anchorage', HNL: 'Pacific/Honolulu', OGG: 'Pacific/Honolulu', SJU: 'America/Puerto_Rico',
  BQN: 'America/Puerto_Rico',
  // Canada, Mexico
  YYZ: 'America/Toronto', YUL: 'America/Toronto', YVR: 'America/Vancouver', YYC: 'America/Edmonton',
  // Puerto Vallarta (Jalisco) keeps Central time, UTC-6 with no DST since
  // 2022 — not the Pacific time of Mazatlán up the coast.
  MEX: 'America/Mexico_City', CUN: 'America/Cancun', PVR: 'America/Mexico_City',
  // Europe
  LHR: 'Europe/London', LGW: 'Europe/London', MAN: 'Europe/London', EDI: 'Europe/London', DUB: 'Europe/Dublin',
  CDG: 'Europe/Paris', ORY: 'Europe/Paris', AMS: 'Europe/Amsterdam', FRA: 'Europe/Berlin', MUC: 'Europe/Berlin',
  BER: 'Europe/Berlin', MAD: 'Europe/Madrid', BCN: 'Europe/Madrid', LIS: 'Europe/Lisbon', FCO: 'Europe/Rome',
  MXP: 'Europe/Rome', ZRH: 'Europe/Zurich', VIE: 'Europe/Vienna', CPH: 'Europe/Copenhagen', ARN: 'Europe/Stockholm',
  OSL: 'Europe/Oslo', HEL: 'Europe/Helsinki', BRU: 'Europe/Brussels', ATH: 'Europe/Athens', IST: 'Europe/Istanbul',
  KEF: 'Atlantic/Reykjavik',
  // Asia, Middle East, Oceania, Latin America, Africa
  NRT: 'Asia/Tokyo', HND: 'Asia/Tokyo', ICN: 'Asia/Seoul', PEK: 'Asia/Shanghai', PVG: 'Asia/Shanghai',
  HKG: 'Asia/Hong_Kong', SIN: 'Asia/Singapore', BKK: 'Asia/Bangkok', DEL: 'Asia/Kolkata', BOM: 'Asia/Kolkata',
  DXB: 'Asia/Dubai', DOH: 'Asia/Qatar', TLV: 'Asia/Jerusalem', SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne',
  AKL: 'Pacific/Auckland', GRU: 'America/Sao_Paulo', EZE: 'America/Argentina/Buenos_Aires', BOG: 'America/Bogota',
  LIM: 'America/Lima', SCL: 'America/Santiago', JNB: 'Africa/Johannesburg', CAI: 'Africa/Cairo',
};

/** The day and hour now in a named IANA zone, or null for a zone Intl does not know. */
export function zoneClock(tz: unknown, now: Date = new Date()): { day: string; hour: number } | null {
  if (typeof tz !== 'string' || !tz) return null;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(x => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
  } catch {
    return null;
  }
}

/** A calendar date `n` days from `day`, counted as dates. */
export function shiftDay(day: string, n: number): string | null {
  const d = validDay(day);
  if (!d || !Number.isInteger(n)) return null;
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// When in the trip's day each ping may go. The cron runs hourly, so the
// first run inside a window sends and the claim stops every later one.
export const WINDOWS: Record<PingKind, { from: number; to: number }> = {
  packing: { from: 10, to: 21 },
  flight_checkin: { from: 10, to: 21 },
  flight_day: { from: 5, to: 12 },
  tonight: { from: 15, to: 22 },
  settle_up: { from: 10, to: 21 },
  // The day before: after the morning's model runs, before people stop
  // reading their phones. The claim is per line, so a forecast that turns
  // bad at six still reaches somebody who had a dry one at noon.
  weather: { from: 12, to: 21 },
};
const inWindow = (kind: PingKind, hour: number) => hour >= WINDOWS[kind].from && hour < WINDOWS[kind].to;

// ── Rows ─────────────────────────────────────────────────────────────────

export interface PingPlan {
  id: string;
  group_id: string;
  title?: string | null;
  type?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  solo_mode?: boolean | null;
  created_by?: string | null;
  destination_lng?: number | string | null;
  destination_lat?: number | string | null;
  destination_country?: string | null;
}
export interface PingLine {
  id: string;
  type?: string | null;
  title?: string | null;
  subtitle?: string | null;
  scheduled_time?: string | null;
  is_confirmed?: boolean | null;
}
export interface PingBooking {
  id: string;
  itinerary_item_id?: string | null;
  vertical?: string | null;
  mode?: string | null;
  status?: string | null;
  provider_ref?: string | null;
  confirmation_number?: string | null;
  detail?: string | null;
  request_payload?: unknown;
  response_payload?: unknown;
}

export interface PingInput {
  plan: PingPlan;
  memberIds: string[];
  lines: PingLine[];
  bookings: PingBooking[];
  /** booking id → the people sitting it out. */
  optOuts: Map<string, Set<string>>;
  /** Told why a ping that might have been due was not worked out. */
  onSkip?: (why: string) => void;
}

/** One ping for one person, or one that needs AeroAPI before it is written. */
export interface PlannedPing {
  kind: PingKind;
  userId: string;
  localDay: string;
  note: Note;
  /** flight_day only: the flight to ask AeroAPI about, and its date. */
  flight?: { ident: string; departDate: string };
  /**
   * What ping_log is claimed under, when it is not `kind`. A weather ping is
   * once per LINE per day, so it claims `weather_<line id>` — the unique
   * index on (plan, user, kind, local_day) then holds it to that.
   */
  claimKind?: string;
}

const LOCKED = new Set(['approved', 'booked']);
const OVER = new Set(['cancelled', 'completed']);
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * A line somebody actually holds a place for.
 *
 * Its booking rows decide when it has any: confirmed, or bought elsewhere
 * with the confirmation number the person brought back (a redirect is never
 * "confirmed" by Reach, but it is reserved). With no booking row, the line's
 * own is_confirmed — a line somebody booked themselves and marked so. A
 * cancelled booking under a line that still says is_confirmed is cancelled.
 */
export function reserved(line: PingLine, bookings: PingBooking[]): boolean {
  const mine = bookings.filter(b => b.itinerary_item_id === line.id);
  if (mine.length) return mine.some(b => b.status === 'confirmed' || (b.mode === 'redirect' && !!clean(b.confirmation_number) && b.status !== 'cancelled' && b.status !== 'failed'));
  return line.is_confirmed === true;
}

/** Who the plan's pings go to: a solo plan's creator, else the group. */
export function audience(plan: PingPlan, memberIds: string[]): { people: string[]; solo: boolean } {
  const members = [...new Set(memberIds.filter(Boolean).map(String))];
  const solo = isSoloPlan(plan, members.length) || members.length === 1;
  if (!solo) return { people: members, solo: false };
  const owner = plan.created_by && members.includes(String(plan.created_by)) ? String(plan.created_by) : members[0];
  return { people: owner ? [owner] : [], solo: true };
}

/** "7:30 PM" from whatever clock form the line was written in. */
export function clockText(time: string): string | null {
  const c = clockOf(time);
  if (!c) return null;
  const h12 = c.h % 12 === 0 ? 12 : c.h % 12;
  return `${h12}${c.m ? `:${String(c.m).padStart(2, '0')}` : ''} ${c.h < 12 ? 'AM' : 'PM'}`;
}

function departDateOf(b: PingBooking): string | null {
  const flight = obj(obj(b.request_payload)?.flight);
  return validDay(flight?.departDate);
}

/** The departure airport's zone, from the IATA code the flight was booked from. */
export function departZoneOf(b: PingBooking): string | null {
  const code = clean(obj(obj(b.request_payload)?.flight)?.origin).toUpperCase();
  return AIRPORT_ZONES[code] ?? null;
}

const IDENT = /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/;

function identOf(b: PingBooking): string | null {
  const fromBook = clean(obj(b.response_payload)?.flightIdent);
  const fromAsk = clean(obj(obj(b.request_payload)?.flight)?.flightNumber);
  const ident = (fromBook || fromAsk).toUpperCase();
  return IDENT.test(ident) ? ident : null;
}

/** One way of a flight booking: the day it leaves, on whose clock, and what to call it. */
export interface FlightLeg {
  way: 'out' | 'back';
  /** YYYY-MM-DD, the departure airport's own date. */
  day: string;
  /** The departure airport's IANA zone, or null when we do not hold it. */
  zone: string | null;
  /** The flight to ask AeroAPI about on the morning, or null: then no morning-of ping. */
  ident: string | null;
  /** What the check-in ping calls it. */
  what: string;
}

/**
 * The ways of a flight booking. Every trip with an end date is quoted as a
 * return (lib/booking/line-request.ts), so the flight back is on the same
 * row as the flight out — returnDate in the request, the return leg in the
 * provider's option (lib/booking/duffel-map.ts offerOption.back). Reading
 * only departDate said nothing at all about the way home.
 *
 * The way back leaves from the destination airport, on that airport's
 * clock; its flight number is the return leg's first, never the way out's
 * (flightIdent is the first segment of the first slice).
 */
export function flightLegs(b: PingBooking): FlightLeg[] {
  const ask = obj(obj(b.request_payload)?.flight);
  const option = obj(obj(b.response_payload)?.option);
  const legs: FlightLeg[] = [];
  const outDay = departDateOf(b);
  if (outDay) legs.push({ way: 'out', day: outDay, zone: departZoneOf(b), ident: identOf(b), what: clean(b.detail) });

  const back = obj(option?.back);
  const backDay = validDay(clean(back?.departs).slice(0, 10)) ?? validDay(ask?.returnDate);
  if (backDay && backDay !== outDay) {
    const from = (clean(back?.from) || clean(ask?.destination)).toUpperCase();
    const to = (clean(back?.to) || clean(ask?.origin)).toUpperCase();
    const first = clean(String(back?.flights ?? '').split(',')[0]).toUpperCase();
    legs.push({
      way: 'back', day: backDay,
      zone: AIRPORT_ZONES[from] ?? null,
      ident: IDENT.test(first) ? first : null,
      what: [clean(option?.airline) || null, from && to ? `${from} → ${to}` : null, backDay].filter(Boolean).join(' · '),
    });
  }
  return legs;
}

/** What a traveller quotes at the airline desk — never Duffel's own order id. */
function referenceOf(b: PingBooking): string | null {
  const typed = clean(b.confirmation_number);
  if (typed) return typed;
  const ref = clean(b.provider_ref);
  return ref && !isOrderId(ref) ? ref : null;
}

// Opens the plan's group today (the client reads `group`); `plan` is there
// for the client to open the plan itself once it reads it. Never a link to a
// screen that does not exist.
const planUrl = (plan: PingPlan) =>
  `/home?group=${encodeURIComponent(String(plan.group_id))}&plan=${encodeURIComponent(plan.id)}`;

// The settle-up reminder opens Settle up itself (the client reads `settle`).
// Through the plan it would depend on the close card, which the reminder's
// own conditions do not promise: a trip whose bookings never reached
// 'confirmed', or one before sql/post-trip-close-2026-09-25.sql, has no card.
export const settleUrl = (plan: Pick<PingPlan, 'id' | 'group_id'>) =>
  `/home?settle=${encodeURIComponent(plan.id)}&group=${encodeURIComponent(String(plan.group_id))}`;

// ── What is due ──────────────────────────────────────────────────────────

/**
 * Every ping due for this plan at `now`, one per person. Pure: what the rows
 * and the clock say, and nothing else. Claiming and sending are runPings's.
 */
export function duePings(input: PingInput, now: Date = new Date()): PlannedPing[] {
  const { plan } = input;
  if (!plan?.id || OVER.has(String(plan.status ?? ''))) return [];
  const clock = localClock(plan.destination_lng, now, plan.destination_lat);
  if (!clock) return [];
  const start = validDay(plan.start_date);
  if (!start) return [];
  const timing = tripTiming({ startDate: plan.start_date, endDate: plan.end_date }, clock.day);
  if (timing === 'over' || timing === null) return [];

  const { people } = audience(plan, input.memberIds);
  if (!people.length) return [];
  const lines = (input.lines ?? []).filter(l => l?.id);
  const bookings = (input.bookings ?? []).filter(b => b?.id);
  const sitsOut = (bookingId: string, userId: string) => input.optOuts.get(bookingId)?.has(userId) === true;
  const linesOf = (line: PingLine) => bookings.filter(b => b.itinerary_item_id === line.id);
  // A line is somebody's when they are not sitting out every booking on it.
  const onLine = (line: PingLine, userId: string) => {
    const bs = linesOf(line).filter(b => b.status !== 'cancelled' && b.status !== 'failed');
    return !bs.length || bs.some(b => !sitsOut(b.id, userId));
  };
  const title = clean(plan.title) || 'your trip';
  const url = planUrl(plan);
  const out: PlannedPing[] = [];

  // ── packing: T-7, overnight, locked in, something confirmed ──
  const nights = nightsBetween(plan.start_date, plan.end_date);
  const flights = bookings.filter(b => b.vertical === 'flight' && b.status === 'confirmed');
  const anythingHeld = lines.some(l => reserved(l, bookings)) || bookings.some(b => b.status === 'confirmed');
  if (
    inWindow('packing', clock.hour) && clock.day === shiftDay(start, -7)
    && plan.type !== 'restaurant' && nights !== null && nights >= 1
    && LOCKED.has(String(plan.status ?? '')) && anythingHeld
  ) {
    for (const userId of people) {
      const mine: PackLine[] = [
        // `held` is what lets the list name a booking reference or tickets:
        // an unbooked hotel line has no reference to bring.
        ...lines.filter(l => onLine(l, userId)).map(l => ({ ...l, held: reserved(l, bookings) })),
        // A flight bought through Reach is on the trip whether or not the
        // itinerary has a line for it.
        ...flights.filter(b => !sitsOut(b.id, userId)).map(b => ({ id: b.id, type: 'flight', title: clean(b.detail) || null, held: true })),
      ];
      const items = packingList({ startDate: plan.start_date, endDate: plan.end_date, lines: mine });
      if (!items.length) continue;
      out.push({
        kind: 'packing', userId, localDay: clock.day,
        note: { kind: 'packing', title: `A week until ${title}`, body: `To pack: ${packingLine(items)}.`, url, planId: plan.id },
      });
    }
  }

  // ── flights: T-1 check-in, and the morning of ──
  // Read on the departure airport's clock, never the destination's: the
  // departDate is that airport's date (see the header).
  // Each way of each booking: the way out, and the way back of a return.
  const legsOf = new Map<string, Array<FlightLeg & { at: { day: string; hour: number } | null }>>();
  for (const b of flights) {
    const legs = flightLegs(b).map(l => ({ ...l, at: l.zone ? zoneClock(l.zone, now) : null }));
    legsOf.set(b.id, legs);
    // Only worth saying near the flight: the trip's clock is within a day
    // or so of any airport's, so this counts a flight whose ping could be
    // due about now and cannot be read, not every flight on every run.
    for (const l of legs) {
      if (!l.at && [shiftDay(l.day, -1), l.day].includes(clock.day)) input.onSkip?.('flight_no_origin_zone');
    }
  }
  for (const userId of people) {
    const theirs = flights.filter(b => !sitsOut(b.id, userId)).flatMap(b => (legsOf.get(b.id) ?? []).map(leg => ({ b, leg, day: leg.day })));
    // Two confirmed flights leaving the same day and nothing saying which
    // one is theirs (one per departure airport, say): naming either could
    // send somebody to the wrong desk, so neither is named.
    const sameDay = (d: string | null) => theirs.filter(f => f.day === d).length;
    for (const { b, leg, day } of theirs) {
      if (sameDay(day) !== 1) continue;
      const at = leg.at;
      if (!at) continue;
      if (at.day === shiftDay(day as string, -1) && inWindow('flight_checkin', at.hour)) {
        const what = leg.what;
        const ref = referenceOf(b);
        out.push({
          kind: 'flight_checkin', userId, localDay: at.day,
          note: {
            kind: 'flight_checkin',
            title: 'Your flight is tomorrow',
            body: [what ? `${what}.` : null, 'Check in with the airline before you go.', ref ? `Booking reference ${ref}.` : null].filter(Boolean).join(' '),
            url, planId: plan.id,
          },
        });
      }
      if (at.day === day && inWindow('flight_day', at.hour)) {
        const ident = leg.ident;
        if (ident) {
          out.push({
            kind: 'flight_day', userId, localDay: at.day,
            // Written by runPings from AeroAPI's answer; nothing is said
            // about this flight until AeroAPI has said it.
            note: { kind: 'flight_day', title: ident, url, planId: plan.id },
            flight: { ident, departDate: day as string },
          });
        }
      }
    }
  }

  // ── tonight: a reserved evening line with a time, before that time ──
  if (inWindow('tonight', clock.hour)) {
    const evening = lines
      .filter(l => reserved(l, bookings))
      .map(l => {
        const when = rowWhen(l.scheduled_time, plan.start_date);
        const c = when?.time ? clockOf(when.time) : null;
        return when && c && when.date === clock.day && c.h >= 17 ? { l, c, text: clockText(when.time as string) } : null;
      })
      .filter((x): x is { l: PingLine; c: { h: number; m: number }; text: string } => !!x && !!x.text && !!clean(x.l.title))
      .sort((a, b) => a.c.h * 60 + a.c.m - (b.c.h * 60 + b.c.m));
    for (const userId of people) {
      const mine = evening.filter(e => onLine(e.l, userId));
      // Only before the first of them: "Tonight: dinner, 7:30 PM" at nine
      // o'clock is a reminder of something already missed.
      if (!mine.length || clock.hour >= mine[0].c.h) continue;
      const [first, ...rest] = mine;
      out.push({
        kind: 'tonight', userId, localDay: clock.day,
        note: {
          kind: 'tonight',
          title: `Tonight: ${clean(first.l.title)}, ${first.text}`,
          body: rest.length ? `Then ${rest.map(r => `${clean(r.l.title)}, ${r.text}`).join('; ')}.` : title,
          url, planId: plan.id,
        },
      });
    }
  }
  return out;
}

// ── The weather, the day before ──────────────────────────────────────────
// "Rain likely tomorrow afternoon (70%)", to the people on an outdoor line of
// tomorrow's plan, linking to Change on that line (which then offers indoor
// places first — lib/itinerary-alternatives.ts preferIndoor). Only:
//
//   - for a line we hold, on tomorrow by the trip's clock, that is out of
//     doors by its venue's map kind (or, with no venue, its own words);
//   - when tomorrow's forecast for that part of the day — from a source we
//     cache, with its credit — spoils it (lib/forecast.ts worries). No
//     forecast, no ping, never one guessed from the averages;
//   - once per line per person per day, claimed as weather_<line id>;
//   - never to somebody who muted the plan, or sat the line out.
//
// A line somebody already holds a booking for is not offered a swap — it
// cannot be swapped — and is told to check with them instead.

export const WEATHER_TYPES = new Set(['activity', 'restaurant']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Short enough to sit after a sentence in a notification. */
const SHORT_CREDIT: Record<ForecastSource, string> = {
  met_norway: SOURCES.met_norway.credit,
  nws: 'Forecast data from weather.gov (US National Weather Service)',
};

export interface WeatherPingInput extends PingInput {
  /** Tomorrow's forecast, on the trip's clock, as held. Null: none, and no ping. */
  tomorrow: HeldDay | null;
  /** line id → the map kind of the venue it cites. */
  kinds: Map<string, string>;
}

/** The lines of tomorrow worth asking the forecast about: ours, typed for it, and on tomorrow. */
export function linesForTomorrow(plan: PingPlan, lines: PingLine[], now: Date): { day: string; lines: PingLine[] } | null {
  const clock = localClock(plan.destination_lng, now, plan.destination_lat);
  if (!clock || !inWindow('weather', clock.hour) || OVER.has(String(plan.status ?? ''))) return null;
  const tomorrow = shiftDay(clock.day, 1);
  if (!tomorrow) return null;
  const ours = (lines ?? []).filter(l => l?.id && UUID_RE.test(l.id) && WEATHER_TYPES.has(String(l.type ?? ''))
    && rowWhen(l.scheduled_time, plan.start_date)?.date === tomorrow && !!clean(l.title));
  return ours.length ? { day: tomorrow, lines: ours } : null;
}

/** "afternoon" → "tomorrow afternoon"; a line that only says its day → "tomorrow". */
const whenWords = (part: string) => (part === 'day' ? 'tomorrow' : `tomorrow ${part}`);

/** Every weather ping due for this plan at `now`. Pure. */
export function dueWeatherPings(input: WeatherPingInput, now: Date = new Date()): PlannedPing[] {
  const { plan, tomorrow } = input;
  if (!plan?.id || !tomorrow) return [];
  const clock = localClock(plan.destination_lng, now, plan.destination_lat);
  const due = linesForTomorrow(plan, input.lines, now);
  if (!clock || !due || tomorrow.date !== due.day) return [];
  const { people, solo } = audience(plan, input.memberIds);
  if (!people.length) return [];
  const bookings = (input.bookings ?? []).filter(b => b?.id);
  const live = (line: PingLine) => bookings.filter(b => b.itinerary_item_id === line.id && b.status !== 'cancelled' && b.status !== 'failed');
  const nightOut = plan.type === 'restaurant';
  const out: PlannedPing[] = [];
  for (const line of due.lines) {
    const verdict = lineWeatherFrom({ time: line.scheduled_time, title: line.title, kind: input.kinds.get(line.id) ?? null, type: line.type }, tomorrow, nightOut);
    if (!verdict) continue;
    const part = partFor(tomorrow, partOfLine(line.scheduled_time, nightOut));
    const said = part ? worryHeadline(part) : null;
    if (!part || !said) continue;
    const wet = part.worries[0] === 'rain' || part.worries[0] === 'storms' || part.worries[0] === 'snow';
    const name = clean(line.title).length > 70 ? `${clean(line.title).slice(0, 67).replace(/\s+\S*$/, '')}…` : clean(line.title);
    const held = reserved(line, bookings);
    const ask = held
      ? 'It is booked, so check with them before you go.'
      : solo ? 'Want an indoor swap?' : 'Want to look at an indoor swap for the group?';
    const title = `${said} ${whenWords(verdict.part)}${wet ? rainFigure(part) : ''}`;
    const body = `“${name}” is outdoors. ${ask} ${SHORT_CREDIT[tomorrow.source]}.`;
    for (const userId of people) {
      // Somebody sitting out every booking on the line is not told about it.
      const bs = live(line);
      if (bs.length && bs.every(b => input.optOuts.get(b.id)?.has(userId))) continue;
      out.push({
        kind: 'weather', userId, localDay: clock.day,
        claimKind: `weather_${line.id.replace(/-/g, '').toLowerCase()}`,
        note: { kind: 'weather', title, body, url: `${planUrl(plan)}&change=${encodeURIComponent(line.id)}`, planId: plan.id },
      });
    }
  }
  return out;
}

// ── AeroAPI ──────────────────────────────────────────────────────────────

export interface AeroFlight {
  status?: string | null;
  scheduled_out?: string | null;
  estimated_out?: string | null;
  gate_origin?: string | null;
  terminal_origin?: string | null;
  departure_delay?: number | null;
  cancelled?: boolean | null;
  origin?: { code_iata?: string | null; timezone?: string | null } | null;
}

/** The date and wall-clock time of an instant in a named zone, or null. */
function wallClock(iso: unknown, tz: unknown): { day: string; time: string } | null {
  if (typeof iso !== 'string' || typeof tz !== 'string' || !tz) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(new Date(t)).map(p => [p.type, p.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}` };
  } catch {
    return null;
  }
}

/**
 * The day-of note from AeroAPI's answer, or null when nothing in it is the
 * flight on that date. Gate and terminal only as AeroAPI gave them; a time
 * only in the departure airport's own zone, as AeroAPI named it.
 */
export function flightDayNote(ident: string, departDate: string, flights: AeroFlight[], now?: Date): { title: string; body: string } | null {
  const f = (Array.isArray(flights) ? flights : []).find(x => wallClock(x?.scheduled_out, x?.origin?.timezone)?.day === departDate);
  if (!f) return null;
  if (now) {
    // "Today" is the departure airport's today, in the zone AeroAPI names,
    // and only before the flight has gone.
    if (zoneClock(f.origin?.timezone, now)?.day !== departDate) return null;
    const out = Date.parse(String(f.estimated_out ?? f.scheduled_out ?? ''));
    if (!f.cancelled && Number.isFinite(out) && now.getTime() >= out) return null;
  }
  const sched = wallClock(f.scheduled_out, f.origin?.timezone);
  const est = wallClock(f.estimated_out, f.origin?.timezone);
  if (f.cancelled) return { title: `${ident} is cancelled`, body: 'The airline has cancelled this flight. Check with them for your options.' };
  const from = clean(f.origin?.code_iata);
  const at = est && sched && est.time !== sched.time ? `now ${est.time} (was ${sched.time})` : sched?.time ?? null;
  const parts = [
    at ? `Departs ${from ? `${from} ` : ''}${at}` : null,
    clean(f.terminal_origin) ? `terminal ${clean(f.terminal_origin)}` : null,
    clean(f.gate_origin) ? `gate ${clean(f.gate_origin)}` : null,
  ].filter(Boolean);
  const status = clean(f.status);
  return {
    title: status ? `${ident} today: ${status}` : `${ident} today`,
    body: parts.length ? `${parts.join(', ')}.` : 'Check the airline for the latest.',
  };
}

export type AeroLookup = (ident: string) => Promise<AeroFlight[] | null>;

/** AeroAPI, or null when there is no key — and then every flight_day ping is skipped. */
export function aeroLookup(key: string | undefined, f: typeof fetch = fetch): AeroLookup | null {
  if (!key) return null;
  return async ident => {
    try {
      const res = await f(`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(ident)}`, { headers: { 'x-apikey': key } });
      if (!res.ok) {
        console.error('[pings] AeroAPI refused', { ident, status: res.status });
        return null;
      }
      const json = await res.json() as { flights?: AeroFlight[] };
      return Array.isArray(json?.flights) ? json.flights : [];
    } catch (e) {
      console.error('[pings] AeroAPI did not answer', { ident, error: (e as Error).message });
      return null;
    }
  };
}

// ── Settling up ──────────────────────────────────────────────────────────
// Reach never moves money between members (lib/money.ts). What it can do is
// remind the one person who owes it, from the ledger's own lines, that
// somebody is waiting. The lines are recomputed on every read and carry no
// age of their own, so "older than three days" is read off the ledger
// itself: nothing on it — no expense, no contribution, no booking, no
// payment marked or withdrawn — has changed for three days. A line that
// just appeared, or just shrank because somebody paid part of it, is left
// alone until it has stood unchanged that long.
//
// Who: the payer on each line, and nobody else. Never the payee, never the
// rest of the group. Never on a trip of one, which has nobody to settle with.
//
// How often: at most once every three days per person per plan. The claim
// is the ping_log row for (plan, user, 'settle_up', local_day), so two runs
// on one day cannot both send; the three-day spacing reads the last claim.
// That read cannot race, because the window is the trip's daytime (10:00 to
// 21:00) and an hourly run lasts minutes: two runs that could each miss the
// other's claim would both have to sit either side of the trip's local
// midnight at the same moment, and nothing is sent at midnight.
//
// Whatever the plan's status: a trip called off after somebody paid the
// deposit still has money on it that one member owes another.
//
// When: from the day after the trip's last day, on the trip's clock, for
// thirty days. Never before or during it. Until then the group may still be
// paying its own shares through Pay, and the ledger spreads each paid share
// across everybody (planShares / apportion): Ana pays her own $100 of a $400
// trip and the three who have not paid yet each read as owing her $25. A
// reminder then would ask them to pay Ana money they do not owe, and then
// their own share again (review, 2026-10-23). Once the trip is over nothing
// is still being collected, and what the ledger says is what is left. A plan
// with no dates cannot say when that is, and is not reminded about. Past the
// thirty days, the ledger screen still says who owes what.
//
// What it says: who is waiting and for how much, from the ledger, and what
// to do — pay, then mark it paid, which the ledger screen can do
// (POST /api/plans/[id]/settlements). Before sql/settle-up-2026-09-25.sql
// nothing can be marked paid, so nothing is sent.

export const SETTLE_EVERY_DAYS = 3;
/** The ledger must have stood unchanged this long before anybody is reminded. */
export const SETTLE_QUIET_MS = 3 * 86_400_000;
/** Days after the trip's last day that reminders keep going. */
export const SETTLE_FOR_DAYS_AFTER = 30;

export interface SettlePlan extends PingPlan {
  destination_city?: string | null;
}

export interface SettleInput {
  plan: SettlePlan;
  memberIds: string[];
  ledger: Pick<Ledger, 'solo' | 'settlementsAvailable' | 'lines'>;
  /** The newest timestamp on anything that moves the ledger, ISO. Null: nothing to go on. */
  lastChange: string | null;
  /** users.id → first name, for the people being waited on. */
  names: Map<string, string>;
  /** payer id → the local_day of their last settle_up ping on this plan. */
  lastSent: Map<string, string>;
  onSkip?: (why: string) => void;
}

/** "$42" or "$42.50". */
export function money(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return c % 100 === 0 ? `$${c / 100}` : `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

/** The trip's last day: its end, or its start when the end is missing or earlier. */
function lastDayOfPlan(plan: PingPlan): string | null {
  const start = validDay(plan.start_date);
  if (!start) return null;
  const end = validDay(plan.end_date);
  return end && end >= start ? end : start;
}

/** Every settle-up reminder due on this plan at `now`, one per payer at most. Pure. */
export function dueSettleUps(input: SettleInput, now: Date = new Date()): PlannedPing[] {
  const { plan, ledger } = input;
  const skip = (why: string) => { input.onSkip?.(why); return [] as PlannedPing[]; };
  if (!plan?.id) return [];
  if (ledger.solo) return [];
  const members = [...new Set(input.memberIds.filter(Boolean).map(String))];
  if (audience(plan, members).solo) return [];

  const clock = localClock(plan.destination_lng, now, plan.destination_lat);
  if (!clock) return [];
  if (!inWindow('settle_up', clock.hour)) return [];
  const last = lastDayOfPlan(plan);
  if (!last) return [];
  // Only once the trip is over: before, shares may still be coming in.
  if (clock.day <= last) return skip('settle_up_trip_not_over');
  const until = shiftDay(last, SETTLE_FOR_DAYS_AFTER);
  if (!until || clock.day > until) return [];

  const owing = (ledger.lines ?? []).filter((l: SettleLine) =>
    l.amountCents > 0 && l.from !== l.to && members.includes(l.from) && members.includes(l.to));
  if (!owing.length) return [];
  if (!ledger.settlementsAvailable) return skip('settle_up_no_settlements_table');

  const changed = input.lastChange ? Date.parse(input.lastChange) : NaN;
  // Money is owed and nothing says since when: not three days we can show.
  if (!Number.isFinite(changed)) return skip('settle_up_no_age');
  if (now.getTime() - changed < SETTLE_QUIET_MS) return skip('settle_up_too_new');

  const byPayer = new Map<string, SettleLine[]>();
  for (const l of owing) byPayer.set(l.from, [...(byPayer.get(l.from) ?? []), l]);

  const note = settleNote(plan as unknown as Record<string, unknown>);
  const url = settleUrl(plan);
  const out: PlannedPing[] = [];
  const quietSince = shiftDay(clock.day, -(SETTLE_EVERY_DAYS - 1)) as string;
  for (const [payer, theirs] of byPayer) {
    const sent = input.lastSent.get(payer);
    if (sent && sent >= quietSince) { input.onSkip?.('settle_up_recent'); continue; }
    const lines = [...theirs].sort((a, b) => b.amountCents - a.amountCents || a.to.localeCompare(b.to));
    const [first, ...rest] = lines;
    const who = (id: string) => clean(input.names.get(id)) || null;
    const firstName = who(first.to);
    const title = firstName
      ? `${firstName} is still waiting on ${money(first.amountCents)}`
      : `You still owe ${money(first.amountCents)} from ${note}`;
    const others = rest.map(l => (who(l.to) ? `${who(l.to)}, ${money(l.amountCents)}` : money(l.amountCents)));
    const body = [
      firstName ? `From ${note}.` : null,
      others.length ? `Also still to pay: ${others.join('; ')}.` : null,
      lines.some(l => l.pending)
        ? 'If it has gone, mark it paid so the trip squares up.'
        : 'Once you have paid, mark it paid so the trip squares up.',
    ].filter(Boolean).join(' ');
    out.push({ kind: 'settle_up', userId: payer, localDay: clock.day, note: { kind: 'settle_up', title, body, url, planId: plan.id } });
  }
  return out;
}

/**
 * Every row whose `col` is one of `values`, however many. One `.in()` over
 * every plan answered at most 1,000 rows and said nothing of the rest, so
 * past a few hundred active plans lines and bookings were silently dropped
 * (a reserved dinner read as unreserved, a flight vanished), and a long id
 * list ran into the URL limit. Read in chunks of ids, each paged by range.
 */
export async function readAllIn(
  db: SupabaseClient, table: string, cols: string, col: string, values: string[],
  opts: { chunk?: number; page?: number; order?: string[] } = {},
): Promise<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }> {
  const chunk = opts.chunk ?? 100;
  const page = opts.page ?? 1000;
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < values.length; i += chunk) {
    const part = values.slice(i, i + chunk);
    for (let from = 0; ; from += page) {
      // Ordered on a unique key, so a page boundary never skips or repeats a row.
      let q = db.from(table).select(cols).in(col, part);
      for (const o of opts.order ?? [col]) q = q.order(o);
      const { data, error } = await q.range(from, from + page - 1);
      if (error) return { data: null, error };
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      out.push(...rows);
      if (rows.length < page) break;
    }
  }
  return { data: out, error: null };
}

// ── Claiming and sending ─────────────────────────────────────────────────

export interface PingReport {
  plans: number;
  sent: Record<string, number>;
  already: number;
  muted: number;
  skipped: Record<string, number>;
  failed: number;
  /** Plans the settle-up pass read a ledger for. */
  settlePlans?: number;
  /** Set when the run stopped before sending anything. */
  stopped?: string;
}

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message || ''));

const PLAN_COLUMNS = 'id, group_id, title, type, status, start_date, end_date, solo_mode, created_by, destination_lng, destination_lat, destination_country';

export type PingOpts = {
  now?: Date; send: Sender | null; aero: AeroLookup | null; dry?: boolean;
  /** The ledger reader; lib/ledger.ts loadLedger unless a test passes its own. */
  ledger?: (db: SupabaseClient, plan: { id: string; group_id: string }) => Promise<Pick<Ledger, 'solo' | 'settlementsAvailable' | 'lines'>>;
  /** The forecast reader; lib/forecast-store.ts forecastFor unless a test passes its own. */
  forecast?: (db: SupabaseClient, at: { lat: number; lng: number }, want: { dates: string[]; country?: string | null }) => Promise<PlaceForecast>;
};

/**
 * Claim one ping, then send it. The insert is the check: the unique index on
 * (plan, user, kind, local_day) is the only thing that can tell two
 * simultaneous runs apart. 'missing' means there is no ping_log at all, and
 * the run must stop.
 */
async function claimAndSend(
  db: SupabaseClient, planId: string, ping: PlannedPing, note: Note, send: Sender | null, report: PingReport,
): Promise<'ok' | 'missing'> {
  const { data: claimed, error: claimErr } = await db.from('ping_log')
    .insert({ plan_id: planId, user_id: ping.userId, kind: ping.claimKind ?? ping.kind, local_day: ping.localDay })
    .select('id').single();
  if (claimErr) {
    if (claimErr.code === '23505') { report.already++; return 'ok'; }
    if (missingTable(claimErr)) {
      console.error('[pings] no ping_log — run sql/pings-2026-09-25.sql; sending nothing, since nothing could stop a second send');
      return 'missing';
    }
    console.error('[pings] could not claim', { kind: ping.kind, code: claimErr.code });
    report.failed++;
    return 'ok';
  }

  const d = await notifyUsers(db, [ping.userId], note, send);
  const channels = [d.stored && d.inApp ? 'bell' : null, d.pushed.length ? 'push' : null].filter((c): c is string => !!c);
  if (!channels.length) {
    report.failed++;
  } else {
    report.sent[ping.kind] = (report.sent[ping.kind] ?? 0) + 1;
  }
  const { error: markErr } = await db.from('ping_log')
    .update({ channels, sent_at: channels.length ? new Date().toISOString() : null })
    .eq('id', (claimed as { id: string }).id);
  if (markErr) console.error('[pings] sent, and could not note it', { kind: ping.kind, code: markErr.code });
  return 'ok';
}

/**
 * One run: the countdown pings, then the settle-up reminders, each ping
 * claimed then sent. `dry` works out what is due and claims and sends nothing.
 */
export async function runPings(db: SupabaseClient, opts: PingOpts): Promise<PingReport> {
  const report = await runCountdown(db, opts);
  // Without ping_log nothing can be sent once, settle-ups included.
  if (report.stopped === 'ping_log_missing') return report;
  return runSettleUps(db, opts, report);
}

/** The newest of these timestamps, ISO, or null. */
export function newest(...stamps: unknown[]): string | null {
  let best = -Infinity;
  for (const s of stamps) {
    const t = typeof s === 'string' ? Date.parse(s) : NaN;
    if (Number.isFinite(t) && t > best) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

/** The settle-up pass. Adds to `report`; sets `stopped` only when nothing could be sent once. */
export async function runSettleUps(db: SupabaseClient, opts: PingOpts, report: PingReport): Promise<PingReport> {
  const now = opts.now ?? new Date();
  const skip = (why: string) => { report.skipped[why] = (report.skipped[why] ?? 0) + 1; };
  const readLedger = opts.ledger ?? loadLedger;

  // Every plan whose last day is no more than thirty days gone, anywhere —
  // and the one or two days either side of every zone's today.
  const utc = now.toISOString().slice(0, 10);
  const lo = shiftDay(utc, -(SETTLE_FOR_DAYS_AFTER + 2)) as string;
  const { data: plans, error: pErr } = await db.from('plans')
    .select(`${PLAN_COLUMNS}, destination_city, budget_cents`)
    .or(`end_date.gte.${lo},start_date.gte.${lo}`)
    .limit(500);
  if (pErr) {
    console.error('[pings] settle-up could not read plans', { code: pErr.code });
    skip('settle_up_plans_unreadable');
    return report;
  }
  const placed = ((plans ?? []) as SettlePlan[]).filter(p => localClock(p.destination_lng, now, p.destination_lat) !== null);
  if (!placed.length) return report;
  const ids = placed.map(p => p.id);

  // Which of them have money on them at all, and when it last moved.
  const [expenses, contributions, bookings, settlements] = await Promise.all([
    db.from('expenses').select('plan_id, created_at').in('plan_id', ids),
    db.from('contributions').select('plan_id, status, created_at, updated_at').in('plan_id', ids),
    db.from('bookings').select('plan_id, created_at, updated_at').in('plan_id', ids),
    db.from('settlements').select('plan_id, created_at, updated_at, paid_at').in('plan_id', ids),
  ]);
  // A ledger whose age cannot be read is not three days old as far as we
  // can say. A missing settlements table is a ledger nobody can mark paid,
  // which dueSettleUps answers on its own.
  for (const [name, r] of [['expenses', expenses], ['contributions', contributions], ['bookings', bookings]] as const) {
    if (r.error) {
      console.error('[pings] settle-up could not read', { table: name, code: r.error.code });
      skip('settle_up_ledger_unreadable');
      return report;
    }
  }
  if (settlements.error && !missingTable(settlements.error) && !/^(PGRST204|42703)$/.test(String(settlements.error.code ?? ''))) {
    console.error('[pings] settle-up could not read settlements', { code: settlements.error.code });
    skip('settle_up_ledger_unreadable');
    return report;
  }

  const stamps = new Map<string, unknown[]>();
  const stamp = (planId: unknown, ...ts: unknown[]) => {
    const k = String(planId);
    stamps.set(k, [...(stamps.get(k) ?? []), ...ts]);
  };
  const withMoney = new Set<string>();
  for (const e of (expenses.data ?? []) as Record<string, unknown>[]) { withMoney.add(String(e.plan_id)); stamp(e.plan_id, e.created_at); }
  for (const c of (contributions.data ?? []) as Record<string, unknown>[]) {
    if (c.status === 'succeeded') withMoney.add(String(c.plan_id));
    stamp(c.plan_id, c.created_at, c.updated_at);
  }
  for (const b of (bookings.data ?? []) as Record<string, unknown>[]) stamp(b.plan_id, b.created_at, b.updated_at);
  for (const s of ((settlements.error ? [] : settlements.data) ?? []) as Record<string, unknown>[]) stamp(s.plan_id, s.created_at, s.updated_at, s.paid_at);

  const candidates = placed.filter(p => withMoney.has(String(p.id)));
  if (!candidates.length) return report;

  const groups = [...new Set(candidates.map(p => String(p.group_id)))];
  const candidateIds = candidates.map(p => p.id);
  const [members, sentRows] = await Promise.all([
    db.from('group_members').select('group_id, user_id').in('group_id', groups),
    db.from('ping_log').select('plan_id, user_id, local_day')
      .eq('kind', 'settle_up').in('plan_id', candidateIds).gte('local_day', shiftDay(utc, -(SETTLE_EVERY_DAYS + 2)) as string),
  ]);
  if (members.error) {
    console.error('[pings] settle-up could not read members', { code: members.error.code });
    skip('settle_up_members_unreadable');
    return report;
  }
  if (sentRows.error) {
    if (missingTable(sentRows.error)) {
      console.error('[pings] no ping_log — run sql/pings-2026-09-25.sql');
      return { ...report, stopped: 'ping_log_missing' };
    }
    // Without the last send, "once every three days" is a guess. Next hour.
    console.error('[pings] settle-up could not read when it last reminded anybody', { code: sentRows.error.code });
    skip('settle_up_log_unreadable');
    return report;
  }
  const lastSent = new Map<string, Map<string, string>>();
  for (const r of (sentRows.data ?? []) as Record<string, unknown>[]) {
    const m = lastSent.get(String(r.plan_id)) ?? new Map<string, string>();
    const day = String(r.local_day).slice(0, 10);
    const u = String(r.user_id);
    if (!m.has(u) || day > (m.get(u) as string)) m.set(u, day);
    lastSent.set(String(r.plan_id), m);
  }
  const membersOf = new Map<string, string[]>();
  for (const m of (members.data ?? []) as Record<string, unknown>[]) {
    membersOf.set(String(m.group_id), [...(membersOf.get(String(m.group_id)) ?? []), String(m.user_id)]);
  }

  const names = new Map<string, string>();
  const named = async (ids: string[]) => {
    const want = ids.filter(id => !names.has(id));
    if (!want.length) return;
    const { data, error } = await db.from('users').select('id, first_name, name').in('id', want);
    if (error) { console.error('[pings] settle-up could not read names', { code: error.code }); return; }
    for (const u of (data ?? []) as Record<string, unknown>[]) {
      const first = clean(u.first_name) || clean(u.name).split(' ')[0] || '';
      if (first) names.set(String(u.id), first);
    }
  };

  report.settlePlans = 0;
  for (const plan of candidates) {
    let ledger: Pick<Ledger, 'solo' | 'settlementsAvailable' | 'lines'>;
    try {
      ledger = await readLedger(db, plan as unknown as { id: string; group_id: string });
    } catch {
      skip('settle_up_ledger_unreadable');
      continue;
    }
    report.settlePlans++;
    await named([...new Set((ledger.lines ?? []).filter(l => l.amountCents > 0).map(l => l.to))]);
    const due = dueSettleUps({
      plan,
      memberIds: membersOf.get(String(plan.group_id)) ?? [],
      ledger,
      lastChange: newest(...(stamps.get(String(plan.id)) ?? [])),
      names,
      lastSent: lastSent.get(String(plan.id)) ?? new Map(),
      onSkip: skip,
    }, now);
    if (!due.length) continue;

    const mutes = await mutedFor(db, plan.id, due.map(d => d.userId));
    if (!mutes.ok) { skip('mutes_unreadable'); continue; }
    for (const ping of due) {
      if (mutes.muted.has(ping.userId)) { report.muted++; continue; }
      if (opts.dry) { report.sent[ping.kind] = (report.sent[ping.kind] ?? 0) + 1; continue; }
      const claimed = await claimAndSend(db, plan.id, ping, ping.note, opts.send, report);
      if (claimed === 'missing') return { ...report, stopped: 'ping_log_missing' };
    }
  }
  return report;
}

/**
 * line id → the map kind of the venue the line cites (itinerary_items.venue_ref
 * → discovery_venues.kind). A line citing nothing, or a read that fails, has
 * no kind, and is judged on its own words alone.
 */
export async function venueKinds(db: SupabaseClient, lineIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!lineIds.length) return out;
  const { data: refs, error } = await db.from('itinerary_items').select('id, venue_ref').in('id', lineIds);
  if (error) {
    console.error('[pings] could not read which venues tomorrow\'s lines cite', { code: error.code });
    return out;
  }
  const venueIds = [...new Set(((refs ?? []) as Array<{ venue_ref?: string | null }>).map(r => r.venue_ref).filter((v): v is string => !!v))];
  if (!venueIds.length) return out;
  const { data: venues, error: vErr } = await db.from('discovery_venues').select('id, kind').in('id', venueIds);
  if (vErr) {
    console.error('[pings] could not read the venues tomorrow\'s lines cite', { code: vErr.code });
    return out;
  }
  const kindOf = new Map(((venues ?? []) as Array<{ id: string; kind?: string | null }>).filter(v => v.kind).map(v => [String(v.id), String(v.kind)]));
  for (const r of (refs ?? []) as Array<{ id: string; venue_ref?: string | null }>) {
    const k = r.venue_ref ? kindOf.get(String(r.venue_ref)) : undefined;
    if (k) out.set(String(r.id), k);
  }
  return out;
}

async function runCountdown(db: SupabaseClient, opts: PingOpts): Promise<PingReport> {
  const now = opts.now ?? new Date();
  const report: PingReport = { plans: 0, sent: {}, already: 0, muted: 0, skipped: {}, failed: 0 };
  const skip = (why: string) => { report.skipped[why] = (report.skipped[why] ?? 0) + 1; };

  // Wide enough on both sides that every zone's "today" is inside it: a
  // week and a day ahead for the packing ping, two days back for a trip
  // ending as the date line passes.
  const utc = now.toISOString().slice(0, 10);
  const hi = shiftDay(utc, 9) as string;
  const lo = shiftDay(utc, -2) as string;
  const { data: plans, error: pErr } = await db.from('plans').select(PLAN_COLUMNS)
    .not('status', 'in', '(cancelled,completed)')
    .lte('start_date', hi)
    .or(`end_date.gte.${lo},start_date.gte.${lo}`)
    .limit(1000);
  if (pErr) {
    console.error('[pings] could not read plans', { code: pErr.code, message: pErr.message });
    return { ...report, stopped: 'plans_unreadable' };
  }
  const rows = (plans ?? []) as PingPlan[];
  report.plans = rows.length;
  if (!rows.length) return report;

  const ids = rows.map(p => p.id);
  const groups = [...new Set(rows.map(p => p.group_id))];
  const [members, lines, bookings, optouts] = await Promise.all([
    readAllIn(db, 'group_members', 'group_id, user_id', 'group_id', groups, { order: ['group_id', 'user_id'] }),
    readAllIn(db, 'itinerary_items', 'id, plan_id, type, title, subtitle, scheduled_time, is_confirmed', 'plan_id', ids, { order: ['plan_id', 'id'] }),
    readAllIn(db, 'bookings', 'id, plan_id, itinerary_item_id, vertical, mode, status, provider_ref, confirmation_number, detail, request_payload, response_payload', 'plan_id', ids, { order: ['plan_id', 'id'] }),
    readAllIn(db, 'item_optouts', 'plan_id, item_ref, user_id', 'plan_id', ids, { order: ['plan_id', 'item_ref', 'user_id'] }),
  ]);
  // Without the members or the lines nothing can be said; without the
  // bookings a flight is invisible and a reserved dinner looks unreserved;
  // without the opt-outs somebody sitting a dinner out is told it is
  // tonight. Each stops the run — the next hour tries again.
  for (const [name, r] of [['group_members', members], ['itinerary_items', lines], ['bookings', bookings]] as const) {
    if (r.error) {
      console.error('[pings] could not read', { table: name, code: r.error.code });
      return { ...report, stopped: `${name}_unreadable` };
    }
  }
  if (optouts.error && !missingTable(optouts.error)) {
    console.error('[pings] could not read who is sitting what out', { code: optouts.error.code });
    return { ...report, stopped: 'item_optouts_unreadable' };
  }

  const by = <T extends Record<string, unknown>>(list: T[] | null, key: string) => {
    const m = new Map<string, T[]>();
    for (const r of list ?? []) {
      const k = String(r[key]);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const membersBy = by(members.data as Record<string, unknown>[], 'group_id');
  const linesBy = by(lines.data as Record<string, unknown>[], 'plan_id');
  const bookingsBy = by(bookings.data as Record<string, unknown>[], 'plan_id');
  const optBy = by((optouts.error ? [] : optouts.data) as Record<string, unknown>[], 'plan_id');

  const lookups = new Map<string, Promise<AeroFlight[] | null>>();

  // The weather pings: which plans have a line tomorrow worth asking the
  // forecast about, and the map kind of the venue each line cites. Only
  // those plans' forecasts are read, through the cache.
  const tomorrowLines = new Map<string, { day: string; lines: PingLine[] }>();
  for (const plan of rows) {
    const t = linesForTomorrow(plan, (linesBy.get(plan.id) ?? []) as unknown as PingLine[], now);
    if (t) tomorrowLines.set(plan.id, t);
  }
  const kinds = await venueKinds(db, [...tomorrowLines.values()].flatMap(t => t.lines.map(l => l.id)));
  const readForecast = opts.forecast ?? ((d: SupabaseClient, at: { lat: number; lng: number }, want: { dates: string[]; country?: string | null }) => forecastFor(d, at, want, { now }));

  for (const plan of rows) {
    if (localClock(plan.destination_lng, now, plan.destination_lat) === null) { skip('no_place'); continue; }
    const optOuts = new Map<string, Set<string>>();
    for (const o of optBy.get(plan.id) ?? []) {
      const ref = String(o.item_ref);
      optOuts.set(ref, (optOuts.get(ref) ?? new Set()).add(String(o.user_id)));
    }
    const input: PingInput = {
      plan,
      memberIds: (membersBy.get(plan.group_id) ?? []).map(m => String(m.user_id)),
      lines: (linesBy.get(plan.id) ?? []) as unknown as PingLine[],
      bookings: (bookingsBy.get(plan.id) ?? []) as unknown as PingBooking[],
      optOuts,
      onSkip: skip,
    };
    const due = duePings(input, now);
    const t = tomorrowLines.get(plan.id);
    if (t) {
      const at = forecastPoint(plan.destination_lat, plan.destination_lng);
      if (!at) skip('weather_no_point');
      else {
        const fc = await readForecast(db, at, { dates: [t.day], country: plan.destination_country ?? null })
          .catch((e: unknown) => { console.error('[pings] forecast read failed', { error: (e as Error)?.message }); return null; });
        const tomorrow = fc?.days.find(d => d.date === t.day) ?? null;
        if (fc && !fc.available) skip('weather_no_forecast_table');
        else if (!tomorrow) skip('weather_no_forecast');
        due.push(...dueWeatherPings({ ...input, tomorrow, kinds }, now));
      }
    }
    if (!due.length) continue;

    const mutes = await mutedFor(db, plan.id, due.map(d => d.userId));
    if (!mutes.ok) { skip('mutes_unreadable'); continue; }

    for (const ping of due) {
      if (mutes.muted.has(ping.userId)) { report.muted++; continue; }

      let note = ping.note;
      if (ping.kind === 'flight_day' && ping.flight) {
        if (!opts.aero) { skip('flight_day_no_aeroapi_key'); continue; }
        const { ident, departDate } = ping.flight;
        if (!lookups.has(ident)) lookups.set(ident, opts.aero(ident));
        const flights = await lookups.get(ident);
        if (!flights) { skip('flight_day_aeroapi_failed'); continue; }
        const said = flightDayNote(ident, departDate, flights, now);
        if (!said) { skip('flight_day_not_found'); continue; }
        note = { ...note, ...said };
      }

      if (opts.dry) { report.sent[ping.kind] = (report.sent[ping.kind] ?? 0) + 1; continue; }

      const claimed = await claimAndSend(db, plan.id, ping, note, opts.send, report);
      if (claimed === 'missing') return { ...report, stopped: 'ping_log_missing' };
    }
  }
  return report;
}
