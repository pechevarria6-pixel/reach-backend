// Watching for a table (lib/watch): the window somebody picks, what Reach
// offers for a restaurant, which slot it takes, the scheduled check — hold,
// lapse, stop — the run's claims and budget, and press one through the one
// booking path with chosen.watch. Nothing real is called: no keys exist.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readWindow, offerFor, pickSlot, checkTable, nightsOffered, expiresAtFor, clockBetween, windowSaid, PRE_ACCEPTED, TABLE_WATCH,
  type TableWatchDeps, type LoadedTable,
} from '../../lib/watch/tables.ts';
import { runWatches } from '../../lib/watch/run.ts';
import type { WatchRow, WatchStore, CheckCtx, WatchStep } from '../../lib/watch/types.ts';
import { reserveTable, type TableRow, type TableStore, type ReserveInput, type ReserveDeps, type InstantTable, type ReserveResult } from '../../lib/reservations/reserve.ts';
import { pickTable } from '../../lib/booking/tables/pick.ts';
import type { Openings, OpeningsAsk, TableProvider, TableSlot } from '../../lib/booking/tables/types.ts';
import type { TableStore as FlowStore } from '../../lib/booking/tables/flow.ts';
import { checkFacts, instructions } from '../../lib/reservations/script.ts';

// 13:00 in Raleigh by the longitude estimate.
const NOW = new Date('2026-11-04T18:00:00Z');
const LNG = -78.64;
const OT_PROFILE = 'https://www.opentable.com/restaurant/profile/1038007/reserve';
const TRIP = { start: '2026-11-05', end: '2026-11-08' };

// ── a fake platform, shaped like lib/booking/tables/types.ts TableProvider ──
function platform(slots: (ask: OpeningsAsk) => Openings | Promise<Openings> = () => ({ ok: true, slots: [] })) {
  const asked: OpeningsAsk[] = [];
  const holds: OpeningsAsk[] = [];
  let n = 0;
  const p: TableProvider = {
    vertical: 'restaurant', name: 'opentable', platform: 'opentable', canModify: true,
    enabled: () => true, allows: () => true,
    venueIdFrom: urls => (urls.some(u => /profile\/1038007/.test(u ?? '')) ? '1038007' : null),
    async openings(_id, ask) { asked.push(ask); return slots(ask); },
    async hold(venueId, ask) {
      holds.push(ask);
      return { ok: true, hold: {
        platform: 'opentable', venueId, holdId: `lock_${++n}`, date: ask.date, time: ask.time, covers: ask.covers,
        expiresAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(), cancellationPolicy: 'Cancel by 5 PM the day before.', policies: [],
        terms: { text: "By clicking 'Complete reservation' you agree to the OpenTable Terms of Use", links: [], version: 'ot-1' },
        fee: null, editable: true, cancelBy: null, notes: null, handoffUrl: null,
      } };
    },
    async release() { /* nothing to let go */ },
    async reserve() { throw new Error('a watch never reserves'); },
    async status() { return { ok: false, code: 'platform_down', error: 'no' }; },
    async cancel() { return { status: 'quoted', refundCents: 0 }; },
    async quote() { throw new Error('no'); },
    async book() { throw new Error('no'); },
  };
  return { p, asked, holds, instant: { provider: p, venueId: '1038007' } as InstantTable };
}

const slot = (date: string, time: string, needsCard = false): TableSlot => ({ date, time, needsCard, handoffUrl: needsCard ? 'https://www.opentable.com/booking/card' : null });

// ── the window ──────────────────────────────────────────────────────────

