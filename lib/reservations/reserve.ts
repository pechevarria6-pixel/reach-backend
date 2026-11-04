// ─── How Reach reserves a table — one place that decides, and does it ──
// Owner, 2026-11-04: "the point of this app is we do it all, they just tell
// us what they want." Decided the same day: Reach books by default, with
// "Book on your own Resy/OpenTable" beside it so card perks still apply; AI
// calls stay locked until a lawyer signs off; never a bot acting as the user.
//
// Three ways a table gets reserved, tried in this order for each restaurant
// line, and every one of them leaves the others on screen:
//
//   instant  — the restaurant is on a platform Reach has a deal with and the
//              provider's keys are set (lib/booking/registry.ts
//              TABLE_PROVIDERS). Reach holds the exact slot — the line's own
//              night (lib/line-when.ts), the time somebody gave, the party —
//              shows the platform's terms, and books only once they have been
//              accepted. "Confirmed" only with the platform's reservation id.
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
// own card, so a quote that asks for one is handed off and Stripe is never
// involved. Rows keep mode 'redirect' — mode says who pays (nobody pays
// Reach for a table), the mark (reserve-state.ts) says who booked it.
//
// Never twice: every write is conditional on the row as it was read (status
// and updated_at), booking claims the row first (lib/booking/claim.ts) so two
// presses cannot both reach the platform, a live call in progress refuses an
// instant booking and an instant booking in flight refuses a call, and an
// answer that never came back leaves the row mid-claim — not failed, which
// would let it be booked a second time.
import type { BookingItemRequest, BookingItemResult, BookingProvider, TableQuoteRaw } from '../booking/types.ts';
import { isOutcomeUnknown, usableTableProvider } from '../booking/types.ts';
import type { Claim, ClaimResult } from '../booking/claim.ts';
import { midClaim } from '../booking/claim.ts';
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
  solo: boolean;
}

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
  /** The provider that books this platform's tables, or null (none listed, or its keys are not set). */
  instant: BookingProvider | null;
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

export interface TermsView {
  platform: string;
  platformName: string;
  /** The platform's own words, once a slot has been held; null before. */
  cancellationPolicy: string | null;
  depositCents: number | null;
  feeNote: string | null;
  termsUrl: string | null;
  /** What the screen says above the button. */
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
  /** The platform's terms, for instant. Null for a call or a hand-off: there are none to accept. */
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
}

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
      path: mark?.path ?? (row?.status === 'pending' ? 'call' : name ? 'instant' : 'handoff'),
      what: settled.title, needs: [], open: false, alternatives: [], terms: null, ownAccount: null,
      status: row?.status ?? null, state: settled.state, offeredTimes: [],
      title: settled.title, body: settled.body,
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

  if (a.instant && name) {
    path = 'instant';
    what = needs.length
      ? `Pick ${needs.includes('date') ? 'a night and a time' : 'a time'}, and Reach books ${f.restaurant} on ${name} for ${f.partySize}.`
      : `Reach books ${f.restaurant} on ${name}: ${at}. You'll see ${name}'s terms before anything is booked.`;
    terms = {
      platform: f.platform, platformName: name,
      cancellationPolicy: mark?.terms?.cancellationPolicy ?? null,
      depositCents: mark?.terms?.depositCents ?? null,
      feeNote: mark?.terms?.feeNote ?? null,
      termsUrl: mark?.terms?.termsUrl ?? null,
      statement: `${name} holds the table and shows its cancellation policy and any deposit before Reach books it. Booking accepts ${name}'s terms.`,
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
        ? `${f.restaurant} books by phone: ${prettyPhone(toE164(f.phone) ?? f.phone ?? '')}. Reach can't book it itself yet.`
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
    title: shown?.title ?? null, body: shown?.body ?? null,
  };
}

