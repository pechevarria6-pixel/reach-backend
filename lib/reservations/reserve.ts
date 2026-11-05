// ─── How Reach reserves a table — one place that decides, and does it ──
// Owner, 2026-11-04: "the point of this app is we do it all, they just tell
// us what they want." Decided the same day: Reach books by default, with
// "Book on your own Resy/OpenTable" beside it so card perks still apply; AI
// calls stay locked until a lawyer signs off; never a bot acting as the user.
//
// Three ways a table gets reserved, tried in this order for each restaurant
// line, and every one of them leaves the others on screen:
//
//   instant  — Reach holds the restaurant's id on a platform it has a deal
//              with, and that provider's keys are set (lib/booking/registry.ts
//              tableProviderFor). The steps are the platform's own
//              (lib/booking/tables/flow.ts): its openings for the line's own
//              night (lib/line-when.ts), the time somebody gave and the party;
//              a five-minute hold whose terms and policy the person reads and
//              accepts on screen; then the reservation. "Confirmed" only with
//              the platform's reservation id. A held table is never booked.
//   call     — the calling assistant's gate is open for real (live, with the
//              lawyer's yes — lib/reservations/gate.ts) and the venue's own
//              number is a +1 landline. Reach rings and reports what staff
//              said (lib/reservations/call.ts). A test-mode gate is not "open"
//              here: a test call rings Reach's own number and books nothing,
//              so it is never offered to anybody as a way to get a table.
//   handoff  — the person books it: the platform or their own page with the
//              night filled in, the restaurant's number, and "I've got it".
//
// Never: a table Reach pays for. A table is free to hold; a deposit or a card
// hold is the restaurant's, taken on the platform's page with the person's
// own card, so a slot that asks for one is handed off and Stripe is never
// involved. A table Reach booked is mode 'native' with the platform as its
// provider — lib/booking/charged.ts counts it as no money (reachBuys) and as
// Reach's own booking nobody may settle by hand (reachBooked).
//
// Never twice: every write is conditional on the row as it was read (status
// and updated_at), the platform step claims the row first with claim.ts's
// stamp so two presses cannot both reach the platform, a live call in
// progress refuses an instant booking and an instant booking in flight
// refuses a call, and an answer that never came back leaves the row
// mid-claim — not failed, which would let it be booked a second time.
//
// The routes: GET /api/plans/[planId]/reservations (decide, read only), POST
// /api/bookings/[id]/reserve, approval's "Book it" and a live POST
// /api/bookings/[id]/call (reserveTable — the last with path 'call'), and
// POST /api/bookings/[id]/cancel (cancelStep). There is no other way to book
// a table. placeCall itself also refuses a row the instant path has claimed
// or never heard back about, so nothing reaching it can ring over one.
import { midClaim } from '../booking/claim.ts';
import { PLATFORM_LABEL, type TableGuest, type TableHold, type TableProvider } from '../booking/tables/types.ts';
import {
  holdStep, openingsStep, reserveStep, settlePending, tableStateOf,
  type FlowAnswer, type TableCtx, type TableRow as FlowRow, type TableStore as FlowStore,
} from '../booking/tables/flow.ts';
import { readSlots, type SlotSeen } from '../booking/tables/steps.ts';
import { TABLE_COPY } from '../booking/tables/wording.ts';
import { inDoubtRow } from '../checkout.ts';
import { PLATFORM_NAME, PLATFORM_PERK, usableTime, type Platform } from '../booking/reservations.ts';
import { dayWhere } from '../calendar.ts';
import { lineAt } from '../line-when.ts';
import { gate, type Env } from './gate.ts';
import { toE164, dialable, localMinute, type LineLookup } from './policy.ts';
import { prettyPhone } from './wording.ts';
import { placeCall, REFUSAL_COPY, type PlaceDeps, type PlaceInput, type Refusal } from './call.ts';
import { reserveMarkOf, withMark, shortClock, tableWhen, type ReserveMark, type ReservePath, type ReserveState } from './reserve-state.ts';

export type { ReservePath, ReserveMark, ReserveState };

// ─── What is known about one table ──────────────────────────────────────

export interface TableFacts {
  bookingId: string | null;
  itemId: string | null;
  restaurant: string;
  city: string | null;
  /** Where it takes bookings. 'none' is "no platform we know of". */
  platform: Platform;
  /** The line's own night (lineWhen), or null when it cannot be known. */
  date: string | null;
  /** HH:MM, only one somebody gave. */
  time: string | null;
  partySize: number;
  /** The restaurant's own number. */
  phone: string | null;
  /** The hand-off link with the line's night in it (reservationUrl), or their own booking page. */
  reserveUrl: string | null;
  /**
   * Every booking link we hold for it — the line's, the row's hand-off, the
   * venue's — from which a platform id may be read (tableProviderFor). Never
   * a name search.
   */
  urls: (string | null)[];
  solo: boolean;
}

/** A platform Reach may book this restaurant on now, and its id there. */
export type InstantTable = { provider: TableProvider; venueId: string };

export type CallCheck = { ok: true } | { ok: false; why: 'calls_off' | 'test_only' | 'no_number' | 'not_north_american' | 'landline_unverified' | 'not_a_landline' };

/**
 * Whether the calling assistant may really ring this venue: the live gate
 * open (the lawyer's yes and a provider), and a +1 number a line-type lookup
 * says is a landline. The rest of the call's rules (hours, the cap,
 * do-not-call, one call per table) are placeCall's, checked when it rings.
 */
export async function callCheck(env: Env, phone: string | null | undefined, lookup: LineLookup | null): Promise<CallCheck> {
  const g = gate(env);
  if (!g.ok) return { ok: false, why: 'calls_off' };
  if (g.mode !== 'live') return { ok: false, why: 'test_only' };
  const e164 = toE164(phone);
  if (!e164) return { ok: false, why: 'no_number' };
  if (!dialable(e164)) return { ok: false, why: 'not_north_american' };
  if (!lookup) return { ok: false, why: 'landline_unverified' };
  const line = await lookup(e164).catch(() => 'unknown' as const);
  if (line === 'unknown') return { ok: false, why: 'landline_unverified' };
  return line === 'landline' ? { ok: true } : { ok: false, why: 'not_a_landline' };
}

export interface Availability {
  /** The platform Reach books this table on, or null (no id we hold, or its keys are not set). */
  instant: InstantTable | null;
  call: CallCheck;
}

// ─── What the screen is told ────────────────────────────────────────────

export type OptionKind = ReservePath | 'link' | 'phone' | 'confirm';

export interface ReserveOption {
  kind: OptionKind;
  label: string;
  /** One sentence: what happens if they press it. */
  what: string;
  href?: string | null;
}

/**
 * What the screen says about terms before anything is held. The terms
 * themselves — the restaurant's policy, the platform's wording and links,
 * any fee — come with the hold (terms_required), because only a hold has them.
 */
export interface TermsView {
  platform: string;
  platformName: string;
  statement: string;
}

export type Need = 'time' | 'date';