test('a window is real nights on the trip, none gone, at most seven, a range that runs forwards, a party a platform takes', () => {
  const ctx = { today: '2026-11-04', trip: TRIP };
  const good = readWindow({ nights: ['2026-11-07', '2026-11-06'], from: '19:00', to: '21:00', party: 4 }, ctx);
  assert.deepEqual(good, { ok: true, window: { nights: ['2026-11-06', '2026-11-07'], from: '19:00', to: '21:00', party: 4 } });
  const bad = (g: Parameters<typeof readWindow>[0], c = ctx) => { const r = readWindow(g, c); return r.ok === false ? r.error : null; };
  assert.match(bad({ nights: ['2026-11-09'], from: '19:00', to: '21:00', party: 4 })!, /on this trip/);
  assert.match(bad({ nights: ['2026-11-03'], from: '19:00', to: '21:00', party: 4 }, { today: '2026-11-04', trip: { start: '2026-11-01', end: '2026-11-08' } })!, /already gone/);
  assert.match(bad({ nights: [], from: '19:00', to: '21:00', party: 4 })!, /at least one night/);
  assert.match(bad({ nights: ['2026-11-31'], from: '19:00', to: '21:00', party: 4 })!, /at least one night|not a date/);
  assert.match(bad({ nights: ['2026-11-06'], from: '21:00', to: '19:00', party: 4 })!, /before the latest/);
  assert.match(bad({ nights: ['2026-11-06'], from: '7pm', to: '21:00', party: 4 })!, /earliest and latest/);
  assert.match(bad({ nights: ['2026-11-06'], from: '19:00', to: '21:00', party: 0 })!, /1 to 20/);
  assert.match(bad({ nights: ['2026-11-06'], from: '19:00', to: '21:00', party: 21 })!, /1 to 20/);
  const eight = Array.from({ length: 8 }, (_, i) => `2026-12-0${i + 1}`);
  assert.match(bad({ nights: eight, from: '19:00', to: '21:00', party: 2 }, { today: '2026-11-04', trip: null })!, /up to 7/);
  // No trip: the next sixty days.
  assert.match(bad({ nights: ['2027-02-01'], from: '19:00', to: '21:00', party: 2 }, { today: '2026-11-04', trip: null })!, /next 60 days/);
  assert.equal(readWindow({ nights: ['2026-12-01'], from: '19:00', to: '21:00', party: 2 }, { today: '2026-11-04', trip: null }).ok, true);
});

