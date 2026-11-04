// ─── The AI reservation-calling assistant ───────────────────────────────
// Owner, 2026-11-04: "I want an ai assistant that can reserve restaurants".
// Decided: build it, and call NO restaurant until a phone-law lawyer signs
// off — test number only until then (lib/reservations/gate.ts).
//
// One request becomes at most one call, and only when every rule says yes.
// Each rule fails closed and hands the person the restaurant's own booking
// link and number instead, so a refusal is never the end of a plan:
//
//   1. the gate: mode off | test | live, live only with the lawyer's yes,
//      and a provider whose keys are all present;
//   2. a restaurant booking the person books themselves (never one Reach buys);
//   3. every fact from what we hold — no default date, no default time;
//   4. the date inside the trip, and the date and clock time still to come
//      where the venue is — by more than the longitude estimate can be off;
//   5. a +1 number we can read;
//   6. no earlier call that skipped the disclosure (that stops everything);
//   7. not on the do-not-call list, which is forever;
//   8. one call per reservation (per mode — a test never uses up the real one);
//   9. the venue's own hours say it is plainly open now;
//  10. a line-type lookup says the venue's number is a landline;
//  11. a slot under the fifty-a-day cap, taken in the database.
//
// Then the provider is asked to ring. In test mode it rings
// RESERVATION_TEST_NUMBER, never the venue, and no booking is changed.
//
// When the provider reports the call ended (app/api/webhooks/reservation-
// call), settleCall judges it from the restaurant's own words
// (lib/reservations/outcome.ts), settles the row exactly once, honours a
// "stop calling", moves the booking and tells the person — the exact
// wording in lib/reservations/wording.ts.
import { gate, dialTarget, type Env, type Gate } from './gate.ts';
import { checkFacts, opening, instructions, type CallFacts, type FactProblem } from './script.ts';
import { settle, type Outcome, type Settled } from './outcome.ts';
import { callWording, type WordingContext, type Wording } from './wording.ts';
import { toE164, dialable, openForCalls, localMinute, HOURS_MARGIN, type LineLookup, type LineType } from './policy.ts';
import type { Provider, CallEnded } from './providers.ts';
import { dayWhere } from '../calendar.ts';
import type { ReserveMark } from './reserve-state.ts';

export { gate, settle, callWording };
export type { Outcome, Settled, Wording, CallFacts };

export const DAILY_CAP = 50;
/** How far back an undisclosed call stops new ones: forever, in practice. */
const DISCLOSURE_LOOKBACK_DAYS = 3650;

export type Refusal =
  | 'calls_off' | 'live_not_approved' | 'no_test_number' | 'no_provider'
  | 'not_a_table' | 'reach_buys' | 'already_settled_booking'
  | 'missing_facts' | 'date_past' | 'time_past' | 'date_outside_trip'
  | 'number_unreadable' | 'not_north_american'
  | 'disclosure_failed_before'
  | 'do_not_call'
  | 'already_called'
  | 'hours_unknown' | 'closed_now'
  | 'landline_unverified' | 'not_a_landline'
  | 'daily_cap'
  | 'provider_refused' | 'provider_unknown'
  | 'not_migrated' | 'store_error';

/** What the person is told when Reach will not ring, and what they can do instead. */
export const REFUSAL_COPY: Record<Refusal, string> = {
  calls_off: "Reach can't call restaurants yet.",
  live_not_approved: "Reach can't call restaurants yet.",
  no_test_number: "Reach can't call restaurants yet.",
  no_provider: "Reach can't call restaurants yet.",
  not_a_table: 'Only a table can be asked for on a call.',
  reach_buys: 'This one is booked by Reach directly, not by a call.',
  already_settled_booking: 'This table is already settled.',
  missing_facts: 'Pick a date, a time and how many people first.',
  date_past: 'That date has already gone.',
  time_past: "That time has gone, or is too soon for Reach to ask — call them instead.",
  date_outside_trip: "That date isn't on this trip.",
  number_unreadable: "We don't hold a number for this restaurant we can be sure of.",
  not_north_american: 'Reach can only call restaurants in the US and Canada.',
  disclosure_failed_before: "Reach isn't placing calls right now.",
  do_not_call: 'This restaurant asked not to be called by Reach.',
  already_called: 'Reach has already called about this table.',
  hours_unknown: "We don't know this restaurant's hours, so Reach won't call.",
  closed_now: "They aren't open right now, so Reach won't call.",
  landline_unverified: "We can't confirm this is the restaurant's landline, so Reach won't call.",
  not_a_landline: "This number isn't a restaurant landline, so Reach won't call.",
  daily_cap: 'Reach has made all its calls for today.',
  provider_refused: "The call couldn't be placed.",
  provider_unknown: "We couldn't tell whether the call went through.",
  not_migrated: "Reach can't call restaurants yet.",
  store_error: "Reach couldn't place the call just now.",
};

