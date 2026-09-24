// Run with: npm run test:unit
// What POST /api/bookings does with a flight or hotel the plan already has,
// run against a stand-in database: the order of fits / stale / twin, the
// held quote, and the one write that prices a stale row again in place.
// The route calls exactly these (settle, restated, writeRepriced); a route
// file cannot be imported here, so its wiring is checked by source below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readParty, settle, restated, writeRepriced, staleRows, expectedFor } from '../../lib/booking/reprice.ts';
import { partyChange } from '../../lib/booking/party.ts';
import { beforeJoining, afterJoining } from '../../lib/joining.ts';
import { partySize } from '../../lib/participation.ts';

type Row = Record<string, any>;

// ── A stand-in for the database ──────────────────────────────────────────
// Every chained call the lib makes: select, eq, in, is, not, limit, update,
// upsert, maybeSingle, a count head read, and awaiting the chain. `fail`
// fails every call on a table; `writes` records each update that matched.
function makeDb(tables: Record<string, Row[]>, fail: Record<string, { code: string; message?: string }> = {}) {
  const writes: { table: string; patch: Row; ids: unknown[] }[] = [];
  const t = (name: string) => (tables[name] ??= []);
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' = 'select';
    let patch: Row = {};
    let head = false;
    let limit = Infinity;
    const matching = () => t(table).filter(r => filters.every(f => f(r))).slice(0, limit);
    const result = () => {
      if (fail[table]) return { data: null, error: fail[table], count: null };
      if (op === 'update') {
        const hit = matching();
        hit.forEach(r => Object.assign(r, patch));
        if (hit.length) writes.push({ table, patch, ids: hit.map(r => r.id) });
        return { data: hit.map(r => ({ ...r })), error: null, count: null };
      }
      const rows = matching();
      return { data: head ? null : rows, error: null, count: rows.length };
    };
    const b: any = {
      select(_c?: string, o?: { head?: boolean }) { if (o?.head) head = true; return b; },
      eq(col: string, val: any) { filters.push(r => r[col] === val); return b; },
      neq(col: string, val: any) { filters.push(r => r[col] !== val); return b; },
      in(col: string, vals: any[]) { filters.push(r => vals.includes(r[col])); return b; },
      is(col: string, val: any) { filters.push(r => (r[col] ?? null) === val); return b; },
      not(col: string, o: string, val: any) {
        if (o === 'is') filters.push(r => (r[col] ?? null) !== val);
        return b;
      },
      limit(n: number) { limit = n; return b; },
      update(p: Row) { op = 'update'; patch = p; return b; },
      upsert(rows: Row[]) {
        if (fail[table]) return Promise.resolve({ error: fail[table] });
        for (const row of rows) {
          if (!t(table).some(r => r.plan_id === row.plan_id && r.item_ref === row.item_ref && r.user_id === row.user_id)) t(table).push(row);
        }
        return Promise.resolve({ error: null });
      },
      maybeSingle() { const r = result(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
      then(resolve: any, reject: any) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return b;
  };
  return { db: { from } as any, writes };
}

const T0 = '2026-09-23T10:00:00.000Z';
const flightReq = (seats: number, extra: Row = {}) => ({
  vertical: 'flight', itineraryItemId: 'line-f', title: 'Flight to Puerto Vallarta', travelers: [],
  party: seats,
  flight: { origin: 'RDU', destination: 'PVR', departDate: '2026-11-02', returnDate: '2026-11-09', offerKey: 'AA100/AA101', seats },
  ...extra,
});
const hotelReq = (party: number, extra: Row = {}) => ({
  vertical: 'hotel', itineraryItemId: 'line-h', title: 'Hotel', travelers: [], party,
  hotel: { hotelId: 'lp81ecd', city: 'Puerto Vallarta', checkin: '2026-11-02', checkout: '2026-11-09', rooms: 1 },
  ...extra,
});
const booking = (id: string, status: string, req: Row, extra: Row = {}) => ({
  id, plan_id: 'p1', vertical: req.vertical, mode: 'native', provider: req.vertical === 'flight' ? 'duffel' : 'liteapi',
  status, request_payload: req, price_cents: 30000, approved_at: null, updated_at: T0, ...extra,
});

/** A trip for one that a second person has joined: nothing paid, nothing bought. */
function joined(rows: Row[], extra: Record<string, Row[]> = {}) {
  return {
    group_members: [{ group_id: 'g1', user_id: 'u-solo' }, { group_id: 'g1', user_id: 'u-new' }],
    item_optouts: [] as Row[],
    contributions: [] as Row[],
    bookings: rows,
    ...extra,
  };
}
const plan = { group_id: 'g1', solo_mode: false };
const unpaid = async () => false;
const quote = (priceCents: number, extra: Row = {}) => ({
  vertical: 'flight', mode: 'native', status: 'awaiting_approval', provider: 'duffel', providerRef: 'off_2',
  priceCents, currency: 'USD', detail: 'AA100 · 2 seats', raw: { offerKey: 'AA100/AA101' }, ...extra,
});

// ── Who is going ─────────────────────────────────────────────────────────

test('who is going is read so that a failure is a failure', async () => {
  const { db } = makeDb(joined([]));
  const going = await readParty(db, plan, 'p1');
  assert.deepEqual(going, { party: 2, memberIds: ['u-solo', 'u-new'], skips: [] });
  assert.equal(await readParty(makeDb(joined([]), { group_members: { code: 'XX000' } }).db, plan, 'p1'), null,
    'partySize answers one when the count fails, and one is a real number to price for');
  assert.equal(await readParty(makeDb(joined([]), { item_optouts: { code: 'XX000' } }).db, plan, 'p1'), null);
  const noTable = await readParty(makeDb(joined([]), { item_optouts: { code: 'PGRST205' } }).db, plan, 'p1');
  assert.deepEqual(noTable?.skips, [], 'before sql/preferences-v1.sql nobody is kept off anything');
});

test('readParty counts as partySize does, so quote, funding and approval agree', async () => {
  for (const p of [{ group_id: 'g1', solo_mode: false }, { group_id: 'g1', solo_mode: true }]) {
    const { db } = makeDb(joined([]));
    assert.equal((await readParty(db, p, 'p1'))!.party, await partySize(db, p), `solo_mode ${p.solo_mode}`);
  }
});

// ── The order POST /api/bookings settles a request in ────────────────────

test('nothing on the plan: a new quote', async () => {
  const going = { party: 2, memberIds: ['u-solo', 'u-new'], skips: [] };
  assert.equal((await settle([], flightReq(2), going, unpaid)).kind, 'new');
  assert.equal((await settle([booking('b', 'cancelled', flightReq(1))], flightReq(2), going, unpaid)).kind, 'new',
    'a cancelled row is the reason somebody is asking again');
});

test('a live row of the right size wins over re-pricing a stale twin', async () => {
  const going = { party: 2, memberIds: ['u-solo', 'u-new'], skips: [] };
  const staleOne = booking('old', 'awaiting_approval', flightReq(1));
  const fits = booking('new', 'awaiting_approval', flightReq(2));
  const m = await settle([staleOne, fits], flightReq(2), going, unpaid);
  assert.equal(m.kind, 'twin');
  assert.equal(m.kind === 'twin' && m.row.id, 'new');
});

test('a stale proposal is priced again only at exactly the route’s count, and never once paid', async () => {
  const going = { party: 2, memberIds: ['u-solo', 'u-new'], skips: [] };
  const rows = [booking('f', 'awaiting_approval', flightReq(1))];
  const m = await settle(rows, flightReq(2), going, unpaid);
  assert.equal(m.kind, 'stale');
  assert.equal(m.kind === 'stale' && m.party, 2);
  assert.equal((await settle(rows, flightReq(9), going, unpaid)).kind, 'twin', 'seats: 9 from any member is not a re-price');
  assert.equal((await settle(rows, flightReq(2), null, unpaid)).kind, 'twin', 'unsized: who is going could not be read');
  assert.equal((await settle(rows, flightReq(2), going, async () => true)).kind, 'twin', 'paid, or unknown, is handed back');
  let asked = 0;
  await settle(rows, flightReq(1), { ...going, party: 1, memberIds: ['u-solo'] }, async () => { asked++; return false; });
  assert.equal(asked, 0, 'payments are only asked about when something would be re-priced');
});

test('a held quote is handed back as it is, never re-priced or retired', async () => {
  const going = { party: 2, memberIds: ['u-solo', 'u-new'], skips: [] };
  const held = booking('h', 'quoted', flightReq(1));
  const m = await settle([held], flightReq(2), going, unpaid);
  assert.equal(m.kind, 'twin');
  assert.equal(m.kind === 'twin' && m.row, held);
  assert.deepEqual(staleRows([held], going), [], 'and funding does not refuse money over it: it is in nobody’s share');
  // Let go of, it is a proposal again, stale, and priced again before anybody pays.
  assert.deepEqual(staleRows([{ ...held, status: 'awaiting_approval' }], going).map(r => r.id), ['h']);
});

test('a row mid-booking is handed back, whatever size it says', async () => {
  const going = { party: 2, memberIds: ['u-solo', 'u-new'], skips: [] };
  const claimed = booking('f', 'awaiting_approval', flightReq(1), { approved_at: T0, updated_at: T0 });
  assert.equal((await settle([claimed], flightReq(2), going, unpaid)).kind, 'twin');
});

// ── The write ────────────────────────────────────────────────────────────

test('a stale row is priced again in place: same row, same flights, new size and price', async () => {
  const tables = joined([booking('f', 'awaiting_approval', flightReq(1), { itinerary_item_id: 'line-f' })]);
  const { db, writes } = makeDb(tables);
  const row = tables.bookings[0];
  const ask = restated(row, 2, { itineraryItemId: 'line-f' });
  assert.equal((ask as any).flight.offerKey, 'AA100/AA101', 'the flights that were chosen, not the request’s');
  const out = await writeRepriced(db, row, ask, quote(60000), unpaid);
  assert.deepEqual(out, { ok: true });
  assert.equal(tables.bookings.length, 1, 'no second row, nothing retired');
  const now = tables.bookings[0];
  assert.equal(now.status, 'awaiting_approval');
  assert.equal(now.itinerary_item_id, 'line-f', 'still linked to its line');
  assert.equal(now.price_cents, 60000);
  assert.equal(now.request_payload.flight.seats, 2);
  assert.equal(now.request_payload.party, 2);
  assert.equal(writes.length, 1);
});

test('a re-price that fails changes nothing, and says the trip cannot be paid until it is priced', async () => {
  const tables = joined([booking('f', 'awaiting_approval', flightReq(1))]);
  const { db, writes } = makeDb(tables);
  const before = JSON.stringify(tables.bookings);
  const out = await writeRepriced(db, tables.bookings[0], restated(tables.bookings[0], 2),
    { status: 'failed', error: 'Sam needs to add their travel details' }, unpaid);
  assert.equal(out.ok, false);
  assert.equal(out.why, 'unpriced');
  assert.match(out.error!, /priced for 1 person and 2 are going now/);
  assert.match(out.error!, /Sam needs to add their travel details/);
  assert.match(out.error!, /Nobody can pay/);
  assert.equal(JSON.stringify(tables.bookings), before, 'not cancelled, not unlinked, not repriced');
  assert.equal(writes.length, 0);
});

test('a payment that lands while the provider answers keeps the price it was paid against', async () => {
  const tables = joined([booking('f', 'awaiting_approval', flightReq(1))]);
  const { db, writes } = makeDb(tables);
  const out = await writeRepriced(db, tables.bookings[0], restated(tables.bookings[0], 2), quote(60000), async () => true);
  assert.equal(out.why, 'paid');
  assert.equal(writes.length, 0);
});

test('an approval that claimed the row meanwhile wins: nothing is written over it', async () => {
  const tables = joined([booking('f', 'awaiting_approval', flightReq(1))]);
  const { db, writes } = makeDb(tables);
  const asRead = { ...tables.bookings[0] };
  // The claim moves the version (lib/booking/claim.ts); the row as read is older.
  Object.assign(tables.bookings[0], { status: 'booking', approved_at: '2026-09-23T10:00:05.000Z', updated_at: '2026-09-23T10:00:05.000Z' });
  const out = await writeRepriced(db, asRead, restated(asRead, 2), quote(60000), unpaid);
  assert.equal(out.why, 'changed');
  assert.equal(writes.length, 0);
  assert.equal(tables.bookings[0].status, 'booking');
  assert.equal(tables.bookings[0].price_cents, 30000);
  // Before sql/wave1-bookings-2026-09-22.sql the claim is only a stamp: the
  // status still reads awaiting_approval, and only the version says it moved.
  const t1 = joined([booking('f', 'awaiting_approval', flightReq(1))]);
  const stamp = makeDb(t1);
  const readFirst = { ...t1.bookings[0] };
  Object.assign(t1.bookings[0], { approved_at: '2026-09-23T10:00:05.000Z', updated_at: '2026-09-23T10:00:05.000Z' });
  assert.equal((await writeRepriced(stamp.db, readFirst, restated(readFirst, 2), quote(60000), unpaid)).why, 'changed');
  assert.equal(stamp.writes.length, 0, 'a stamped claim is not written over');
  // The same with the version unchanged but the status moved to held.
  const t2 = joined([booking('f', 'quoted', flightReq(1))]);
  const second = makeDb(t2);
  const held = await writeRepriced(second.db, { ...t2.bookings[0], status: 'awaiting_approval' }, restated(t2.bookings[0], 2), quote(60000), unpaid);
  assert.equal(held.why, 'changed', 'the write only ever lands on a proposal');
  assert.equal(second.writes.length, 0);
});

test('a hotel priced before hotels were pinned is pinned to the one this price is for', async () => {
  const req = hotelReq(1, { hotel: { city: 'Puerto Vallarta', checkin: '2026-11-02', checkout: '2026-11-09', rooms: 1 } });
  const tables = joined([booking('h', 'awaiting_approval', req)]);
  const { db } = makeDb(tables);
  await writeRepriced(db, tables.bookings[0], restated(tables.bookings[0], 3),
    quote(90000, { vertical: 'hotel', provider: 'liteapi', raw: { hotelId: 'lpNEW', hotel: { name: 'Hotel Rio' } } }), unpaid);
  assert.equal(tables.bookings[0].request_payload.hotel.hotelId, 'lpNEW');
  assert.equal(tables.bookings[0].request_payload.hotel.rooms, 2, 'three people, two rooms');
});

// ── The solo trip, end to end ────────────────────────────────────────────
// Review item 1: a trip for one priced for one, somebody joins, and approval
// must book them both — never one seat after two people paid for two.

test('solo → two, unpaid: priced again for two, funding waits for it, approval names two', async () => {
  const tables: Record<string, Row[]> = {
    plans: [{ id: 'p1', group_id: 'g1', solo_mode: true }],
    group_members: [{ group_id: 'g1', user_id: 'u-solo' }],
    item_optouts: [], contributions: [],
    bookings: [booking('f', 'awaiting_approval', flightReq(1)), booking('h', 'awaiting_approval', hotelReq(1))],
  };
  const { db } = makeDb(tables);
  // The join, as every membership path runs it.
  assert.equal((await beforeJoining(db, 'g1', 'u-new')).ok, true);
  tables.group_members.push({ group_id: 'g1', user_id: 'u-new' });
  await afterJoining(db, 'g1');
  assert.deepEqual(tables.item_optouts, [], 'nothing bought, nothing paid: the newcomer is on both');
  const livePlan = tables.plans[0];
  assert.equal(livePlan.solo_mode, false);

  const going = (await readParty(db, livePlan, 'p1'))!;
  // Funding POST, before anything is priced again: refused.
  assert.deepEqual(staleRows(tables.bookings, going).map(r => r.id), ['f', 'h']);
  // Approval, meanwhile, refuses too: it names two against a price for one.
  assert.deepEqual(partyChange(tables.bookings[0].request_payload, 2), { quoted: 1, now: 2 });

  // Checkout opens: each stale row is priced again, in place, for who is on it.
  for (const row of [...tables.bookings]) {
    const m = await settle(tables.bookings, restated(row, expectedFor(going)(row)), going, unpaid);
    assert.equal(m.kind, 'stale');
    if (m.kind !== 'stale') continue;
    const ok = await writeRepriced(db, m.row, restated(m.row, m.party), quote(row.vertical === 'flight' ? 60000 : 40000, { vertical: row.vertical }), unpaid);
    assert.deepEqual(ok, { ok: true });
  }
  assert.deepEqual(staleRows(tables.bookings, going), [], 'funding now takes money');
  // Approval names the group less anybody kept off the booking — two — and
  // the price is for two: it books two seats.
  for (const row of tables.bookings) assert.equal(partyChange(row.request_payload, 2), null, row.id);
  // And never fewer than quoted: naming one against a price for two is refused.
  assert.deepEqual(partyChange(tables.bookings[0].request_payload, 1), { quoted: 2, now: 1 });
});

test('solo → two, after paying: kept off what was paid for, which stays priced for one and is booked for one', async () => {
  const tables: Record<string, Row[]> = {
    plans: [{ id: 'p1', group_id: 'g1', solo_mode: true }],
    group_members: [{ group_id: 'g1', user_id: 'u-solo' }],
    item_optouts: [], contributions: [{ plan_id: 'p1', status: 'succeeded' }],
    bookings: [booking('f', 'awaiting_approval', flightReq(1))],
  };
  const { db } = makeDb(tables);
  await beforeJoining(db, 'g1', 'u-new');
  tables.group_members.push({ group_id: 'g1', user_id: 'u-new' });
  await afterJoining(db, 'g1');
  const going = (await readParty(db, tables.plans[0], 'p1'))!;
  assert.equal(expectedFor(going)(tables.bookings[0]), 1);
  // One number for the whole plan (2) refused this payment for good.
  assert.deepEqual(staleRows(tables.bookings, going), [], 'the organiser can still pay the rest');
  assert.equal((await settle(tables.bookings, flightReq(2), going, async () => true)).kind, 'twin');
  assert.equal(partyChange(tables.bookings[0].request_payload, expectedFor(going)(tables.bookings[0])), null,
    'approval names one — the group less the newcomer kept off it — against a price for one');
});

// ── The routes use these, and nothing of their own ──────────────────────

test('the routes decide staleness with this one rule and write stale rows in place', () => {
  const bookings = readFileSync('app/api/bookings/route.ts', 'utf8');
  assert.match(bookings, /await settle\(existing, asItem, await whoIsGoing\(\), anyonePaid\)/);
  assert.match(bookings, /writeRepriced\(ctx\.db, stale\.row/);
  assert.doesNotMatch(bookings, /retireStale|status: 'cancelled'/, 'nothing is retired');
  assert.doesNotMatch(bookings, /findStale|findDuplicate\(/);
  const funding = readFileSync('app/api/plans/[planId]/funding/route.ts', 'utf8');
  assert.match(funding, /staleRows\(waiting, going\)/);
  assert.doesNotMatch(funding, /staleForParty\(waiting, party\)/, 'one number for the whole plan');
  const bookable = readFileSync('app/api/plans/[planId]/bookable/route.ts', 'utf8');
  assert.match(bookable, /readParty\(/);
  assert.match(bookable, /b\.status === 'awaiting_approval'\)/, 'held quotes are not sent to be re-priced');
  const options = readFileSync('app/api/bookings/[id]/options/route.ts', 'utf8');
  assert.match(options, /expectedFor\(going\)\(booking\)/);
  const hold = readFileSync('app/api/bookings/[id]/hold/route.ts', 'utf8');
  assert.match(hold, /staleRows\(/);
  // Approval names the group less anybody kept off this very booking.
  const approve = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  assert.match(approve, /skips\.filter\(s => s\.ref === booking\.id\)/);
  assert.match(approve, /partyChange\(request, people\.length\)/);
});