export interface ReservationView {
  bookingId: string | null;
  itemId: string | null;
  restaurant: string;
  when: { date: string | null; time: string | null; said: string };
  partySize: number;
  /** The way Reach will take, now. */
  path: ReservePath;
  /** What will happen, in one sentence. */
  what: string;
  /** Facts the path needs before it can run — asked of the person, never defaulted. */
  needs: Need[];
  /**
   * False when the table is booked, may be booked, or is being booked right
   * now: nothing is offered, because anything offered would be a second table.
   */
  open: boolean;
  /**
   * Every other way in, in order. While the table is open it is never empty:
   * "I've got it" is always last. Empty when it is not open.
   */
  alternatives: ReserveOption[];
  /** What will be shown before booking, for instant. Null for a call or a hand-off: there are none to accept. */
  terms: TermsView | null;
  /** "Book on your own OpenTable", beside Reach's booking, so a card's perks still apply. */
  ownAccount: { label: string; href: string; perk: string | null } | null;
  /** Where it stands, from the row. */
  status: string | null;
  state: ReserveState | null;
  offeredTimes: string[];
  /** The title and body to show for the state, when there is one. */
  title: string | null;
  body: string | null;
  /**
   * How a confirmed table is changed or cancelled, from where it was
   * confirmed. A table Reach booked on a platform is cancelled there through
   * POST /api/bookings/[id]/cancel, and moved with { change: true } only
   * where the platform can move one (OpenTable; Yelp is cancel and book
   * again, said plainly). A table confirmed on a call is the restaurant's to
   * change: their number. Null for anything else — a number somebody typed
   * in is theirs, and an open table has nothing to change.
   */
  manage: null
    | { by: 'platform'; platform: string; platformName: string; canChange: boolean }
    | { by: 'restaurant'; phone: string | null };
}

/** Which platforms move a booking in place. Yelp cannot: TABLE_COPY.yelpNoChange. */
const MOVES_IN_PLACE: Record<string, boolean> = { opentable: true, yelp: false };

const platformName = (p: string | null | undefined) =>
  (p && p !== 'none' && (PLATFORM_NAME as Record<string, string>)[p]) || null;

/** The people the sentence is about: "you" alone, "the group" otherwise. */
const whose = (solo: boolean) => (solo ? 'your' : "the group's");

/** The hand-off options we actually hold for this table, in order: link, their number, "I've got it". */
function handoffOptions(f: TableFacts, skipLink = false): ReserveOption[] {
  const out: ReserveOption[] = [];
  const name = platformName(f.platform);
  if (f.reserveUrl && !skipLink) {
    out.push({
      kind: 'link', href: f.reserveUrl,
      label: name ? `Reserve on ${name}` : 'Book on their site',
      what: name ? `Book it yourself on ${name}, with your own account.` : 'Book it yourself on their own site.',
    });
  }
  if (f.phone) {
    out.push({
      kind: 'phone', href: `tel:${f.phone.replace(/[^\d+]/g, '')}`,
      label: `Call ${f.restaurant}`, what: `Ring them on ${prettyPhone(toE164(f.phone) ?? f.phone)} and ask for the table yourself.`,
    });
  }
  out.push({ kind: 'confirm', label: "I've got it", what: 'Already booked it? Say so, with their confirmation number if they gave one.' });
  return out;
}

const needsOf = (f: TableFacts): Need[] => [...(f.date ? [] : ['date' as const]), ...(f.time ? [] : ['time' as const])];

/**
 * The way Reach takes for this table, what it will do, and every other way
 * in. Pure: the caller works out the availability (tableProvider, callCheck).
 */
export function decide(f: TableFacts, a: Availability, row?: DecideRow | null, now: Date = new Date()): ReservationView {
  const mark = reserveMarkOf(row);
  const name = platformName(f.platform);

  // Booked, maybe booked, or being booked: say where it stands and offer
  // nothing — "Reach books it", their own OpenTable or their number beside a
  // confirmed table is an invitation to book it twice. The night and time are
  // the ones it was booked at, not the line's.
  const settled = settledWords(f, row ?? null, mark, now);
  if (settled) {
    const booked = { date: mark?.date ?? f.date, time: mark?.time ?? f.time };
    return {
      bookingId: f.bookingId, itemId: f.itemId, restaurant: f.restaurant,
      when: { ...booked, said: tableWhen(booked.date, booked.time) || 'No night or time set yet' },
      partySize: mark?.partySize ?? f.partySize,
      path: settled.path ?? mark?.path ?? (row?.status === 'pending' ? 'call' : name ? 'instant' : 'handoff'),
      what: settled.title, needs: [], open: false, alternatives: settled.alternatives ?? [], terms: null, ownAccount: null,
      status: row?.status ?? null, state: settled.state, offeredTimes: [],
      title: settled.title, body: settled.body,
      manage: manageOf(f, row ?? null, mark),
    };
  }

  const at = `${tableWhen(f.date, f.time) || 'the night on the plan'} for ${f.partySize}`;
  const needs = needsOf(f);
  const ownAccount = name && f.reserveUrl
    ? { label: `Book on your own ${name}`, href: f.reserveUrl, perk: PLATFORM_PERK[f.platform] ?? null }
    : null;

  let path: ReservePath;
  let what: string;
  const alternatives: ReserveOption[] = [];
  let terms: TermsView | null = null;

  // Handed to them for a reason Reach gave — the slot wants a card — is
  // theirs from here: Reach's own Book it would only hold it again and hand
  // it back for the same reason. Their link (the platform's page for the
  // slot, where it gave one) and their number are the ways on.
  const handedOver = row?.status === 'redirected' && mark?.state === 'handed_off' && !!mark.reason;
  if (handedOver) {
    const theirs = handoffOptions({ ...f, reserveUrl: row?.redirect_url ?? f.reserveUrl });
    return {
      bookingId: f.bookingId, itemId: f.itemId, restaurant: f.restaurant,
      when: { date: f.date, time: f.time, said: tableWhen(f.date, f.time) || 'No night or time set yet' },
      partySize: f.partySize, path: 'handoff', what: mark!.reason!, needs: [],
      open: true, alternatives: theirs, terms: null, ownAccount: null,
      status: row?.status ?? null, state: 'handed_off', offeredTimes: [],
      title: mark!.reason!, body: nextSaid(f), manage: null,
    };
  }

  if (a.instant) {
    const on = PLATFORM_LABEL[a.instant.provider.platform];
    path = 'instant';
    what = needs.length
      ? `Pick ${needs.includes('date') ? 'a night and a time' : 'a time'}, and Reach books ${f.restaurant} on ${on} for ${f.partySize}.`
      : `Reach books ${f.restaurant} on ${on}: ${at}. You'll see ${on}'s terms before anything is booked.`;
    terms = {
      platform: a.instant.provider.platform, platformName: on,
      statement: `${on} holds the table for ${HOLD_SAID} and shows the restaurant's policy and its own terms before Reach books it. Booking accepts them.`,
    };
    if (a.call.ok) alternatives.push(callOption(f));
    // The own-account link is shown once, as ownAccount, not again here.
    alternatives.push(...handoffOptions(f, !!ownAccount));
  } else if (a.call.ok) {
    path = 'call';
    what = needs.length
      ? `Pick ${needs.includes('date') ? 'a night and a time' : 'a time'}, and Reach calls ${f.restaurant} to ask for a table for ${f.partySize}.`
      : `Reach calls ${f.restaurant} to ask for ${at}, and tells ${f.solo ? 'you' : 'the group'} what they said. It's booked only if they say yes on the call.`;
    alternatives.push(...handoffOptions(f, !!ownAccount));
  } else {
    path = 'handoff';
    const first = handoffOptions(f)[0];
    what = first.kind === 'link'
      ? `${name ? `Book it on ${name}` : 'Book it on their site'} with your own account — Reach can't book ${f.restaurant} itself yet.`
      : first.kind === 'phone'
        // We hold their number, not how they take tables: "books by phone"
        // was read from there being no booking link (2026-11-05).
        ? `Reach can't book ${f.restaurant} itself yet. Ring them on ${prettyPhone(toE164(f.phone) ?? f.phone ?? '')} to ask for a table.`
        : `Reach doesn't hold a way to book ${f.restaurant} yet. If you've booked it, say so.`;
    alternatives.push(...handoffOptions(f));
  }

  const shown = stateWords(f, mark);
  return {
    bookingId: f.bookingId, itemId: f.itemId, restaurant: f.restaurant,
    when: { date: f.date, time: f.time, said: tableWhen(f.date, f.time) || 'No night or time set yet' },
    partySize: f.partySize, path, what, needs,
    open: true, alternatives, terms,
    // Beside Reach's own booking; when the hand-off IS the way, it is the first alternative instead.
    ownAccount: path === 'handoff' ? null : ownAccount,
    status: row?.status ?? null, state: mark?.state ?? null, offeredTimes: mark?.offeredTimes ?? [],
    title: shown?.title ?? null, body: shown?.body ?? null, manage: null,
  };
}