/** The row as decide reads it. */
export type DecideRow = {
  status?: string | null; response_payload?: unknown;
  approved_at?: string | null; updated_at?: string | null; error?: string | null; confirmation_number?: string | null;
};

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
function settledWords(f: TableFacts, row: DecideRow | null, mark: ReserveMark | null, now: Date): (Words & { state: ReserveState | null }) | null {
  if (!row) return null;
  const name = platformName(mark?.platform ?? f.platform);
  if (row.status === 'confirmed') {
    const w = mark?.state === 'confirmed' ? stateWords(f, mark) : null;
    return { ...(w ?? { title: `${f.restaurant} is booked.`, body: `It's on ${whose(f.solo)} plan.` }), state: 'confirmed' };
  }
  if (midClaim(row)) {
    if (tableInDoubt(row, mark, now)) return { ...stateWords(f, { ...(mark ?? { path: 'instant' }), state: 'in_doubt' } as ReserveMark)!, state: 'in_doubt' };
    return { title: `Reach is booking ${f.restaurant}${name ? ` on ${name}` : ''} right now.`, body: 'Open the trip again in a minute to see how it went.', state: mark?.state ?? null };
  }
  if (row.status === 'pending' && (mark?.state === 'calling' || mark?.state === 'requested')) {
    return { ...stateWords(f, mark)!, state: mark.state };
  }
  const own = String(row.confirmation_number ?? '').trim();
  if (own) return { title: `You booked ${f.restaurant} yourself · ref ${own}`, body: `It's on ${whose(f.solo)} plan.`, state: mark?.state ?? null };
  return null;
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

// ─── The platform's answer, read ────────────────────────────────────────

/** What a table quote left in `raw`, read defensively (TableQuoteRaw in lib/booking/types.ts). */
export function tableQuoteOf(raw: unknown): Required<Pick<TableQuoteRaw, 'offeredTimes' | 'noAvailability'>> & TableQuoteRaw {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const cents = Number(r.depositCents);
  return {
    offeredTimes: Array.isArray(r.offeredTimes)
      ? [...new Set(r.offeredTimes.map(t => usableTime(String(t))).filter((t): t is string => !!t))]
      : [],
    cancellationPolicy: str(r.cancellationPolicy),
    depositCents: Number.isFinite(cents) && cents > 0 ? Math.round(cents) : null,
    cardRequired: r.cardRequired === true,
    noAvailability: r.noAvailability === true,
    feeNote: str(r.feeNote),
    termsUrl: str(r.termsUrl) && /^https:\/\//i.test(String(r.termsUrl)) ? String(r.termsUrl) : null,
    reserveUrl: str(r.reserveUrl) && /^https:\/\//i.test(String(r.reserveUrl)) ? String(r.reserveUrl) : null,
    confirmationUrl: str(r.confirmationUrl) && /^https:\/\//i.test(String(r.confirmationUrl)) ? String(r.confirmationUrl) : null,
  };
}

/**
 * The terms the person is accepting, as a short key. The key is what the
 * screen sends back with "Book it": a policy that changed between the
 * screen and the booking — a new deposit, different words — is a different
 * key, and nothing is booked on terms nobody saw. FNV-1a, not a secret.
 */
export function termsKey(platform: string, date: string, time: string, party: number, q: TableQuoteRaw): string {
  const text = JSON.stringify([platform, date, time, party, q.cancellationPolicy ?? null, q.depositCents ?? null, q.feeNote ?? null, q.termsUrl ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `t${h.toString(36)}`;
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
  redirect_url?: string | null;
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
  claim(id: string, by: string, version: string | null | undefined): Promise<ClaimResult>;
  finish(id: string, claim: Claim, patch: Record<string, unknown>): Promise<{ row: Record<string, unknown> | null; error: string | null }>;
  /** A write without a claim (offered, handed off, failed before anything was booked): from `from` at `version` only. */
  write(id: string, from: string, version: string | null | undefined, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
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
    /** termsKey() of the terms shown. Required for an instant booking. */
    acceptTerms?: string;
    /** The person says they have not booked it themselves (a row already handed to them). */
    notBookedElsewhere?: boolean;
  };
  /** The held venue, as the call needs it (hours, longitude). */
  venue: PlaceInput['venue'];
  /** The itinerary line the table is on, so a table booked at another time moves the line with it. */
  line?: { id: string; scheduled_time: string | null } | null;
  now?: Date;
}

export interface ReserveDeps {
  instantFor(platform: string): BookingProvider | null;
  callCheck(phone: string | null): Promise<CallCheck>;
  store: TableStore;
  /** What placeCall needs, for the call path. */
  call: PlaceDeps | null;
}

export type ReserveCode =
  | 'not_a_table' | 'in_progress' | 'calling' | 'booked_elsewhere' | 'ask_first' | 'already_settled'
  | 'path_unavailable' | 'missing_facts' | 'details_missing' | 'date_outside_trip' | 'date_past' | 'time_past'
  | 'terms_required' | 'other_time' | 'unavailable'
  | 'call_refused' | 'provider_failed' | 'outcome_unknown' | 'changed' | 'store_error';

export type ReserveResult =
  | {
      ok: true;
      outcome: 'confirmed' | 'requested' | 'calling' | 'handed_off';
      /** Already done before this request — the same answer again, nothing new sent. */
      already?: boolean;
      row: Record<string, unknown> | null;
      title: string;
      body: string;
      href?: string | null;
      alternatives: ReserveOption[];
    }
  | {
      ok: false;
      code: ReserveCode;
      status: number;
      error: string;
      missing?: string[];
      terms?: TermsView & { key: string };
      offeredTimes?: string[];
      refusal?: Refusal;
      alternatives: ReserveOption[];
    };

/** Rows a table can be reserved from. Anything else is settled, or somebody is on it. */
const OPEN = new Set(['awaiting_approval', 'redirected', 'pending', 'failed']);

const RESERVE_STATUS: Partial<Record<Refusal, number>> = {
  calls_off: 503, live_not_approved: 503, no_test_number: 503, no_provider: 503, not_migrated: 503,
  disclosure_failed_before: 503, store_error: 503,
  already_called: 409, already_settled_booking: 409, do_not_call: 409, reach_buys: 409, not_a_table: 409,
  daily_cap: 429, provider_unknown: 502, provider_refused: 502,
};

export async function reserveTable(input: ReserveInput, deps: ReserveDeps): Promise<ReserveResult> {
  const b = input.booking;
  const f = { ...input.facts };
  const now = input.now ?? new Date();
  const mark = reserveMarkOf(b);
  const next = handoffOptions(f);
  const no = (code: ReserveCode, status: number, error: string, extra: Partial<Extract<ReserveResult, { ok: false }>> = {}): ReserveResult =>
    ({ ok: false, code, status, error, alternatives: next, ...extra });

  if (b.vertical !== 'restaurant') return no('not_a_table', 409, 'Only a table is reserved here.');

  // ── Already done: the same answer, nothing sent again ──
  if (b.status === 'confirmed') {
    const w = stateWords(f, mark) ?? { title: `${f.restaurant} is booked.`, body: `It's on ${whose(f.solo)} plan.` };
    return { ok: true, outcome: 'confirmed', already: true, row: b as unknown as Record<string, unknown>, title: w.title, body: w.body, alternatives: [] };
  }
  if (b.status === 'booking' || midClaim(b)) {
    // Past the time any request can run, a claim with no answer on it is in
    // doubt, not "booking now": the request that held it is gone.
    return tableInDoubt(b, mark, now)
      ? no('outcome_unknown', 502, `We asked ${platformName(mark?.platform ?? f.platform) ?? 'the platform'} for this table and never heard back. Don't book it again anywhere until it has been checked.`, { alternatives: [] })
      : no('in_progress', 409, 'Reach is booking this table right now.', { alternatives: [] });
  }
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
  const instant = usableTableProvider(deps.instantFor(f.platform));
  const call = await deps.callCheck(f.phone);
  const view = decide(f, { instant: platformName(f.platform) ? instant : null, call }, b, now);
  const path = input.chosen.path ?? view.path;
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

  if (path === 'handoff') return handoff(input, deps, f, mark);

  // ── The night and the time: the line's own, or what the person picked ──
  const date = input.chosen.date ?? f.date;
  const time = usableTime(input.chosen.time ?? f.time);
  const missing = [...(date ? [] : ['date']), ...(time ? [] : ['time'])];
  if (missing.length) return no('missing_facts', 422, `Pick ${missing.length === 2 ? 'a night and a time' : `a ${missing[0] === 'date' ? 'night' : 'time'}`} first.`, { missing, alternatives: view.alternatives });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date!)) return no('missing_facts', 422, 'Pick a night first.', { missing: ['date'], alternatives: view.alternatives });
  const { start_date: start, end_date: end } = input.plan;
  if (start && (date! < start || date! > (end || start))) return no('date_outside_trip', 422, "That night isn't on this plan.", { alternatives: view.alternatives });
  const lng = input.venue?.lng ?? null;
  if (date! < dayWhere(lng, now)) return no('date_past', 422, 'That night has already gone.', { alternatives: view.alternatives });
  const here = localMinute(lng, now);
  if (here && `${date}T${time}` <= here) return no('time_past', 422, 'That time has already gone.', { alternatives: view.alternatives });
  f.date = date!; f.time = time!;

  // A refusal from here on carries every other way in, the own-account link
  // among them: the answer to a press has no ownAccount beside it.
  const others = [...view.alternatives.filter(a => a.kind === 'call' && path !== 'call'), ...handoffOptions(f)];
  if (path === 'call') return viaCall(input, deps, f, others);
  return viaPlatform(input, deps, f, instant!, others);
}

/** Who hears about it: the person, on a plan for one; everybody on a group's. */
async function tell(deps: ReserveDeps, input: ReserveInput, w: Words) {
  const people = input.plan.solo ? [input.requester.id] : await deps.store.members(input.plan.group_id);
  const url = input.plan.group_id ? `/home?group=${encodeURIComponent(input.plan.group_id)}` : '/home';
  await deps.store.notify(people.length ? people : [input.requester.id], { kind: 'reservation', title: w.title, body: w.body, url, planId: input.plan.id });
}

const stamp = () => new Date().toISOString();

async function handoff(input: ReserveInput, deps: ReserveDeps, f: TableFacts, prior: ReserveMark | null, reason?: string, href?: string | null): Promise<ReserveResult> {
  const b = input.booking;
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

async function viaCall(input: ReserveInput, deps: ReserveDeps, f: TableFacts, alternatives: ReserveOption[]): Promise<ReserveResult> {
  if (!deps.call) return { ok: false, code: 'path_unavailable', status: 503, error: REFUSAL_COPY.calls_off, alternatives };
  const b = input.booking;
  // Take the row before anything rings, on the version read: 'pending' with
  // the "calling" mark. An instant booking claimed meanwhile has moved the
  // row, so this matches nothing and nobody is rung; one that read the row
  // before this write holds an older version, so its claim matches nothing
  // and the platform is never asked. Reading "nobody is booking it" is not
  // enough: two requests both read that before either writes.
  const calling: ReserveMark = { state: 'calling', path: 'call', platform: null, date: f.date, time: f.time, partySize: f.partySize, at: stamp() };
  const held = await deps.store.write(b.id, b.status, b.updated_at, {
    status: 'pending', error: null, detail: f.restaurant, response_payload: withMark(b.response_payload, calling), updated_at: stamp(),
  });
  if (!held) return { ok: false, code: 'changed', status: 409, error: 'This changed while you were looking — nobody was called. Open it again.', alternatives };
  const version = (held.updated_at as string | null | undefined) ?? null;

  const placed = await placeCall({
    booking: { ...b, status: 'pending', request_payload: b.request_payload as never },
    // A call that ends with no table opens the row again, whatever it was before.
    previousStatus: 'awaiting_approval',
    plan: input.plan,
    requester: { id: input.requester.id, firstName: input.requester.firstName },
    venue: input.venue,
    chosen: { date: f.date!, time: f.time!, partySize: f.partySize, notes: null },
    now: input.now,
  }, deps.call);
  if (placed.ok === false) {
    // Something may be ringing: the row stays taken, so nothing else books it.
    if (placed.refusal !== 'provider_unknown') {
      const back = await deps.store.write(b.id, 'pending', version, {
        status: b.status, error: (b as { error?: unknown }).error ?? null, response_payload: b.response_payload ?? null, updated_at: stamp(),
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

async function viaPlatform(input: ReserveInput, deps: ReserveDeps, f: TableFacts, provider: BookingProvider, alternatives: ReserveOption[]): Promise<ReserveResult> {
  const b = input.booking;
  const name = platformName(f.platform) ?? provider.name;
  const r = input.requester;
  // A table is booked in somebody's name, with a way to reach them. Never a
  // made-up name, never Reach's number.
  const details = [...(r.firstName ? [] : ['first name']), ...(r.lastName ? [] : ['last name']), ...(r.email ? [] : ['email']), ...(r.phone ? [] : ['phone number'])];
  if (details.length) {
    return { ok: false, code: 'details_missing', status: 422, missing: details, error: `${name} needs your ${details.join(', ')} to hold a table. Add ${details.length === 1 ? 'it' : 'them'} in your profile.`, alternatives };
  }
  const prior = (b.request_payload ?? {}) as Partial<BookingItemRequest> & { restaurant?: BookingItemRequest['restaurant'] };
  const request: BookingItemRequest = {
    ...(prior as BookingItemRequest),
    vertical: 'restaurant', planId: b.plan_id, groupId: String(input.plan.group_id ?? ''), reference: b.id,
    party: f.partySize,
    travelers: [{ firstName: r.firstName!, lastName: r.lastName!, email: r.email!, phone: r.phone! }],
    restaurant: {
      ...(prior.restaurant ?? { name: f.restaurant, city: f.city ?? '' }),
      name: f.restaurant, city: f.city ?? prior.restaurant?.city ?? '',
      date: f.date!, time: f.time, partySize: f.partySize,
      platform: f.platform as NonNullable<BookingItemRequest['restaurant']>['platform'],
      externalUrl: f.reserveUrl ?? prior.restaurant?.externalUrl, phone: f.phone,
    },
  };

  // ── 1. Hold the slot and read its terms. Nothing is booked by this. ──
  let quote: BookingItemResult;
  try {
    quote = await provider.quote(request);
  } catch (e) {
    console.error('[reserve] the platform did not answer the quote', { booking: b.id, platform: f.platform, error: e instanceof Error ? e.message : String(e) });
    return { ok: false, code: 'provider_failed', status: 502, error: `${name} didn't answer just now, so nothing was booked. ${nextSaid(f)}`, alternatives };
  }
  const q = tableQuoteOf(quote.raw);

  // ── 2. A deposit or a card hold is the restaurant's money, not Reach's ──
  // Before reading a refusal too: a platform that refuses a slot because it
  // needs a card has told us how the table is taken, not that there is none.
  if (q.depositCents || q.cardRequired) {
    const reason = q.depositCents
      ? `${f.restaurant} asks for a $${(q.depositCents / 100).toFixed(2)} deposit, so Reach won't hold it — book it on ${name} with your own card.`
      : `${f.restaurant} wants a card on file, so Reach won't hold it — book it on ${name} with your own card.`;
    return handoff(input, deps, f, reserveMarkOf(b), reason, q.reserveUrl ?? f.reserveUrl);
  }

  if (quote.status === 'failed') {
    if (q.offeredTimes.length) {
      const mark: ReserveMark = { state: 'offered', path: 'instant', platform: f.platform, date: f.date, time: f.time, partySize: f.partySize, offeredTimes: q.offeredTimes, at: stamp() };
      const w = stateWords(f, mark)!;
      const row = await deps.store.write(b.id, b.status, b.updated_at, {
        status: 'awaiting_approval', error: null, detail: f.restaurant, response_payload: withMark(b.response_payload, mark), updated_at: stamp(),
      });
      if (!row) return { ok: false, code: 'changed', status: 409, error: 'This changed while you were looking. Open it again.', alternatives };
      await tell(deps, input, w);
      return { ok: false, code: 'other_time', status: 409, error: w.title, offeredTimes: q.offeredTimes, alternatives };
    }
    // "No table" only when the platform said so. Any other failure — a rate
    // limit, a key, a timeout, an error we do not know — is ours, and saying
    // it as a fact about the restaurant would send the group elsewhere over
    // our gap. The row is left as it was and nobody else is told.
    if (!q.noAvailability) {
      console.error('[reserve] the platform refused the quote', { booking: b.id, platform: f.platform, error: quote.error ?? null });
      return { ok: false, code: 'provider_failed', status: 502, error: `Reach couldn't get an answer from ${name} just now, so nothing was booked. ${nextSaid(f)}`, alternatives };
    }
    const reason = `${f.restaurant} has no table on ${name} ${tableWhen(f.date, f.time)} for ${f.partySize}.`;
    const mark: ReserveMark = { state: 'failed', path: 'instant', platform: f.platform, date: f.date, time: f.time, partySize: f.partySize, reason, at: stamp() };
    const row = await deps.store.write(b.id, b.status, b.updated_at, {
      status: 'failed', error: quote.error || reason, detail: f.restaurant, response_payload: withMark(b.response_payload, mark), updated_at: stamp(),
    });
    if (!row) return { ok: false, code: 'changed', status: 409, error: 'This changed while you were looking. Open it again.', alternatives };
    await tell(deps, input, stateWords(f, mark)!);
    return { ok: false, code: 'unavailable', status: 409, error: `Not booked. ${reason} ${nextSaid(f)}`, alternatives };
  }

  // ── 3. The terms, shown before anything is booked ──
  const key = termsKey(f.platform, f.date!, f.time!, f.partySize, q);
  if (input.chosen.acceptTerms !== key) {
    const terms = {
      platform: f.platform, platformName: name, key,
      cancellationPolicy: q.cancellationPolicy ?? null, depositCents: q.depositCents ?? null,
      feeNote: q.feeNote ?? null, termsUrl: q.termsUrl ?? null,
      statement: `${name} is holding ${tableWhen(f.date, f.time)} for ${f.partySize}. Booking it accepts ${name}'s terms${q.cancellationPolicy ? ' and the cancellation policy below' : ''}.${q.cancellationPolicy ? '' : ` ${name} sent no cancellation policy for it.`}`,
    };
    return {
      ok: false, code: 'terms_required', status: 409, terms, alternatives,
      error: input.chosen.acceptTerms ? `${name}'s terms for this table changed. Read them again before Reach books it.` : `Read ${name}'s terms, then book it.`,
    };
  }

  // ── 4. Claim the row: one booking per table, whoever presses ──
  let version = b.updated_at ?? null;
  if (b.status !== 'awaiting_approval') {
    const re = await deps.store.reopen(b.id, b.status, version, { error: null, updated_at: stamp() });
    if (!re.ok) return { ok: false, code: 'changed', status: 409, error: 'This changed while you were looking — nothing was booked. Open it again.', alternatives };
    version = re.version;
  }
  const claimed = await deps.store.claim(b.id, input.requester.id, version);
  if (claimed.ok === false) {
    return claimed.taken
      ? { ok: false, code: 'in_progress', status: 409, error: 'Somebody else is booking this table right now.', alternatives: [] }
      : { ok: false, code: 'store_error', status: 500, error: 'Could not start this booking just now. Nothing was booked.', alternatives };
  }
  const claim = claimed.claim;
  const terms = { cancellationPolicy: q.cancellationPolicy ?? null, depositCents: q.depositCents ?? null, feeNote: q.feeNote ?? null, termsUrl: q.termsUrl ?? null };
  const markOf = (state: ReserveState, extra: Partial<ReserveMark> = {}): ReserveMark =>
    ({ state, path: 'instant', platform: f.platform, date: f.date, time: f.time, partySize: f.partySize, terms, at: stamp(), ...extra });

  // ── 5. Book the slot that was held ──
  let result: BookingItemResult;
  try {
    result = await provider.book({ ...request, restaurant: { ...request.restaurant!, holdRef: quote.providerRef } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isOutcomeUnknown(e)) return inDoubt(deps, b, claim, markOf('in_doubt'), msg, f, name);
    const mark = markOf('failed', { reason: `${name} refused the booking.` });
    const { error } = await deps.store.finish(b.id, claim, { status: 'failed', error: msg, response_payload: withMark(b.response_payload, mark), updated_at: stamp() });
    if (error) console.error('[reserve] a refused booking could not be marked failed', { booking: b.id, error });
    await tell(deps, input, stateWords(f, mark)!);
    return { ok: false, code: 'provider_failed', status: 502, error: `Not booked — ${name} refused it. ${nextSaid(f)}`, alternatives };
  }

  // Confirmed only with the platform's own reservation id. "Confirmed" with
  // none is an answer we cannot point at: it may be booked, and it is not
  // tried again.
  if (result.status === 'confirmed' && !result.providerRef) {
    return inDoubt(deps, b, claim, markOf('in_doubt'), 'confirmed with no reservation id', f, name);
  }
  if (result.status === 'confirmed' || result.status === 'pending') {
    const state: ReserveState = result.status === 'confirmed' ? 'confirmed' : 'requested';
    const mark = markOf(state, { ref: result.providerRef ?? null });
    const w = stateWords(f, mark)!;
    const { row, error } = await deps.store.finish(b.id, claim, {
      status: result.status, provider: f.platform, provider_ref: result.providerRef ?? null,
      redirect_url: q.confirmationUrl ?? b.redirect_url ?? null, detail: f.restaurant, error: null, price_cents: 0,
      // What was asked for is what was booked: the night, the time, the party.
      request_payload: { ...(b.request_payload ?? {}), party: f.partySize, restaurant: { ...(prior.restaurant ?? {}), name: f.restaurant, date: f.date, time: f.time, partySize: f.partySize } },
      response_payload: withMark(b.response_payload, mark), updated_at: stamp(),
    });
    if (error || !row) {
      console.error('[reserve] BOOKED AND NOT RECORDED', { booking: b.id, platform: f.platform, ref: result.providerRef ?? null, error });
      return { ok: false, code: 'store_error', status: 500, error: `${name} booked it (ref ${result.providerRef ?? 'not given'}) and we couldn't save that. Don't book it again — we have been told.`, alternatives: [] };
    }
    await moveLine(input, deps, f);
    await tell(deps, input, w);
    return { ok: true, outcome: state === 'confirmed' ? 'confirmed' : 'requested', row, title: w.title, body: w.body, alternatives: state === 'confirmed' ? [] : alternatives };
  }

  const reason = result.error || `${name} refused the booking.`;
  const mark = markOf('failed', { reason: `${f.restaurant} couldn't be booked on ${name}.` });
  const { error } = await deps.store.finish(b.id, claim, { status: 'failed', error: reason, response_payload: withMark(b.response_payload, mark), updated_at: stamp() });
  if (error) console.error('[reserve] a refused booking could not be marked failed', { booking: b.id, error });
  await tell(deps, input, stateWords(f, mark)!);
  return { ok: false, code: 'provider_failed', status: 502, error: `Not booked. ${reason} ${nextSaid(f)}`, alternatives };
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

async function inDoubt(deps: ReserveDeps, b: TableRow, claim: Claim, mark: ReserveMark, msg: string, f: TableFacts, name: string): Promise<ReserveResult> {
  // Left mid-claim, as approval leaves a flight: marking it failed would let
  // it be booked again, a second table if the first went through.
  const { error } = await deps.store.finish(b.id, claim, { error: `outcome unknown: ${msg}`, response_payload: withMark(b.response_payload, mark) });
  if (error) console.error('[reserve] could not note an unknown outcome', { booking: b.id, error });
  console.error('[reserve] table outcome unknown', { booking: b.id, platform: f.platform, msg });
  return {
    ok: false, code: 'outcome_unknown', status: 502, alternatives: [],
    error: `We asked ${name} for ${f.restaurant} and never heard back, so we can't tell yet whether it's booked. Don't book it again anywhere — it stays on hold here until it has been checked.`,
  };
}