export interface CallRow {
  id: string;
  booking_id: string;
  plan_id: string;
  requested_by: string;
  mode: 'test' | 'live';
  provider: 'retell' | 'vapi';
  provider_call_id: string | null;
  dialed_number: string;
  venue_phone: string;
  call_day: string;
  day_slot: number;
  status: 'placing' | 'calling' | 'unknown' | 'settled';
  request: StoredRequest;
  opening: string;
  outcome: Outcome | null;
  staff_quote?: string | null;
  outcome_detail?: Record<string, unknown> | null;
  disclosed?: boolean | null;
  created_at?: string;
}

/** The facts, plus what settling needs to put the booking back and say it right. */
export interface StoredRequest extends CallFacts {
  solo: boolean;
  reserveUrl: string | null;
  /** The booking's status before the call, restored when the call books nothing. */
  previousStatus: string;
  groupId: string | null;
}

export type Claim = { ok: true; row: CallRow } | { ok: false; why: 'already' | 'cap' | 'not_migrated' | 'error' };
type Read<T> = { ok: true; value: T } | { ok: false; why: 'not_migrated' | 'error' };

/** Everything the assistant reads and writes. Supabase in production (store.ts), memory in tests. */
export interface Store {
  anyUndisclosed(sinceISO: string): Promise<Read<boolean>>;
  onDoNotCall(phone: string): Promise<Read<boolean>>;
  callFor(bookingId: string, mode: 'test' | 'live'): Promise<Read<CallRow | null>>;
  /** Insert the row, taking the next free slot of the day; the database refuses a second per booking and a 51st. */
  claim(row: Omit<CallRow, 'id' | 'day_slot' | 'status' | 'outcome' | 'provider_call_id'>): Promise<Claim>;
  markPlaced(id: string, providerCallId: string): Promise<boolean>;
  markUnknown(id: string, detail: string): Promise<boolean>;
  /** Delete a claim the provider refused before anything rang. */
  release(id: string): Promise<boolean>;
  find(provider: string, providerCallId: string | null, callId: string | null): Promise<Read<CallRow | null>>;
  /** Settle the row if, and only if, it is not settled yet. Returns the row when this call settled it. */
  settleOnce(id: string, fields: Partial<CallRow> & { transcript: unknown }): Promise<Read<CallRow | null>>;
  addDoNotCall(phone: string, reason: 'asked' | 'refused', callId: string): Promise<boolean>;
  /** Move a booking from one of `from` to `to`; false when it was not in `from` any more. */
  /**
   * `mark` is where the reservation stands (lib/reservations/reserve-state.ts),
   * put on the row's response_payload so every screen reads "on the phone",
   * "offered 9:00" or "not booked" from the row itself.
   */
  moveBooking(bookingId: string, from: string[], to: { status: string; detail?: string | null; provider_ref?: string | null; mark?: ReserveMark }): Promise<boolean>;
  planMembers(planId: string, groupId: string | null): Promise<string[]>;
  notify(userIds: string[], note: { kind: string; title: string; body: string; url: string | null; planId: string }): Promise<void>;
}

export interface BookingRow {
  id: string;
  plan_id: string;
  vertical: string;
  mode: string | null;
  provider: string | null;
  status: string;
  redirect_url?: string | null;
  request_payload?: { restaurant?: { name?: string; partySize?: number; notes?: string; externalUrl?: string } } | null;
}

export interface PlaceInput {
  booking: BookingRow;
  plan: { id: string; group_id: string | null; solo: boolean; start_date: string | null; end_date: string | null };
  requester: { id: string; firstName: string | null };
  /** The held venue: its own number, hours and longitude. */
  venue: { name: string; phone: string | null; opening_hours: string | null; lng: number | null; reserveUrl: string | null } | null;
  /** What the person chose for this call. */
  chosen: { date?: string; time?: string; partySize?: number; notes?: string | null };
  now?: Date;
}