/** How a confirmed table is changed or cancelled (ReservationView.manage). */
function manageOf(f: TableFacts, row: DecideRow | null, mark: ReserveMark | null): ReservationView['manage'] {
  if (row?.status !== 'confirmed' || mark?.state !== 'confirmed') return null;
  if (mark.path === 'call') return { by: 'restaurant', phone: f.phone ?? null };
  const platform = mark.platform ?? null;
  const name = platformName(platform);
  if (mark.path !== 'instant' || !platform || !name || !row.provider_ref) return null;
  return { by: 'platform', platform, platformName: name, canChange: MOVES_IN_PLACE[platform] === true };
}

/** The row as decide reads it. */
export type DecideRow = {
  status?: string | null; response_payload?: unknown; provider_ref?: string | null; redirect_url?: string | null;
  approved_at?: string | null; updated_at?: string | null; error?: string | null; confirmation_number?: string | null;
};

const HOLD_SAID = 'five minutes';

/** A table the platform holds until a card is added: its page, and their number. Nothing else books it. */
function cardOptions(f: TableFacts, row: DecideRow | null, platform: string | null | undefined): ReserveOption[] {
  const name = platformName(platform) ?? 'the platform';
  const out: ReserveOption[] = [];
  if (row?.redirect_url) out.push({ kind: 'link', href: row.redirect_url, label: `Add a card on ${name}`, what: `${name} books it once a card is on its page — the restaurant's hold, not a charge from Reach.` });
  return [...out, ...handoffOptions(f, true).filter(o => o.kind === 'phone')];
}

/**
 * Sent to the platform and no answer is coming: the in-doubt mark, approval's
 * "outcome unknown" note, or a claim older than any request can run (the
 * function was killed while the platform was answering, before anything
 * could be written). Never retried: the platform may hold the table.
 */
export function tableInDoubt(row: DecideRow, mark: ReserveMark | null, now: Date): boolean {
  if (!midClaim(row)) return false;
  return mark?.state === 'in_doubt' || inDoubtRow(row as Parameters<typeof inDoubtRow>[0], now);
}

/** Words for a table nothing more may be done to, or null when it is still open. */
function settledWords(f: TableFacts, row: DecideRow | null, mark: ReserveMark | null, now: Date): (Words & { state: ReserveState | null; alternatives?: ReserveOption[]; path?: ReservePath }) | null {
  if (!row) return null;
  const name = platformName(mark?.platform ?? f.platform);
  const own = String(row.confirmation_number ?? '').trim();
  if (row.status === 'confirmed') {
    // Confirmed only from a platform's reference or staff's yes on a call
    // (the mark). Anything else confirmed is somebody saying so through
    // "I've got it" — said as that, never as a booking Reach saw, and with
    // no state of 'confirmed' for a screen to put a green tick on. A row a
    // platform gave an id to before marks were written keeps the old words.
    if (mark?.state === 'confirmed') return { ...stateWords(f, mark)!, state: 'confirmed' };
    if (!own && row.provider_ref) return { title: `${f.restaurant} is booked.`, body: `It's on ${whose(f.solo)} plan.`, state: 'confirmed' };
    return { ...saidBooked(f, own), state: null, path: 'handoff' };
  }
  if (midClaim(row)) {
    if (tableInDoubt(row, mark, now)) return { ...stateWords(f, { ...(mark ?? { path: 'instant' }), state: 'in_doubt' } as ReserveMark)!, state: 'in_doubt' };
    return { title: `Reach is booking ${f.restaurant}${name ? ` on ${name}` : ''} right now.`, body: 'Open the trip again in a minute to see how it went.', state: mark?.state ?? null };
  }
  if (row.status === 'pending' && (mark?.state === 'calling' || mark?.state === 'requested')) {
    return { ...stateWords(f, mark)!, state: mark.state };
  }
  if (row.status === 'pending' && mark?.state === 'card_owed') {
    // Not booked, and not Reach's to book again: the card on their page is the one way on.
    return { ...stateWords(f, mark)!, state: 'card_owed', alternatives: cardOptions(f, row, mark.platform) };
  }
  // A number typed in on a row not yet marked confirmed: the same words.
  if (own) return { ...saidBooked(f, own), state: null, path: 'handoff' };
  return null;
}

/**
 * Where the confirmation came from, said as that: a number a person typed
 * in, or only their word, never one a platform or a call gave Reach. On a
 * group's plan the reader may not be the one who said it.
 */
function saidBooked(f: TableFacts, own: string): Words {
  const body = `${f.restaurant} was booked outside Reach. It's on ${whose(f.solo)} plan.`;
  if (own) return { title: f.solo ? `You entered ${own}` : `Someone in the group entered ${own}`, body };
  return { title: f.solo ? `You marked ${f.restaurant} as booked.` : `Someone in the group marked ${f.restaurant} as booked.`, body };
}

function callOption(f: TableFacts): ReserveOption {
  return { kind: 'call', label: 'Ask Reach to call', what: `Reach rings ${f.restaurant} and asks. It's booked only if they say yes on the call.` };
}

// ─── Words for each state ───────────────────────────────────────────────

export interface Words { title: string; body: string }

/** The next options we hold, as a sentence for a notification. */
function nextSaid(f: TableFacts): string {
  const opts: string[] = [];
  if (f.reserveUrl) opts.push(platformName(f.platform) ? `book it on ${platformName(f.platform)}` : 'book it on their site');
  if (f.phone) opts.push(`call them on ${prettyPhone(toE164(f.phone) ?? f.phone)}`);
  if (!opts.length) return f.solo ? 'Pick another place on your plan.' : 'Pick another place on the plan.';
  return `Next: ${opts.join(' or ')} — it's on ${whose(f.solo)} plan.`;
}

