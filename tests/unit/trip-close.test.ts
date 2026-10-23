import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  closeAsk, closeDay, isCloseScore, lastDayOf, nextOffer, settleFor, somethingHeld, startedFromClose,
  type ClosePlan,
} from '../../lib/trip-close.ts';
import type { PingBooking, PingLine } from '../../lib/pings.ts';
import type { SettleLine } from '../../lib/money.ts';

const NYC = -74;
/** `hour` o'clock on `day` in New York (UTC-5 by longitude). */
const nyc = (day: string, hour: number) => new Date(Date.parse(`${day}T00:00:00Z`) + (hour + 5) * 3_600_000);

const plan = (over: Partial<ClosePlan> = {}): ClosePlan => ({
  id: 'p1', group_id: 'g1', type: 'trip', status: 'booked',
  start_date: '2026-11-06', end_date: '2026-11-08', destination_lng: NYC, ...over,
});
const dinner: PingLine = { id: 'l1', type: 'restaurant', title: 'Lilia', scheduled_time: 'Day 1 · 7:30 PM', is_confirmed: false };
const held: PingBooking = { id: 'b1', itinerary_item_id: 'l1', vertical: 'restaurant', mode: 'native', status: 'confirmed' };
const ask = (over: Partial<Parameters<typeof closeAsk>[0]> = {}) =>
  closeAsk({ plan: plan(), lines: [dinner], bookings: [held], joinedAt: '2026-10-01T12:00:00Z', now: nyc('2026-11-09', 10), ...over });

// ── when ──

test('the morning after the last day, on the trip\'s clock, the card is shown', () => {
  assert.deepEqual(ask(), { ask: true, why: null, endedOn: '2026-11-08' });
});

test('at 8pm on the last day in New York — already the 9th in UTC — the trip is not over', () => {
  const r = ask({ now: nyc('2026-11-08', 20) });
  assert.equal(r.ask, false);
  assert.equal(r.why, 'not_over');
});

test('a plan with no point on the map waits until the trip is over everywhere', () => {
  // 6am on the 9th in New York is 11:00 UTC — still 11pm on the 8th at UTC-12.
  const early = nyc('2026-11-09', 6);
  assert.equal(ask({ now: early }).ask, true);
  const r = ask({ plan: plan({ destination_lng: null }), now: early });
  assert.equal(r.why, 'not_over');
  assert.equal(closeDay(null, early), '2026-11-08');
  assert.equal(ask({ plan: plan({ destination_lng: null }), now: nyc('2026-11-09', 8) }).ask, true);
});

test('a night out is over the day after its date', () => {
  const night = plan({ type: 'restaurant', start_date: '2026-11-06', end_date: null });
  assert.equal(ask({ plan: night, now: nyc('2026-11-06', 23) }).why, 'not_over');
  assert.equal(ask({ plan: night, now: nyc('2026-11-07', 9) }).ask, true);
  assert.equal(lastDayOf({ start_date: '2026-11-06', end_date: '2026-11-01' }), '2026-11-06');
});

test('no dates, no card: there is no end to be after', () => {
  assert.equal(ask({ plan: plan({ start_date: null, end_date: null }) }).why, 'no_dates');
});

test('a called-off trip is not asked about', () => {
  assert.equal(ask({ plan: plan({ status: 'cancelled' }) }).why, 'cancelled');
});

test('completed is read from the dates, not the status: a booked plan whose dates have passed is closed', () => {
  // Nothing flips status to completed; the card does not wait for it.
  assert.equal(ask({ plan: plan({ status: 'booked' }) }).ask, true);
  assert.equal(ask({ plan: plan({ status: 'planning' }) }).ask, true);
});

// ── something was held ──

test('a trip nobody booked anything for is not one anybody can be asked about', () => {
  assert.equal(ask({ bookings: [] }).why, 'nothing_held');
  assert.equal(ask({ bookings: [{ ...held, status: 'awaiting_approval' }] }).why, 'nothing_held');
  // A line still saying is_confirmed over a booking that was cancelled is cancelled.
  assert.equal(ask({ lines: [{ ...dinner, is_confirmed: true }], bookings: [{ ...held, status: 'cancelled' }] }).why, 'nothing_held');
});

test('a line booked elsewhere with its confirmation number, or marked booked by hand, counts', () => {
  assert.equal(somethingHeld([dinner], [{ ...held, mode: 'redirect', status: 'redirected', confirmation_number: 'XK42' }]), true);
  assert.equal(somethingHeld([dinner], [{ ...held, mode: 'redirect', status: 'redirected' }]), false);
  assert.equal(somethingHeld([{ ...dinner, is_confirmed: true }], []), true);
  // A confirmed flight with no line on the itinerary is still the trip.
  assert.equal(somethingHeld([], [{ id: 'f1', vertical: 'flight', mode: 'native', status: 'confirmed' }]), true);
});

// ── who ──

test('somebody who joined the group after the trip was not on it', () => {
  assert.equal(ask({ joinedAt: '2026-11-09T09:00:00Z' }).why, 'joined_after');
  assert.equal(ask({ joinedAt: '2026-11-08T09:00:00Z' }).ask, true);
  // An old row with no timestamp is not evidence they were not there.
  assert.equal(ask({ joinedAt: null }).ask, true);
});