export interface PlaceDeps {
  env: Env;
  store: Store;
  lookup: LineLookup | null;
  provider: (g: Gate) => Provider;
}

export type PlaceResult =
  | { ok: true; call: CallRow; wording: Wording }
  | { ok: false; refusal: Refusal; message: string; missing?: FactProblem[]; handoff: { reserveUrl: string | null; phone: string | null } };

const TERMINAL = new Set(['confirmed', 'cancelled', 'failed', 'booking']);

/** Rows Reach pays a provider for are booked by approval, never by a call. Mirrors lib/booking/charged.ts. */
const isReachBuys = (b: BookingRow) => !(b.mode === 'redirect' || b.mode === 'concierge' || b.provider === 'concierge');

export function wordingFor(req: StoredRequest, phone: string | null, test: boolean): WordingContext {
  return {
    restaurant: req.restaurant, time: req.time, date: req.date, partySize: req.partySize,
    firstName: req.firstName, solo: req.solo, reserveUrl: req.reserveUrl, phone, test,
  };
}

export async function placeCall(input: PlaceInput, deps: PlaceDeps): Promise<PlaceResult> {
  const now = input.now ?? new Date();
  const venuePhone = toE164(input.venue?.phone);
  const reserveUrl = input.venue?.reserveUrl ?? input.booking.redirect_url ?? input.booking.request_payload?.restaurant?.externalUrl ?? null;
  const handoff = { reserveUrl, phone: input.venue?.phone ?? null };
  const no = (refusal: Refusal, extra: { missing?: FactProblem[] } = {}): PlaceResult =>
    ({ ok: false, refusal, message: REFUSAL_COPY[refusal], handoff, ...extra });

  // 1. The gate. Nothing below runs while calls are off.
  const g = gate(deps.env);
  if (g.ok === false) return no(g.refusal!);

  // 2. A table the person books themselves, not settled already.
  const b = input.booking;
  if (b.vertical !== 'restaurant') return no('not_a_table');
  if (isReachBuys(b)) return no('reach_buys');
  if (TERMINAL.has(b.status)) return no('already_settled_booking');

  // 3. Facts we hold, and nothing else.
  const checked = checkFacts({
    restaurant: input.venue?.name ?? b.request_payload?.restaurant?.name,
    venuePhone: venuePhone ?? '',
    date: input.chosen.date,
    time: input.chosen.time,
    partySize: input.chosen.partySize ?? b.request_payload?.restaurant?.partySize,
    firstName: input.requester.firstName ?? '',
    notes: input.chosen.notes ?? null,
  });
  if (checked.ok === false) {
    if (checked.missing.length === 1 && checked.missing[0] === 'venue_phone') return no('number_unreadable');
    return no('missing_facts', { missing: checked.missing });
  }
  const facts = checked.facts;

  // 4. A night on this trip, still to come where the restaurant is.
  if (facts.date < dayWhere(input.venue?.lng, now)) return no('date_past');
  // The date alone lets a 6 p.m. table be asked for at 9 p.m. the same night.
  // The venue's clock is estimated from longitude, so a time inside the
  // margin may already be gone there: hand it to the person instead.
  // Without a longitude there is no clock to read; check 9 refuses that
  // call (openForCalls needs one too), so nothing rings without this check.
  const soonest = localMinute(input.venue?.lng, new Date(now.getTime() + HOURS_MARGIN * 3_600_000));
  if (soonest && `${facts.date}T${facts.time}` <= soonest) return no('time_past');
  const { start_date: start, end_date: end } = input.plan;
  if (start && (facts.date < start || facts.date > (end || start))) return no('date_outside_trip');

  // 5. A number the providers dial and the research covered.
  if (!dialable(facts.venuePhone)) return no('not_north_american');

  // 6. An earlier call that did not open with the disclosure stops all of them.
  const since = new Date(now.getTime() - DISCLOSURE_LOOKBACK_DAYS * 86_400_000).toISOString();
  const undisclosed = await deps.store.anyUndisclosed(since);
  if (undisclosed.ok === false) return no(undisclosed.why === 'not_migrated' ? 'not_migrated' : 'store_error');
  if (undisclosed.value) return no('disclosure_failed_before');

  // 7. Do not call, forever.
  const dnc = await deps.store.onDoNotCall(facts.venuePhone);
  if (dnc.ok === false) return no(dnc.why === 'not_migrated' ? 'not_migrated' : 'store_error');
  if (dnc.value) return no('do_not_call');

  // 8. One call per reservation. The unique index says so too (claim).
  const mode = g.mode as 'test' | 'live';
  const earlier = await deps.store.callFor(b.id, mode);
  if (earlier.ok === false) return no(earlier.why === 'not_migrated' ? 'not_migrated' : 'store_error');
  if (earlier.value) return no('already_called');

  // 9. Plainly open, now, by the venue's own hours.
  const open = openForCalls(input.venue?.opening_hours, input.venue?.lng, now);
  if (open.ok === false) return no(open.why === 'closed' ? 'closed_now' : 'hours_unknown');

  // 10. A business landline, and we have checked.
  if (!deps.lookup) return no('landline_unverified');
  const line: LineType = await deps.lookup(facts.venuePhone);
  if (line === 'unknown') return no('landline_unverified');
  if (line !== 'landline') return no('not_a_landline');

  // 11. Claim the call — and a slot under the cap — before anything rings.
  const to = dialTarget(g, facts.venuePhone);
  if (!to) return no('calls_off');
  const request: StoredRequest = {
    ...facts, solo: input.plan.solo, reserveUrl, previousStatus: b.status, groupId: input.plan.group_id,
  };
  const claim = await deps.store.claim({
    booking_id: b.id, plan_id: input.plan.id, requested_by: input.requester.id,
    mode, provider: g.provider!, dialed_number: to, venue_phone: facts.venuePhone,
    call_day: now.toISOString().slice(0, 10), request, opening: opening(facts),
  });
  if (claim.ok === false) {
    return no(claim.why === 'already' ? 'already_called' : claim.why === 'cap' ? 'daily_cap'
      : claim.why === 'not_migrated' ? 'not_migrated' : 'store_error');
  }
  const row = claim.row;

  const provider = deps.provider(g);
  const placed = await provider.place({
    callId: row.id, to,
    variables: { opening: row.opening, instructions: instructions(facts), first_name: facts.firstName, restaurant: facts.restaurant },
  });
  if (placed.ok === false) {
    if (placed.placed === false) {
      // Nothing rang, so the one call this reservation gets is not used up.
      if (!(await deps.store.release(row.id))) console.error('[reservation call] could not release a refused claim', { id: row.id });
      console.error('[reservation call] provider refused', { id: row.id, detail: placed.detail });
      return no('provider_refused');
    }
    // Something may be ringing. Never retried: one call per reservation.
    if (!(await deps.store.markUnknown(row.id, placed.detail))) console.error('[reservation call] could not mark a call unknown', { id: row.id });
    return no('provider_unknown');
  }
  if (!(await deps.store.markPlaced(row.id, placed.providerCallId))) {
    // The webhook still finds it by the metadata we sent, so this is logged, not fatal.
    console.error('[reservation call] could not record the provider call id', { id: row.id, provider: g.provider });
  }

  const wording = callWording({ state: 'calling' }, wordingFor(request, handoff.phone, mode === 'test'));
  if (mode === 'live') {
    // Calling is not booked; the row says "pending" and the words say "calling".
    const moved = await deps.store.moveBooking(b.id, [b.status], {
      // detail stays the restaurant's name: it is what every list shows as
      // the booking's title. Where it stands is the mark's to say.
      status: 'pending', detail: facts.restaurant,
      mark: { state: 'calling', path: 'call', date: facts.date, time: facts.time, partySize: facts.partySize, callId: row.id, at: now.toISOString() },
    });
    if (!moved) console.error('[reservation call] booking changed while the call was placed', { booking: b.id });
  }
  await tell(deps.store, row.plan_id, request, row.requested_by, mode, wording);
  return { ok: true, call: { ...row, status: 'calling', provider_call_id: placed.providerCallId }, wording };
}