export function stateWords(f: TableFacts, mark: ReserveMark | null): Words | null {
  if (!mark) return null;
  const name = platformName(mark.platform ?? f.platform);
  const time = mark.time ?? f.time;
  const at = `${tableWhen(mark.date ?? f.date, time)} for ${mark.partySize ?? f.partySize}`;
  switch (mark.state) {
    case 'confirmed':
      return mark.path === 'call'
        ? { title: `${f.restaurant} confirmed on the call: ${at}.`, body: `It's on ${whose(f.solo)} plan.` }
        : { title: `Confirmed by ${name ?? 'the platform'}${mark.ref ? ` · ref ${mark.ref}` : ''}`, body: `${f.restaurant}, ${at}. It's on ${whose(f.solo)} plan.` };
    case 'requested':
      return { title: `${name ?? 'The platform'} is checking with ${f.restaurant}.`, body: `Not confirmed yet: ${at}. ${f.solo ? "You'll" : "The group will"} see the answer here.` };
    case 'card_owed':
      return { title: `Not booked yet — ${name ?? 'the platform'} needs a card`, body: `${name ?? 'The platform'} is holding ${f.restaurant}, ${at}, until a card is added on its page. It isn't booked until then.` };
    case 'calling':
      return { title: `Reach is calling ${f.restaurant} to ask for ${shortClock(time)} for ${mark.partySize ?? f.partySize}.`, body: f.solo ? "You'll see their answer here." : 'The group will see their answer here.' };
    case 'offered': {
      const o = mark.offeredTimes?.[0];
      return {
        title: o ? `No ${shortClock(time)}. ${mark.path === 'call' ? 'They' : name ?? 'They'} offered ${shortClock(o)}. Take it?` : `No ${shortClock(time)} at ${f.restaurant}.`,
        body: o
          ? `Nothing is booked yet. ${mark.path === 'instant' ? `Take ${shortClock(o)} and Reach books it on ${name ?? 'the platform'}.` : `To take ${shortClock(o)}, call them or book online.`}`
          : nextSaid(f),
      };
    }
    case 'not_booked':
    case 'failed':
      return { title: `Not booked. ${mark.reason ?? `${f.restaurant} has no table ${at}.`}`, body: nextSaid(f) };
    case 'handed_off':
      return { title: mark.reason ?? `Book ${f.restaurant} yourself.`, body: nextSaid(f) };
    case 'in_doubt':
      return {
        title: `We can't tell yet whether ${f.restaurant} is booked.`,
        body: `It was sent to ${name ?? 'the platform'} and no answer came back, so Reach won't try again. Don't book it anywhere else until it has been checked — write to hello@alcanzar.io.`,
      };
  }
  return null;
}

// ─── Doing it ───────────────────────────────────────────────────────────

/** The booking row as reserve reads it. */
export interface TableRow {
  id: string;
  plan_id: string;
  vertical: string;
  mode: string | null;
  provider: string | null;
  status: string;
  provider_ref?: string | null;
  redirect_url?: string | null;
  detail?: string | null;
  error?: string | null;
  request_payload?: Record<string, unknown> | null;
  response_payload?: unknown;
  updated_at?: string | null;
  approved_at?: string | null;
  confirmation_number?: string | null;
}