test('three answers, and nothing else', () => {
  for (const s of [1, 2, 3]) assert.equal(isCloseScore(s), true);
  for (const s of [0, 4, 2.5, '3', null, undefined, 10]) assert.equal(isCloseScore(s), false, String(s));
});

// ── the ledger, from this person's side ──

test('unsettled says whether this person has money to move, either way, and nobody else\'s', () => {
  const lines: SettleLine[] = [
    { from: 'ben', to: 'ana', amountCents: 4200, pending: null },
    { from: 'cy', to: 'ben', amountCents: 1000, pending: { id: 's1', amountCents: 1000, method: 'venmo', createdAt: null } },
    { from: 'cy', to: 'ana', amountCents: 700, pending: null },
  ];
  assert.deepEqual(settleFor('ben', lines, true), { available: true, unsettled: true, youOweCents: 4200, owedToYouCents: 1000, pending: true });
  assert.deepEqual(settleFor('dee', lines, true), { available: true, unsettled: false, youOweCents: 0, owedToYouCents: 0, pending: false });
  // A zero line kept only for its pending claim is not money still to move.
  assert.equal(settleFor('ana', [{ from: 'ben', to: 'ana', amountCents: 0, pending: { id: 's2', amountCents: 500, method: 'cashapp', createdAt: null } }], true).unsettled, false);
});

// ── the next one ──

test('"Plan the next one?" is the same group and kind, and says when one is already being planned', () => {
  assert.deepEqual(nextOffer(plan(), null), { groupId: 'g1', type: 'trip', fromClose: 'p1', blockedBy: null });
  assert.deepEqual(nextOffer(plan({ type: 'restaurant' }), { id: 'p9', title: 'Tacos' }),
    { groupId: 'g1', type: 'restaurant', fromClose: 'p1', blockedBy: { id: 'p9', title: 'Tacos' } });
  assert.equal(nextOffer(plan({ type: 'something new' }), null).type, 'trip');
});

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const result = async () => ({ data: (tables[table] ?? []).filter(r => filters.every(f => f(r))), error: null });
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q; },
      maybeSingle: async () => { const r = await result(); return { data: r.data[0] ?? null, error: null }; },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result().then(ok, bad),
    };
    return q;
  };
  return { from } as never;
}
const source = (over: Row = {}) => fakeDb({
  plans: [{ ...plan(), ...over }],
  itinerary_items: [{ ...dinner, plan_id: 'p1' }],
  bookings: [{ ...held, plan_id: 'p1' }],
});

test('a new plan counts as started from the close card only from a card that could be shown, in the same group', async () => {
  const now = nyc('2026-11-09', 10);
  assert.deepEqual(await startedFromClose(source(), { sourceId: 'p1', groupId: 'g1', now }), { ok: true, sourceType: 'trip' });
  assert.deepEqual(await startedFromClose(source(), { sourceId: 'p1', groupId: 'g2', now }), { ok: false, why: 'other_group' });
  assert.deepEqual(await startedFromClose(source(), { sourceId: 'nope', groupId: 'g1', now }), { ok: false, why: 'no_source' });
  assert.deepEqual(await startedFromClose(source(), { sourceId: 'p1', groupId: 'g1', now: nyc('2026-11-07', 10) }), { ok: false, why: 'not_over' });
});

// ── counted once ──

test('next_trip_started_from_close is written by the plan route after the plan exists, and only there', () => {
  const route = readFileSync(new URL('../../app/api/plans/route.ts', import.meta.url), 'utf8');
  const insert = route.indexOf(".from('plans').insert(row)");
  const counted = route.indexOf("'next_trip_started_from_close'");
  assert.ok(insert > 0 && counted > insert, 'counted before the plan exists');
  // Only when the source checks out.
  assert.match(route, /if \(from\.ok === true\) \{\s*void track\(supabase, 'next_trip_started_from_close'/);
  assert.ok(route.lastIndexOf('startedFromClose(', counted) > insert, 'the source is checked after the insert, before the count');
  // The close route offers, and never counts or creates.
  const close = readFileSync(new URL('../../app/api/plans/[planId]/close/route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(close, /next_trip_started_from_close|from\('plans'\)\.insert|track\(/);
});

test('v_organizer_conversion counts plan_created alone, so a plan from the close card is counted there once', () => {
  const sql = readFileSync(new URL('../../sql/events-2026-09-20.sql', import.meta.url), 'utf8');
  const view = sql.slice(sql.indexOf('create or replace view public.v_organizer_conversion'));
  const body = view.slice(0, view.indexOf(';'));
  assert.match(body, /e\.name = 'plan_created'/);
  assert.doesNotMatch(body, /next_trip_started_from_close/);
  // And the plan route writes one plan_created per plan.
  const route = readFileSync(new URL('../../app/api/plans/route.ts', import.meta.url), 'utf8');
  assert.equal(route.match(/track\(supabase, 'plan_created'/g)?.length, 1);
});
