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
// no pings rather than pings at a guessed hour. The flight pings use the
// same clock — the departure airport's own zone is not something we hold,
// and for a trip within one country the difference is a few hours inside a
// window that is most of a day wide.
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
import { notifyUsers, mutedFor, type Note, type Sender } from './notify-user.ts';
import { rowWhen, clockOf, validDay } from './ics.ts';
import { tripTiming } from './calendar.ts';
import { nightsBetween } from './away.ts';
import { packingList, packingLine, type PackLine } from './packing.ts';
import { isSoloPlan } from './booking/approval.ts';
import { isOrderId } from './booking/duffel-map.ts';

export const PING_KINDS = ['packing', 'flight_checkin', 'flight_day', 'tonight'] as const;
export type PingKind = typeof PING_KINDS[number];

// ── The trip's clock ─────────────────────────────────────────────────────

/** The day and the hour at a longitude — the same rounding as dayWhere. */
export function localClock(lng: unknown, now: Date = new Date()): { day: string; hour: number } | null {
  const deg = typeof lng === 'number' ? lng : typeof lng === 'string' && lng.trim() ? Number(lng) : NaN;
  // Null is not 0: a plan nobody placed is not in Greenwich.
  if (!Number.isFinite(deg) || deg < -180 || deg > 180) return null;
  const hours = Math.max(-12, Math.min(14, Math.round(deg / 15)));
  const there = new Date(now.getTime() + hours * 3_600_000);
  return { day: there.toISOString().slice(0, 10), hour: there.getUTCHours() };
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
}

