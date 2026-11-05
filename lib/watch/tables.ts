// ─── Watching for a table at a restaurant that is hard to get into ──────
// Owner, 2026-11-05: "a particular place in mind but it's really hard to get
// a reservation there … sit and watch … once a favorable reservation comes
// available, book it within your travel window."
//
// What Reach can honestly do, from the research of the same day (workflow
// wf_745eec5f, citing the platforms' own docs):
//
//   · Ask a platform for openings again and again only under a partner deal,
//     through its own API. That is the same switch as booking: a provider is
//     on only when its keys are set (lib/booking/registry.ts). Never a
//     scraped page, never the person's own account, never a browser.
//   · Book without the person there: no. OpenTable's Consumer API makes the
//     booking "contingent upon user acceptance of OpenTable's terms and
//     conditions within a visually accessible interface", and neither it nor
//     Yelp says the terms can be accepted in advance. So when a slot opens
//     Reach takes the platform's own five-minute hold through the one booking
//     path (lib/reservations/reserve.ts, with chosen.watch) and tells the
//     person; their tap is press two on the terms in front of them.
//     PRE_ACCEPTED below is where a platform's written permission would go —
//     there is none, and no screen offers it.
//   · Hold one table, never a spare: OpenTable refuses a second booking
//     within 2.5 hours on the same day, and holding a backup to trade up is
//     the hoarding that gets accounts closed. So a slot within 2.5 hours of
//     a table the person already has — held by another of their watches,
//     booked, or held on another line of the plan — is never taken
//     (deps.taken, clashes), and a watch never holds over a hold somebody is
//     reading the terms for on its own row.
//   · Every request a check makes counts against the run's budget, the
//     ones press one makes as well (deps.hold reports them), and a platform
//     that says slow down during a hold is left alone like one that says it
//     to an openings request.
//   · A hold that runs out is said as that, and the watch carries on — but
//     the same slot is never held twice, and three lapsed holds stop the
//     watch. A hold blocks other diners for five minutes; doing that over
//     and over for somebody asleep is the abuse the platforms ban.
//
// What it does instead, where it can't:
//
//   · a platform Reach has no deal with: that platform's own alert (Resy
//     Notify, OpenTable Notify me, Tock Notify), opened on the restaurant's
//     page for the night and party — and said plainly that Reach is not the
//     one watching. No platform documents a link that opens its form filled
//     in, so none is promised.
//   · a restaurant that books by phone: nothing for Reach to check, so no
//     watch is offered or saved — their number, and the suggestion to ask
//     whether they keep a cancellation list. A watch that nothing checks is
//     a promise nobody keeps.
//
// Facts come only from the venue row the line cites (venue_ref), never a
// name match, the same rule as booking (lib/reservations/table-venue.ts).
//
// Pure apart from `tableWatcher`, whose reads and press one are passed in.
import type { TableProvider, TableSlot } from '../booking/tables/types.ts';
import { PLATFORM_LABEL, isRefusal } from '../booking/tables/types.ts';
import { PLATFORM_NAME, type Platform } from '../booking/reservations.ts';
import { dayWhere } from '../calendar.ts';
import { localMinute } from '../reservations/policy.ts';
import { reserveMarkOf, tableWhen } from '../reservations/reserve-state.ts';
import { tableStateOf } from '../booking/tables/flow.ts';
import { clockSaid, dateSaid } from '../line-when.ts';
import type { InstantTable, ReserveResult } from '../reservations/reserve.ts';
import type { CheckCtx, WatchRow, WatchStep, Watcher, WatchNote } from './types.ts';

// ─── The rules ──────────────────────────────────────────────────────────

export const TABLE_WATCH = {
  /** Live watches one person may have at once. */
  perPerson: 3,
  /** Nights one watch may cover: one openings request each, every check. */
  nights: 7,
  /** How far ahead a watch with no trip may look. */
  daysAhead: 60,
  /** Checked this often while the nearest night is within two days … */
  nearMinutes: 15,
  /** … and this often before that. */
  farMinutes: 60,
  /** Holds that ran out unbooked before Reach stops holding for this watch. */
  lapses: 3,
  partyMin: 1,
  partyMax: 20,
} as const;

/**
 * Platforms whose own written terms let Reach book a table the person
 * agreed to in advance, without the terms on screen at the time. None: see
 * the header. A platform goes here only with the clause that says so.
 */
export const PRE_ACCEPTED: Readonly<Record<string, { clause: string }>> = {};

