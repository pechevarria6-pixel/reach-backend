// How Reach reserves a table (lib/reservations/reserve.ts): which way, what
// it says, every path, and the never-double-book rule — with the instant path
// running through the table platforms' own steps (lib/booking/tables/flow.ts)
// against a fake platform shaped like lib/booking/tables/types.ts
// TableProvider. Nothing real is called: no keys exist.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decide, reserveTable, callCheck,
  type TableFacts, type TableRow, type TableStore, type ReserveInput, type ReserveDeps, type CallCheck, type InstantTable,
} from '../../lib/reservations/reserve.ts';
import { reserveMarkOf } from '../../lib/reservations/reserve-state.ts';
import { OutcomeUnknown, type BookingItemResult } from '../../lib/booking/types.ts';
import { pickTable } from '../../lib/booking/tables/pick.ts';
import { readSlots, quoteWith } from '../../lib/booking/tables/steps.ts';
import type { Openings, HoldResult, OpeningsAsk, StatusResult, TableHold, TableProvider, TableRefusal } from '../../lib/booking/tables/types.ts';
import type { TableStore as FlowStore } from '../../lib/booking/tables/flow.ts';
import { openTableReservations } from '../../lib/booking/providers/tables.opentable.ts';
import { yelpReservations } from '../../lib/booking/providers/tables.yelp.ts';
import { reachBuys, reachBooked } from '../../lib/booking/charged.ts';
import { midClaim } from '../../lib/booking/claim.ts';
import { approveOutcome, nextStepFor } from '../../lib/booking/approve-outcome.ts';
import type { Store as CallStore, CallRow } from '../../lib/reservations/call.ts';
import { getNextAction, type NextActionInput, type NextBooking } from '../../lib/next-action.ts';
import { checkoutState } from '../../lib/checkout.ts';
import { lineAt, lineWhen } from '../../lib/line-when.ts';

// ── fixtures ────────────────────────────────────────────────────────────
// 13:00 in Raleigh by the longitude estimate: the dinner is three nights off.
const NOW = new Date('2026-11-04T18:00:00Z');
const OT_LINK = 'https://www.opentable.com/r/luigis-raleigh?covers=4&dateTime=2026-11-07T19%3A30';
const OT_PROFILE = 'https://www.opentable.com/restaurant/profile/1038007/reserve';
const POLICY = 'Cancel by 5 PM the day before. A $25 per person no-show fee applies.';

function facts(over: Partial<TableFacts> = {}): TableFacts {
  return {
    bookingId: 'b1', itemId: 'l-dinner', restaurant: "Luigi's", city: 'Raleigh', platform: 'opentable',
    date: '2026-11-07', time: '19:30', partySize: 4, phone: '(919) 555-0100', reserveUrl: OT_LINK,
    urls: [OT_PROFILE, OT_LINK], solo: false,
    ...over,
  };
}

let clock = 0;
const tick = () => new Date(Date.UTC(2026, 10, 4, 18, 0, 0, ++clock)).toISOString();

function row(over: Partial<TableRow> = {}): TableRow {
  return {
    id: 'b1', plan_id: 'p1', vertical: 'restaurant', mode: 'redirect', provider: 'restaurant_handoff', status: 'awaiting_approval',
    redirect_url: OT_LINK, updated_at: '2026-11-04T17:00:00.000Z', approved_at: null,
    request_payload: { party: 4, restaurant: { name: "Luigi's", city: 'Raleigh', date: '2026-11-07', time: '19:30', partySize: 4, platform: 'opentable' } },
    response_payload: { platform: 'opentable', phone: '(919) 555-0100' },
    ...over,
  };
}

/** The bookings table, in memory, keeping the database's conditional-write rules. */
function memory(start: TableRow = row(), opts: { members?: string[]; callOpen?: boolean; lines?: Record<string, string | null> } = {}) {
  const rows = new Map<string, TableRow & Record<string, unknown>>([[start.id, { ...start }]]);
  const lines = new Map<string, string | null>(Object.entries(opts.lines ?? {}));
  const notes: { to: string[]; title: string; body: string }[] = [];
  const at = (id: string, from: string, version: unknown) => {
    const r = rows.get(id);
    return r && r.status === from && (r.updated_at ?? null) === (version ?? null) ? r : null;
  };
  const flow: FlowStore = {
    async write(id, version, patch) {
      await new Promise(res => setTimeout(res, 1));
      const r = rows.get(id);
      if (!r || (r.updated_at ?? null) !== (version ?? null)) return { ok: false, taken: true };
      const v = tick();
      // The database stores exactly what was sent: a claim's stamp (approved_at = updated_at) stays a stamp.
      const stampKept = patch.approved_at !== undefined && patch.approved_at === patch.updated_at;
      Object.assign(r, patch, { updated_at: v }, stampKept ? { approved_at: v } : {});
      return { ok: true, version: v };
    },
  };
  const store: TableStore = {
    async reopen(id, from, version, patch) {
      const r = at(id, from, version);
      if (!r) return { ok: false, taken: true };
      Object.assign(r, patch, { status: 'awaiting_approval', updated_at: tick() });
      return { ok: true, version: r.updated_at ?? null };
    },
    async write(id, from, version, patch) {
      const r = at(id, from, version);
      if (!r) return null;
      Object.assign(r, patch, { updated_at: tick() });
      return { ...r };
    },
    flow,
    async callOpen() { return opts.callOpen === true; },
    async retime(itemId, from, to) {
      if (!lines.has(itemId) || lines.get(itemId) !== from) return false;
      lines.set(itemId, to);
      return true;
    },
    async members() { return opts.members ?? ['u1', 'u2', 'u3']; },
    async notify(to, note) { notes.push({ to, title: note.title, body: note.body }); },
  };
  return { store, rows, notes, lines, get: (id = start.id) => rows.get(id)! };
}

type Fn<A, R> = R | ((a: A) => R | Promise<R>);
const run = async <A, R>(x: Fn<A, R> | undefined, a: A, fallback: () => R): Promise<R> =>
  x === undefined ? fallback() : typeof x === 'function' ? (x as (a: A) => R | Promise<R>)(a) : x;

/**
 * A table platform shaped like Yelp's and OpenTable's providers: openings,
 * a five-minute hold with the restaurant's policy and the platform's terms,
 * reserve confirmed only with its reservation id.
 */