/** One ping for one person, or one that needs AeroAPI before it is written. */
export interface PlannedPing {
  kind: PingKind;
  userId: string;
  localDay: string;
  note: Note;
  /** flight_day only: the flight to ask AeroAPI about, and its date. */
  flight?: { ident: string; departDate: string };
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

function identOf(b: PingBooking): string | null {
  const fromBook = clean(obj(b.response_payload)?.flightIdent);
  const fromAsk = clean(obj(obj(b.request_payload)?.flight)?.flightNumber);
  const ident = (fromBook || fromAsk).toUpperCase();
  return /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(ident) ? ident : null;
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

// ── What is due ──────────────────────────────────────────────────────────

/**
 * Every ping due for this plan at `now`, one per person. Pure: what the rows
 * and the clock say, and nothing else. Claiming and sending are runPings's.
 */
export function duePings(input: PingInput, now: Date = new Date()): PlannedPing[] {
  const { plan } = input;
  if (!plan?.id || OVER.has(String(plan.status ?? ''))) return [];
  const clock = localClock(plan.destination_lng, now);
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
        ...lines.filter(l => onLine(l, userId)),
        // A flight bought through Reach is on the trip whether or not the
        // itinerary has a line for it.
        ...flights.filter(b => !sitsOut(b.id, userId)).map(b => ({ id: b.id, type: 'flight', title: clean(b.detail) || null })),
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
  for (const userId of people) {
    const theirs = flights.filter(b => !sitsOut(b.id, userId)).map(b => ({ b, day: departDateOf(b) })).filter(f => f.day);
    const tomorrow = theirs.filter(f => f.day === shiftDay(clock.day, 1));
    const today = theirs.filter(f => f.day === clock.day);
    // Two confirmed flights leaving the same day and nothing saying which
    // one is theirs (one per departure airport, say): naming either could
    // send somebody to the wrong desk, so neither is named.
    if (tomorrow.length === 1 && inWindow('flight_checkin', clock.hour)) {
      const { b } = tomorrow[0];
      const what = clean(b.detail);
      const ref = referenceOf(b);
      out.push({
        kind: 'flight_checkin', userId, localDay: clock.day,
        note: {
          kind: 'flight_checkin',
          title: 'Your flight is tomorrow',
          body: [what ? `${what}.` : null, 'Check in with the airline before you go.', ref ? `Booking reference ${ref}.` : null].filter(Boolean).join(' '),
          url, planId: plan.id,
        },
      });
    }
    if (today.length === 1 && inWindow('flight_day', clock.hour)) {
      const ident = identOf(today[0].b);
      if (ident) {
        out.push({
          kind: 'flight_day', userId, localDay: clock.day,
          // Written by runPings from AeroAPI's answer; nothing is said
          // about this flight until AeroAPI has said it.
          note: { kind: 'flight_day', title: ident, url, planId: plan.id },
          flight: { ident, departDate: today[0].day as string },
        });
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
export function flightDayNote(ident: string, departDate: string, flights: AeroFlight[]): { title: string; body: string } | null {
  const f = (Array.isArray(flights) ? flights : []).find(x => wallClock(x?.scheduled_out, x?.origin?.timezone)?.day === departDate);
  if (!f) return null;
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

// ── Claiming and sending ─────────────────────────────────────────────────

export interface PingReport {
  plans: number;
  sent: Record<string, number>;
  already: number;
  muted: number;
  skipped: Record<string, number>;
  failed: number;
  /** Set when the run stopped before sending anything. */
  stopped?: string;
}

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message || ''));

const PLAN_COLUMNS = 'id, group_id, title, type, status, start_date, end_date, solo_mode, created_by, destination_lng';

/**
 * One run: every plan near enough to have a ping due, every ping due, each
 * claimed then sent. `dry` works out what is due and claims and sends nothing.
 */
export async function runPings(db: SupabaseClient, opts: {
  now?: Date; send: Sender | null; aero: AeroLookup | null; dry?: boolean;
}): Promise<PingReport> {
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
    db.from('group_members').select('group_id, user_id').in('group_id', groups),
    db.from('itinerary_items').select('id, plan_id, type, title, subtitle, scheduled_time, is_confirmed').in('plan_id', ids),
    db.from('bookings').select('id, plan_id, itinerary_item_id, vertical, mode, status, provider_ref, confirmation_number, detail, request_payload, response_payload').in('plan_id', ids),
    db.from('item_optouts').select('plan_id, item_ref, user_id').in('plan_id', ids),
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

  for (const plan of rows) {
    if (localClock(plan.destination_lng, now) === null) { skip('no_place'); continue; }
    const optOuts = new Map<string, Set<string>>();
    for (const o of optBy.get(plan.id) ?? []) {
      const ref = String(o.item_ref);
      optOuts.set(ref, (optOuts.get(ref) ?? new Set()).add(String(o.user_id)));
    }
    const due = duePings({
      plan,
      memberIds: (membersBy.get(plan.group_id) ?? []).map(m => String(m.user_id)),
      lines: (linesBy.get(plan.id) ?? []) as unknown as PingLine[],
      bookings: (bookingsBy.get(plan.id) ?? []) as unknown as PingBooking[],
      optOuts,
    }, now);
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
        const said = flightDayNote(ident, departDate, flights);
        if (!said) { skip('flight_day_not_found'); continue; }
        note = { ...note, ...said };
      }

      if (opts.dry) { report.sent[ping.kind] = (report.sent[ping.kind] ?? 0) + 1; continue; }

      // The claim. Insert first: the unique index is the only thing that
      // can tell two simultaneous runs apart.
      const { data: claimed, error: claimErr } = await db.from('ping_log')
        .insert({ plan_id: plan.id, user_id: ping.userId, kind: ping.kind, local_day: ping.localDay })
        .select('id').single();
      if (claimErr) {
        if (claimErr.code === '23505') { report.already++; continue; }
        if (missingTable(claimErr)) {
          console.error('[pings] no ping_log — run sql/pings-2026-09-25.sql; sending nothing, since nothing could stop a second send');
          return { ...report, stopped: 'ping_log_missing' };
        }
        console.error('[pings] could not claim', { kind: ping.kind, code: claimErr.code });
        report.failed++;
        continue;
      }

      const d = await notifyUsers(db, [ping.userId], note, opts.send);
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
    }
  }
  return report;
}