/** Everything reserve writes, through one door. Supabase in production (reserve-store.ts), memory in tests. */
export interface TableStore {
  /**
   * Put a row back to awaiting_approval, but only from `from` at `version`.
   * The new version, or `taken` when the row moved or the database refused
   * (a second live row for the same line: the one-live-booking index).
   */
  reopen(id: string, from: string, version: string | null | undefined, patch: Record<string, unknown>): Promise<{ ok: true; version: string | null } | { ok: false; taken: boolean }>;
  /** A write without the platform (offered, handed off, no table, a call): from `from` at `version` only. */
  write(id: string, from: string, version: string | null | undefined, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  /** The platform steps' own writes (lib/booking/tables/flow.ts): at `version` only. */
  flow: FlowStore;
  /** A live call for this booking that has not settled. */
  callOpen(bookingId: string): Promise<boolean>;
  /** Move the itinerary line to the night and time booked — only while its words are still `from`. */
  retime(itemId: string, from: string | null, to: string): Promise<boolean>;
  members(groupId: string | null): Promise<string[]>;
  notify(userIds: string[], note: { kind: string; title: string; body: string; url: string | null; planId: string }): Promise<void>;
}

export interface Requester {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface ReserveInput {
  booking: TableRow;
  facts: TableFacts;
  plan: { id: string; group_id: string | null; solo: boolean; start_date: string | null; end_date: string | null };
  requester: Requester;
  chosen: {
    path?: ReservePath;
    /** HH:MM — a time the person picked, or an offered time they took. */
    time?: string;
    date?: string;
    /** The hold from a terms_required answer. With it, this press books that hold — and only that one. */
    holdId?: string;
    /** What the person accepted on screen: hold.terms.version (when the hold has terms), and the restaurant's policy. */
    accept?: { terms?: string | null; policy?: boolean } | null;
    /** For the restaurant, under the booking. */
    notes?: string;
    /** Move a table Reach booked to `time`/`date` (OpenTable; Yelp answers no_change). */
    change?: boolean;
    /** The person says they have not booked it themselves (a row already handed to them). */
    notBookedElsewhere?: boolean;
    /**
     * Press one from a table watch (lib/watch/tables.ts), never from a
     * request body (reserve-server.ts chosenFrom does not read it): hold
     * exactly this night and time or do nothing. Anything else the platform
     * answers — another time, no table, a card — writes nothing and tells
     * nobody, because nobody pressed anything: the watch just keeps looking.
     */
    watch?: boolean;
  };
  /** The held venue, as the call needs it (hours, longitude). */
  venue: PlaceInput['venue'];
  /** The itinerary line the table is on, so a table booked at another time moves the line with it. */
  line?: { id: string; scheduled_time: string | null } | null;
  now?: Date;
}

export interface ReserveDeps {
  /** The platform Reach may book a restaurant on from these links (lib/booking/registry.ts tableProviderFor). */
  instantFor(urls: readonly (string | null | undefined)[]): InstantTable | null;
  /** The platform a table was booked on, from the row's provider (tableProviderNamed). */
  bookedOn(provider: unknown): TableProvider | null;
  callCheck(phone: string | null): Promise<CallCheck>;
  store: TableStore;
  /** What placeCall needs, for the call path. */
  call: PlaceDeps | null;
  /** Booked at a platform and not recorded: said loudly. */
  report?: (message: string, extra: Record<string, unknown>) => void;
}

export type ReserveCode =
  | 'not_a_table' | 'in_progress' | 'calling' | 'booked_elsewhere' | 'ask_first' | 'already_settled'
  | 'path_unavailable' | 'missing_facts' | 'details_missing' | 'date_outside_trip' | 'date_past' | 'time_past'
  | 'terms_required' | 'other_time' | 'unavailable' | 'pending_card' | 'no_change'
  | 'call_refused' | 'provider_failed' | 'outcome_unknown' | 'changed' | 'store_error'
  // The platform steps' own refusals (lib/booking/tables/flow.ts), passed through as they are.
  | 'hold_missing' | 'hold_expired' | 'terms_not_accepted' | 'needs_guest' | 'needs_card' | 'slot_gone' | 'duplicate'
  | 'party_size' | 'bad_request' | 'rate_limited' | 'not_bookable_here' | 'not_on_platform' | 'disabled' | 'auth' | 'platform_down';

/** The hold as the screen shows it before the button (flow.ts publicHold). */
export type HoldView = ReturnType<typeof import('../booking/tables/flow.ts').publicHold>;

export type ReserveResult =
  | {
      ok: true;
      /** confirmed: the platform's id or staff's yes. card_owed: the platform holds it until a card is added on its page — NOT booked. */
      outcome: 'confirmed' | 'card_owed' | 'calling' | 'handed_off';
      /** Already done before this request — the same answer again, nothing new sent. */
      already?: boolean;
      row: Record<string, unknown> | null;
      title: string;
      body: string;
      href?: string | null;
      /** Booked at the platform, and our row could not be updated to say so. */
      warning?: string;
      alternatives: ReserveOption[];
    }
  | {
      ok: false;
      code: ReserveCode;
      status: number;
      error: string;
      missing?: string[];
      /** terms_required: the held slot, its policy, terms and fee — shown before the button. */
      hold?: HoldView;
      /** terms_required: the button's exact words ("Complete reservation" on OpenTable). */
      button?: string;
      title?: string;
      body?: string;
      /** terms_required on Yelp: a booking cannot be moved later, said before it is made. */
      changeNote?: string | null;
      /** The platform's own page for exactly this slot, when it gave one. */
      platformUrl?: string | null;
      offeredTimes?: string[];
      refusal?: Refusal;
      alternatives: ReserveOption[];
    };

/** Rows a table can be reserved from. Anything else is settled, or somebody is on it. */
const OPEN = new Set(['awaiting_approval', 'redirected', 'pending', 'failed']);

const RESERVE_STATUS: Partial<Record<Refusal, number>> = {
  calls_off: 503, live_not_approved: 503, no_test_number: 503, no_provider: 503, not_migrated: 503,
  disclosure_failed_before: 503, store_error: 503,
  already_called: 409, already_settled_booking: 409, booking_in_progress: 409, do_not_call: 409, reach_buys: 409, not_a_table: 409,
  daily_cap: 429, provider_unknown: 502, provider_refused: 502,
};

export async function reserveTable(input: ReserveInput, deps: ReserveDeps): Promise<ReserveResult> {
  let b = input.booking;
  const f = { ...input.facts };
  const now = input.now ?? new Date();
  const next = handoffOptions(f);
  const no = (code: ReserveCode, status: number, error: string, extra: Partial<Extract<ReserveResult, { ok: false }>> = {}): ReserveResult =>
    ({ ok: false, code, status, error, alternatives: next, ...extra });

  if (b.vertical !== 'restaurant') return no('not_a_table', 409, 'Only a table is reserved here.');

  // ── A table Reach booked that the platform holds for a card: ask it first ──
  // Only the platform's answer moves it — card added: confirmed; let go:
  // open again; anything else: still not booked (flow.ts settlePending).
  const bookedOn = deps.bookedOn(b.provider);
  if (b.status === 'pending' && bookedOn && b.provider_ref) {
    const settled = await settlePending(flowCtx(input, deps, b, null, bookedOn));
    b = { ...b, ...(settled.row as unknown as Partial<TableRow>) };
  }
  const mark = reserveMarkOf(b);

  // Press two books the hold that was shown: its night, its time, and — on a
  // table Reach already booked — the move it was held for. Never what the
  // line or press one's body said: a press two sent as the contract says,
  // { holdId, accept }, carries neither, and a time taken instead of the
  // line's is the hold's, not the line's.
  const pressTwo = typeof input.chosen.holdId === 'string' && input.chosen.holdId ? input.chosen.holdId : null;
  const shownHold = tableStateOf(b as unknown as FlowRow)?.hold ?? null;
  const held = pressTwo && shownHold?.holdId === pressTwo ? shownHold : null;

  // ── Already done: the same answer, nothing sent again ──
  // A confirmed row holding a hold of its own was held for a move (a booking
  // clears its hold), so press two on it moves the table, change or not.
  const changing = b.status === 'confirmed' && (input.chosen.change === true || !!held);
  if (b.status === 'confirmed' && !changing) {
    // The same words GET …/reservations gives this row (settledWords).
    const own = String(b.confirmation_number ?? '').trim();
    const w = mark?.state === 'confirmed' ? stateWords(f, mark)!
      : !own && b.provider_ref ? { title: `${f.restaurant} is booked.`, body: `It's on ${whose(f.solo)} plan.` }
        : saidBooked(f, own);
    return { ok: true, outcome: 'confirmed', already: true, row: b as unknown as Record<string, unknown>, title: w.title, body: w.body, alternatives: [] };
  }
  if (changing && !(bookedOn && b.provider_ref && b.mode === 'native')) {
    return no('no_change', 409, `Reach didn't book ${f.restaurant} on a platform, so it can't move it. Change it where it was booked.`);
  }
  if (b.status === 'pending' && mark?.state === 'card_owed') {
    return no('pending_card', 409, TABLE_COPY.pendingCard(platformName(mark.platform) ?? 'The platform'),
      { platformUrl: b.redirect_url ?? null, alternatives: cardOptions(f, b, mark.platform) });
  }
  if (b.status === 'booking' || midClaim(b)) {
    // Past the time any request can run, a claim with no answer on it is in
    // doubt, not "booking now": the request that held it is gone.
    return tableInDoubt(b, mark, now)
      ? no('outcome_unknown', 502, `We asked ${platformName(mark?.platform ?? f.platform) ?? 'the platform'} for this table and never heard back. Don't book it again anywhere until it has been checked.`, { alternatives: [] })
      : no('in_progress', 409, 'Reach is booking this table right now.', { alternatives: [] });
  }

  // A watch never holds over a hold somebody is reading the terms for: the
  // platform would keep both locked in their name, and theirs would be gone
  // from the row when they tapped (holdStep writes whatever it holds).
  if (input.chosen.watch === true && shownHold && Date.parse(shownHold.expiresAt) > now.getTime()) {
    return no('in_progress', 409, `Somebody is reading the terms for a table at ${f.restaurant} now.`, { alternatives: [] });
  }

  let path: ReservePath = 'instant';
  let instant: InstantTable | null = null;
  let others: ReserveOption[] = next;
  if (!changing) {
    if (!OPEN.has(b.status)) return no('already_settled', 409, 'This table is already settled.');
    // A call ringing now. The mark says so; so does an unsettled live call,
    // whatever the row's status, in case the mark was never written — a call
    // whose booking move failed leaves the row awaiting approval with the
    // restaurant on the phone.
    const marked = b.status === 'pending' && (mark?.state === 'calling' || mark?.state === 'requested');
    if (marked || await deps.store.callOpen(b.id)) {
      return no('calling', 409, mark?.state === 'requested'
        ? `${platformName(mark.platform) ?? 'The platform'} is still checking with ${f.restaurant}.`
        : `Reach is on the phone to ${f.restaurant} about this table now.`, { alternatives: [] });
    }
    if (b.confirmation_number?.trim()) {
      return no('booked_elsewhere', 409, `You said you booked this yourself (you entered ${b.confirmation_number.trim()}), so Reach won't book it again.`, { alternatives: [] });
    }

    // ── Which way ──
    instant = deps.instantFor(f.urls);
    const call = await deps.callCheck(f.phone);
    const view = decide(f, { instant, call }, b, now);
    path = input.chosen.path ?? view.path;
    const can = path === 'handoff' || (path === 'instant' ? view.path === 'instant' : call.ok);
    if (!can) {
      return no('path_unavailable', 409, path === 'instant'
        ? `Reach can't book ${f.restaurant} itself yet.` : "Reach can't call restaurants yet.", { alternatives: view.alternatives });
    }

    // Handed to them already and they may have booked it themselves — never
    // book over that without asking.
    if (path !== 'handoff' && (b.status === 'redirected' || (b.status === 'pending' && mark?.state !== 'not_booked'))
      && input.chosen.notBookedElsewhere !== true) {
      return no('ask_first', 409, `Have you already booked ${f.restaurant} yourself? If not, Reach will ${path === 'call' ? 'call them' : 'book it'}.`, { alternatives: view.alternatives });
    }

    if (path === 'handoff') return handoff(input, deps, f, b, mark);
    // A refusal from here on carries every other way in, the own-account link
    // among them: the answer to a press has no ownAccount beside it.
    others = [...view.alternatives.filter(a => a.kind === 'call' && path !== 'call'), ...handoffOptions(f)];
  }

  // ── The night and the time: the hold's, the line's own, or what the person picked ──
  // A press two whose hold is not on the row books nothing, whatever else it says.
  if (pressTwo && !held) return no('hold_missing', 409, TABLE_COPY.holdMissing, { alternatives: others });
  const date = held?.date ?? input.chosen.date ?? f.date;
  const time = usableTime(held?.time ?? input.chosen.time ?? f.time);
  const missing = [...(date ? [] : ['date']), ...(time ? [] : ['time'])];
  if (missing.length) return no('missing_facts', 422, `Pick ${missing.length === 2 ? 'a night and a time' : `a ${missing[0] === 'date' ? 'night' : 'time'}`} first.`, { missing, alternatives: others });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date!)) return no('missing_facts', 422, 'Pick a night first.', { missing: ['date'], alternatives: others });
  const { start_date: start, end_date: end } = input.plan;
  if (start && (date! < start || date! > (end || start))) return no('date_outside_trip', 422, "That night isn't on this plan.", { alternatives: others });
  const lng = input.venue?.lng ?? null;
  if (date! < dayWhere(lng, now)) return no('date_past', 422, 'That night has already gone.', { alternatives: others });
  const here = localMinute(lng, now);
  if (here && `${date}T${time}` <= here) return no('time_past', 422, 'That time has already gone.', { alternatives: others });
  f.date = date!; f.time = time!;