/**
 * Each platform's own alert, by the name it gives it, where its help pages
 * say it exists for a future night (research 2026-11-05). SevenRooms runs
 * its alerts per restaurant and Yelp's waitlist is a same-day queue, so
 * neither is offered as one.
 */
export const OWN_ALERT: Partial<Record<Platform, string>> = { resy: 'Notify', opentable: 'Notify me', tock: 'Notify' };

// ─── The window: which nights, which times, how many ────────────────────

export interface TableWindow {
  /** YYYY-MM-DD, the restaurant's own days, sorted. */
  nights: string[];
  /** HH:MM, 24-hour: the earliest and latest time they would sit down. */
  from: string;
  to: string;
  party: number;
}

/** What a table watch keeps in watches.spec. */
export interface TableSpec extends TableWindow {
  restaurant: string;
  /** The venue's longitude, for its own day and clock. */
  lng: number | null;
  /** Holds that ran out unbooked. */
  lapses?: number;
  /**
   * The table had been handed to them to book, and when they set the watch
   * they said they hadn't booked it themselves (POST /api/watches,
   * notBookedElsewhere): press one may hold it, as the reserve route's own
   * notBookedElsewhere lets a person's press.
   */
  notBookedElsewhere?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const realDay = (s: string) => DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export type WindowAnswer = { ok: true; window: TableWindow } | { ok: false; code: 'bad_window'; error: string };

/**
 * The window somebody picked, checked: real nights, none gone, all inside
 * the trip when there is one (or within TABLE_WATCH.daysAhead when there is
 * not), at most TABLE_WATCH.nights of them, a time range that runs forwards,
 * and a party a platform takes. Nothing is filled in for them.
 */
export function readWindow(
  given: { nights?: unknown; from?: unknown; to?: unknown; party?: unknown },
  ctx: { today: string; trip: { start: string | null; end: string | null } | null },
): WindowAnswer {
  const no = (error: string): WindowAnswer => ({ ok: false, code: 'bad_window', error });
  const nights = Array.isArray(given.nights) ? [...new Set(given.nights.filter((n): n is string => typeof n === 'string' && realDay(n)))].sort() : [];
  if (!nights.length) return no('Pick at least one night.');
  if (Array.isArray(given.nights) && nights.length !== new Set(given.nights).size) return no('One of those nights is not a date.');
  if (nights.length > TABLE_WATCH.nights) return no(`Pick up to ${TABLE_WATCH.nights} nights.`);
  if (nights[0] < ctx.today) return no('One of those nights has already gone.');
  const start = ctx.trip?.start ?? null;
  if (start) {
    const end = ctx.trip?.end || start;
    if (nights[0] < start || nights[nights.length - 1] > end) return no("Pick nights on this trip — one of those isn't.");
  } else if (nights[nights.length - 1] > addDays(ctx.today, TABLE_WATCH.daysAhead)) {
    return no(`Pick nights in the next ${TABLE_WATCH.daysAhead} days.`);
  }
  const from = typeof given.from === 'string' ? given.from.trim() : '';
  const to = typeof given.to === 'string' ? given.to.trim() : '';
  if (!CLOCK.test(from) || !CLOCK.test(to)) return no('Pick the earliest and latest time you would sit down.');
  if (from > to) return no('The earliest time has to come before the latest.');
  const party = Number(given.party);
  if (!Number.isInteger(party) || party < TABLE_WATCH.partyMin || party > TABLE_WATCH.partyMax) {
    return no(`A table is for ${TABLE_WATCH.partyMin} to ${TABLE_WATCH.partyMax} people.`);
  }
  return { ok: true, window: { nights, from, to, party } };
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The nights a picker offers: the trip's, from today, or the next fortnight with no trip. */
export function nightsOffered(today: string, trip: { start: string | null; end: string | null } | null): string[] {
  const out: string[] = [];
  const start = trip?.start && trip.start > today ? trip.start : today;
  const end = trip?.start ? (trip.end || trip.start) : addDays(today, 13);
  for (let d = start; d <= end && out.length < 31; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * When the watch stops: a day and a half after its last night's date at
 * UTC midnight, which is after that night has ended everywhere on Earth.
 * The check also drops each night once it has gone at the restaurant.
 */
export function expiresAtFor(nights: readonly string[]): string {
  const last = [...nights].sort().pop()!;
  return new Date(Date.parse(`${last}T00:00:00Z`) + 36 * 3_600_000).toISOString();
}

/** When to look again: every fifteen minutes once the nearest night is two days off, hourly before. */
export function nextCheck(now: Date, nights: readonly string[], lng: number | null): string {
  const here = dayWhere(lng, now);
  const soon = nights.some(n => n >= here && n <= addDays(here, 2));
  return new Date(now.getTime() + (soon ? TABLE_WATCH.nearMinutes : TABLE_WATCH.farMinutes) * 60_000).toISOString();
}

export const slotKey = (date: string, time: string) => `${date}T${time}`;

const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** OpenTable refuses a second booking within 2.5 hours on the same day. */
export const CLASH_MINUTES = 150;

/** A table the person already has, or has held for them: another watch's hold, a booking, a hold on another line. */
export interface TakenTable { date: string; time: string }

/** Within 2.5 hours, on the same night, of a table they already have. */
export function clashes(s: { date: string; time: string }, taken: readonly TakenTable[]): boolean {
  return taken.some(t => t.date === s.date && CLOCK.test(t.time) && Math.abs(minutes(t.time) - minutes(s.time)) < CLASH_MINUTES);
}

/**
 * The slot to hold from what a platform listed: on a night watched, inside
 * the time range, not gone at the restaurant, never one already held or
 * told, never within 2.5 hours of a table they already have (`avoid`) —
 * and one Reach may book (no card). Earliest night first, then the time
 * nearest the middle of the range. `card` is what matched but wants a card,
 * which only the platform's own page takes.
 */
export function pickSlot(
  slots: readonly TableSlot[],
  w: TableWindow,
  ctx: { now: Date; lng: number | null; seen: readonly string[]; avoid?: readonly TakenTable[] },
): { slot: TableSlot | null; card: TableSlot | null } {
  const here = localMinute(ctx.lng, ctx.now) ?? ctx.now.toISOString().slice(0, 16);
  const mid = (minutes(w.from) + minutes(w.to)) / 2;
  const ok = slots
    .filter(s => w.nights.includes(s.date) && s.time >= w.from && s.time <= w.to)
    .filter(s => slotKey(s.date, s.time) > here && !ctx.seen.includes(slotKey(s.date, s.time)))
    .filter(s => !clashes(s, ctx.avoid ?? []))
    .sort((a, b) => a.date.localeCompare(b.date) || Math.abs(minutes(a.time) - mid) - Math.abs(minutes(b.time) - mid));
  return { slot: ok.find(s => !s.needsCard) ?? null, card: ok.find(s => s.needsCard) ?? null };
}

/** "Fri, Nov 6, Sat, Nov 7 · 7:00 PM–9:00 PM for 4" — the window in words. */
export function windowSaid(w: TableWindow): string {
  const nights = w.nights.map(n => dateSaid(n) ?? n);
  const times = w.from === w.to ? clockSaid(w.from) : `${clockSaid(w.from)}–${clockSaid(w.to)}`;
  return `${nights.length > 3 ? `${nights.length} nights, ${nights[0]} to ${nights[nights.length - 1]}` : nights.join(', ')} · ${times} for ${w.party}`;
}

// ─── Whether Reach can watch this one, and what it says ─────────────────

export type WatchOffer =
  | {
      can: 'platform';
      platform: string;
      platformName: string;
      /** One sentence: exactly what Reach will do. */
      what: string;
    }
  | {
      can: 'none';
      why: 'not_ready' | 'not_running' | 'no_venue' | 'no_deal' | 'phone_only' | 'nothing_held';
      what: string;
      /** The platform's own alert, on the restaurant's page there. */
      alert: { label: string; href: string; say: string } | null;
      /** Their number, to ask for a cancellation list themselves. */
      phone: string | null;
    };

export interface OfferFacts {
  restaurant: string;
  /** The platform the cited venue row says it books on. */
  platform: Platform;
  /** That platform's page for the restaurant, or their own booking page. */
  reserveUrl: string | null;
  phone: string | null;
  /** The watch is on a plan's line, with a booking row Reach can hold a table on. */
  onPlan: boolean;
  /** The line cites a venue row at all. */
  cited: boolean;
}

export interface OfferState {
  instant: InstantTable | null;
  /** The watches table exists (sql/table-watches-2026-11-05.sql has run). */
  migrated: boolean;
  /** The scheduled check has run recently (a watch_runs row in the last two hours). */
  running: boolean;
}

/**
 * What Reach offers for this restaurant: to watch it on a platform it has a
 * deal with, or not — and then the platform's own alert or their number,
 * said as theirs. A restaurant that books by phone has nothing Reach can
 * check, so it is never offered as a watch.
 * "Reach watches" appears only where every switch it needs is on.
 */
export function offerFor(f: OfferFacts, s: OfferState): WatchOffer {
  const name = f.platform !== 'none' ? PLATFORM_NAME[f.platform] : null;
  const own = OWN_ALERT[f.platform];
  const alert = own && name && f.reserveUrl
    ? { label: `Set ${name} ${own}`, href: f.reserveUrl, say: `Open ${f.restaurant} on ${name}, pick the night and party, and tap ${own}. ${name} tells you when a table opens.` }
    : null;
  const theirs = (what: string, why: Extract<WatchOffer, { can: 'none' }>['why']): WatchOffer => ({ can: 'none', why, what, alert, phone: f.phone });

  if (!f.cited) return theirs(`Reach doesn't hold ${f.restaurant}'s booking details, so it can't watch it.`, 'no_venue');
  if (!s.migrated) return theirs(`Reach can't watch for tables yet.`, 'not_ready');

  if (s.instant && s.running) {
    const on = PLATFORM_LABEL[s.instant.provider.platform];
    return {
      can: 'platform', platform: s.instant.provider.platform, platformName: on,
      what: f.onPlan
        ? `Reach checks ${on} for a table at ${f.restaurant} on the nights you pick. When one opens, ${on} holds it for five minutes and Reach tells you — you tap to book it.`
        : `Reach checks ${on} for a table at ${f.restaurant} on the nights you pick, and tells you when one opens so you can book it.`,
    };
  }
  if (s.instant && !s.running) return theirs(`Reach's table watch isn't running yet.`, 'not_running');

  if (!name && f.phone) {
    return theirs(`We hold only a phone number for ${f.restaurant}, so there's nothing online for Reach to watch. Ring them and ask whether they keep a cancellation list.`, 'phone_only');
  }
  if (name) {
    return theirs(alert
      ? `Reach can't watch ${name} for you yet. ${name} has its own ${own}.`
      : `Reach can't watch ${name} for you yet.`, 'no_deal');
  }
  return theirs(`Reach doesn't hold a way to book ${f.restaurant}, so it can't watch it.`, 'nothing_held');
}

// ─── What a plan's table already says ───────────────────────────────────

const dayIn = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const clockIn = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : null);

/**
 * A booking row as a table somebody has, or has held: booked (or said
 * booked), pending at the platform or on a call, or with a live hold on it.
 * Its night and time are what was booked, else what the line asks for.
 */
export function tableTaken(b: Record<string, any>, now: Date): TakenTable | null {
  const booked = (b.response_payload?.booked ?? {}) as Record<string, unknown>;
  const asked = (b.request_payload?.restaurant ?? {}) as Record<string, unknown>;
  const hold = tableStateOf(b as never)?.hold ?? null;
  const has = b.status === 'confirmed' || b.status === 'pending' || !!String(b.confirmation_number ?? '').trim();
  if (has) {
    const date = dayIn(booked.date) ?? dayIn(asked.date);
    const time = clockIn(booked.time) ?? clockIn(asked.time);
    return date && time ? { date, time } : null;
  }
  if (hold && Date.parse(hold.expiresAt) > now.getTime()) return { date: hold.date, time: hold.time };
  return null;
}

/**
 * Why a plan's table can't take a new watch as it stands, or null. Mirrors
 * reserveTable's own order: a card owed at the platform, a call ringing, then
 * a table handed to them that they haven't said they didn't book — which
 * would make every hold the watch tried come back "ask first".
 */
export function blockedForWatch(
  b: { status: string; mode?: string | null; provider_ref?: string | null; response_payload?: unknown },
  restaurant: string, notBookedElsewhere: boolean,
): { code: 'booked' | 'calling' | 'ask_first'; error: string } | null {
  if (b.status === 'pending' && b.mode === 'native' && b.provider_ref) {
    return { code: 'booked', error: `${restaurant} is held for you until you add a card on the platform's page. It isn't booked until you do.` };
  }
  const mark = reserveMarkOf(b as never);
  if (b.status === 'pending' && (mark?.state === 'calling' || mark?.state === 'requested')) {
    return { code: 'calling', error: `Reach is asking ${restaurant} about this table now. Watch it once that's done.` };
  }
  if ((b.status === 'redirected' || (b.status === 'pending' && mark?.state !== 'not_booked')) && !notBookedElsewhere) {
    return { code: 'ask_first', error: `Have you already booked ${restaurant} yourself? If not, Reach will watch for a table and hold one when it opens.` };
  }
  return null;
}

// ─── What the person is told ────────────────────────────────────────────

const landing = (id: string) => `/home?watch=${encodeURIComponent(id)}`;

export const WATCH_COPY = {
  held: (s: TableSpec, platform: string, date: string, time: string) => ({
    title: `A table for ${s.party} at ${s.restaurant} opened: ${tableWhen(date, time)}`,
    body: `${platform} is holding it for five minutes. Tap to read the terms and book it.`,
  }),
  lapsed: (s: TableSpec, date: string, time: string, more: boolean) => ({
    title: `The table at ${s.restaurant} wasn't booked in time`,
    body: more
      ? `${tableWhen(date, time)} was held for five minutes and is no longer held. Nothing was booked. Reach is still watching.`
      : `${tableWhen(date, time)} was held for five minutes and is no longer held. Nothing was booked. That's ${TABLE_WATCH.lapses} tables gone by, so Reach has stopped watching — start again if you still want one.`,
  }),
  opened: (s: TableSpec, platform: string, date: string, time: string) => ({
    title: `A table for ${s.party} at ${s.restaurant} opened: ${tableWhen(date, time)}`,
    body: `Reach can't hold it from here. Book it on ${platform} before somebody else does.`,
  }),
  card: (s: TableSpec, platform: string, date: string, time: string) => ({
    title: `A table for ${s.party} at ${s.restaurant} opened: ${tableWhen(date, time)}`,
    body: `${s.restaurant} wants a card for it, which only ${platform}'s own page takes. Reach didn't hold it. Reach is still watching.`,
  }),
  askFirst: (s: TableSpec, date: string, time: string) => ({
    title: `Reach stopped watching ${s.restaurant}`,
    body: `A table opened for ${tableWhen(date, time)}, but this table was handed to you to book, so Reach didn't hold it. If you haven't booked it, start watching again and say so.`,
  }),
  expired: (s: TableSpec) => ({
    title: `Reach stopped watching ${s.restaurant}`,
    body: 'The nights you picked have gone. Nothing was booked.',
  }),
};

// ─── The check ──────────────────────────────────────────────────────────

/** What a check needs to know about the table, read fresh each time. */
export interface LoadedTable {
  restaurant: string;
  /** Booking links from the cited venue row only (TableFacts.urls). */
  urls: (string | null)[];
  reserveUrl: string | null;
  lng: number | null;
  /** The plan's booking row the watch is on, as it stands. Null for a watch with no plan. */
  booking: {
    status: string;
    confirmed: boolean;
    /** Somebody said they booked it themselves. */
    theirs: boolean;
    /** Mid-claim: somebody is pressing two right now. */
    busy: boolean;
    /** The hold on the row now — this watch's, or one somebody took pressing Book it — and when it runs out. */
    holdId: string | null;
    holdExpiresAt: string | null;
    /**
     * Reach booked it on the platform and the platform is holding it for a
     * card on its own page ('pending' with a reservation id): a table
     * exists, waiting on them. Not booked, and not lapsed either.
     */
    owed: boolean;
  } | null;
}

export interface TableWatchDeps {
  /** The table as it stands. Null when it cannot be read just now (tried again later), or is gone. */
  load(row: WatchRow): Promise<{ gone: true } | LoadedTable | null>;
  instantFor(urls: readonly (string | null | undefined)[]): InstantTable | null;
  /**
   * Press one through the one booking path (reserveTable with chosen.watch):
   * hold this slot exactly, or nothing. `calls` is every request it made to
   * a platform (its own openings, the hold, a release), counted against the
   * run's budget like the check's own.
   */
  hold(row: WatchRow, slot: { date: string; time: string }): Promise<{ result: ReserveResult; calls: number }>;
  /**
   * The tables this watch's person already has, other than the one watched:
   * their other watches' live holds, and tables booked or held on their
   * plans. Null when that cannot be read: nothing is held or told until it can.
   */
  taken(row: WatchRow): Promise<TakenTable[] | null>;
}

/** The most requests press one makes: its openings, the hold, and a release when the hold cannot be saved. */
export const HOLD_CALLS = 3;

const ASKS = ['openings', 'hold', 'release', 'reserve', 'modify', 'status', 'cancel', 'quote', 'book'] as const;

/**
 * The same provider, counting every request made to it into `tally` — how
 * press one's own requests reach the run's budget. What it knows without
 * asking (enabled, allows, venueIdFrom) is not counted.
 */
export function counted<P extends TableProvider>(p: P, tally: { n: number }): P {
  const c = Object.create(p) as P;
  for (const k of ASKS) {
    const f = (p as unknown as Record<string, unknown>)[k];
    if (typeof f === 'function') {
      (c as unknown as Record<string, unknown>)[k] = (...args: unknown[]) => { tally.n++; return (f as (...a: unknown[]) => unknown).apply(p, args); };
    }
  }
  return c;
}

export function specOf(row: WatchRow): TableSpec {
  const s = (row.spec ?? {}) as Partial<TableSpec>;
  return {
    restaurant: String(s.restaurant || 'the restaurant'),
    nights: Array.isArray(s.nights) ? s.nights.filter((n): n is string => typeof n === 'string') : [],
    from: String(s.from ?? '00:00'), to: String(s.to ?? '23:59'),
    party: Number(s.party) || 1,
    lng: typeof s.lng === 'number' && Number.isFinite(s.lng) ? s.lng : null,
    lapses: Number(s.lapses) || 0,
    ...(s.notBookedElsewhere === true ? { notBookedElsewhere: true } : {}),
  };
}

/** A table that opened which Reach told about but could not hold: kept for the landing until it is gone. */
export interface Opening { date: string; time: string; link: string | null; card: boolean }

export function openingOf(last: WatchRow['last_result']): Opening | null {
  const o = (last as { opening?: Partial<Opening> } | null)?.opening;
  return o && typeof o.date === 'string' && typeof o.time === 'string'
    ? { date: o.date, time: o.time, link: typeof o.link === 'string' && /^https:\/\//.test(o.link) ? o.link : null, card: o.card === true }
    : null;
}

/** What watches.hold keeps while a table is held. */
export interface HeldNow {
  holdId: string;
  date: string;
  time: string;
  expiresAt: string;
  platform: string;
  /** The terms_required answer's own words, for the landing (GET /api/watches/[id]). */
  button: string;
  title: string;
  body: string;
  changeNote: string | null;
}

export function heldOf(row: Pick<WatchRow, 'hold'>): HeldNow | null {
  const h = row.hold as Partial<HeldNow> | null;
  return h && typeof h.holdId === 'string' && typeof h.expiresAt === 'string' && typeof h.date === 'string' && typeof h.time === 'string'
    ? h as HeldNow : null;
}

export function tableWatcher(deps: TableWatchDeps): Watcher {
  return { kind: 'table', check: (row, ctx) => checkTable(row, ctx, deps) };
}

export async function checkTable(row: WatchRow, ctx: CheckCtx, deps: TableWatchDeps): Promise<WatchStep> {
  const spec = specOf(row);
  const { now } = ctx;
  const at = now.toISOString();
  const later = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const after = (iso: string) => new Date(Date.parse(iso) + 60_000).toISOString();
  const live = (iso: string | null | undefined) => !!iso && Date.parse(iso) > now.getTime();
  const note = (w: { title: string; body: string }): WatchNote => ({ ...w, url: landing(row.id), planId: row.plan_id });
  const expired = (): WatchStep => ({ patch: { status: 'expired', hold: null, last_result: { at, found: 'expired' } }, note: note(WATCH_COPY.expired(spec)), calls: 0 });

  // A table told about but not held stays on the landing — with its link —
  // until its time has gone, or a later check asked that night and it was
  // no longer listed. Every last_result this check writes carries it, so a
  // notification tapped hours later still lands on a way to book.
  const here = localMinute(spec.lng, now) ?? at.slice(0, 16);
  const before = openingOf(row.last_result);
  const kept = (answered: ReadonlySet<string> = new Set(), listed: readonly TableSlot[] = []) =>
    before && slotKey(before.date, before.time) > here
      && (!answered.has(before.date) || listed.some(s => s.date === before.date && s.time === before.time))
      ? { opening: before } : {};

  if (Date.parse(row.expires_at) <= now.getTime()) return expired();

  const loaded = await deps.load(row);
  if (!loaded) return { patch: { next_check_at: later(30 * 60_000), last_result: { at, found: 'unreadable', ...kept() } }, calls: 0 };
  // The dinner left the plan, or the venue row went: nothing left to watch, nobody to tell.
  if ('gone' in loaded) return { patch: { status: 'ended', hold: null, last_result: { at, found: 'gone' } }, calls: 0 };

  const b = loaded.booking;
  const held = heldOf(row);
  // Booked — by their tap on this watch's hold, or any other way: done, and
  // nothing more is said (the booking itself told everybody).
  if (b && (b.confirmed || b.theirs)) {
    const ours = row.status === 'held' && b.confirmed;
    return { patch: { status: ours ? 'booked' : 'ended', hold: null, last_result: { at, found: ours ? 'booked' : 'booked_elsewhere' } }, calls: 0 };
  }
  // Press two went through and the platform wants a card on its own page: a
  // reservation exists there, waiting on them (their tap was answered with
  // that page). Not a lapse, and nothing more to hold.
  if (b?.owed) return { patch: { status: 'ended', hold: null, last_result: { at, found: 'card_owed' } }, calls: 0 };

  let seen = [...(row.seen ?? [])];
  let lapses = spec.lapses ?? 0;
  if (row.status === 'held' && held) {
    // Somebody is pressing two right now: look again in a minute.
    if (b?.busy) return { patch: { next_check_at: later(60_000) }, calls: 0 };
    if (b && b.holdId === held.holdId && live(held.expiresAt)) {
      return { patch: { next_check_at: after(held.expiresAt) }, calls: 0 };
    }
    seen = [...new Set([...seen, slotKey(held.date, held.time)])];
    // Somebody pressed Book it on this line over the watch's hold: the row
    // holds theirs now. Not a lapse and nothing said — they are on it — and
    // nothing is held over theirs while it is live.
    if (b && b.holdId && b.holdId !== held.holdId) {
      return {
        patch: { status: 'active', hold: null, seen, last_result: { at, found: 'replaced' }, next_check_at: live(b.holdExpiresAt) ? after(b.holdExpiresAt!) : later(60_000) },
        calls: 0,
      };
    }
    // Ran out unbooked. Said, and that slot is never held again by this watch.
    lapses += 1;
    const more = lapses < TABLE_WATCH.lapses;
    return {
      patch: {
        status: more ? 'active' : 'ended', hold: null, seen, spec: { ...row.spec, lapses },
        last_result: { at, found: 'lapsed', lapses },
        next_check_at: later(60_000),
      },
      note: note(WATCH_COPY.lapsed(spec, held.date, held.time, more)),
      calls: 0,
    };
  }

  // A hold on the row that is not this watch's: somebody pressed Book it and
  // is reading the terms. Nothing asked, nothing held over it.
  if (b && b.holdId && live(b.holdExpiresAt)) {
    return { patch: { next_check_at: after(b.holdExpiresAt!), last_result: { at, found: 'their_hold', ...kept() } }, calls: 0 };
  }

  const today = dayWhere(spec.lng, now);
  const nights = spec.nights.filter(n => n >= today);
  if (!nights.length) return expired();

  // Only a platform is ever watched (offerFor). A row saying otherwise is
  // from before that: ended, never left looking as if something checks it.
  if (row.method !== 'platform') return { patch: { status: 'ended', hold: null, last_result: { at, found: 'cannot_watch' } }, calls: 0 };

  const instant = deps.instantFor(loaded.urls);
  // Its keys were taken off, or the venue no longer carries the id: nothing
  // is asked, and the watch waits rather than pretending to look.
  if (!instant) return { patch: { next_check_at: later(3_600_000), last_result: { at, found: 'platform_off', ...kept() } }, calls: 0 };
  const platform = instant.provider.platform;
  const on = PLATFORM_LABEL[platform];
  if (ctx.throttled.has(platform)) return { patch: { next_check_at: later(3_600_000) }, calls: 0, throttled: platform };

  const w: TableWindow = { nights, from: spec.from, to: spec.to, party: spec.party };
  const ask = clockBetween(spec.from, spec.to);
  const slots: TableSlot[] = [];
  const answered = new Set<string>();
  let calls = 0;
  let throttled: string | null = null;
  const problems: string[] = [];
  for (const night of nights) {
    if (calls >= ctx.budget) break;
    calls++;
    const o = await openingsOf(instant.provider, instant.venueId, { date: night, time: ask, covers: spec.party });
    if (isRefusal(o)) {
      problems.push(o.code);
      if (o.code === 'rate_limited') { throttled = platform; break; }
      continue;
    }
    answered.add(night);
    slots.push(...o.slots);
  }
  const next = () => throttled ? later(3_600_000) : nextCheck(now, nights, spec.lng);
  const result = (extra: Record<string, unknown>) => ({ at, asked: calls, ...(problems.length ? { problems } : {}), ...kept(answered, slots), ...extra });
  const quiet = (extra: Record<string, unknown>, more: Partial<WatchStep['patch']> = {}): WatchStep =>
    ({ patch: { next_check_at: next(), platform, ...more, last_result: result(extra) }, calls, throttled });

  let pick = pickSlot(slots, w, { now, lng: spec.lng, seen });
  if (pick.slot || pick.card) {
    // Never a second table within 2.5 hours of one they already have.
    const taken = await deps.taken(row);
    if (!taken) return quiet({ found: 'unreadable' });
    pick = pickSlot(slots, w, { now, lng: spec.lng, seen, avoid: taken });
  }
  const { slot, card } = pick;

  if (!slot) {
    if (card) {
      // Told once, with the platform's own page: theirs to take with their card.
      const opening: Opening = { date: card.date, time: card.time, link: card.handoffUrl ?? loaded.reserveUrl, card: true };
      return {
        ...quiet({ found: 'card', opening }, { seen: [...seen, slotKey(card.date, card.time)] }),
        note: note(WATCH_COPY.card(spec, on, card.date, card.time)),
      };
    }
    return quiet({ found: 'nothing' });
  }

  const key = slotKey(slot.date, slot.time);
  // No plan to hold it on: told, with where to book it, and never told twice.
  if (!b) {
    const opening: Opening = { date: slot.date, time: slot.time, link: slot.handoffUrl ?? loaded.reserveUrl, card: false };
    return {
      ...quiet({ found: 'opened', opening }, { seen: [...seen, key] }),
      note: note(WATCH_COPY.opened(spec, on, slot.date, slot.time)),
    };
  }

  // Press one makes requests of its own: only with room for all of them in
  // this run's budget. Otherwise the slot waits for the next run, untouched.
  if (ctx.budget - calls < HOLD_CALLS) return quiet({ found: 'deferred' }, { next_check_at: at });

  const pressed = await deps.hold(row, { date: slot.date, time: slot.time });
  calls += pressed.calls;
  const r = pressed.result;
  if (r.ok === false && (r.code === 'rate_limited' || r.status === 429)) {
    // Slow down, said to the hold: the same as said to an openings request.
    throttled = platform;
    return quiet({ found: 'not_held', code: 'rate_limited' });
  }
  if (r.ok === false && r.code === 'terms_required' && r.hold) {
    const h: HeldNow = {
      holdId: r.hold.holdId, date: r.hold.date, time: r.hold.time, expiresAt: r.hold.expiresAt, platform,
      button: r.button ?? 'Book this table', title: r.title ?? '', body: r.body ?? '', changeNote: r.changeNote ?? null,
    };
    return {
      patch: { status: 'held', hold: h as unknown as Record<string, unknown>, seen: [...seen, key], platform, next_check_at: after(h.expiresAt), last_result: result({ found: 'held', date: h.date, time: h.time }) },
      note: note(WATCH_COPY.held(spec, on, h.date, h.time)), calls, throttled,
    };
  }
  if (r.ok === false && r.code === 'ask_first') {
    // Handed to them after the watch was set, and nobody has said they
    // haven't booked it: Reach can never hold it, so it stops — told once,
    // not once for every table that opens.
    return {
      patch: { status: 'ended', hold: null, seen: [...seen, key], platform, last_result: result({ found: 'ask_first', date: slot.date, time: slot.time }) },
      note: note(WATCH_COPY.askFirst(spec, slot.date, slot.time)), calls, throttled,
    };
  }
  // Gone before the hold, somebody booking it right now, a platform that did
  // not answer: nothing held, nothing said, look again. A slot the booking
  // path will never hold for this table (a card, a night off the trip, a way
  // of booking it no longer open) is not asked for again.
  const never = r.ok === false && NEVER_AGAIN.has(r.code);
  return quiet({ found: 'not_held', code: r.ok === false ? r.code : r.outcome }, never ? { seen: [...seen, key] } : {});
}

const NEVER_AGAIN = new Set(['needs_card', 'path_unavailable', 'date_outside_trip', 'date_past', 'time_past', 'party_size', 'details_missing', 'already_settled', 'booked_elsewhere', 'not_a_table']);

/** The middle of the range, HH:MM: what a platform's openings are asked around. */
export function clockBetween(from: string, to: string): string {
  const m = Math.round((minutes(from) + minutes(to)) / 2);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

async function openingsOf(p: TableProvider, venueId: string, ask: { date: string; time: string; covers: number }) {
  try {
    return await p.openings(venueId, ask);
  } catch (e) {
    console.error('[watch] openings threw', { platform: p.platform, error: e instanceof Error ? e.message : String(e) });
    return { ok: false as const, code: 'platform_down' as const, error: 'no answer' };
  }
}
