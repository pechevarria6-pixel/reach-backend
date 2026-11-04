// How Reach reserves a table (lib/reservations/reserve.ts): which way, what
// it says, every path, and the never-double-book rule.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decide, reserveTable, callCheck, tableQuoteOf, termsKey,
  type TableFacts, type TableRow, type TableStore, type ReserveInput, type ReserveDeps, type CallCheck,
} from '../../lib/reservations/reserve.ts';
import { reserveMarkOf } from '../../lib/reservations/reserve-state.ts';
import { OutcomeUnknown, usableTableProvider, type BookingItemRequest, type BookingItemResult, type BookingProvider } from '../../lib/booking/types.ts';
import { approveOutcome, nextStepFor } from '../../lib/booking/approve-outcome.ts';
import type { Store as CallStore, CallRow } from '../../lib/reservations/call.ts';
import { getNextAction, type NextActionInput, type NextBooking } from '../../lib/next-action.ts';
import { checkoutState } from '../../lib/checkout.ts';

// ── fixtures ────────────────────────────────────────────────────────────
// 13:00 in Raleigh by the longitude estimate: the dinner is three nights off.
const NOW = new Date('2026-11-04T18:00:00Z');
const OT_LINK = 'https://www.opentable.com/r/luigis-raleigh?covers=4&dateTime=2026-11-07T19%3A30';

function facts(over: Partial<TableFacts> = {}): TableFacts {
  return {
    bookingId: 'b1', itemId: 'l-dinner', restaurant: "Luigi's", city: 'Raleigh', platform: 'opentable',
    date: '2026-11-07', time: '19:30', partySize: 4, phone: '(919) 555-0100', reserveUrl: OT_LINK, solo: false,
    ...over,
  };
}

let clock = 0;
const tick = () => new Date(Date.UTC(2026, 10, 4, 18, 0, 0, ++clock)).toISOString();

function row(over: Partial<TableRow> = {}): TableRow {
  return {
    id: 'b1', plan_id: 'p1', vertical: 'restaurant', mode: 'redirect', provider: 'opentable', status: 'awaiting_approval',
    redirect_url: OT_LINK, updated_at: '2026-11-04T17:00:00.000Z', approved_at: null,
    request_payload: { party: 4, restaurant: { name: "Luigi's", city: 'Raleigh', date: '2026-11-07', time: '19:30', partySize: 4, platform: 'opentable' } },
    response_payload: { platform: 'opentable', phone: '(919) 555-0100' },
    ...over,
  };
}

/** The bookings table, in memory, keeping the database's conditional-write rules. */
function memory(start: TableRow = row(), opts: { members?: string[]; callOpen?: boolean } = {}) {
  const rows = new Map<string, TableRow & Record<string, unknown>>([[start.id, { ...start }]]);
  const notes: { to: string[]; title: string; body: string }[] = [];
  const at = (id: string, from: string, version: unknown) => {
    const r = rows.get(id);
    return r && r.status === from && (r.updated_at ?? null) === (version ?? null) ? r : null;
  };
  const store: TableStore = {
    async reopen(id, from, version, patch) {
      const r = at(id, from, version);
      if (!r) return { ok: false, taken: true };
      Object.assign(r, patch, { status: 'awaiting_approval', updated_at: tick() });
      return { ok: true, version: r.updated_at ?? null };
    },
    async claim(id, by, version) {
      const r = at(id, 'awaiting_approval', version);
      if (!r) return { ok: false, taken: true };
      const stamp = tick();
      Object.assign(r, { status: 'booking', approved_by: by, approved_at: stamp, updated_at: stamp });
      return { ok: true, claim: { how: 'status', at: stamp, by } };
    },
    async finish(id, claim, patch) {
      const r = rows.get(id);
      if (!r || r.status !== 'booking' || r.approved_at !== claim.at) return { row: null, error: null };
      Object.assign(r, patch, { updated_at: patch.updated_at ?? r.updated_at });
      return { row: { ...r }, error: null };
    },
    async write(id, from, version, patch) {
      const r = at(id, from, version);
      if (!r) return null;
      Object.assign(r, patch, { updated_at: tick() });
      return { ...r };
    },
    async callOpen() { return opts.callOpen === true; },
    async members() { return opts.members ?? ['u1', 'u2', 'u3']; },
    async notify(to, note) { notes.push({ to, title: note.title, body: note.body }); },
  };
  return { store, rows, notes, get: (id = start.id) => rows.get(id)! };
}