  if (changing) return viaPlatform(input, deps, f, b, { provider: bookedOn!, venueId: '' }, others, true);
  if (path === 'call') return viaCall(input, deps, f, b, others);
  return viaPlatform(input, deps, f, b, instant!, others, false);
}

/**
 * A row still 'native' with no reservation on it: a table the platform let go
 * before a card was added (flow.ts settlePending), from before that step put
 * the mode back. Nothing Reach booked is live on it.
 */
const lapsedNative = (r: { mode?: string | null; provider_ref?: string | null; status: string }) =>
  r.mode === 'native' && !r.provider_ref && r.status !== 'confirmed' && r.status !== 'pending';

/** Who hears about it: the person, on a plan for one; everybody on a group's. */
async function tell(deps: ReserveDeps, input: ReserveInput, w: Words) {
  const people = input.plan.solo ? [input.requester.id] : await deps.store.members(input.plan.group_id);
  const url = input.plan.group_id ? `/home?group=${encodeURIComponent(input.plan.group_id)}` : '/home';
  await deps.store.notify(people.length ? people : [input.requester.id], { kind: 'reservation', title: w.title, body: w.body, url, planId: input.plan.id });
}

const stamp = () => new Date().toISOString();

async function handoff(input: ReserveInput, deps: ReserveDeps, f: TableFacts, b: TableRow, prior: ReserveMark | null, reason?: string, href?: string | null): Promise<ReserveResult> {
  const link = href ?? f.reserveUrl ?? b.redirect_url ?? null;
  const mark: ReserveMark = { state: 'handed_off', path: 'handoff', platform: f.platform === 'none' ? null : f.platform, date: f.date, time: f.time, partySize: f.partySize, reason: reason ?? null, at: stamp() };
  const words = stateWords(f, mark)!;
  const alternatives = handoffOptions({ ...f, reserveUrl: link }).filter(o => o.kind !== 'link');
  if (b.status === 'redirected' && prior?.state === 'handed_off' && !reason) {
    return { ok: true, outcome: 'handed_off', already: true, row: b as unknown as Record<string, unknown>, title: words.title, body: words.body, href: link, alternatives };
  }
  const row = await deps.store.write(b.id, b.status, b.updated_at, {
    status: 'redirected', redirect_url: link, provider_ref: null, error: null,
    detail: f.restaurant, response_payload: withMark(b.response_payload, mark), updated_at: stamp(),
  });
  if (!row) return { ok: false, code: 'changed', status: 409, error: 'This changed while you were looking — nothing was booked. Open it again.', alternatives: handoffOptions(f) };
  return { ok: true, outcome: 'handed_off', row, title: words.title, body: words.body, href: link, alternatives };
}