async function tell(store: Store, planId: string, req: StoredRequest, requester: string, mode: 'test' | 'live', w: Wording) {
  // A test call speaks only to whoever ran it. A live one to the person on a
  // solo plan, and to everybody on a group's — it is the group's dinner.
  const people = mode === 'test' || req.solo ? [requester] : await store.planMembers(planId, req.groupId);
  const url = req.groupId ? `/home?group=${encodeURIComponent(req.groupId)}` : '/home';
  await store.notify(people.length ? people : [requester], { kind: 'reservation_call', title: w.title, body: w.body, url, planId });
}

export type SettleResult =
  | { ok: true; settled: Settled; wording: Wording; row: CallRow }
  | { ok: false; why: 'unknown_call' | 'not_final' | 'already_settled' | 'not_migrated' | 'store_error' };

/** Settle one call from the provider's call-ended event. Safe to receive any number of times. */
export async function settleCall(event: CallEnded, providerName: string, store: Store, now: Date = new Date()): Promise<SettleResult> {
  const found = await store.find(providerName, event.providerCallId, event.callId);
  if (found.ok === false) return { ok: false, why: found.why === 'not_migrated' ? 'not_migrated' : 'store_error' };
  const row = found.value;
  if (!row) return { ok: false, why: 'unknown_call' };
  if (row.status === 'settled') return { ok: false, why: 'already_settled' };
  if (!event.final) return { ok: false, why: 'not_final' };

  const req = row.request;
  const settled = settle(req, event.turns, event.extraction, event.signals);
  const wrote = await store.settleOnce(row.id, {
    status: 'settled', outcome: settled.outcome, staff_quote: settled.staffQuote ?? null,
    disclosed: settled.disclosed,
    outcome_detail: { offeredTime: settled.offeredTime ?? null, held: settled.held ?? null, doubt: settled.doubt ?? null, stopCalling: settled.stopCalling, extraction: event.extraction ?? null },
    transcript: event.turns,
    provider_call_id: row.provider_call_id ?? event.providerCallId,
    settled_at: now.toISOString(),
  } as Partial<CallRow> & { transcript: unknown });
  if (wrote.ok === false) return { ok: false, why: wrote.why === 'not_migrated' ? 'not_migrated' : 'store_error' };
  // Somebody else's delivery of this same event settled it first.
  if (!wrote.value) return { ok: false, why: 'already_settled' };

  // Only a call whose assistant spoke without the disclosure. One nobody
  // answered, or that the assistant never spoke on, is null and stops nothing.
  if (settled.disclosed === false) {
    console.error('[reservation call] THE CALL DID NOT OPEN WITH THE DISCLOSURE — every later call is refused until this is looked at', { id: row.id, provider: providerName });
  }

  const test = row.mode === 'test';
  // A restaurant that said stop is never rung again. A test call rang our
  // own number, so the venue said nothing and is not listed.
  if (settled.stopCalling && !test) {
    const listed = await store.addDoNotCall(row.venue_phone, settled.outcome === 'refused' ? 'refused' : 'asked', row.id);
    if (!listed) console.error('[reservation call] COULD NOT RECORD DO-NOT-CALL', { phone: row.venue_phone, id: row.id });
  }

  const wording = callWording({ state: 'settled', outcome: settled.outcome, offeredTime: settled.offeredTime },
    wordingFor(req, row.venue_phone, test));

  if (!test) {
    // Only a call that moved the booking to pending moves it back, and only
    // while it is still pending: somebody who marked it themselves meanwhile wins.
    const base = { path: 'call' as const, date: req.date, time: req.time, partySize: req.partySize, callId: row.id, at: now.toISOString() };
    const mark: ReserveMark = settled.outcome === 'confirmed'
      ? { ...base, state: 'confirmed', ref: `reach-call:${row.id}` }
      : settled.outcome === 'alternative_offered' && settled.offeredTime
        ? { ...base, state: 'offered', offeredTimes: [settled.offeredTime] }
        : { ...base, state: 'not_booked', reason: wording.title.replace(/^Not booked\.\s*/, '') };
    const to = settled.outcome === 'confirmed'
      ? { status: 'confirmed', detail: req.restaurant, provider_ref: `reach-call:${row.id}`, mark }
      : { status: req.previousStatus, detail: req.restaurant, mark };
    const moved = await store.moveBooking(row.booking_id, ['pending'], to);
    if (!moved) console.error('[reservation call] booking was not pending when the call settled; left as it is', { booking: row.booking_id, outcome: settled.outcome });
  }
  await tell(store, row.plan_id, req, row.requested_by, row.mode, wording);
  return { ok: true, settled, wording, row };
}