type Answer = BookingItemResult | (() => BookingItemResult | Promise<BookingItemResult>);
/** A table platform answering from fixtures built from its docs (no keys exist; nothing real is called). */
function platform(o: { quote?: Answer; book?: Answer; enabled?: boolean; name?: string } = {}) {
  const quotes: BookingItemRequest[] = [];
  const books: BookingItemRequest[] = [];
  const run = async (a: Answer | undefined, fallback: BookingItemResult) => (typeof a === 'function' ? a() : a ?? fallback);
  const p: BookingProvider = {
    vertical: 'restaurant', name: o.name ?? 'opentable',
    enabled: () => o.enabled !== false,
    async quote(req) {
      quotes.push(req);
      return run(o.quote, {
        vertical: 'restaurant', mode: 'native', status: 'quoted', provider: 'opentable', providerRef: 'lock_77',
        raw: { cancellationPolicy: 'Cancel by 5 PM the day before. A $25 per person no-show fee applies.', termsUrl: 'https://www.opentable.com/legal/terms' },
      });
    },
    async book(req) {
      books.push(req);
      return run(o.book, { vertical: 'restaurant', mode: 'native', status: 'confirmed', provider: 'opentable', providerRef: '4821', raw: { confirmationUrl: 'https://www.opentable.com/booking/4821' } });
    },
  };
  return { p, quotes, books };
}

const CLOSED: CallCheck = { ok: false, why: 'calls_off' };

function input(b: TableRow, over: Partial<ReserveInput> = {}): ReserveInput {
  return {
    booking: { ...b }, facts: facts(),
    plan: { id: 'p1', group_id: 'g1', solo: false, start_date: '2026-11-05', end_date: '2026-11-08' },
    requester: { id: 'u1', firstName: 'Maria', lastName: 'Lopez', email: 'maria@example.com', phone: '+19195550111' },
    chosen: {}, venue: { name: "Luigi's", phone: '(919) 555-0100', opening_hours: 'Mo-Su 11:00-22:00', lng: -78.64, reserveUrl: OT_LINK },
    now: NOW, ...over,
  };
}

function deps(store: TableStore, p: BookingProvider | null, call: CallCheck = CLOSED, over: Partial<ReserveDeps> = {}): ReserveDeps {
  return { instantFor: plat => (plat === 'opentable' ? p : null), callCheck: async () => call, store, call: null, ...over };
}

/** Quote first (terms shown), then book with the key: the two presses a person makes. */
async function bookWithTerms(m: ReturnType<typeof memory>, p: BookingProvider, over: Partial<ReserveInput> = {}) {
  const first = await reserveTable(input(m.get(), over), deps(m.store, p));
  assert.equal(first.ok === false && first.code, 'terms_required');
  const key = first.ok === false ? first.terms!.key : '';
  return reserveTable(input(m.get(), { ...over, chosen: { ...(over.chosen ?? {}), acceptTerms: key } }), deps(m.store, p));
}

// ── which way ───────────────────────────────────────────────────────────