async function viaCall(input: ReserveInput, deps: ReserveDeps, f: TableFacts, b: TableRow, alternatives: ReserveOption[]): Promise<ReserveResult> {
  if (!deps.call) return { ok: false, code: 'path_unavailable', status: 503, error: REFUSAL_COPY.calls_off, alternatives };
  // Take the row before anything rings, on the version read: 'pending' with
  // the "calling" mark. An instant booking claimed meanwhile has moved the
  // row, so this matches nothing and nobody is rung; one that read the row
  // before this write holds an older version, so its claim matches nothing
  // and the platform is never asked. Reading "nobody is booking it" is not
  // enough: two requests both read that before either writes.
  const calling: ReserveMark = { state: 'calling', path: 'call', platform: null, date: f.date, time: f.time, partySize: f.partySize, at: stamp() };
  const mode = lapsedNative(b) ? 'redirect' : b.mode;
  const held = await deps.store.write(b.id, b.status, b.updated_at, {
    status: 'pending', mode, error: null, detail: f.restaurant, response_payload: withMark(b.response_payload, calling), updated_at: stamp(),
  });
  if (!held) return { ok: false, code: 'changed', status: 409, error: 'This changed while you were looking — nobody was called. Open it again.', alternatives };
  const version = (held.updated_at as string | null | undefined) ?? null;

  const placed = await placeCall({
    booking: { ...b, mode, status: 'pending', approved_at: null, updated_at: version, response_payload: held.response_payload as never, request_payload: b.request_payload as never },
    // A call that ends with no table opens the row again, whatever it was before.
    previousStatus: 'awaiting_approval',
    plan: input.plan,
    requester: { id: input.requester.id, firstName: input.requester.firstName },
    venue: input.venue,
    chosen: { date: f.date!, time: f.time!, partySize: f.partySize, notes: input.chosen.notes?.slice(0, 300) ?? null },
    now: input.now,
  }, deps.call);
  if (placed.ok === false) {
    // Something may be ringing: the row stays taken, so nothing else books it.
    if (placed.refusal !== 'provider_unknown') {
      const back = await deps.store.write(b.id, 'pending', version, {
        status: b.status, error: b.error ?? null, response_payload: b.response_payload ?? null, updated_at: stamp(),
      });
      if (!back) console.error('[reserve] a call that never rang could not give its row back', { booking: b.id, refusal: placed.refusal });
    }
    return {
      ok: false, code: 'call_refused', status: RESERVE_STATUS[placed.refusal] ?? 422, refusal: placed.refusal,
      error: `${placed.message} ${nextSaid(f)}`, missing: placed.missing, alternatives,
    };
  }
  // placeCall put the call's id on the mark (a live call only) and told
  // everybody; a test call changed nothing and said so.
  return { ok: true, outcome: 'calling', row: null, title: placed.wording.title, body: placed.wording.body, alternatives };
}

// ─── Instant: the platform's own steps ──────────────────────────────────
// Press one: the platform's openings for that night, time and party. The
// exact time is held (five minutes) and its terms come back as
// terms_required — nothing is booked. Another time that night is offered
// (other_time); a time that wants a card is handed to the platform's page;
// and only an answer that lists no table that night is "no table". A refusal
// or no answer is ours, told as ours, with the row left as it was.
//
// Press two, with the hold and what was accepted: the platform's reserve,
// confirmed only by its reservation id (flow.ts reserveStep). Its guarantees
// are the flow's: the hold must be live and this row's, the terms version
// and the restaurant's policy accepted, the claim taken on the row as read,
// and an answer that never came back leaves it claimed and in doubt.

function flowCtx(input: ReserveInput, deps: ReserveDeps, row: TableRow, table: InstantTable | null, bookedOn: TableProvider | null): TableCtx {
  return {
    row: row as unknown as FlowRow, table, bookedOn,
    solo: input.plan.solo, userId: input.requester.id, store: deps.store.flow, now: input.now,
    venue: { reservationUrl: input.facts.reserveUrl, phone: input.facts.phone },
    report: deps.report,
  };
}

/** A platform step's refusal, as reserve answers it: its code, its words, and the next options. */
function fromFlow(a: FlowAnswer, alternatives: ReserveOption[], name: string): ReserveResult {
  const body = a.body as { code?: string; error?: unknown; platformUrl?: string | null; terms?: unknown };
  const code = (body.code ?? (a.status >= 500 ? 'provider_failed' : 'unavailable')) as ReserveCode;
  // While it may be booked, or somebody else is booking it, nothing is offered: anything would be a second table.
  const quiet = code === 'outcome_unknown' || code === 'in_progress';
  const platformUrl = typeof body.platformUrl === 'string' && body.platformUrl ? body.platformUrl : null;
  // The platform's page for exactly this slot takes the place of the general link, not a second one beside it.
  const next = platformUrl
    ? [{ kind: 'link' as const, href: platformUrl, label: `Finish on ${name}`, what: `${name}'s own page for this table, with your own card.` }, ...alternatives.filter(o => o.kind !== 'link')]
    : alternatives;
  return { ok: false, code, status: a.status, error: String(body.error ?? 'Nothing was booked.'), platformUrl, alternatives: quiet ? [] : next };
}