test('the picker offers the trip\'s nights from today, and a watch ends after its last night everywhere', () => {
  assert.deepEqual(nightsOffered('2026-11-06', TRIP), ['2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(nightsOffered('2026-11-04', null).length, 14);
  assert.equal(expiresAtFor(['2026-11-06', '2026-11-08']), '2026-11-09T12:00:00.000Z');
  assert.equal(clockBetween('19:00', '21:30'), '20:15');
  assert.match(windowSaid({ nights: ['2026-11-06'], from: '19:00', to: '21:00', party: 4 }), /Fri, Nov 6 · 7:00 PM–9:00 PM for 4/);
});

// ── the offer ───────────────────────────────────────────────────────────

const OT = { restaurant: "Luigi's", platform: 'opentable' as const, reserveUrl: 'https://www.opentable.com/r/luigis', phone: '(919) 555-0100', onPlan: true, cited: true };
const ON = { instant: platform().instant, call: { ok: false as const, why: 'calls_off' as const }, migrated: true, running: true };

test('Reach says it watches only where a platform deal, the migration and a running schedule are all there', () => {
  const yes = offerFor(OT, ON);
  assert.equal(yes.can, 'platform');
  assert.match(yes.what, /^Reach checks OpenTable for a table at Luigi's on the nights you pick\. When one opens, OpenTable holds it for five minutes and Reach tells you — you tap to book it\.$/);
  assert.doesNotMatch(yes.what, /Reach (will )?books?\b/, 'a watch never books on its own');

  const idle = offerFor(OT, { ...ON, running: false });
  assert.equal(idle.can === 'none' && idle.why, 'not_running');
  const unmigrated = offerFor(OT, { ...ON, migrated: false });
  assert.equal(unmigrated.can === 'none' && unmigrated.why, 'not_ready');
  const uncited = offerFor({ ...OT, cited: false }, ON);
  assert.equal(uncited.can === 'none' && uncited.why, 'no_venue');
  for (const o of [idle, unmigrated, uncited]) assert.doesNotMatch(o.what, /Reach checks|Reach watches|we'll watch/i);

  // No plan to hold it on: told, never held.
  const discover = offerFor({ ...OT, onPlan: false }, ON);
  assert.match(discover.what, /tells you when one opens so you can book it\.$/);
  assert.doesNotMatch(discover.what, /holds/);
});

test('a platform Reach has no deal with: that platform\'s own alert, said as theirs; none promised where none is documented', () => {
  const resy = offerFor({ ...OT, platform: 'resy', reserveUrl: 'https://resy.com/cities/ny/carbone?date=2026-11-07&seats=4' }, { ...ON, instant: null });
  assert.equal(resy.can, 'none');
  if (resy.can !== 'none') return;
  assert.equal(resy.why, 'no_deal');
  assert.equal(resy.what, "Reach can't watch Resy for you yet. Resy has its own Notify.");
  assert.equal(resy.alert?.label, 'Set Resy Notify');
  assert.match(resy.alert!.say, /tap Notify/);
  assert.doesNotMatch(resy.alert!.say, /filled in|already set/i, 'no platform documents a pre-filled form');
  assert.equal(resy.phone, OT.phone, 'their number is the next option too');

  const seven = offerFor({ ...OT, platform: 'sevenrooms' }, { ...ON, instant: null });
  assert.equal(seven.can === 'none' && seven.alert, null, 'SevenRooms alerts are the restaurant\'s, not offered as a public feature');
  const yelp = offerFor({ ...OT, platform: 'yelp' }, { ...ON, instant: null });
  assert.equal(yelp.can === 'none' && yelp.alert, null, "Yelp's waitlist is a same-day queue, not an alert");
});

test('a phone-only restaurant: a cancellation list asked on Reach\'s own call only when calling is really open', () => {
  const phoneOnly = { ...OT, platform: 'none' as const, reserveUrl: null };
  const open = offerFor(phoneOnly, { ...ON, instant: null, call: { ok: true } });
  assert.equal(open.can, 'call_list');
  assert.match(open.what, /When Reach calls them for this table, it also asks whether they keep a cancellation list\./);
  const shut = offerFor(phoneOnly, { ...ON, instant: null });
  assert.equal(shut.can === 'none' && shut.why, 'phone_only');
  assert.match(shut.what, /Reach can't call for you yet\. Ring them/);
  // A Discover card has no booking for a call to be about.
  assert.equal(offerFor({ ...phoneOnly, onPlan: false }, { ...ON, instant: null, call: { ok: true } }).can, 'none');
});

test('no platform lets Reach book on terms accepted in advance, so nothing is pre-accepted', () => {
  assert.deepEqual(Object.keys(PRE_ACCEPTED), []);
});

test('the call asks about a cancellation list only when a watch asked it to', () => {
  const base = { restaurant: "Luigi's", venuePhone: '+19195550100', date: '2026-11-07', time: '19:30', partySize: 4, firstName: 'Maria' };
  const plain = checkFacts(base);
  const asked = checkFacts({ ...base, cancellationList: true });
  assert.ok(plain.ok && asked.ok);
  if (!plain.ok || !asked.ok) return;
  assert.doesNotMatch(instructions(plain.facts), /cancellation list/);
  assert.match(instructions(asked.facts), /ask whether they keep a cancellation list/);
  assert.match(instructions(asked.facts), /Do not give a phone number or put anybody on a list yourself/);
});

// ── which slot ──────────────────────────────────────────────────────────

test('the slot taken: a night watched, inside the range, not gone, never one already held, never one wanting a card', () => {
  const w = { nights: ['2026-11-06', '2026-11-07'], from: '19:00', to: '21:00', party: 4 };
  const ctx = { now: NOW, lng: LNG, seen: [] as string[] };
  const listed = [slot('2026-11-05', '20:00'), slot('2026-11-07', '20:00'), slot('2026-11-06', '18:30'), slot('2026-11-06', '21:30'), slot('2026-11-06', '19:00'), slot('2026-11-06', '20:15')];
  assert.deepEqual(pickSlot(listed, w, ctx).slot, slot('2026-11-06', '20:15'), 'earliest night, then nearest the middle of the range');
  assert.deepEqual(pickSlot(listed, w, { ...ctx, seen: ['2026-11-06T20:15'] }).slot, slot('2026-11-06', '19:00'));
  const card = pickSlot([slot('2026-11-06', '20:00', true)], w, ctx);
  assert.equal(card.slot, null);
  assert.deepEqual(card.card, slot('2026-11-06', '20:00', true));
  // At 20:30 on the 6th in Raleigh, the 6th's 20:15 has gone.
  assert.deepEqual(pickSlot(listed, w, { ...ctx, now: new Date('2026-11-07T01:30:00Z') }).slot, slot('2026-11-07', '20:00'));
});

// ── the check ───────────────────────────────────────────────────────────

function watch(over: Partial<WatchRow> = {}): WatchRow {
  return {
    id: 'w1', kind: 'table', user_id: 'u1', plan_id: 'p1', booking_id: 'b1', item_id: 'l1', target_ref: 'v1',
    method: 'platform', platform: 'opentable',
    spec: { restaurant: "Luigi's", nights: ['2026-11-06', '2026-11-07'], from: '19:00', to: '21:00', party: 4, lng: LNG, lapses: 0 },
    status: 'active', expires_at: '2026-11-08T12:00:00.000Z', next_check_at: NOW.toISOString(), last_checked_at: null,
    last_result: null, seen: [], hold: null, updated_at: '2026-11-04T17:00:00.000Z', ...over,
  };
}

const LOADED: LoadedTable = {
  restaurant: "Luigi's", urls: [OT_PROFILE], reserveUrl: 'https://www.opentable.com/r/luigis', lng: LNG,
  booking: { status: 'failed', confirmed: false, theirs: false, busy: false, holdId: null },
};

function checkDeps(o: { loaded?: LoadedTable | { gone: true } | null; instant?: InstantTable | null; hold?: (s: { date: string; time: string }) => ReserveResult } = {}) {
  const held: { date: string; time: string }[] = [];
  const deps: TableWatchDeps = {
    load: async () => (o.loaded === undefined ? LOADED : o.loaded),
    instantFor: urls => (o.instant === undefined ? null : o.instant && pickTable([o.instant.provider], urls)),
    async hold(_row, s) {
      held.push(s);
      return o.hold ? o.hold(s) : {
        ok: false, code: 'terms_required', status: 409, alternatives: [], error: 'Read the terms.',
        hold: { holdId: 'lock_9', platform: 'opentable', platformLabel: 'OpenTable', date: s.date, time: s.time, covers: 4, expiresAt: new Date(NOW.getTime() + 300_000).toISOString(), cancellationPolicy: null, policies: [], terms: null, fee: null, cancelBy: null, notes: null, editable: true },
        button: 'Complete reservation', title: 'Held for five minutes', body: 'Nothing is booked yet.', changeNote: null,
      };
    },
  };
  return { deps, held };
}
const CTX: CheckCtx = { now: NOW, budget: 60, throttled: new Set() };

test('a table that opens is HELD through press one and the person told to tap — never booked by the watch', async () => {
  const pl = platform(ask => ({ ok: true, slots: ask.date === '2026-11-07' ? [slot('2026-11-07', '20:30')] : [] }));
  const { deps, held } = checkDeps({ instant: pl.instant });
  const step = await checkTable(watch(), CTX, deps);
  assert.deepEqual(pl.asked.map(a => [a.date, a.time, a.covers]), [['2026-11-06', '20:00', 4], ['2026-11-07', '20:00', 4]], 'one request a night, around the middle of the range, for the watch\'s party');
  assert.deepEqual(held, [{ date: '2026-11-07', time: '20:30' }]);
  assert.equal(step.patch.status, 'held');
  assert.equal((step.patch.hold as { holdId?: string }).holdId, 'lock_9');
  assert.deepEqual(step.patch.seen, ['2026-11-07T20:30']);
  assert.equal(step.note?.title, "A table for 4 at Luigi's opened: Sat, Nov 7 at 8:30 PM");
  assert.equal(step.note?.body, 'OpenTable is holding it for five minutes. Tap to read the terms and book it.');
  assert.equal(step.note?.url, '/home?watch=w1');
  assert.doesNotMatch(`${step.note?.title} ${step.note?.body}`, /\bbooked\b|confirmed/i);
  assert.equal(step.calls, 2);
});

test('while the hold is live nothing is asked; booked by their tap ends it quietly as booked', async () => {
  const pl = platform(() => ({ ok: true, slots: [slot('2026-11-07', '20:30')] }));
  const h = { holdId: 'lock_9', date: '2026-11-07', time: '20:30', expiresAt: new Date(NOW.getTime() + 120_000).toISOString(), platform: 'opentable', button: 'Complete reservation', title: '', body: '', changeNote: null };
  const live = await checkTable(watch({ status: 'held', hold: h }), CTX, checkDeps({ instant: pl.instant, loaded: { ...LOADED, booking: { ...LOADED.booking!, holdId: 'lock_9', status: 'awaiting_approval' } } }).deps);
  assert.equal(live.calls, 0);
  assert.equal(pl.asked.length, 0);
  assert.equal(live.patch.status, undefined);
  assert.equal(live.note, undefined);

  const booked = await checkTable(watch({ status: 'held', hold: h }), CTX, checkDeps({ instant: pl.instant, loaded: { ...LOADED, booking: { ...LOADED.booking!, status: 'confirmed', confirmed: true } } }).deps);
  assert.equal(booked.patch.status, 'booked');
  assert.equal(booked.note, undefined, 'the booking itself told everybody');
});

test('a hold that ran out is said as lapsed, the watch carries on, and that slot is never held again', async () => {
  const pl = platform(() => ({ ok: true, slots: [slot('2026-11-07', '20:30')] }));
  const h = { holdId: 'lock_9', date: '2026-11-07', time: '20:30', expiresAt: new Date(NOW.getTime() - 1000).toISOString(), platform: 'opentable', button: 'Complete reservation', title: '', body: '', changeNote: null };
  const { deps, held } = checkDeps({ instant: pl.instant, loaded: { ...LOADED, booking: { ...LOADED.booking!, holdId: 'lock_9', status: 'awaiting_approval' } } });
  const lapsed = await checkTable(watch({ status: 'held', hold: h }), CTX, deps);
  assert.equal(lapsed.patch.status, 'active');
  assert.equal(lapsed.patch.hold, null);
  assert.deepEqual(lapsed.patch.seen, ['2026-11-07T20:30']);
  assert.equal((lapsed.patch.spec as { lapses?: number }).lapses, 1);
  assert.equal(lapsed.note?.title, "The table at Luigi's wasn't booked in time");
  assert.match(lapsed.note!.body, /no longer held\. Nothing was booked\. Reach is still watching\.$/);

  // The next check sees the same slot listed and leaves it.
  const again = await checkTable(watch({ seen: lapsed.patch.seen as string[], spec: lapsed.patch.spec as Record<string, unknown> }), CTX, deps);
  assert.equal(held.length, 0, 'the lapsed slot was held again');
  assert.equal(again.patch.status, undefined);

  // The third lapse stops it, and says so.
  const third = await checkTable(watch({ status: 'held', hold: h, spec: { ...watch().spec, lapses: 2 } }), CTX, deps);
  assert.equal(third.patch.status, 'ended');
  assert.match(third.note!.body, /3 tables gone by, so Reach has stopped watching/);
});

test('nothing is polled where Reach cannot: no platform keys, a phone-only list, a booked table, a watch past its nights', async () => {
  const pl = platform(() => ({ ok: true, slots: [slot('2026-11-07', '20:30')] }));
  const off = await checkTable(watch(), CTX, checkDeps({ instant: null }).deps);
  assert.equal(off.calls, 0);
  assert.equal((off.patch.last_result as { found?: string }).found, 'platform_off');

  const list = await checkTable(watch({ method: 'call_list' }), CTX, checkDeps({ instant: pl.instant }).deps);
  assert.equal(list.calls, 0);

  const theirs = await checkTable(watch(), CTX, checkDeps({ instant: pl.instant, loaded: { ...LOADED, booking: { ...LOADED.booking!, theirs: true } } }).deps);
  assert.equal(theirs.patch.status, 'ended');
  assert.equal(theirs.note, undefined);

  const gone = await checkTable(watch(), CTX, checkDeps({ instant: pl.instant, loaded: { gone: true } }).deps);
  assert.equal(gone.patch.status, 'ended');

  const late = await checkTable(watch({ expires_at: NOW.toISOString() }), CTX, checkDeps({ instant: pl.instant }).deps);
  assert.equal(late.patch.status, 'expired');
  assert.equal(late.note?.body, 'The nights you picked have gone. Nothing was booked.');
  assert.equal(pl.asked.length, 0, 'a platform was asked anyway');
});

test('a platform that says slow down is asked nothing more; the budget is never overrun', async () => {
  const pl = platform(() => ({ ok: false, code: 'rate_limited', error: 'slow down' }));
  const step = await checkTable(watch(), CTX, checkDeps({ instant: pl.instant }).deps);
  assert.equal(step.throttled, 'opentable');
  assert.equal(pl.asked.length, 1, 'kept asking after a 429');
  const later = await checkTable(watch(), { ...CTX, throttled: new Set(['opentable']) }, checkDeps({ instant: pl.instant }).deps);
  assert.equal(later.calls, 0);
  assert.equal(pl.asked.length, 1);

  const quiet = platform(() => ({ ok: true, slots: [] }));
  const one = await checkTable(watch(), { ...CTX, budget: 1 }, checkDeps({ instant: quiet.instant }).deps);
  assert.equal(one.calls, 1);
  assert.equal(quiet.asked.length, 1);
});

test('a watch with no plan tells, with the platform\'s page, and holds nothing', async () => {
  const pl = platform(() => ({ ok: true, slots: [{ date: '2026-11-07', time: '20:30', needsCard: false, handoffUrl: 'https://www.opentable.com/booking/slot' }] }));
  const { deps, held } = checkDeps({ instant: pl.instant, loaded: { ...LOADED, booking: null } });
  const step = await checkTable(watch({ plan_id: null, booking_id: null }), CTX, deps);
  assert.equal(held.length, 0);
  assert.equal(step.patch.status, undefined);
  assert.equal((step.patch.last_result as { link?: string }).link, 'https://www.opentable.com/booking/slot');
  assert.match(step.note!.body, /^Reach can't hold it from here\. Book it on OpenTable/);
});

test('a slot gone before the hold is said to nobody, and the watch keeps looking', async () => {
  const pl = platform(() => ({ ok: true, slots: [slot('2026-11-07', '20:30')] }));
  const { deps } = checkDeps({ instant: pl.instant, hold: () => ({ ok: false, code: 'slot_gone', status: 409, error: 'gone', alternatives: [] }) });
  const step = await checkTable(watch(), CTX, deps);
  assert.equal(step.note, undefined);
  assert.equal(step.patch.status, undefined);
  assert.deepEqual(step.patch.seen, undefined, 'a slot nobody held is not marked seen');
});

// ── press one, through the one booking path ─────────────────────────────

function bookingRow(over: Partial<TableRow> = {}): TableRow {
  return {
    id: 'b1', plan_id: 'p1', vertical: 'restaurant', mode: 'redirect', provider: 'restaurant_handoff', status: 'failed',
    updated_at: '2026-11-04T17:00:00.000Z', approved_at: null,
    request_payload: { party: 4, restaurant: { name: "Luigi's", date: '2026-11-07', time: '19:30', partySize: 4 } },
    response_payload: {},
    ...over,
  };
}

function memory(start: TableRow) {
  const rows = new Map<string, TableRow & Record<string, unknown>>([[start.id, { ...start }]]);
  const notes: string[] = [];
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 10, 4, 18, 0, 0, ++clock)).toISOString();
  const flow: FlowStore = {
    async write(id, version, patch) {
      const r = rows.get(id);
      if (!r || (r.updated_at ?? null) !== (version ?? null)) return { ok: false, taken: true };
      const v = tick();
      Object.assign(r, patch, { updated_at: v });
      return { ok: true, version: v };
    },
  };
  const store: TableStore = {
    async reopen(id, from, version, patch) {
      const r = rows.get(id);
      if (!r || r.status !== from || (r.updated_at ?? null) !== (version ?? null)) return { ok: false, taken: true };
      Object.assign(r, patch, { status: 'awaiting_approval', updated_at: tick() });
      return { ok: true, version: r.updated_at ?? null };
    },
    async write(id, from, version, patch) {
      const r = rows.get(id);
      if (!r || r.status !== from || (r.updated_at ?? null) !== (version ?? null)) return null;
      Object.assign(r, patch, { updated_at: tick() });
      return { ...r };
    },
    flow,
    async callOpen() { return false; },
    async retime() { return true; },
    async members() { return ['u1', 'u2']; },
    async notify(_to, note) { notes.push(note.title); },
  };
  return { store, notes, get: () => rows.get(start.id)! };
}

function pressOne(b: TableRow, time: string, watchPress = true): ReserveInput {
  return {
    booking: { ...b },
    facts: { bookingId: 'b1', itemId: 'l1', restaurant: "Luigi's", city: 'Raleigh', platform: 'opentable', date: '2026-11-07', time: '19:30', partySize: 4, phone: '(919) 555-0100', reserveUrl: null, urls: [OT_PROFILE], solo: false },
    plan: { id: 'p1', group_id: 'g1', solo: false, start_date: TRIP.start, end_date: TRIP.end },
    requester: { id: 'u1', firstName: 'Maria', lastName: 'Lopez', email: 'maria@example.com', phone: '+19195550111' },
    chosen: { path: 'instant', date: '2026-11-07', time, ...(watchPress ? { watch: true } : {}) },
    venue: { name: "Luigi's", phone: '(919) 555-0100', opening_hours: null, lng: LNG, reserveUrl: null },
    now: NOW,
  };
}
const reserveDeps = (store: TableStore, p: TableProvider): ReserveDeps => ({
  instantFor: urls => pickTable([p], urls), bookedOn: () => null, callCheck: async () => ({ ok: false, why: 'calls_off' }), store, call: null,
});

test('press one from a watch holds the exact slot and books nothing', async () => {
  const pl = platform(ask => ({ ok: true, slots: [slot(ask.date, '20:30')] }));
  const m = memory(bookingRow());
  const r = await reserveTable(pressOne(m.get(), '20:30'), reserveDeps(m.store, pl.p));
  assert.equal(r.ok === false && r.code, 'terms_required');
  assert.equal(r.ok === false && r.hold?.time, '20:30');
  assert.equal(m.get().status, 'awaiting_approval');
  assert.notEqual(m.get().status, 'confirmed');
  assert.deepEqual(m.notes, [], 'a hold is told by the watch, not by the booking path');
});

test('press one from a watch, the slot gone: nothing written, nobody told, the row as it was', async () => {
  const pl = platform(ask => ({ ok: true, slots: [slot(ask.date, '22:00')] }));
  const m = memory(bookingRow());
  const r = await reserveTable(pressOne(m.get(), '20:30'), reserveDeps(m.store, pl.p));
  assert.equal(r.ok === false && r.code, 'slot_gone');
  assert.equal(pl.holds.length, 0);
  assert.equal(m.get().status, 'failed', 'the row was left reopened');
  assert.deepEqual(m.get().response_payload, {}, 'an offered-times mark was written');
  assert.deepEqual(m.notes, []);

  // The same press from a person still offers the other time, as before.
  const person = memory(bookingRow());
  const said = await reserveTable(pressOne(person.get(), '20:30', false), reserveDeps(person.store, pl.p));
  assert.equal(said.ok === false && said.code, 'other_time');
});

test('press one from a watch, a card wanted: not handed off, nothing written', async () => {
  const pl = platform(ask => ({ ok: true, slots: [slot(ask.date, '20:30', true)] }));
  const m = memory(bookingRow());
  const r = await reserveTable(pressOne(m.get(), '20:30'), reserveDeps(m.store, pl.p));
  assert.equal(r.ok === false && r.code, 'needs_card');
  assert.equal(m.get().status, 'failed');
});

// ── the run ─────────────────────────────────────────────────────────────

function runStore(rows: WatchRow[], o: { taken?: string[]; unsaved?: string[]; missing?: boolean } = {}) {
  const saved: { id: string; patch: Record<string, unknown> }[] = [];
  const told: string[] = [];
  const store: WatchStore = {
    async due() { return { rows, missing: !!o.missing }; },
    async claim(row) { return o.taken?.includes(row.id) ? { ok: false } : { ok: true, version: `v-${row.id}` }; },
    async save(id, version, patch) {
      assert.equal(version, `v-${id}`, 'saved at a version the claim did not leave');
      if (o.unsaved?.includes(id)) return false;
      saved.push({ id, patch }); return true;
    },
    async notify(_u, note) { told.push(note.title); },
  };
  return { store, saved, told };
}
const stepping = (step: Partial<WatchStep>) => ({ kind: 'table' as const, check: async () => ({ patch: {}, calls: 1, ...step }) });

test('a run claims each watch, skips one another run took, tells nobody about a watch stopped meanwhile, and keeps to its budget', async () => {
  const rows = ['a', 'b', 'c', 'd'].map(id => watch({ id }));
  const s = runStore(rows, { taken: ['b'], unsaved: ['c'] });
  const r = await runWatches(s.store, [stepping({ note: { title: 'opened', body: '', url: '/home', planId: null }, calls: 1 })], { now: NOW, budget: 2 });
  assert.equal(r.skipped, 1);
  assert.deepEqual(s.saved.map(x => x.id), ['a']);
  assert.equal(s.told.length, 1, 'a watch whose save failed was told about');
  assert.equal(r.deferred, 1, 'the budget was overrun');
  assert.equal(r.calls, 2);
});

test('a run with no watches table stops and says so', async () => {
  const r = await runWatches(runStore([], { missing: true }).store, [stepping({})], { now: NOW });
  assert.equal(r.stopped, 'not_migrated');
});

test('the limits are the ones the screens and the migration describe', () => {
  assert.equal(TABLE_WATCH.perPerson, 3);
  assert.equal(TABLE_WATCH.nights, 7);
  assert.ok(TABLE_WATCH.nearMinutes >= 15, 'checked more often than every fifteen minutes');
});