test('a platform Reach books, with its keys set: instant, at the line\'s own night, with the own-account link beside it', () => {
  const v = decide(facts(), { instant: platform().p, call: CLOSED });
  assert.equal(v.path, 'instant');
  assert.match(v.what, /^Reach books Luigi's on OpenTable: Sat, Nov 7 at 7:30 PM for 4\./);
  assert.equal(v.ownAccount?.label, 'Book on your own OpenTable');
  assert.equal(v.ownAccount?.href, OT_LINK);
  assert.match(v.ownAccount?.perk ?? '', /Chase/);
  assert.ok(v.terms, 'the platform\'s terms are part of the answer');
  assert.match(v.terms!.statement, /before Reach books it/);
  // The own-account link is shown once, not again among the alternatives.
  assert.deepEqual(v.alternatives.map(a => a.kind), ['phone', 'confirm']);
});

test('no platform deal, the live gate open and a landline: Reach calls; otherwise the hand-off', () => {
  const call = decide(facts(), { instant: null, call: { ok: true } });
  assert.equal(call.path, 'call');
  assert.match(call.what, /It's booked only if they say yes on the call\./);
  assert.equal(call.terms, null);
  assert.deepEqual(call.alternatives.map(a => a.kind), ['phone', 'confirm']);

  const off = decide(facts(), { instant: null, call: CLOSED });
  assert.equal(off.path, 'handoff');
  assert.equal(off.ownAccount, null, 'the hand-off is the link; it is not shown twice');
  assert.deepEqual(off.alternatives.map(a => a.kind), ['link', 'phone', 'confirm']);
  assert.match(off.what, /Reach can't book Luigi's itself yet/);
  assert.doesNotMatch(off.what, /Reach books|Reach will book/);
});

test('instant comes with the call as the next option when both are open', () => {
  const v = decide(facts(), { instant: platform().p, call: { ok: true } });
  assert.deepEqual(v.alternatives.map(a => a.kind), ['call', 'phone', 'confirm']);
});

test('a provider without its keys is never offered, and nor is one for a platform the venue is not on', () => {
  assert.equal(usableTableProvider(platform({ enabled: false }).p), null);
  const noEnabled = { ...platform().p, enabled: undefined };
  assert.equal(usableTableProvider(noEnabled), null, 'no enabled() means not offered, never "try anyway"');
  assert.equal(decide(facts({ platform: 'none', reserveUrl: null }), { instant: platform().p, call: CLOSED }).path, 'handoff');
});

test('a line with no time is asked for one, never given seven o\'clock', () => {
  const v = decide(facts({ time: null }), { instant: platform().p, call: CLOSED });
  assert.deepEqual(v.needs, ['time']);
  assert.match(v.what, /^Pick a time, and Reach books/);
  assert.doesNotMatch(JSON.stringify(v), /7:00|19:00/);
});

test('every way in ends with "I\'ve got it", and a place we hold nothing for says so', () => {
  const v = decide(facts({ platform: 'none', phone: null, reserveUrl: null }), { instant: null, call: CLOSED });
  assert.equal(v.path, 'handoff');
  assert.deepEqual(v.alternatives.map(a => a.kind), ['confirm']);
  assert.match(v.what, /Reach doesn't hold a way to book Luigi's yet/);
});

test('the call check: only a live, approved gate and a +1 landline', async () => {
  const live = { RESERVATION_CALLS_MODE: 'live', RESERVATION_CALLS_LAWYER_APPROVED: 'yes', RETELL_API_KEY: 'k', RETELL_AGENT_ID: 'a', RETELL_FROM_NUMBER: '+19195550001' };
  const landline = async () => 'landline' as const;
  assert.deepEqual(await callCheck({}, '(919) 555-0100', landline), { ok: false, why: 'calls_off' });
  assert.deepEqual(await callCheck({ ...live, RESERVATION_CALLS_LAWYER_APPROVED: '' }, '(919) 555-0100', landline), { ok: false, why: 'calls_off' });
  assert.deepEqual(await callCheck({ ...live, RESERVATION_CALLS_MODE: 'test', RESERVATION_TEST_NUMBER: '+19195559999' }, '(919) 555-0100', landline),
    { ok: false, why: 'test_only' }, 'a test call books nothing, so it is never a way to get a table');
  assert.deepEqual(await callCheck(live, '(919) 555-0100', landline), { ok: true });
  assert.deepEqual(await callCheck(live, '(919) 555-0100', async () => 'mobile'), { ok: false, why: 'not_a_landline' });
  assert.deepEqual(await callCheck(live, '(919) 555-0100', null), { ok: false, why: 'landline_unverified' });
  assert.deepEqual(await callCheck(live, '+44 20 7946 0000', landline), { ok: false, why: 'not_north_american' });
  assert.deepEqual(await callCheck(live, null, landline), { ok: false, why: 'no_number' });
});

// ── instant ─────────────────────────────────────────────────────────────

test('instant: the terms are shown first and nothing is booked until they are accepted', async () => {
  const m = memory();
  const p = platform();
  const first = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(first.ok, false);
  assert.equal(first.ok === false && first.code, 'terms_required');
  assert.equal(first.ok === false && first.terms?.cancellationPolicy, 'Cancel by 5 PM the day before. A $25 per person no-show fee applies.');
  assert.equal(p.books.length, 0, 'nothing booked before the terms are accepted');
  assert.equal(m.get().status, 'awaiting_approval');
  // Asked for at the line's night, its time and the party.
  assert.equal(p.quotes[0].restaurant?.date, '2026-11-07');
  assert.equal(p.quotes[0].restaurant?.time, '19:30');
  assert.equal(p.quotes[0].party, 4);
  assert.deepEqual(p.quotes[0].travelers[0], { firstName: 'Maria', lastName: 'Lopez', email: 'maria@example.com', phone: '+19195550111' });
});

test('instant: confirmed only with the platform\'s reservation id, the hold handed back, the group told', async () => {
  const m = memory();
  const p = platform();
  const r = await bookWithTerms(m, p.p);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.outcome, 'confirmed');
  assert.equal(p.books.length, 1);
  assert.equal(p.books[0].restaurant?.holdRef, 'lock_77', 'the slot whose terms were shown is the one booked');
  const b = m.get();
  assert.equal(b.status, 'confirmed');
  assert.equal(b.provider_ref, '4821');
  assert.equal(b.mode, 'redirect', 'a table never becomes something Reach charges for');
  assert.equal(b.price_cents, 0);
  const mark = reserveMarkOf(b)!;
  assert.equal(mark.state, 'confirmed');
  assert.equal(mark.path, 'instant');
  assert.equal(mark.terms?.cancellationPolicy, 'Cancel by 5 PM the day before. A $25 per person no-show fee applies.');
  assert.equal(m.notes.length, 1);
  assert.deepEqual(m.notes[0].to, ['u1', 'u2', 'u3']);
  assert.equal(m.notes[0].title, 'Confirmed by OpenTable · ref 4821');
  assert.equal(m.notes[0].body, "Luigi's, Sat, Nov 7 at 7:30 PM for 4. It's on the group's plan.");
});

test('solo: the person alone is told, in the singular', async () => {
  const m = memory();
  const r = await bookWithTerms(m, platform().p, { plan: { id: 'p1', group_id: 'g1', solo: true, start_date: '2026-11-05', end_date: '2026-11-08' }, facts: facts({ solo: true }) });
  assert.equal(r.ok, true);
  assert.deepEqual(m.notes[0].to, ['u1']);
  assert.match(m.notes[0].body, /It's on your plan\.$/);
});

test('"confirmed" with no reservation id is not confirmed: it is in doubt and never tried again', async () => {
  const m = memory();
  const p = platform({ book: { vertical: 'restaurant', mode: 'native', status: 'confirmed', provider: 'opentable' } });
  const r = await bookWithTerms(m, p.p);
  assert.equal(r.ok === false && r.code, 'outcome_unknown');
  assert.equal(m.get().status, 'booking', 'left mid-claim, not failed: failed would let it be booked twice');
  assert.equal(reserveMarkOf(m.get())?.state, 'in_doubt');
  const again = await reserveTable(input(m.get(), { chosen: { acceptTerms: 'anything' } }), deps(m.store, p.p));
  assert.equal(again.ok === false && again.code, 'outcome_unknown');
  assert.equal(p.books.length, 1, 'never sent a second time');
});

test('no answer from the platform after the order went: in doubt, not failed, not retried', async () => {
  const m = memory();
  const p = platform({ book: () => { throw new OutcomeUnknown('timeout'); } });
  const r = await bookWithTerms(m, p.p);
  assert.equal(r.ok === false && r.code, 'outcome_unknown');
  assert.equal(m.get().status, 'booking');
  assert.match(String(m.get().error), /^outcome unknown/);
  assert.equal(r.ok === false && r.alternatives.length, 0, 'no other way offered while it may be booked');
});

test('never double-books: two presses at the same moment reach the platform once', async () => {
  const m = memory();
  let release!: () => void;
  const gate = new Promise<void>(res => { release = res; });
  let hold = false;
  const p = platform({ book: async () => { if (hold) await gate; return { vertical: 'restaurant', mode: 'native', status: 'confirmed', provider: 'opentable', providerRef: '4821' }; } });
  const shown = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(shown.ok === false && shown.code, 'terms_required');
  const key = shown.ok === false ? shown.terms!.key : '';
  hold = true;
  const snapshot = m.get();
  const a = reserveTable(input(snapshot, { chosen: { acceptTerms: key } }), deps(m.store, p.p));
  const b = reserveTable(input(snapshot, { chosen: { acceptTerms: key } }), deps(m.store, p.p));
  await new Promise(r => setTimeout(r, 5));
  release();
  const results = await Promise.all([a, b]);
  assert.equal(p.books.length, 1);
  assert.equal(results.filter(r => r.ok).length, 1);
  const loser = results.find(r => !r.ok);
  assert.equal(loser?.ok === false && loser.code, 'in_progress');
  assert.equal(m.notes.length, 1);
});

test('idempotent: a table already confirmed answers the same, and nothing is sent again', async () => {
  const m = memory();
  const p = platform();
  await bookWithTerms(m, p.p);
  const again = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(again.ok && again.already, true);
  assert.equal(again.ok && again.outcome, 'confirmed');
  assert.equal(p.books.length, 1);
  assert.equal(p.quotes.length, 2, 'not even quoted again');
});

test('terms that changed between the screen and the booking are shown again, and nothing is booked', async () => {
  const m = memory();
  let policy = 'Free cancellation.';
  const p = platform({ quote: () => ({ vertical: 'restaurant', mode: 'native', status: 'quoted', provider: 'opentable', providerRef: 'lock_1', raw: { cancellationPolicy: policy } }) });
  const shown = await reserveTable(input(m.get()), deps(m.store, p.p));
  const key = shown.ok === false ? shown.terms!.key : '';
  policy = '$50 per person if cancelled within 24 hours.';
  const r = await reserveTable(input(m.get(), { chosen: { acceptTerms: key } }), deps(m.store, p.p));
  assert.equal(r.ok === false && r.code, 'terms_required');
  assert.match(r.ok === false ? r.error : '', /terms for this table changed/);
  assert.equal(p.books.length, 0);
});

test('another time offered: nothing booked, the row says so, and taking it books that time', async () => {
  const m = memory();
  const noTable: BookingItemResult = { vertical: 'restaurant', mode: 'native', status: 'failed', provider: 'opentable', error: 'No availability', raw: { offeredTimes: ['21:00', '18:15', 'soon'] } };
  let first = true;
  const p = platform({ quote: () => (first ? (first = false, noTable) : { vertical: 'restaurant', mode: 'native', status: 'quoted', provider: 'opentable', providerRef: 'lock_9', raw: {} }) });
  const r = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(r.ok === false && r.code, 'other_time');
  assert.deepEqual(r.ok === false && r.offeredTimes, ['21:00', '18:15']);
  assert.equal(m.get().status, 'awaiting_approval');
  assert.deepEqual(reserveMarkOf(m.get())?.offeredTimes, ['21:00', '18:15']);
  assert.equal(m.notes[0].title, 'No 7:30. OpenTable offered 9:00. Take it?');
  assert.equal(p.books.length, 0);

  const took = await bookWithTerms(m, p.p, { chosen: { time: '21:00' } });
  assert.equal(took.ok && took.outcome, 'confirmed');
  assert.equal(p.books[0].restaurant?.time, '21:00');
  assert.equal(reserveMarkOf(m.get())?.time, '21:00');
});

test('no table and nothing offered: failed with the reason, and the next options with it', async () => {
  const m = memory();
  const p = platform({ quote: { vertical: 'restaurant', mode: 'native', status: 'failed', provider: 'opentable', error: 'No availability', raw: {} } });
  const r = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(r.ok === false && r.code, 'unavailable');
  assert.deepEqual(r.ok === false && r.alternatives.map(a => a.kind), ['link', 'phone', 'confirm']);
  assert.match(r.ok === false ? r.error : '', /^Not booked\. Luigi's has no table on OpenTable Sat, Nov 7 at 7:30 PM for 4\. Next: book it on OpenTable or call them on \(919\) 555-0100/);
  assert.equal(m.get().status, 'failed');
  assert.equal(reserveMarkOf(m.get())?.state, 'failed');
  assert.equal(m.notes.length, 1);
});

test('a deposit or a card hold is handed off: Reach holds nobody\'s money for a table', async () => {
  for (const raw of [{ depositCents: 2500, reserveUrl: 'https://www.opentable.com/booking/deposit/77' }, { cardRequired: true }]) {
    const m = memory();
    const p = platform({ quote: { vertical: 'restaurant', mode: 'native', status: 'quoted', provider: 'opentable', providerRef: 'lock_d', raw } });
    const r = await reserveTable(input(m.get(), { chosen: { acceptTerms: 'x' } }), deps(m.store, p.p));
    assert.equal(r.ok && r.outcome, 'handed_off');
    assert.equal(p.books.length, 0);
    assert.equal(m.get().status, 'redirected');
    assert.equal(m.get().redirect_url, 'depositCents' in raw ? raw.reserveUrl : OT_LINK);
    assert.match(r.ok ? r.title : '', 'depositCents' in raw ? /asks for a \$25\.00 deposit, so Reach won't hold it/ : /wants a card on file/);
  }
  // And nothing in reserve reaches Stripe.
  const code = readFileSync('lib/reservations/reserve.ts', 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /stripe|paymentIntent|contributions/i);
});

test('nothing is asked for that nobody gave: no time, a night off the trip, a night gone, a name missing', async () => {
  const m = memory();
  const p = platform();
  const noTime = await reserveTable(input(m.get(), { facts: facts({ time: null }) }), deps(m.store, p.p));
  assert.equal(noTime.ok === false && noTime.code, 'missing_facts');
  assert.deepEqual(noTime.ok === false && noTime.missing, ['time']);
  const off = await reserveTable(input(m.get(), { facts: facts({ date: '2026-11-20' }) }), deps(m.store, p.p));
  assert.equal(off.ok === false && off.code, 'date_outside_trip');
  const gone = await reserveTable(input(m.get(), { facts: facts({ date: '2026-11-03' }), plan: { id: 'p1', group_id: 'g1', solo: false, start_date: '2026-11-01', end_date: '2026-11-08' } }), deps(m.store, p.p));
  assert.equal(gone.ok === false && gone.code, 'date_past');
  const tooSoon = await reserveTable(input(m.get(), { facts: facts({ date: '2026-11-04', time: '12:00' }), plan: { id: 'p1', group_id: 'g1', solo: false, start_date: '2026-11-04', end_date: '2026-11-08' } }), deps(m.store, p.p));
  assert.equal(tooSoon.ok === false && tooSoon.code, 'time_past');
  const nameless = await reserveTable(input(m.get(), { requester: { id: 'u1', firstName: 'Maria', lastName: null, email: 'maria@example.com', phone: null } }), deps(m.store, p.p));
  assert.equal(nameless.ok === false && nameless.code, 'details_missing');
  assert.deepEqual(nameless.ok === false && nameless.missing, ['last name', 'phone number']);
  assert.equal(p.quotes.length, 0, 'the platform was never asked');
});

test('a time the person picked is used when the line has none', async () => {
  const m = memory();
  const p = platform();
  await reserveTable(input(m.get(), { facts: facts({ time: null }), chosen: { time: '20:15' } }), deps(m.store, p.p));
  assert.equal(p.quotes[0].restaurant?.time, '20:15');
});

// ── never over somebody else ────────────────────────────────────────────

test('a call ringing now refuses an instant booking, even when its mark was never written', async () => {
  const calling = memory(row({ status: 'pending', response_payload: { reserve: { state: 'calling', path: 'call', time: '19:30', partySize: 4 } } }));
  const p = platform();
  const r = await reserveTable(input(calling.get()), deps(calling.store, p.p));
  assert.equal(r.ok === false && r.code, 'calling');
  const unmarked = memory(row({ status: 'pending', response_payload: {} }), { callOpen: true });
  const r2 = await reserveTable(input(unmarked.get(), { chosen: { notBookedElsewhere: true } }), deps(unmarked.store, p.p));
  assert.equal(r2.ok === false && r2.code, 'calling');
  assert.equal(p.quotes.length, 0);
});

test('a table handed to them is not booked over without asking; one they said they got is never booked', async () => {
  const p = platform();
  const handed = memory(row({ status: 'redirected' }));
  const ask = await reserveTable(input(handed.get()), deps(handed.store, p.p));
  assert.equal(ask.ok === false && ask.code, 'ask_first');
  const got = memory(row({ status: 'redirected', confirmation_number: 'ABC123' }));
  const no = await reserveTable(input(got.get(), { chosen: { notBookedElsewhere: true } }), deps(got.store, p.p));
  assert.equal(no.ok === false && no.code, 'booked_elsewhere');
  assert.match(no.ok === false ? no.error : '', /you entered ABC123/);
  // Said they have not: Reach books it, from the handed-over row.
  const ok = await bookWithTerms(handed, p.p, { chosen: { notBookedElsewhere: true } });
  assert.equal(ok.ok && ok.outcome, 'confirmed');
  assert.equal(p.books.length, 1);
});

test('a row somebody changed meanwhile is not booked over', async () => {
  const m = memory();
  const p = platform();
  const shown = await reserveTable(input(m.get()), deps(m.store, p.p));
  const stale = { ...m.get() };
  m.get().updated_at = tick(); // somebody else wrote to it
  const r = await reserveTable(input(stale, { chosen: { acceptTerms: shown.ok === false ? shown.terms!.key : '' } }), deps(m.store, p.p));
  assert.equal(r.ok === false && r.code, 'in_progress');
  assert.equal(p.books.length, 0);
});

test('a failed table is reopened for the next option, on its version only', async () => {
  const m = memory(row({ status: 'failed', response_payload: { reserve: { state: 'failed', path: 'instant', reason: 'No table.' } } }));
  const p = platform();
  const r = await bookWithTerms(m, p.p, { chosen: { time: '18:00' } });
  assert.equal(r.ok && r.outcome, 'confirmed');
  assert.equal(m.get().status, 'confirmed');
});

// ── the call path ───────────────────────────────────────────────────────

/** The calls' own store, writing to the same bookings table. */
function callStore(m: ReturnType<typeof memory>): CallStore {
  const calls: CallRow[] = [];
  return {
    async anyUndisclosed() { return { ok: true, value: false }; },
    async onDoNotCall() { return { ok: true, value: false }; },
    async callFor(id, mode) { return { ok: true, value: calls.find(c => c.booking_id === id && c.mode === mode) ?? null }; },
    async claim(r) { const c = { ...r, id: `c${calls.length + 1}`, day_slot: 1, status: 'placing', outcome: null, provider_call_id: null } as CallRow; calls.push(c); return { ok: true, row: c }; },
    async markPlaced() { return true; },
    async markUnknown() { return true; },
    async release() { return true; },
    async find() { return { ok: true, value: null }; },
    async settleOnce() { return { ok: true, value: null }; },
    async addDoNotCall() { return true; },
    async moveBooking(id, from, to) {
      const b = m.rows.get(id)!;
      if (!from.includes(b.status)) return false;
      const { mark, ...cols } = to;
      Object.assign(b, cols, mark ? { response_payload: { ...(b.response_payload as object), reserve: mark } } : {}, { updated_at: tick() });
      return true;
    },
    async planMembers() { return ['u1', 'u2']; },
    async notify() { /* the call's own words; tested in reservation-call.test.ts */ },
  };
}

const LIVE = { RESERVATION_CALLS_MODE: 'live', RESERVATION_CALLS_LAWYER_APPROVED: 'yes', RETELL_API_KEY: 'k', RETELL_AGENT_ID: 'a', RETELL_FROM_NUMBER: '+19195550001' };

test('call: Reach rings, the row is pending and marked "calling" (never booked), and an instant booking is then refused', async () => {
  const m = memory();
  const placed: string[] = [];
  const d = deps(m.store, null, { ok: true }, {
    call: {
      env: LIVE, store: callStore(m), lookup: async () => 'landline',
      provider: () => ({ name: 'retell', async place(a) { placed.push(a.to); return { ok: true, providerCallId: 'call_1' }; }, verify: () => true, parse: () => null }),
    },
  });
  const r = await reserveTable(input(m.get()), d);
  assert.equal(r.ok && r.outcome, 'calling');
  assert.match(r.ok ? r.title : '', /^Reach is calling Luigi's to ask for 7:30 for 4\.$/);
  assert.deepEqual(placed, ['+19195550100']);
  assert.equal(m.get().status, 'pending');
  assert.equal(m.get().detail, "Luigi's", 'the name stays the booking\'s title');
  assert.equal(reserveMarkOf(m.get())?.state, 'calling');

  const p = platform();
  const instant = await reserveTable(input(m.get(), { chosen: { path: 'instant', notBookedElsewhere: true } }), deps(m.store, p.p));
  assert.equal(instant.ok === false && instant.code, 'calling');
  assert.equal(p.quotes.length, 0);
});

test('call refused by its own rules: the hand-off is the answer, on screen with it', async () => {
  const m = memory();
  const d = deps(m.store, null, { ok: true }, {
    call: { env: LIVE, store: callStore(m), lookup: async () => 'landline', provider: () => { throw new Error('must not ring'); } },
  });
  const r = await reserveTable(input(m.get(), { venue: { name: "Luigi's", phone: '(919) 555-0100', opening_hours: 'Mo-Su 23:00-23:30', lng: -78.64, reserveUrl: OT_LINK } }), d);
  assert.equal(r.ok === false && r.code, 'call_refused');
  assert.equal(r.ok === false && r.refusal, 'closed_now');
  assert.deepEqual(r.ok === false && r.alternatives.map(a => a.kind), ['link', 'phone', 'confirm']);
  assert.equal(m.get().status, 'awaiting_approval');
});

test('asking for the call while it is shut is refused, with the other ways', async () => {
  const m = memory();
  const r = await reserveTable(input(m.get(), { chosen: { path: 'call' } }), deps(m.store, null));
  assert.equal(r.ok === false && r.code, 'path_unavailable');
  assert.ok(r.ok === false && r.alternatives.some(a => a.kind === 'link'));
});

// ── the hand-off ────────────────────────────────────────────────────────

test('hand-off: the row is handed over with the line\'s night, no reference invented, nothing charged', async () => {
  const m = memory();
  const r = await reserveTable(input(m.get()), deps(m.store, null));
  assert.equal(r.ok && r.outcome, 'handed_off');
  assert.equal(r.ok && r.href, OT_LINK);
  const b = m.get();
  assert.equal(b.status, 'redirected');
  assert.equal(b.provider_ref, null);
  assert.equal(b.mode, 'redirect');
  assert.deepEqual(r.ok && r.alternatives.map(a => a.kind), ['phone', 'confirm'], 'the link is the answer; not repeated');
  const again = await reserveTable(input(m.get()), deps(m.store, null));
  assert.equal(again.ok && again.already, true);
});

// ── reading the platform ────────────────────────────────────────────────

test('a quote\'s terms are read defensively and keyed, so a change is a different key', () => {
  const q = tableQuoteOf({ offeredTimes: ['9:00', '21:00', 'later'], depositCents: '2500', termsUrl: 'http://not-https', cancellationPolicy: ' Cancel by noon. ' });
  assert.deepEqual(q.offeredTimes, ['09:00', '21:00']);
  assert.equal(q.depositCents, 2500);
  assert.equal(q.termsUrl, null);
  assert.equal(q.cancellationPolicy, 'Cancel by noon.');
  const a = termsKey('opentable', '2026-11-07', '19:30', 4, q);
  assert.equal(a, termsKey('opentable', '2026-11-07', '19:30', 4, { ...q }));
  assert.notEqual(a, termsKey('opentable', '2026-11-07', '19:30', 4, { ...q, cancellationPolicy: 'Cancel by 5.' }));
  assert.notEqual(a, termsKey('opentable', '2026-11-07', '19:30', 5, q));
});

test('checkout reads a table\'s two new answers as things to ask, not failures', () => {
  const terms = approveOutcome(409, { code: 'terms_required', error: "Read OpenTable's terms, then book it.", terms: { key: 't1', platformName: 'OpenTable' } });
  assert.equal(terms.kind, 'terms');
  assert.equal(terms.terms?.key, 't1');
  assert.equal(nextStepFor(terms, 'restaurant'), 'answer');
  const other = approveOutcome(409, { code: 'other_time', offeredTimes: ['21:00'] });
  assert.equal(other.kind, 'otherTime');
  assert.deepEqual(other.offeredTimes, ['21:00']);
});

test('approval sends a table through reserve, before any money is looked at', () => {
  const src = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  const branch = src.indexOf("if (vertical === 'restaurant') return approveTable(");
  assert.ok(branch > 0, 'approval does not route tables through reserve');
  assert.ok(branch < src.indexOf('// ── 3. The money'), 'a table must not reach the funding check');
  assert.ok(branch < src.indexOf('// ── 1. Who is on it'));
});

// ── what the next-step card says ────────────────────────────────────────

const HOTEL = { id: 'b-hotel', vertical: 'hotel', status: 'confirmed', price_cents: 60000, mode: 'native', provider: 'liteapi', itinerary_item_id: 'l-hotel', detail: 'The Gonzo Inn' } as NextBooking;
const tableRow = (over: Partial<NextBooking> = {}) => ({
  id: 'b1', vertical: 'restaurant', status: 'awaiting_approval', mode: 'redirect', provider: 'opentable', redirect_url: OT_LINK,
  itinerary_item_id: 'l-dinner', detail: "Luigi's", response_payload: { phone: '(919) 555-0100' }, ...over,
}) as NextBooking;
const DINNER = { id: 'l-dinner', type: 'restaurant', title: 'Dinner', venue_name: "Luigi's", booking_mode: 'ahead' };
function na(bookings: NextBooking[], over: Partial<NextActionInput> = {}) {
  return getNextAction({
    plan: { id: 'p1', groupId: 'g1', status: 'approved', type: 'trip', title: 'Raleigh', destStyle: 'fixed', hasOptions: false, createdBy: 'u1',
      itinerary: [{ id: 'l-hotel', type: 'hotel', title: 'Hotel', booking_mode: 'reach' }, DINNER] as never },
    bookings: [HOTEL, ...bookings], funding: { memberCount: 3, targetCents: 60000, collectedCents: 60000, funded: true, myPaidCents: 20000, myRemainingCents: 0 },
    readiness: null, essentials: null, memberCount: 3, me: 'u1', now: NOW, ...over,
  })!;
}

test('next step: a table on a call is "booking in progress", in words that never say booked', () => {
  const a = na([tableRow({ status: 'pending', response_payload: { reserve: { state: 'calling', path: 'call', time: '19:30', partySize: 4 } } })]);
  assert.equal(a.state, 'booking_in_progress');
  assert.equal(a.title, "Reach is calling Luigi's");
  assert.equal(a.body, 'Asking for 7:30 for 4. Nothing is booked until they say yes — the group will see their answer here.');
  assert.equal(a.cta, null);
  assert.notEqual(a.state, 'finish_elsewhere', 'it used to say "Finish on OpenTable" while Reach was calling');
  const solo = na([tableRow({ status: 'pending', response_payload: { reserve: { state: 'calling', path: 'call', time: '19:30', partySize: 1 } } })], { memberCount: 1 });
  assert.match(solo.body ?? '', /you'll see their answer here/);
});

test('next step: another time offered is "needs attention" with "Take 9:00?"', () => {
  const a = na([tableRow({ response_payload: { reserve: { state: 'offered', path: 'instant', platform: 'opentable', time: '19:30', offeredTimes: ['21:00'] } } })]);
  assert.equal(a.state, 'needs_attention');
  assert.equal(a.title, "No 7:30. Luigi's offered 9:00");
  assert.deepEqual(a.cta, { label: 'Take 9:00?', kind: 'reserve', bookingId: 'b1', path: 'instant', time: '21:00' });
  assert.equal(a.secondary?.kind, 'link');
  // Offered on a call: the person takes it, by ringing them.
  const call = na([tableRow({ response_payload: { phone: '(919) 555-0100', reserve: { state: 'offered', path: 'call', time: '19:30', offeredTimes: ['21:00'] } } })]);
  assert.deepEqual(call.cta, { label: 'Take 9:00?', kind: 'link', href: 'tel:9195550100' });
  assert.match(call.body ?? '', /Reach only asked, so nothing is booked/);
});

test('next step: a table that was not booked says why, with the next option already there', () => {
  const failed = na([tableRow({ status: 'failed', error: 'No availability', response_payload: { reserve: { state: 'failed', path: 'instant', reason: "Luigi's has no table on OpenTable Sat, Nov 7 at 7:30 PM for 4." } } })]);
  assert.equal(failed.state, 'needs_attention');
  assert.equal(failed.title, "Luigi's isn't booked");
  assert.equal(failed.cta?.kind, 'link');
  assert.equal(failed.secondary?.kind, 'confirm');
  const thenCall = na([tableRow({ status: 'failed', response_payload: { reserve: { state: 'failed', path: 'instant' } } })], { reservations: [{ bookingId: 'b1', path: 'call' }] });
  assert.deepEqual(thenCall.cta, { label: 'Ask Reach to call →', kind: 'reserve', bookingId: 'b1', path: 'call' });
});

test('next step: a table Reach can book is offered as Reach\'s to book, a confirmed one is booked, a hand-off is still the hand-off', () => {
  const ready = na([tableRow()], { reservations: [{ bookingId: 'b1', path: 'instant', what: "Reach books Luigi's on OpenTable." }] });
  assert.equal(ready.state, 'ready_to_book');
  assert.deepEqual(ready.cta, { label: 'Book it →', kind: 'reserve', bookingId: 'b1', path: 'instant' });
  const handoff = na([tableRow()], { reservations: [{ bookingId: 'b1', path: 'handoff' }] });
  assert.equal(handoff.state, 'finish_elsewhere');
  const booked = na([tableRow({ status: 'confirmed', provider_ref: '4821', response_payload: { reserve: { state: 'confirmed', path: 'instant', ref: '4821' } } })]);
  assert.equal(booked.state, 'booked');
  assert.equal(booked.allBooked, true);
});

test('next step: a table that may have gone through is never offered again', () => {
  const a = na([tableRow({ status: 'booking', error: 'outcome unknown: timeout', response_payload: { reserve: { state: 'in_doubt', path: 'instant' } } })]);
  assert.equal(a.state, 'needs_attention');
  assert.match(a.title, /can't tell yet whether Luigi's is booked/);
  assert.equal(a.cta?.kind, 'link');
  assert.match(a.cta && a.cta.kind === 'link' ? a.cta.href : '', /^mailto:/);
});

test('"Book it" has the tables to send to approval, kept apart from what is paid for', () => {
  const s = checkoutState([
    { id: 'b-hotel', vertical: 'hotel', status: 'awaiting_approval', mode: 'native', provider: 'liteapi', price_cents: 60000, detail: 'Hotel' },
    { id: 'b1', vertical: 'restaurant', status: 'awaiting_approval', mode: 'redirect', provider: 'opentable', price_cents: 0, detail: "Luigi's" },
    { id: 'b2', vertical: 'restaurant', status: 'confirmed', mode: 'redirect', provider: 'opentable', detail: "Poole's" },
  ] as never);
  assert.deepEqual(s.waiting.map(r => r.id), ['b-hotel']);
  assert.deepEqual(s.tables.map(r => r.id), ['b1']);
  assert.equal(s.totalCents, 60000, 'a table adds nothing to what anybody pays');
});