function platform(o: {
  enabled?: boolean;
  canModify?: boolean;
  openings?: Fn<OpeningsAsk, Openings>;
  hold?: Fn<OpeningsAsk, HoldResult>;
  reserve?: Fn<TableHold, BookingItemResult | TableRefusal>;
  status?: StatusResult;
} = {}) {
  const calls = { openings: [] as OpeningsAsk[], holds: [] as OpeningsAsk[], reserves: [] as { hold: TableHold; firstName: string }[], modifies: [] as string[], status: 0 };
  let n = 0;
  const p: TableProvider = {
    vertical: 'restaurant', name: 'opentable', platform: 'opentable', canModify: o.canModify !== false,
    enabled: () => o.enabled !== false,
    allows: () => true,
    venueIdFrom: urls => (urls.some(u => /opentable\.com\/restaurant\/profile\/1038007/.test(u ?? '')) ? '1038007' : null),
    async openings(_venueId, ask) {
      calls.openings.push(ask);
      return run(o.openings, ask, () => ({ ok: true, slots: [{ date: ask.date, time: ask.time, needsCard: false, handoffUrl: null }] }));
    },
    async hold(venueId, ask) {
      calls.holds.push(ask);
      return run(o.hold, ask, () => ({
        ok: true,
        hold: {
          platform: 'opentable', venueId, holdId: `lock_${++n}`, date: ask.date, time: ask.time, covers: ask.covers,
          expiresAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
          cancellationPolicy: POLICY, policies: ['15-minute grace period.'],
          terms: { text: "By clicking 'Complete reservation' you agree to the OpenTable Terms of Use and Privacy Policy", links: [], version: 'ot-terms-1' },
          fee: null, editable: true, cancelBy: null, notes: null, handoffUrl: null,
        },
      }));
    },
    async release() { /* nothing held to let go in a fake */ },
    async reserve(hold, guest) {
      calls.reserves.push({ hold, firstName: guest.firstName });
      return run(o.reserve, hold, () => ({ vertical: 'restaurant', mode: 'native', status: 'confirmed', provider: 'opentable', providerRef: '1038007-4821', redirectUrl: 'https://www.opentable.com/booking/4821' }));
    },
    async modify(ref, hold) {
      calls.modifies.push(ref);
      return { vertical: 'restaurant', mode: 'native', status: 'confirmed', provider: 'opentable', providerRef: '1038007-4821', redirectUrl: 'https://www.opentable.com/booking/4821', raw: { movedTo: hold.time } };
    },
    async status() { calls.status++; return o.status ?? { ok: false, code: 'platform_down', error: 'no answer' }; },
    async cancel() { return { status: 'quoted', refundCents: 0 }; },
    async quote() { throw new Error('reserve never quotes'); },
    async book() { throw new Error('reserve never books through book()'); },
  };
  const total = () => calls.openings.length + calls.holds.length + calls.reserves.length + calls.modifies.length + calls.status;
  return { p, calls, total, instant: { provider: p, venueId: '1038007' } as InstantTable };
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

function deps(store: TableStore, p: TableProvider | null, call: CallCheck = CLOSED, over: Partial<ReserveDeps> = {}): ReserveDeps {
  return {
    instantFor: urls => (p ? pickTable([p], urls) : null),
    bookedOn: name => (p && name === p.platform ? p : null),
    callCheck: async () => call, store, call: null, ...over,
  };
}

const ACCEPT = { terms: 'ot-terms-1', policy: true };

/** Press one (held, terms shown), then press two with the hold and what was accepted: what a person does. */
async function bookWithTerms(m: ReturnType<typeof memory>, p: TableProvider, over: Partial<ReserveInput> = {}) {
  const first = await reserveTable(input(m.get(), over), deps(m.store, p));
  assert.equal(first.ok === false && first.code, 'terms_required', first.ok === false ? first.error : 'booked on the first press');
  const holdId = first.ok === false ? first.hold!.holdId : '';
  return reserveTable(input(m.get(), { ...over, chosen: { ...(over.chosen ?? {}), holdId, accept: ACCEPT } }), deps(m.store, p));
}

// ── which way ───────────────────────────────────────────────────────────

test('a platform Reach books, with its keys set: instant, at the line\'s own night, with the own-account link beside it', () => {
  const v = decide(facts(), { instant: platform().instant, call: CLOSED });
  assert.equal(v.path, 'instant');
  assert.match(v.what, /^Reach books Luigi's on OpenTable: Sat, Nov 7 at 7:30 PM for 4\./);
  assert.equal(v.ownAccount?.label, 'Book on your own OpenTable');
  assert.equal(v.ownAccount?.href, OT_LINK);
  assert.match(v.ownAccount?.perk ?? '', /Chase/);
  assert.ok(v.terms, 'what is shown before booking is part of the answer');
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
  const v = decide(facts(), { instant: platform().instant, call: { ok: true } });
  assert.deepEqual(v.alternatives.map(a => a.kind), ['call', 'phone', 'confirm']);
});

test('credentials absent: the platform is never offered and never called; an id comes only from a link we hold', async () => {
  const off = platform({ enabled: false });
  assert.equal(pickTable([off.p], [OT_PROFILE]), null);
  assert.equal(pickTable([platform().p], [OT_LINK]), null, 'a name page is not an id');
  // The real platforms with no keys set offer nothing, for any link (the registry's tableProviderFor is this pick).
  assert.equal(pickTable([openTableReservations, yelpReservations], [OT_PROFILE, 'https://www.yelp.com/reservations/victors'], {} as NodeJS.ProcessEnv), null);
  const m = memory();
  const r = await reserveTable(input(m.get()), deps(m.store, off.p));
  assert.equal(r.ok && r.outcome, 'handed_off');
  assert.equal(off.total(), 0, 'a platform with no keys was asked');
});

test('a line with no time is asked for one, never given seven o\'clock', () => {
  const v = decide(facts({ time: null }), { instant: platform().instant, call: CLOSED });
  assert.deepEqual(v.needs, ['time']);
  assert.match(v.what, /^Pick a time, and Reach books/);
  assert.doesNotMatch(JSON.stringify(v), /7:00|19:00/);
});

test('every way in ends with "I\'ve got it", and a place we hold nothing for says so', () => {
  const v = decide(facts({ platform: 'none', phone: null, reserveUrl: null, urls: [] }), { instant: null, call: CLOSED });
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

test('instant, press one: the exact slot is held and its terms shown — held is not booked', async () => {
  const m = memory();
  const p = platform();
  const first = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(first.ok, false);
  assert.equal(first.ok === false && first.code, 'terms_required');
  const hold = first.ok === false ? first.hold! : null;
  assert.equal(hold?.cancellationPolicy, POLICY);
  assert.deepEqual(hold?.policies, ['15-minute grace period.']);
  assert.equal(hold?.terms?.version, 'ot-terms-1');
  assert.equal(first.ok === false && first.button, 'Complete reservation');
  assert.match(first.ok === false ? String(first.title) : '', /not booked yet/);
  assert.doesNotMatch(JSON.stringify(first), /lock_.*token|reservation_token/, 'the platform token is never sent to the screen');
  assert.equal(p.calls.reserves.length, 0, 'nothing booked before the terms are accepted');
  assert.equal(m.get().status, 'awaiting_approval');
  assert.equal(reachBooked(m.get()), false);
  // Asked for at the line's night, its time and the party.
  assert.deepEqual(p.calls.openings[0], { date: '2026-11-07', time: '19:30', covers: 4 });
  assert.deepEqual({ ...p.calls.holds[0] }, { date: '2026-11-07', time: '19:30', covers: 4, uniqueId: 'b1' });
});

test('instant, press two: refused unless the terms version and the restaurant\'s policy were both accepted', async () => {
  const m = memory();
  const p = platform();
  const first = await reserveTable(input(m.get()), deps(m.store, p.p));
  const holdId = first.ok === false ? first.hold!.holdId : '';
  for (const accept of [null, { terms: 'ot-terms-0', policy: true }, { terms: 'ot-terms-1', policy: false }]) {
    const r = await reserveTable(input(m.get(), { chosen: { holdId, accept } }), deps(m.store, p.p));
    assert.equal(r.ok === false && r.code, 'terms_not_accepted');
    assert.ok(r.ok === false && r.alternatives.length > 0, 'a refusal with no next option');
  }
  assert.equal(p.calls.reserves.length, 0);
});

test('instant: confirmed only with the platform\'s reservation id, the hold shown is the one booked, the group told', async () => {
  const m = memory();
  const p = platform();
  const r = await bookWithTerms(m, p.p);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.outcome, 'confirmed');
  assert.equal(r.ok && r.href, 'https://www.opentable.com/booking/4821');
  assert.deepEqual(r.ok && r.alternatives, []);
  assert.equal(p.calls.reserves.length, 1);
  assert.equal(p.calls.reserves[0].hold.holdId, 'lock_1', 'the slot whose terms were shown is the one booked');
  assert.equal(p.calls.reserves[0].firstName, 'Maria');
  const b = m.get();
  assert.equal(b.status, 'confirmed');
  assert.equal(b.provider_ref, '1038007-4821');
  assert.equal(b.mode, 'native');
  assert.equal(b.provider, 'opentable');
  assert.equal(reachBuys(b), false, 'a table never becomes something anybody is charged for');
  assert.equal(reachBooked(b), true, 'Reach\'s own booking: nobody may set it by hand');
  const mark = reserveMarkOf(b)!;
  assert.equal(mark.state, 'confirmed');
  assert.equal(mark.path, 'instant');
  assert.equal(mark.ref, '4821');
  assert.equal(m.notes.length, 1);
  assert.deepEqual(m.notes[0].to, ['u1', 'u2', 'u3']);
  assert.equal(m.notes[0].title, "Luigi's is booked");
  assert.match(m.notes[0].body, /under Maria\. OpenTable confirmation 4821\.$/);
});

test('solo: the person alone is told, in the singular', async () => {
  const m = memory();
  const r = await bookWithTerms(m, platform().p, { plan: { id: 'p1', group_id: 'g1', solo: true, start_date: '2026-11-05', end_date: '2026-11-08' }, facts: facts({ solo: true }) });
  assert.equal(r.ok, true);
  assert.deepEqual(m.notes[0].to, ['u1']);
  assert.equal(m.notes[0].title, "You're booked at Luigi's");
  assert.doesNotMatch(m.notes[0].body, /under|group/);
});

test('"confirmed" with no reservation id is not confirmed: it is in doubt and never tried again', async () => {
  const m = memory();
  const p = platform({ reserve: { vertical: 'restaurant', mode: 'native', status: 'confirmed', provider: 'opentable' } });
  const r = await bookWithTerms(m, p.p);
  assert.equal(r.ok === false && r.code, 'outcome_unknown');
  assert.notEqual(m.get().status, 'confirmed');
  assert.ok(midClaim(m.get()), 'left mid-claim, not failed: failed would let it be booked twice');
  assert.equal(reserveMarkOf(m.get())?.state, 'in_doubt');
  const again = await reserveTable(input(m.get(), { chosen: { holdId: 'lock_1', accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(again.ok === false && again.code, 'outcome_unknown');
  const fresh = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(fresh.ok === false && fresh.code, 'outcome_unknown');
  assert.equal(p.calls.reserves.length, 1, 'never sent a second time');
});

test('no answer from the platform after the booking went: in doubt, not failed, not retried, nothing offered', async () => {
  const m = memory();
  const p = platform({ reserve: () => { throw new OutcomeUnknown('timeout'); } });
  const r = await bookWithTerms(m, p.p);
  assert.equal(r.ok === false && r.code, 'outcome_unknown');
  assert.ok(midClaim(m.get()));
  assert.match(String(m.get().error), /^outcome unknown/);
  assert.equal(r.ok === false && r.alternatives.length, 0, 'no other way offered while it may be booked');
  const card = na([tableRow(m.get() as never)]);
  assert.match(card.title, /can't tell yet whether Luigi's is booked/);
});

test('never double-books: two presses of "Complete reservation" at the same moment reach the platform once', async () => {
  const m = memory();
  const gate = latch();
  let hold = false;
  const p = platform({ reserve: async () => { if (hold) await gate.done; return { vertical: 'restaurant', mode: 'native', status: 'confirmed', provider: 'opentable', providerRef: '1038007-4821' }; } });
  const shown = await reserveTable(input(m.get()), deps(m.store, p.p));
  const holdId = shown.ok === false ? shown.hold!.holdId : '';
  hold = true;
  const snapshot = m.get();
  const a = reserveTable(input({ ...snapshot }, { chosen: { holdId, accept: ACCEPT } }), deps(m.store, p.p));
  const b = reserveTable(input({ ...snapshot }, { chosen: { holdId, accept: ACCEPT } }), deps(m.store, p.p));
  await new Promise(r => setTimeout(r, 10));
  gate.open();
  const results = await Promise.all([a, b]);
  assert.equal(p.calls.reserves.length, 1);
  assert.equal(results.filter(r => r.ok).length, 1);
  const loser = results.find(r => !r.ok);
  assert.equal(loser?.ok === false && loser.code, 'in_progress');
  assert.equal(m.notes.length, 1);
});

test('idempotent: a table already confirmed answers the same, and nothing is sent again', async () => {
  const m = memory();
  const p = platform();
  await bookWithTerms(m, p.p);
  const before = p.total();
  const again = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(again.ok && again.already, true);
  assert.equal(again.ok && again.outcome, 'confirmed');
  assert.equal(p.total(), before, 'not even asked for openings again');
});

test('a hold that ran out, or one that is not this row\'s, books nothing', async () => {
  const m = memory();
  const p = platform();
  const shown = await reserveTable(input(m.get()), deps(m.store, p.p));
  const holdId = shown.ok === false ? shown.hold!.holdId : '';
  const other = await reserveTable(input(m.get(), { chosen: { holdId: 'lock_somebody_else', accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(other.ok === false && other.code, 'hold_missing');
  const late = await reserveTable(input(m.get(), { chosen: { holdId, accept: ACCEPT }, now: new Date(NOW.getTime() + 6 * 60_000) }), deps(m.store, p.p));
  assert.equal(late.ok === false && late.code, 'hold_expired');
  assert.equal(p.calls.reserves.length, 0);
});

test('another time offered: nothing held or booked, the row says so, and taking it books that time', async () => {
  const m = memory();
  let first = true;
  const p = platform({
    openings: ask => (first
      ? (first = false, { ok: true, slots: [{ date: ask.date, time: '22:00', needsCard: false, handoffUrl: null }, { date: ask.date, time: '21:00', needsCard: false, handoffUrl: null }] })
      : { ok: true, slots: [{ date: ask.date, time: ask.time, needsCard: false, handoffUrl: null }] }),
  });
  const r = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(r.ok === false && r.code, 'other_time');
  assert.deepEqual(r.ok === false && r.offeredTimes, ['21:00', '22:00'], 'nearest the time asked for first');
  assert.equal(m.get().status, 'awaiting_approval');
  assert.deepEqual(reserveMarkOf(m.get())?.offeredTimes, ['21:00', '22:00']);
  assert.equal(m.notes[0].title, 'No 7:30. OpenTable offered 9:00. Take it?');
  assert.equal(p.calls.holds.length, 0);

  const took = await bookWithTerms(m, p.p, { chosen: { time: '21:00' } });
  assert.equal(took.ok && took.outcome, 'confirmed');
  assert.equal(p.calls.reserves[0].hold.time, '21:00');
  assert.equal(reserveMarkOf(m.get())?.time, '21:00');
});

test('no table that night, in the platform\'s own answer: failed with the reason, and the next options with it', async () => {
  const m = memory();
  const p = platform({ openings: { ok: true, slots: [] } });
  const r = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(r.ok === false && r.code, 'unavailable');
  assert.deepEqual(r.ok === false && r.alternatives.map(a => a.kind), ['link', 'phone', 'confirm']);
  assert.match(r.ok === false ? r.error : '', /^Not booked\. Luigi's has no table on OpenTable Sat, Nov 7 at 7:30 PM for 4\. Next: book it on OpenTable or call them on \(919\) 555-0100/);
  assert.equal(m.get().status, 'failed');
  assert.equal(reserveMarkOf(m.get())?.state, 'failed');
  assert.equal(m.notes.length, 1);
});

test('a card, deposit or prepayment is handed to the platform\'s page: Reach holds nobody\'s money for a table', async () => {
  const slotCard = platform({ openings: ask => ({ ok: true, slots: [{ date: ask.date, time: ask.time, needsCard: true, handoffUrl: 'https://www.opentable.com/booking/deposit/77' }] }) });
  const holdCard = platform({ hold: { ok: false, code: 'needs_card', error: 'This time needs a card.', handoffUrl: 'https://www.opentable.com/booking/card/88' } });
  for (const [p, url] of [[slotCard, 'https://www.opentable.com/booking/deposit/77'], [holdCard, 'https://www.opentable.com/booking/card/88']] as const) {
    const m = memory();
    const r = await reserveTable(input(m.get()), deps(m.store, p.p));
    assert.equal(r.ok && r.outcome, 'handed_off');
    assert.equal(p.calls.reserves.length, 0);
    assert.equal(m.get().status, 'redirected');
    assert.equal(m.get().redirect_url, url);
    assert.match(r.ok ? r.title : '', /wants a card to hold Sat, Nov 7 at 7:30 PM, so Reach won't book it/);
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
  assert.equal(p.total(), 0, 'the platform was never asked');
});

test('a time the person picked is used when the line has none', async () => {
  const m = memory();
  const p = platform();
  await reserveTable(input(m.get(), { facts: facts({ time: null }), chosen: { time: '20:15' } }), deps(m.store, p.p));
  assert.equal(p.calls.openings[0].time, '20:15');
  assert.equal(p.calls.holds[0].time, '20:15');
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
  assert.equal(p.total(), 0);
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
  assert.equal(p.total(), 0);
  // Said they have not: Reach books it, from the handed-over row.
  const ok = await bookWithTerms(handed, p.p, { chosen: { notBookedElsewhere: true } });
  assert.equal(ok.ok && ok.outcome, 'confirmed');
  assert.equal(p.calls.reserves.length, 1);
});

test('a row somebody changed meanwhile is not booked over', async () => {
  const m = memory();
  const p = platform();
  const shown = await reserveTable(input(m.get()), deps(m.store, p.p));
  const stale = { ...m.get() };
  m.get().updated_at = tick(); // somebody else wrote to it
  const r = await reserveTable(input(stale, { chosen: { holdId: shown.ok === false ? shown.hold!.holdId : '', accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(r.ok === false && r.code, 'in_progress');
  assert.equal(p.calls.reserves.length, 0);
});

test('a failed table is reopened for the next option, on its version only', async () => {
  const m = memory(row({ status: 'failed', response_payload: { reserve: { state: 'failed', path: 'instant', reason: 'No table.' } } }));
  const p = platform();
  const r = await bookWithTerms(m, p.p, { chosen: { time: '18:00' } });
  assert.equal(r.ok && r.outcome, 'confirmed');
  assert.equal(m.get().status, 'confirmed');
});

// ── a table the platform holds for a card ───────────────────────────────

const PENDING_REF = '1038007-7646';
const CARD_PAGE = 'https://www.opentable.com/payment/7646';
function pendingRow(): TableRow {
  return row({
    status: 'pending', mode: 'native', provider: 'opentable', provider_ref: PENDING_REF, redirect_url: CARD_PAGE,
    response_payload: {
      table: { platform: 'opentable', venueId: '1038007' },
      booked: { platform: 'opentable', ref: PENDING_REF, date: '2026-11-07', time: '19:30', covers: 4, manage_reservation_url: 'https://www.opentable.com/manage/7646' },
    },
  });
}

test('a press two OpenTable answers "add a card" is card_owed: not booked, and the card page is the way on', async () => {
  const m = memory();
  const p = platform({ reserve: { vertical: 'restaurant', mode: 'native', status: 'pending', provider: 'opentable', providerRef: PENDING_REF, redirectUrl: CARD_PAGE } });
  const r = await bookWithTerms(m, p.p);
  assert.equal(r.ok && r.outcome, 'card_owed');
  assert.equal(r.ok && r.href, CARD_PAGE);
  assert.match(r.ok ? r.title : '', /^Not booked yet/);
  assert.equal(m.get().status, 'pending');
  assert.equal(reserveMarkOf(m.get())?.state, 'card_owed');
  assert.equal(m.notes.length, 0, 'nobody is told a table is booked that is not');
  const v = decide(facts(), { instant: p.instant, call: CLOSED }, m.get(), NOW);
  assert.equal(v.open, false);
  assert.equal(v.state, 'card_owed');
  assert.deepEqual(v.alternatives.map(a => [a.kind, a.href]), [['link', CARD_PAGE], ['phone', 'tel:9195550100']]);
});

test('a table held for a card is asked about first: still owed is pending_card, let go is bookable again', async () => {
  const owed = platform({ status: { ok: true, active: true, date: null, time: null, covers: 4, fee: null, owesCard: null, cancelled: false } });
  const m = memory(pendingRow());
  const r = await reserveTable(input(m.get()), deps(m.store, owed.p));
  assert.equal(r.ok === false && r.code, 'pending_card');
  assert.equal(r.ok === false && r.platformUrl, CARD_PAGE);
  assert.equal(owed.calls.status, 1);
  assert.equal(owed.calls.openings.length, 0, 'a second table was asked for while the first is held');

  const gone = platform({ status: { ok: true, active: false, date: null, time: null, covers: 4, fee: null, owesCard: null, cancelled: true } });
  const g = memory(pendingRow());
  const again = await reserveTable(input(g.get()), deps(g.store, gone.p));
  assert.equal(again.ok === false && again.code, 'terms_required', 'a table OpenTable let go could not be booked again');
  assert.equal(g.get().provider_ref, null);

  const paid = platform({ status: { ok: true, active: true, date: null, time: null, covers: 4, fee: null, owesCard: false, cancelled: false } });
  const c = memory(pendingRow());
  const done = await reserveTable(input(c.get()), deps(c.store, paid.p));
  assert.equal(done.ok && done.outcome, 'confirmed');
  assert.equal(done.ok && done.already, true);
  assert.equal(paid.calls.reserves.length, 0);
});

test('a platform record is read only while the row still holds that reservation: a table booked since by a call is the call\'s', () => {
  const lapsedThenCalled = {
    status: 'confirmed', provider_ref: 'reach-call:c1',
    response_payload: {
      booked: { platform: 'opentable', ref: PENDING_REF, date: '2026-11-07', time: '19:30', covers: 4, lapsedAt: '2026-11-04T17:00:00Z' },
      reserve: { state: 'confirmed', path: 'call', date: '2026-11-07', time: '21:00', partySize: 4, ref: 'reach-call:c1' },
    },
  };
  const m = reserveMarkOf(lapsedThenCalled)!;
  assert.equal(m.path, 'call');
  assert.equal(m.time, '21:00');
  assert.equal(m.ref, 'reach-call:c1');
});

test('next step: a table held for a card says so, with the card page first — never "booked"', () => {
  const a = na([tableRow({ ...pendingRow() } as never)]);
  assert.equal(a.state, 'needs_attention');
  assert.equal(a.title, "Luigi's isn't booked yet — OpenTable needs a card");
  assert.deepEqual(a.cta, { label: 'Add the card on OpenTable →', kind: 'link', href: CARD_PAGE });
  assert.equal(a.allBooked, false);
});

// ── moving a table Reach booked ─────────────────────────────────────────

test('change: a table Reach booked on OpenTable is held at the new time, accepted, moved — and its line moves too', async () => {
  const words = 'Day 3 · Evening · 7:30 PM';
  const m = memory(row(), { lines: { 'l-dinner': words } });
  const p = platform();
  await bookWithTerms(m, p.p);
  const line = { id: 'l-dinner', scheduled_time: words };
  const moved = await bookWithTerms(m, p.p, { line, chosen: { change: true, time: '21:00' } });
  assert.equal(moved.ok && moved.outcome, 'confirmed');
  assert.deepEqual(p.calls.modifies, ['1038007-4821']);
  assert.equal(p.calls.reserves.length, 1, 'a move is not a second table');
  assert.equal(m.lines.get('l-dinner'), 'Day 3 · Evening · 9:00 PM');
  const yelp = platform({ canModify: false });
  const y = memory(row());
  await bookWithTerms(y, yelp.p);
  const no = await reserveTable(input(y.get(), { chosen: { change: true, time: '21:00' } }), deps(y.store, yelp.p));
  assert.equal(no.ok === false && no.code, 'no_change');
  assert.match(no.ok === false ? no.error : '', /can't change a booking/);
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
    async lineOf() { return null; },
    async retime() { return false; },
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
  assert.equal(p.total(), 0);
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

test('openings are read once, for everybody: exact, card, another time, or — only when the platform lists nothing — none', async () => {
  const s = (time: string, reachBooks = true, date = '2026-11-07') => ({ date, time, reachBooks, handoffUrl: reachBooks ? null : `https://ot/${time}` });
  assert.deepEqual(readSlots([s('19:30')], '2026-11-07', '19:30'), { kind: 'exact', slot: s('19:30') });
  assert.deepEqual(readSlots([s('19:30', false)], '2026-11-07', '19:30'), { kind: 'card', handoffUrl: 'https://ot/19:30' });
  assert.deepEqual(readSlots([s('22:00'), s('18:45'), s('20:00', false)], '2026-11-07', '19:30'), { kind: 'other', times: ['18:45', '22:00'] });
  assert.deepEqual(readSlots([s('19:30', true, '2026-11-08')], '2026-11-07', '19:30'), { kind: 'none' }, 'another night is not this night');
  assert.deepEqual(readSlots([], '2026-11-07', '19:30'), { kind: 'none' });

  // quote(): noAvailability only on the platform's own empty answer; a refusal never carries it.
  const req = { vertical: 'restaurant' as const, planId: 'p1', groupId: 'g1', travelers: [], party: 4, restaurant: { name: "Luigi's", city: 'Raleigh', date: '2026-11-07', time: '19:30', partySize: 4, externalUrl: OT_PROFILE } };
  const empty = await quoteWith(platform({ openings: { ok: true, slots: [] } }).p, req);
  assert.equal((empty.raw as { noAvailability?: boolean }).noAvailability, true);
  const refused = await quoteWith(platform({ openings: { ok: false, code: 'rate_limited', error: 'Too many requests.' } }).p, req);
  assert.equal(refused.status, 'failed');
  assert.equal((refused.raw as { noAvailability?: boolean } | undefined)?.noAvailability, undefined);
  const other = await quoteWith(platform({ openings: { ok: true, slots: [{ date: '2026-11-07', time: '21:00', needsCard: false, handoffUrl: null }] } }).p, req);
  assert.deepEqual((other.raw as { offeredTimes?: string[] }).offeredTimes, ['21:00']);
});

test('a platform that refused or never answered is never told to anybody as "no table"', async () => {
  const answers: (() => Openings | Promise<Openings>)[] = [
    () => ({ ok: false, code: 'rate_limited', error: 'OpenTable is busy — try again in a minute.' }),
    () => ({ ok: false, code: 'auth', error: 'Reach could not sign in to OpenTable.' }),
    () => { throw new Error('fetch failed'); },
  ];
  for (const openings of answers) {
    const m = memory();
    const p = platform({ openings });
    const r = await reserveTable(input(m.get()), deps(m.store, p.p));
    assert.equal(r.ok, false);
    assert.notEqual(r.ok === false && r.code, 'unavailable');
    assert.doesNotMatch(r.ok === false ? r.error : '', /has no table/);
    assert.deepEqual(r.ok === false && r.alternatives.map(a => a.kind), ['link', 'phone', 'confirm']);
    assert.equal(m.get().status, 'awaiting_approval', 'the row is left open');
    assert.equal(reserveMarkOf(m.get()), null);
    assert.equal(m.notes.length, 0, 'nobody is told the restaurant is full');
    assert.equal(p.calls.holds.length, 0);
  }
  // A refusal that is the restaurant's way of taking it (a card) is handed off.
  const m = memory();
  const p = platform({ openings: { ok: false, code: 'needs_card', error: 'card required', handoffUrl: 'https://www.opentable.com/booking/card/1' } });
  const r = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(r.ok && r.outcome, 'handed_off');
  assert.equal(m.get().redirect_url, 'https://www.opentable.com/booking/card/1');
});

test('checkout reads a table\'s two new answers as things to ask, not failures', () => {
  const terms = approveOutcome(409, { code: 'terms_required', error: "Read OpenTable's terms, then tap Complete reservation.", hold: { holdId: 'lock_1', terms: { version: 'ot-terms-1' } }, button: 'Complete reservation' });
  assert.equal(terms.kind, 'terms');
  assert.equal(terms.hold?.holdId, 'lock_1');
  assert.equal(terms.button, 'Complete reservation');
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

test('one way to book a table: no route but reserve calls the platform steps that book', () => {
  const routes = ['app/api/bookings/[id]/reserve/route.ts', 'app/api/bookings/[id]/approve/route.ts', 'app/api/bookings/[id]/cancel/route.ts', 'app/api/plans/[planId]/reservations/route.ts'];
  assert.throws(() => readFileSync('app/api/bookings/[id]/table/route.ts', 'utf8'), 'a second table route is back');
  for (const f of routes) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\b(holdStep|reserveStep|openingsStep)\(/, `${f} books a table around the orchestrator`);
  }
  const reserve = readFileSync('lib/reservations/reserve.ts', 'utf8');
  for (const step of ['openingsStep(', 'holdStep(', 'reserveStep(', 'settlePending(']) assert.ok(reserve.includes(step), `reserve.ts does not use ${step}`);
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

test('next step: a table Reach can book is offered as Reach\'s to book, a confirmed one is booked, a hand-off is still the hand-off', async () => {
  const ready = na([tableRow()], { reservations: [{ bookingId: 'b1', path: 'instant', what: "Reach books Luigi's on OpenTable." }] });
  assert.equal(ready.state, 'ready_to_book');
  assert.deepEqual(ready.cta, { label: 'Book it →', kind: 'reserve', bookingId: 'b1', path: 'instant' });
  const handoff = na([tableRow()], { reservations: [{ bookingId: 'b1', path: 'handoff' }] });
  assert.equal(handoff.state, 'finish_elsewhere');
  // Booked by the platform steps: the row's own record, read as booked.
  const m = memory();
  await bookWithTerms(m, platform().p);
  const booked = na([tableRow(m.get() as never)]);
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
    { id: 'b2', vertical: 'restaurant', status: 'confirmed', mode: 'native', provider: 'opentable', detail: "Poole's" },
  ] as never);
  assert.deepEqual(s.waiting.map(r => r.id), ['b-hotel']);
  assert.deepEqual(s.tables.map(r => r.id), ['b1']);
  assert.equal(s.totalCents, 60000, 'a table adds nothing to what anybody pays');
});

// ── the defects found in review, each held here ─────────────────────────

/** A promise and the function that settles it, for holding a request mid-flight. */
function latch() {
  let open!: () => void;
  const done = new Promise<void>(r => { open = r; });
  return { done, open };
}

test('a call being placed takes the row first: "Complete reservation" pressed meanwhile never reaches the platform', async () => {
  const m = memory();
  const p = platform();
  const shown = await reserveTable(input(m.get()), deps(m.store, p.p));
  const holdId = shown.ok === false ? shown.hold!.holdId : '';
  const before = { ...m.get() };
  const ringing = latch();
  const inPlace = latch();
  const d = deps(m.store, p.p, { ok: true }, {
    call: {
      env: LIVE, store: callStore(m), lookup: async () => 'landline',
      provider: () => ({ name: 'retell', async place() { inPlace.open(); await ringing.done; return { ok: true, providerCallId: 'call_1' }; }, verify: () => true, parse: () => null }),
    },
  });
  const call = reserveTable(input(before, { chosen: { path: 'call' } }), d);
  await inPlace.done;
  // Somebody who read the row before the call took it presses the button.
  const stale = await reserveTable(input(before, { chosen: { path: 'instant', holdId, accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(stale.ok, false);
  assert.equal(p.calls.reserves.length, 0, 'the restaurant is on the phone; the platform is never asked as well');
  // Somebody who reads it now is told Reach is calling.
  const fresh = await reserveTable(input(m.get(), { chosen: { path: 'instant', holdId, accept: ACCEPT, notBookedElsewhere: true } }), deps(m.store, p.p));
  assert.equal(fresh.ok === false && fresh.code, 'calling');
  ringing.open();
  const r = await call;
  assert.equal(r.ok && r.outcome, 'calling');
  assert.equal(m.get().status, 'pending');
  assert.equal(reserveMarkOf(m.get())?.callId, 'c1');
});

test('an instant booking in flight refuses a call pressed from the row as it was, and nothing rings', async () => {
  const m = memory();
  const answering = latch();
  const inReserve = latch();
  const p = platform({ reserve: async () => { inReserve.open(); await answering.done; return { vertical: 'restaurant', mode: 'native', status: 'confirmed', provider: 'opentable', providerRef: '1038007-4821' }; } });
  const shown = await reserveTable(input(m.get()), deps(m.store, p.p));
  const holdId = shown.ok === false ? shown.hold!.holdId : '';
  const before = { ...m.get() };
  const booking = reserveTable(input(before, { chosen: { holdId, accept: ACCEPT } }), deps(m.store, p.p));
  await inReserve.done;
  const placed: string[] = [];
  const d = deps(m.store, null, { ok: true }, {
    call: {
      env: LIVE, store: callStore(m), lookup: async () => 'landline',
      provider: () => ({ name: 'retell', async place(a) { placed.push(a.to); return { ok: true, providerCallId: 'call_x' }; }, verify: () => true, parse: () => null }),
    },
  });
  const call = await reserveTable(input(before, { chosen: { path: 'call' } }), d);
  assert.equal(call.ok === false && call.code, 'changed');
  // And from the row as it is now, mid-claim: refused before anything is written.
  const now = await reserveTable(input(m.get(), { chosen: { path: 'call' } }), d);
  assert.equal(now.ok === false && now.code, 'in_progress');
  assert.deepEqual(placed, [], 'nobody is rung about a table the platform is booking');
  answering.open();
  assert.equal((await booking).ok, true);
  assert.equal(m.get().status, 'confirmed');
});

test('a live call with no mark on the row refuses "Book it" whatever the row\'s status', async () => {
  const m = memory(row(), { callOpen: true });
  const p = platform();
  const r = await reserveTable(input(m.get(), { chosen: { holdId: 'lock_1', accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(r.ok === false && r.code, 'calling');
  assert.equal(p.total(), 0);
});

test('a call that never rang gives the row back as it was', async () => {
  const m = memory(row({ status: 'failed', response_payload: { reserve: { state: 'failed', path: 'instant', reason: 'No table.' } } }));
  const d = deps(m.store, null, { ok: true }, {
    call: { env: LIVE, store: callStore(m), lookup: async () => 'landline', provider: () => { throw new Error('must not ring'); } },
  });
  const r = await reserveTable(input(m.get(), { venue: { name: "Luigi's", phone: '(919) 555-0100', opening_hours: 'Mo-Su 23:00-23:30', lng: -78.64, reserveUrl: OT_LINK } }), d);
  assert.equal(r.ok === false && r.code, 'call_refused');
  assert.equal(m.get().status, 'failed');
  assert.equal(reserveMarkOf(m.get())?.state, 'failed', 'no "calling" left on a row nobody rang');
});

test('a table that is booked, or may be, offers nothing more, and says the time it was booked at', async () => {
  const a = { instant: platform().instant, call: { ok: true } as CallCheck };
  const confirmed = decide(facts(), a, { status: 'confirmed', response_payload: { reserve: { state: 'confirmed', path: 'call', date: '2026-11-07', time: '21:00', partySize: 4, ref: 'reach-call:c1' } } });
  assert.equal(confirmed.open, false);
  assert.deepEqual(confirmed.alternatives, []);
  assert.equal(confirmed.ownAccount, null);
  assert.equal(confirmed.terms, null);
  assert.equal(confirmed.what, "Luigi's confirmed on the call: Sat, Nov 7 at 9:00 PM for 4.");
  assert.equal(confirmed.when.said, 'Sat, Nov 7 at 9:00 PM');
  assert.doesNotMatch(JSON.stringify(confirmed), /7:30|Reach books|your own/, 'one card, one time, nothing to book again');

  // Booked by the platform steps at an offered time: their record, their time.
  const m = memory();
  await bookWithTerms(m, platform().p, { chosen: { time: '21:00' } });
  const viaPlatform = decide(facts(), a, m.get(), NOW);
  assert.equal(viaPlatform.open, false);
  assert.equal(viaPlatform.what, 'Confirmed by OpenTable · ref 4821');
  assert.equal(viaPlatform.when.said, 'Sat, Nov 7 at 9:00 PM');

  const doubt = decide(facts(), { instant: null, call: CLOSED }, { status: 'booking', error: 'outcome unknown: timeout', response_payload: { reserve: { state: 'in_doubt', path: 'instant', platform: 'opentable' } } });
  assert.equal(doubt.open, false);
  assert.deepEqual(doubt.alternatives, []);
  assert.equal(doubt.state, 'in_doubt');
  assert.match(doubt.what, /can't tell yet whether Luigi's is booked/);
  assert.doesNotMatch(JSON.stringify(doubt), /Reserve on|Book it on/);

  const calling = decide(facts(), a, { status: 'pending', response_payload: { reserve: { state: 'calling', path: 'call', time: '19:30', partySize: 4 } } });
  assert.equal(calling.open, false);
  assert.deepEqual(calling.alternatives, []);

  const theirs = decide(facts(), a, { status: 'redirected', confirmation_number: 'ABC123' });
  assert.equal(theirs.open, false);
  assert.match(theirs.what, /ABC123/);
  // Where the confirmation came from: a number somebody typed in, said as that.
  assert.equal(decide({ ...facts(), solo: true }, a, { status: 'redirected', confirmation_number: 'ABC123' }).title, 'You entered ABC123');
  assert.equal(theirs.title, facts().solo ? 'You entered ABC123' : 'Someone in the group entered ABC123');

  assert.equal(decide(facts(), a, { status: 'awaiting_approval' }).open, true);
});

test('a number somebody typed in is said as theirs, on the row the confirmation route actually writes', () => {
  const a = { instant: platform().instant, call: { ok: true } as CallCheck };
  // POST /api/bookings/[id]/confirmation writes status 'confirmed' and the number, and no mark.
  const typed = decide(facts(), a, { status: 'confirmed', confirmation_number: 'ABC123' });
  assert.equal(typed.title, 'Someone in the group entered ABC123');
  assert.equal(decide({ ...facts(), solo: true }, a, { status: 'confirmed', confirmation_number: 'ABC123' }).title, 'You entered ABC123');
  assert.notEqual(typed.state, 'confirmed', 'a green tick is for a platform reference or a yes on a call');
  assert.equal(typed.open, false);
  assert.deepEqual(typed.alternatives, []);
  assert.equal(typed.manage, null);
  // No number: still their word, not a booking Reach saw.
  const word = decide({ ...facts(), solo: true }, a, { status: 'confirmed' });
  assert.equal(word.title, "You marked Luigi's as booked.");
  assert.notEqual(word.state, 'confirmed');
  // After a call that got no table: theirs, not the call's.
  const afterCall = decide(facts(), a, { status: 'confirmed', confirmation_number: 'ABC123', response_payload: { reserve: { state: 'not_booked', path: 'call', time: '19:30', partySize: 4 } } });
  assert.equal(afterCall.path, 'handoff');
  assert.equal(afterCall.title, 'Someone in the group entered ABC123');
});

test('a table handed over because the slot wants a card is not offered back to Reach', async () => {
  const m = memory();
  const p = platform({ hold: { ok: false, code: 'needs_card', error: 'This time needs a card.', handoffUrl: 'https://www.opentable.com/booking/card/88' } });
  const r = await reserveTable(input(m.get()), deps(m.store, p.p));
  assert.equal(r.ok && r.outcome, 'handed_off');
  const view = decide(facts(), { instant: p.instant, call: { ok: true } as CallCheck }, m.get(), NOW);
  assert.equal(view.path, 'handoff', "Reach's Book it would hold it and hand it back again");
  assert.equal(view.open, true);
  assert.equal(view.ownAccount, null);
  assert.equal(view.state, 'handed_off');
  assert.ok(!view.alternatives.some(o => o.kind === 'call'), 'the restaurant wants a card, which a call cannot give');
  assert.equal(view.alternatives[0].href, 'https://www.opentable.com/booking/card/88', "the platform's page for the slot");
  assert.match(view.title ?? '', /wants a card/);
  assert.equal(view.what, view.title);
  // Pressing Book it anyway books nothing: no new hold.
  const again = await reserveTable(input(m.get(), { chosen: { path: 'instant', notBookedElsewhere: true } }), deps(m.store, p.p));
  assert.equal(again.ok === false && again.code, 'path_unavailable');
  assert.equal(p.calls.holds.length, 1);
});

test('a confirmed table says how it is changed or cancelled, from where it was confirmed', () => {
  const a = { instant: null, call: CLOSED };
  const on = (platform: string) => decide(facts(), a, {
    status: 'confirmed', provider_ref: 'R-4821',
    response_payload: { reserve: { state: 'confirmed', path: 'instant', platform, ref: '4821', time: '19:30', partySize: 4 } },
  }).manage;
  assert.deepEqual(on('opentable'), { by: 'platform', platform: 'opentable', platformName: 'OpenTable', canChange: true });
  const yelp = on('yelp');
  assert.equal(yelp?.by === 'platform' && yelp.canChange, false, 'Yelp is cancel and book again');
  const call = decide(facts(), a, { status: 'confirmed', provider_ref: 'reach-call:c1', response_payload: { reserve: { state: 'confirmed', path: 'call', ref: 'reach-call:c1', time: '19:30', partySize: 4 } } });
  assert.equal(call.manage?.by, 'restaurant', 'confirmed on the call: theirs to change, by phone');
  // A number somebody typed in, and an open table: nothing to manage from here.
  assert.equal(decide(facts(), a, { status: 'redirected', confirmation_number: 'ABC123' }).manage, null);
  assert.equal(decide(facts(), a, { status: 'awaiting_approval' }).manage, null);
});

test('a claim nobody answered is "booking now" for a minute, then in doubt — never "booking now" for good', async () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const fresh = row({ status: 'booking', approved_at: at(30_000), updated_at: at(30_000) });
  const stuck = row({ status: 'booking', approved_at: at(10 * 60_000), updated_at: at(10 * 60_000) });
  // The platform steps' own claim: the stamp, and the reservation it was sending.
  const reserving = (ms: number) => row({
    approved_at: at(ms), updated_at: at(ms),
    response_payload: { table: { platform: 'opentable', venueId: '1038007', reserving: { at: at(ms), by: 'u1', holdId: 'lock_1' } } },
  });
  const p = platform();
  for (const [r, code] of [[fresh, 'in_progress'], [stuck, 'outcome_unknown'], [reserving(30_000), 'in_progress'], [reserving(10 * 60_000), 'outcome_unknown']] as const) {
    const out = await reserveTable(input(r), deps(memory(r).store, p.p));
    assert.equal(out.ok === false && out.code, code);
  }
  assert.equal(p.total(), 0, 'never sent again');

  assert.equal(decide(facts(), { instant: p.instant, call: CLOSED }, fresh, NOW).state, null);
  assert.equal(decide(facts(), { instant: p.instant, call: CLOSED }, stuck, NOW).state, 'in_doubt');

  const now = na([tableRow({ status: 'booking', approved_at: at(30_000), updated_at: at(30_000) })]);
  assert.equal(now.state, 'booking_in_progress');
  const later = na([tableRow({ status: 'booking', approved_at: at(10 * 60_000), updated_at: at(10 * 60_000) })]);
  assert.equal(later.state, 'needs_attention');
  assert.match(later.title, /can't tell yet whether Luigi's is booked/);
  assert.match(later.cta && later.cta.kind === 'link' ? later.cta.href : '', /^mailto:/, 'somebody to ask, not a dead end');
});

test('a table booked at an offered time moves its line and its request to that time', async () => {
  const words = 'Day 3 · Evening · 7:30 PM';
  const m = memory(row(), { lines: { 'l-dinner': words } });
  const line = { id: 'l-dinner', scheduled_time: words };
  let first = true;
  const p = platform({
    openings: ask => (first
      ? (first = false, { ok: true, slots: [{ date: ask.date, time: '21:00', needsCard: false, handoffUrl: null }] })
      : { ok: true, slots: [{ date: ask.date, time: ask.time, needsCard: false, handoffUrl: null }] }),
  });
  const offered = await reserveTable(input(m.get(), { line }), deps(m.store, p.p));
  assert.equal(offered.ok === false && offered.code, 'other_time');
  assert.equal(m.lines.get('l-dinner'), words, 'nothing booked, nothing moved');

  const took = await bookWithTerms(m, p.p, { line, chosen: { time: '21:00' } });
  assert.equal(took.ok && took.outcome, 'confirmed');
  assert.equal(m.lines.get('l-dinner'), 'Day 3 · Evening · 9:00 PM');
  const plan = { startDate: '2026-11-05', endDate: '2026-11-08' };
  assert.deepEqual([lineWhen(m.lines.get('l-dinner'), plan).date, lineWhen(m.lines.get('l-dinner'), plan).clock], ['2026-11-07', '21:00']);
  const req = m.get().request_payload as { restaurant?: { time?: string; date?: string } };
  assert.equal(req.restaurant?.time, '21:00');
  assert.equal(req.restaurant?.date, '2026-11-07');
});

test('a table booked at the line\'s own time leaves the line alone', async () => {
  const words = 'Day 3 · Evening · 7:30 PM';
  const m = memory(row(), { lines: { 'l-dinner': words } });
  const r = await bookWithTerms(m, platform().p, { line: { id: 'l-dinner', scheduled_time: words } });
  assert.equal(r.ok && r.outcome, 'confirmed');
  assert.equal(m.lines.get('l-dinner'), words);
});

test('lineAt writes only words that read back as the night and time booked', () => {
  const plan = { startDate: '2026-11-05', endDate: '2026-11-08' };
  assert.equal(lineAt('Day 3 · Evening', '2026-11-07', '20:15', plan), 'Day 3 · Evening · 8:15 PM');
  assert.equal(lineAt('Evening', '2026-11-06', '20:15', plan), 'Day 2 · Evening · 8:15 PM', 'a night somebody picked is written as its day');
  assert.equal(lineAt('The main event', '2026-11-05', '21:00', { startDate: '2026-11-05' }), 'The main event · 9:00 PM', 'a night out keeps no day number');
  assert.equal(lineAt('Day 3 · Dinner at 7:30', '2026-11-07', '21:00', plan), null, 'never two times on one line');
  assert.equal(lineAt('Day 3', '2026-11-20', '21:00', plan), null, 'a night off the trip is not written');
  assert.equal(lineAt('Day 3', '2026-11-07', 'soon', plan), null);
});

// ── press two is the hold's, and the call route is the orchestrator's ────

test('press two sent as the contract says — { holdId, accept } and nothing else — books the hold\'s time, not the line\'s', async () => {
  // The line has no clock: the person picked 20:15 on press one.
  const m = memory();
  const p = platform();
  const noClock = { facts: facts({ time: null }) };
  const first = await reserveTable(input(m.get(), { ...noClock, chosen: { time: '20:15' } }), deps(m.store, p.p));
  assert.equal(first.ok === false && first.code, 'terms_required');
  const holdId = first.ok === false ? first.hold!.holdId : '';
  const second = await reserveTable(input(m.get(), { ...noClock, chosen: { holdId, accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(second.ok && second.outcome, 'confirmed', second.ok === false ? `${second.code}: ${second.error}` : '');
  assert.equal(p.calls.reserves[0].hold.time, '20:15');

  // The line said 12:30 tonight, already gone where the restaurant is; 21:00 was taken instead.
  const tonight = { facts: facts({ date: '2026-11-04', time: '12:30' }), plan: { id: 'p1', group_id: 'g1', solo: false, start_date: '2026-11-04', end_date: '2026-11-08' } };
  const t = memory();
  const q = platform();
  const one = await reserveTable(input(t.get(), { ...tonight, chosen: { time: '21:00' } }), deps(t.store, q.p));
  const id = one.ok === false ? one.hold!.holdId : '';
  const two = await reserveTable(input(t.get(), { ...tonight, chosen: { holdId: id, accept: ACCEPT } }), deps(t.store, q.p));
  assert.equal(two.ok && two.outcome, 'confirmed', two.ok === false ? `${two.code}: ${two.error}` : '');
  assert.equal(q.calls.reserves[0].hold.time, '21:00');
});

test('a press two whose hold is not on the row is hold_missing, whatever the line is missing', async () => {
  const m = memory();
  const p = platform();
  const r = await reserveTable(input(m.get(), { facts: facts({ time: null }), chosen: { holdId: 'lock_nobody', accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(r.ok === false && r.code, 'hold_missing');
  assert.equal(p.total(), 0);
});

test('moving a table Reach booked: press two as documented moves it — never "already confirmed" over the old time', async () => {
  const m = memory();
  const p = platform();
  await bookWithTerms(m, p.p);
  const shown = await reserveTable(input(m.get(), { chosen: { change: true, time: '21:00' } }), deps(m.store, p.p));
  assert.equal(shown.ok === false && shown.code, 'terms_required');
  const holdId = shown.ok === false ? shown.hold!.holdId : '';
  const moved = await reserveTable(input(m.get(), { chosen: { holdId, accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(moved.ok && moved.already, undefined, 'answered "already confirmed" and moved nothing');
  assert.equal(moved.ok && moved.outcome, 'confirmed');
  assert.deepEqual(p.calls.modifies, ['1038007-4821']);
  assert.equal(p.calls.reserves.length, 1, 'a move is not a second table');
  // Pressed again with the same hold: the move is done, the hold is spent — nothing sent again.
  const again = await reserveTable(input(m.get(), { chosen: { holdId, accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(again.ok && again.already, true);
  assert.equal(p.calls.modifies.length, 1);
});

test('a table the platform let go is nobody\'s booking: not "native", and a press nobody answered leaves it as it was', async () => {
  const gone = platform({
    status: { ok: true, active: false, date: null, time: null, covers: 4, fee: null, owesCard: null, cancelled: true },
    openings: () => { throw new Error('fetch failed'); },
  });
  const m = memory(pendingRow());
  const r = await reserveTable(input(m.get()), deps(m.store, gone.p));
  assert.equal(r.ok === false && r.code, 'provider_failed');
  assert.equal(m.get().status, 'failed', 'a press OpenTable never answered reopened the row');
  assert.equal(m.get().mode, 'redirect');
  assert.equal(reachBooked(m.get()), false, '"I\'ve got it" and the call would be refused over a table nothing holds');
  assert.deepEqual(r.ok === false && r.alternatives.map(a => a.kind), ['link', 'phone', 'confirm']);

  // A row already lapsed while still 'native': reopened as a hand-off row, and bookable again.
  const old = memory(row({ status: 'failed', mode: 'native', provider: 'opentable', provider_ref: null,
    response_payload: { table: { platform: 'opentable', venueId: '1038007' }, booked: { platform: 'opentable', ref: PENDING_REF, lapsedAt: '2026-11-04T17:00:00Z' } } }));
  const again = await reserveTable(input(old.get()), deps(old.store, platform().p));
  assert.equal(again.ok === false && again.code, 'terms_required');
  assert.equal(old.get().mode, 'redirect');
  assert.equal(reachBooked(old.get()), false);
});

test('a lapsed table can still be called about: the call path never sees it as Reach\'s own booking', async () => {
  const m = memory(row({ status: 'failed', mode: 'native', provider: 'opentable', provider_ref: null,
    response_payload: { booked: { platform: 'opentable', ref: PENDING_REF, lapsedAt: '2026-11-04T17:00:00Z' } } }));
  const placed: string[] = [];
  const d = deps(m.store, null, { ok: true }, {
    call: {
      env: LIVE, store: callStore(m), lookup: async () => 'landline',
      provider: () => ({ name: 'retell', async place(a) { placed.push(a.to); return { ok: true, providerCallId: 'call_1' }; }, verify: () => true, parse: () => null }),
    },
  });
  const r = await reserveTable(input(m.get(), { chosen: { path: 'call' } }), d);
  assert.equal(r.ok && r.outcome, 'calling', r.ok === false ? `${r.code}: ${r.error}` : '');
  assert.equal(placed.length, 1);
  assert.equal(m.get().mode, 'redirect');
});

test('the calling assistant itself refuses a table the instant path has claimed or never heard back about', async () => {
  const { placeCall } = await import('../../lib/reservations/call.ts');
  const stamp = '2026-11-04T17:59:00.000Z';
  const rows = {
    claimed: row({ approved_at: stamp, updated_at: stamp, response_payload: { table: { platform: 'opentable', venueId: '1038007', reserving: { at: stamp, by: 'u1', holdId: 'lock_1' } } } }),
    unknown: row({ approved_at: stamp, updated_at: stamp, error: 'outcome unknown: timeout', response_payload: { table: { platform: 'opentable', venueId: '1038007', reserving: { at: stamp, by: 'u2', holdId: 'lock_1', unknown: 'timeout' } } } }),
    // The stamp lost, the in-flight mark still there: still refused.
    marked: row({ response_payload: { table: { platform: 'opentable', venueId: '1038007', reserving: { at: stamp, by: 'u1', holdId: 'lock_1' } } } }),
  };
  for (const [what, b] of Object.entries(rows)) {
    const m = memory(b);
    const r = await placeCall({
      booking: b as never, plan: { id: 'p1', group_id: 'g1', solo: false, start_date: '2026-11-05', end_date: '2026-11-08' },
      requester: { id: 'u2', firstName: 'Sam' },
      venue: { name: "Luigi's", phone: '(919) 555-0100', opening_hours: 'Mo-Su 11:00-22:00', lng: -78.64, reserveUrl: OT_LINK },
      chosen: { date: '2026-11-07', time: '19:30', partySize: 4 }, now: NOW,
    }, { env: LIVE, store: callStore(m), lookup: async () => 'landline', provider: () => { throw new Error(`${what}: must not ring`); } });
    assert.equal(r.ok === false && r.refusal, 'booking_in_progress', what);
    assert.equal(m.get().status, 'awaiting_approval', what);
  }
});

test('the call route books through the orchestrator when calls are live: placeCall only rings the test number', () => {
  const src = readFileSync('app/api/bookings/[id]/call/route.ts', 'utf8').replace(/\/\/[^\n]*/g, '');
  const live = src.indexOf("gate(process.env).mode === 'live'");
  assert.ok(live > 0, 'the call route does not send a live call through reserve');
  const orchestrated = src.indexOf('reserveTable(', live);
  assert.ok(orchestrated > live, 'a live call is placed around the orchestrator');
  assert.ok(src.indexOf("path: 'call'", live) > live);
  assert.ok(src.indexOf('placeCall(') > orchestrated, 'placeCall runs before the live branch has returned');
  assert.match(src, /const BOOKING = TABLE_ROW/, 'the route cannot see the claim it must honour');
  // No route other than reserve's own callers places a call or books a table.
  for (const f of ['app/api/bookings/[id]/reserve/route.ts', 'app/api/bookings/[id]/approve/route.ts', 'app/api/bookings/[id]/cancel/route.ts', 'app/api/plans/[planId]/reservations/route.ts']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\bplaceCall\(/, `${f} rings around the orchestrator`);
  }
});

test('checkout: a table refusal keeps its own code, and "no table" is only the platform\'s own answer', async () => {
  const { tableApproveCode } = await import('../../lib/booking/approve-outcome.ts');
  const step = (code: string, status: number) => nextStepFor(approveOutcome(status, { code: tableApproveCode(code, status) }), 'restaurant');
  assert.equal(tableApproveCode('hold_expired', 409), 'hold_expired');
  assert.equal(tableApproveCode('rate_limited', 429), 'rate_limited');
  assert.equal(tableApproveCode('in_progress', 409), 'already_in_progress');
  assert.equal(tableApproveCode('unavailable', 409), 'unavailable');
  assert.equal(step('hold_expired', 409), 'retry', 'an expired hold is a new hold, not a change to the plan');
  assert.equal(step('slot_gone', 409), 'retry');
  assert.equal(step('rate_limited', 429), 'retry', 'our failure read as a fact about the restaurant');
  assert.equal(step('details_missing', 422), 'details');
  assert.equal(step('missing_facts', 422), 'answer');
  assert.equal(step('terms_not_accepted', 422), 'answer');
  assert.equal(step('unavailable', 409), 'plan');
  assert.equal(step('outcome_unknown', 502), 'recheck');
  const src = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  assert.match(src, /code: tableApproveCode\(code, status\)/);
  assert.doesNotMatch(src, /'unavailable'\), reserveCode/);
});

test('a night picked on press one is the hold\'s on press two, not asked for again', async () => {
  const m = memory();
  const p = platform();
  const noNight = { facts: facts({ date: null, time: null }) };
  const first = await reserveTable(input(m.get(), { ...noNight, chosen: { date: '2026-11-06', time: '20:15' } }), deps(m.store, p.p));
  const holdId = first.ok === false ? first.hold!.holdId : '';
  const second = await reserveTable(input(m.get(), { ...noNight, chosen: { holdId, accept: ACCEPT } }), deps(m.store, p.p));
  assert.equal(second.ok && second.outcome, 'confirmed', second.ok === false ? `${second.code}: ${second.error}` : '');
  assert.equal(p.calls.reserves[0].hold.date, '2026-11-06');
});

test('the platform letting a card table go hands the row back: mode "redirect", never Reach\'s booking', async () => {
  const gone = platform({ status: { ok: true, active: false, date: null, time: null, covers: 4, fee: null, owesCard: null, cancelled: true } });
  const m = memory(pendingRow());
  // No instant booking on offer now: the hand-off, after the platform was asked.
  const r = await reserveTable(input(m.get()), deps(m.store, gone.p, CLOSED, { instantFor: () => null }));
  assert.equal(gone.calls.status, 1);
  assert.equal(r.ok && r.outcome, 'handed_off');
  assert.equal(m.get().mode, 'redirect');
  assert.equal(reachBooked(m.get()), false);
});