async function viaPlatform(
  input: ReserveInput, deps: ReserveDeps, f: TableFacts, b: TableRow, instant: InstantTable, alternatives: ReserveOption[], changing: boolean,
): Promise<ReserveResult> {
  const name = PLATFORM_LABEL[instant.provider.platform];
  const r = input.requester;
  // A table is booked in somebody's name, with a way to reach them. Never a
  // made-up name, never Reach's number — asked before any slot is held.
  const details = [...(r.firstName ? [] : ['first name']), ...(r.lastName ? [] : ['last name']), ...(r.email ? [] : ['email']), ...(r.phone ? [] : ['phone number'])];
  if (details.length) {
    return { ok: false, code: 'details_missing', status: 422, missing: details, error: `${name} needs your ${details.join(', ')} to hold a table. Add ${details.length === 1 ? 'it' : 'them'} in your profile.`, alternatives };
  }
  const guest: TableGuest = { firstName: r.firstName!, lastName: r.lastName!, email: r.email!, phone: r.phone!, notes: input.chosen.notes?.slice(0, 300) ?? null };

  // An open row that is not awaiting approval (handed over, failed, a call
  // that found nothing) is reopened first, on its version: the claim's stamp
  // is only read on an awaiting row, and the one-live-booking index answers
  // before any platform is asked rather than after a table is booked.
  //
  // A table whose platform let it go before a card was added is nobody's
  // booking any more: it is reopened as a hand-off row ('redirect'), never
  // left 'native', which says "Reach booked this" (charged.ts reachBooked).
  let row = b;
  let reopened = false;
  if (!changing && row.status !== 'awaiting_approval') {
    const mode = lapsedNative(row) ? 'redirect' : row.mode;
    const re = await deps.store.reopen(row.id, row.status, row.updated_at, { mode, error: null, updated_at: stamp() });
    if (!re.ok) return { ok: false, code: 'changed', status: 409, error: 'This changed while you were looking — nothing was booked. Open it again.', alternatives };
    row = { ...row, mode, status: 'awaiting_approval', error: null, updated_at: re.version };
    reopened = true;
  }
  // Our failure, or the platform's, before anything was held: the row goes
  // back to what it said, so a press nobody answered changes nothing.
  const giveBack = async (a: FlowAnswer): Promise<ReserveResult> => {
    // A watch's press is nobody's: whatever stopped it, the row says what it said before.
    if (reopened && (a.status >= 500 || a.status === 429 || input.chosen.watch === true)) {
      const back = await deps.store.write(row.id, 'awaiting_approval', row.updated_at, { status: b.status, error: b.error ?? null, updated_at: stamp() });
      if (!back) console.error('[reserve] a press the platform never answered could not give its row back', { booking: b.id, code: a.body.code });
    }
    return fromFlow(a, alternatives, name);
  };
  const ctx = flowCtx(input, deps, row, changing ? null : instant, changing ? instant.provider : null);

  // ── Press two: book the hold that was shown ──
  if (typeof input.chosen.holdId === 'string' && input.chosen.holdId) {
    const hold = tableStateOf(ctx.row)?.hold ?? null;
    const a = await reserveStep(ctx, { holdId: input.chosen.holdId, accept: input.chosen.accept ?? null }, guest);
    return afterReserve(input, deps, f, a, hold, alternatives, name);
  }

  // Nothing is booked before reserveStep, so a platform that throws here is
  // only "no answer" — said as ours, the row left as it was.
  const asked = async (step: () => Promise<FlowAnswer>): Promise<FlowAnswer> => {
    try { return await step(); } catch (e) {
      console.error('[reserve] the platform did not answer', { booking: b.id, platform: instant.provider.platform, error: e instanceof Error ? e.message : String(e) });
      return { status: 502, body: { code: 'provider_failed', error: `Reach couldn't get an answer from ${name} just now, so nothing was booked. ${nextSaid(f)}` } };
    }
  };
  // A watch asks for one exact slot and takes nothing else (ReserveInput.chosen.watch).
  const quietly = input.chosen.watch === true && !changing;
  // Nothing was held, so a row reopened for this press goes back to what it said.
  const passed = async (code: ReserveCode, error: string): Promise<ReserveResult> => {
    if (reopened) {
      const back = await deps.store.write(row.id, 'awaiting_approval', row.updated_at, { status: b.status, error: b.error ?? null, updated_at: stamp() });
      if (!back) console.error('[reserve] a watch press could not give its row back', { booking: b.id, code });
    }
    return { ok: false, code, status: 409, error, alternatives };
  };
  const card = (url: string | null | undefined) => quietly
    ? passed('needs_card', `${f.restaurant} wants a card for that time, so Reach did not hold it.`)
    : handoff(input, deps, f, row, reserveMarkOf(row),
    `${f.restaurant} wants a card to hold ${tableWhen(f.date, f.time)}, so Reach won't book it — book it on ${name} with your own card.`,
    url ?? f.reserveUrl);

  // ── Press one: what the platform has that night, then hold the exact time ──
  if (!changing) {
    const o = await asked(() => openingsStep(ctx, { date: f.date, time: f.time, covers: f.partySize }));
    if (o.status !== 200 && o.body.code === 'needs_card') return card(o.body.platformUrl as string | null);
    if (o.status !== 200) {
      if (o.status >= 500) console.error('[reserve] the platform did not give its openings', { booking: b.id, platform: instant.provider.platform, code: o.body.code });
      return giveBack(o);
    }
    const read = readSlots((o.body.slots ?? []) as SlotSeen[], f.date!, f.time!);
    if (read.kind === 'card') return card(read.handoffUrl);
    if (quietly && read.kind !== 'exact') return passed('slot_gone', `That time at ${f.restaurant} went before Reach could hold it.`);
    if (read.kind === 'other') {
      const mark: ReserveMark = { state: 'offered', path: 'instant', platform: instant.provider.platform, date: f.date, time: f.time, partySize: f.partySize, offeredTimes: read.times, at: stamp() };
      const w = stateWords(f, mark)!;
      const wrote = await deps.store.write(row.id, row.status, row.updated_at, {
        status: 'awaiting_approval', error: null, detail: f.restaurant, response_payload: withMark(row.response_payload, mark), updated_at: stamp(),
      });
      if (!wrote) return { ok: false, code: 'changed', status: 409, error: 'This changed while you were looking. Open it again.', alternatives };
      await tell(deps, input, w);
      return { ok: false, code: 'other_time', status: 409, error: w.title, offeredTimes: read.times, alternatives };
    }
    if (read.kind === 'none') {
      // The platform answered and lists no table that night: the one answer
      // that is a fact about the restaurant (TableQuoteRaw.noAvailability).
      const reason = `${f.restaurant} has no table on ${name} ${tableWhen(f.date, f.time)} for ${f.partySize}.`;
      const mark: ReserveMark = { state: 'failed', path: 'instant', platform: instant.provider.platform, date: f.date, time: f.time, partySize: f.partySize, reason, at: stamp() };
      const wrote = await deps.store.write(row.id, row.status, row.updated_at, {
        status: 'failed', error: reason, detail: f.restaurant, response_payload: withMark(row.response_payload, mark), updated_at: stamp(),
      });
      if (!wrote) return { ok: false, code: 'changed', status: 409, error: 'This changed while you were looking. Open it again.', alternatives };
      await tell(deps, input, stateWords(f, mark)!);
      return { ok: false, code: 'unavailable', status: 409, error: `Not booked. ${reason} ${nextSaid(f)}`, alternatives };
    }
  }

  const h = await asked(() => holdStep(ctx, { date: f.date, time: f.time, covers: f.partySize, change: changing }));
  if (h.status !== 200) {
    // A hold the platform refused because it wants a card: the restaurant's way of taking it.
    if (h.body.code === 'needs_card' && !changing) return card(h.body.platformUrl as string | null);
    return giveBack(h);
  }
  return {
    ok: false, code: 'terms_required', status: 409, alternatives,
    hold: h.body.hold as HoldView,
    button: String(h.body.button), title: String(h.body.title), body: String(h.body.body),
    changeNote: (h.body.changeNote as string | null) ?? null,
    error: `Read the restaurant's policy and ${name}'s terms, then tap ${String(h.body.button)}. Nothing is booked yet.`,
  };
}

/** What press two answered: booked (the line moves, everybody is told), held for a card, or refused. */
async function afterReserve(
  input: ReserveInput, deps: ReserveDeps, f: TableFacts, a: FlowAnswer, hold: TableHold | null, alternatives: ReserveOption[], name: string,
): Promise<ReserveResult> {
  const body = a.body as { booked?: boolean; pending?: boolean; title?: string; body?: string; confirmationUrl?: string | null; warning?: string };
  if (a.status !== 200 || !(body.booked || body.pending)) return fromFlow(a, alternatives, name);
  // The night and time booked are the hold's, whatever the line said.
  const at = { ...f, date: hold?.date ?? f.date, time: hold?.time ?? f.time, partySize: hold?.covers ?? f.partySize };
  await moveLine(input, deps, at);
  const words = { title: String(body.title ?? ''), body: String(body.body ?? '') };
  if (body.booked) {
    await tell(deps, input, words);
    return { ok: true, outcome: 'confirmed', row: null, ...words, href: body.confirmationUrl ?? null, warning: body.warning, alternatives: [] };
  }
  // Held for a card on the platform's page: not booked, and theirs to finish.
  const card = body.confirmationUrl ?? null;
  return {
    ok: true, outcome: 'card_owed', row: null, ...words, href: card, warning: body.warning,
    alternatives: cardOptions(f, { redirect_url: card }, hold?.platform ?? null),
  };
}

/**
 * A table booked at another night or time than its line — an offered time
 * taken, a time or night somebody picked — moves the line with it. Otherwise
 * the plan says 7:30 while the restaurant expects them at 9.
 */
async function moveLine(input: ReserveInput, deps: ReserveDeps, f: TableFacts) {
  const line = input.line;
  if (!line || (f.date === input.facts.date && f.time === input.facts.time)) return;
  const to = lineAt(line.scheduled_time, f.date, f.time!, { startDate: input.plan.start_date, endDate: input.plan.end_date });
  const moved = to ? await deps.store.retime(line.id, line.scheduled_time, to) : false;
  if (!moved) {
    console.error('[reserve] BOOKED AT ANOTHER TIME AND THE LINE STILL SAYS THE OLD ONE', {
      booking: input.booking.id, line: line.id, was: line.scheduled_time, booked: `${f.date} ${f.time}`, wrote: to,
    });
  }
}
