import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  duePings, runPings, localClock, shiftDay, reserved, flightDayNote, clockText,
  type PingInput, type PingPlan, type PingBooking, type PingLine,
} from '../../lib/pings.ts';
import { dayWhere } from '../../lib/calendar.ts';

// New York: -74° rounds to UTC-5, the same as dayWhere.
const NYC = -74;
/** The instant it is `hour` o'clock on `day` in New York (UTC-5 by longitude). */
const nyc = (day: string, hour: number) => new Date(Date.parse(`${day}T00:00:00Z`) + (hour + 5) * 3_600_000);

const plan = (over: Partial<PingPlan> = {}): PingPlan => ({
  id: 'p1', group_id: 'g1', title: 'Brooklyn weekend', type: 'trip', status: 'booked',
  start_date: '2026-11-06', end_date: '2026-11-08', solo_mode: false, created_by: 'ana',
  destination_lng: NYC, ...over,
});

const dinner: PingLine = { id: 'l1', type: 'restaurant', title: "Lilia", scheduled_time: 'Day 1 · 7:30 PM', is_confirmed: false };
const dinnerBooked: PingBooking = { id: 'b1', itinerary_item_id: 'l1', vertical: 'restaurant', mode: 'native', status: 'confirmed' };
const flight: PingBooking = {
  id: 'f1', vertical: 'flight', mode: 'native', status: 'confirmed', provider_ref: 'MHW2Y3',
  detail: 'American Airlines · RDU → JFK · 2026-11-06',
  request_payload: { flight: { origin: 'RDU', destination: 'JFK', departDate: '2026-11-06' } },
  response_payload: { flightIdent: 'AA1234' },
};

const input = (over: Partial<PingInput> = {}): PingInput => ({
  plan: plan(), memberIds: ['ana', 'ben'], lines: [dinner], bookings: [dinnerBooked], optOuts: new Map(), ...over,
});

const kinds = (ps: ReturnType<typeof duePings>) => ps.map(p => `${p.kind}:${p.userId}`).sort();

// ── the clock ──

test('the local day is dayWhere\'s, at every hour, including after the UTC day has turned over', () => {
  for (let h = 0; h < 48; h++) {
    const now = new Date(Date.parse('2026-11-06T00:00:00Z') + h * 3_600_000);
    assert.equal(localClock(NYC, now)?.day, dayWhere(NYC, now));
  }
  // Eight in the evening in New York is already the 7th in UTC.
  assert.deepEqual(localClock(NYC, nyc('2026-11-06', 20)), { day: '2026-11-06', hour: 20 });
});

test('a plan nobody placed has no clock, and is not read as Greenwich', () => {
  assert.equal(localClock(null), null);
  assert.equal(localClock(undefined), null);
  assert.equal(localClock(''), null);
  assert.deepEqual(duePings(input({ plan: plan({ destination_lng: null }) }), nyc('2026-11-06', 16)), []);
});

test('days are counted as dates', () => {
  assert.equal(shiftDay('2026-11-06', -7), '2026-10-30');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-13-01', 1), null);
});

// ── tonight ──

test('Tonight names a reserved line and its time, to everybody on it, before it starts', () => {
  const due = duePings(input(), nyc('2026-11-06', 16));
  assert.deepEqual(kinds(due), ['tonight:ana', 'tonight:ben']);
  assert.equal(due[0].note.title, 'Tonight: Lilia, 7:30 PM');
  assert.equal(due[0].localDay, '2026-11-06');
});

test('at 7pm in New York — the 7th in UTC — tonight is still the 6th, and tomorrow\'s dinner is not announced', () => {
  const lines: PingLine[] = [
    { ...dinner, scheduled_time: 'Day 1 · 8:30 PM' },
    { id: 'l2', type: 'restaurant', title: 'Via Carota', scheduled_time: 'Day 2 · 8 PM', is_confirmed: true },
  ];
  const due = duePings(input({ lines }), nyc('2026-11-06', 19));
  assert.equal(due.length, 2);
  assert.ok(due.every(p => p.note.title === 'Tonight: Lilia, 8:30 PM' && p.localDay === '2026-11-06'));
});

test('no ping without a reserved row behind it: a planned dinner nobody booked is not announced', () => {
  assert.deepEqual(duePings(input({ bookings: [] }), nyc('2026-11-06', 16)), []);
  assert.deepEqual(duePings(input({ bookings: [{ ...dinnerBooked, status: 'awaiting_approval' }] }), nyc('2026-11-06', 16)), []);
  // A cancelled booking under a line still marked confirmed is cancelled.
  assert.equal(reserved({ ...dinner, is_confirmed: true }, [{ ...dinnerBooked, status: 'cancelled' }]), false);
  // Bought elsewhere with the number brought back is reserved.
  assert.equal(reserved(dinner, [{ ...dinnerBooked, mode: 'redirect', status: 'awaiting_approval', confirmation_number: 'R-12' }]), true);
  // Booked by hand, no row: the line's own flag.
  assert.equal(reserved({ ...dinner, is_confirmed: true }, []), true);
});

test('a line with no clock time, or after its time, is not "Tonight: …, <time>"', () => {
  assert.deepEqual(duePings(input({ lines: [{ ...dinner, scheduled_time: 'Day 1 · Evening' }] }), nyc('2026-11-06', 16)), []);
  assert.deepEqual(duePings(input(), nyc('2026-11-06', 21)), []);
});

test('somebody sitting the dinner out is not told it is tonight', () => {
  const due = duePings(input({ optOuts: new Map([['b1', new Set(['ben'])]]) }), nyc('2026-11-06', 16));
  assert.deepEqual(kinds(due), ['tonight:ana']);
});

test('a cancelled or completed plan sends nothing', () => {
  assert.deepEqual(duePings(input({ plan: plan({ status: 'cancelled' }) }), nyc('2026-11-06', 16)), []);
  assert.deepEqual(duePings(input({ plan: plan({ status: 'completed' }) }), nyc('2026-11-06', 16)), []);
});

// ── solo ──

test('a solo plan pings its one traveller, and no ping speaks for anybody else', () => {
  const solo = input({ plan: plan({ solo_mode: true }), memberIds: ['ana'], bookings: [dinnerBooked, flight] });
  const all = [
    ...duePings(solo, nyc('2026-10-30', 11)),
    ...duePings(solo, nyc('2026-11-05', 11)),
    ...duePings(solo, nyc('2026-11-06', 16)),
  ];
  assert.ok(all.length >= 3);
  assert.ok(all.every(p => p.userId === 'ana'));
  for (const p of all) {
    const text = `${p.note.title} ${p.note.body ?? ''}`;
    assert.doesNotMatch(text, /\b(everyone|everybody|the group|all of you|you all|your group|others|we're|let's)\b/i, text);
  }
});

// ── packing ──

test('T-7: a packing list built from the itinerary, only for an overnight, locked-in trip with something held', () => {
  const lines: PingLine[] = [dinner, { id: 'l3', type: 'activity', title: 'Brooklyn Bridge walking tour', scheduled_time: 'Day 2 · 10 AM' }];
  const at = nyc('2026-10-30', 11);
  const due = duePings(input({ lines }), at);
  assert.deepEqual(kinds(due), ['packing:ana', 'packing:ben']);
  assert.equal(due[0].note.title, 'A week until Brooklyn weekend');
  assert.match(due[0].note.body ?? '', /Clothes for 2 nights/);
  assert.match(due[0].note.body ?? '', /Walking shoes \(Brooklyn Bridge walking tour\)/);

  // Still voting, a night out, nothing held, or nothing to pack: no ping.
  assert.deepEqual(duePings(input({ lines, plan: plan({ status: 'voting' }) }), at), []);
  assert.deepEqual(duePings(input({ lines, plan: plan({ type: 'restaurant', end_date: '2026-11-06' }) }), at), []);
  assert.deepEqual(duePings(input({ lines, bookings: [] }), at), []);
  assert.deepEqual(duePings(input(), at), []);
  // T-6 is not T-7.
  assert.deepEqual(duePings(input({ lines }), nyc('2026-10-31', 11)), []);
});

// ── flights ──

test('T-7 names no hotel reference or tickets for a line nobody holds, even when something else is held', () => {
  const hotel: PingLine = { id: 'h1', type: 'hotel', title: 'The Crawford', scheduled_time: 'Day 1 · 3 PM' };
  const gig: PingLine = { id: 'e1', type: 'event', title: 'J. Cole concert', scheduled_time: 'Day 1 · 8 PM' };
  const walk: PingLine = { id: 'l3', type: 'activity', title: 'Brooklyn Bridge walking tour', scheduled_time: 'Day 2 · 10 AM' };
  const at = nyc('2026-10-30', 11);
  const pending: PingBooking[] = [dinnerBooked,
    { id: 'hb', itinerary_item_id: 'h1', vertical: 'hotel', mode: 'native', status: 'awaiting_approval' },
    { id: 'eb', itinerary_item_id: 'e1', vertical: 'event', mode: 'redirect', status: 'redirected' }];
  const due = duePings(input({ lines: [dinner, hotel, gig, walk], bookings: pending }), at);
  assert.equal(due.length, 2);
  assert.doesNotMatch(due[0].note.body ?? '', /booking reference|tickets/i);
  assert.match(due[0].note.body ?? '', /Walking shoes/);
  // Booked, both are named.
  const held: PingBooking[] = [dinnerBooked,
    { id: 'hb', itinerary_item_id: 'h1', vertical: 'hotel', mode: 'native', status: 'confirmed' },
    { id: 'eb', itinerary_item_id: 'e1', vertical: 'event', mode: 'redirect', status: 'redirected', confirmation_number: 'TM-88' }];
  const body = duePings(input({ lines: [dinner, hotel, gig, walk], bookings: held }), at)[0].note.body ?? '';
  assert.match(body, /Your hotel's booking reference \(The Crawford\)/);
  assert.match(body, /Your tickets \(J\. Cole concert\)/);
});

test('flight days are the departure airport\'s, not the destination\'s: New York to Rome, Los Angeles to Tokyo', () => {
  // Rome (12.5° → +1). JFK departs 2026-11-06.
  const rome = plan({ destination_lng: 12.5, start_date: '2026-11-07', end_date: '2026-11-12' });
  const jfk: PingBooking = { ...flight, detail: 'American Airlines · JFK → FCO · 2026-11-06',
    request_payload: { flight: { origin: 'JFK', destination: 'FCO', departDate: '2026-11-06' } } };
  const at = (iso: string) => new Date(iso);
  // 04:07Z is 5:07 AM 11-06 in Rome and 11:07 PM 11-05 in New York: not "today".
  assert.deepEqual(duePings(input({ plan: rome, bookings: [jfk], lines: [] }), at('2026-11-06T04:07:00Z')).filter(p => p.kind === 'flight_day'), []);
  // 7:07 AM in New York on the 6th: today.
  const day = duePings(input({ plan: rome, bookings: [jfk], lines: [] }), at('2026-11-06T12:07:00Z')).filter(p => p.kind === 'flight_day');
  assert.deepEqual(kinds(day), ['flight_day:ana', 'flight_day:ben']);
  assert.equal(day[0].localDay, '2026-11-06');
  // Check-in on the 5th by New York's clock, not Rome's.
  assert.deepEqual(kinds(duePings(input({ plan: rome, bookings: [jfk], lines: [] }), at('2026-11-05T15:07:00Z'))), ['flight_checkin:ana', 'flight_checkin:ben']);

  // Tokyo (139.7° → +9) from LAX, departing 2026-11-06.
  const tokyo = plan({ destination_lng: 139.7, start_date: '2026-11-07', end_date: '2026-11-12' });
  const lax: PingBooking = { ...flight, request_payload: { flight: { origin: 'LAX', destination: 'NRT', departDate: '2026-11-06' } } };
  // 2026-11-04T23:07Z: 8:07 AM on the 5th in Tokyo, 3:07 PM on the 4th in LA — two days out in LA.
  assert.deepEqual(duePings(input({ plan: tokyo, bookings: [lax], lines: [] }), at('2026-11-04T23:07:00Z')), []);
  // 2026-11-05T21:07Z: 1:07 PM on the 5th in LA — the day before.
  assert.deepEqual(kinds(duePings(input({ plan: tokyo, bookings: [lax], lines: [] }), at('2026-11-05T21:07:00Z'))), ['flight_checkin:ana', 'flight_checkin:ben']);
  // 2026-11-05T21:07Z is 6:07 AM on the 6th in Tokyo: not the morning of in LA.
  assert.ok(duePings(input({ plan: tokyo, bookings: [lax], lines: [] }), at('2026-11-05T21:07:00Z')).every(p => p.kind !== 'flight_day'));
});

test('a departure airport whose zone we do not hold gets no flight pings, and says so', () => {
  const odd: PingBooking = { ...flight, request_payload: { flight: { origin: 'ZZZ', destination: 'JFK', departDate: '2026-11-06' } } };
  const skipped: string[] = [];
  assert.deepEqual(duePings(input({ bookings: [odd], lines: [], onSkip: w => skipped.push(w) }), nyc('2026-11-05', 11)), []);
  assert.deepEqual(duePings(input({ bookings: [odd], lines: [], onSkip: w => skipped.push(w) }), nyc('2026-11-06', 7)), []);
  assert.deepEqual(skipped, ['flight_no_origin_zone', 'flight_no_origin_zone']);
});

test('the morning-of note is only for the departure airport\'s today, and only before the flight goes', () => {
  const f = [{ status: 'Scheduled', scheduled_out: '2026-11-06T23:00:00Z', origin: { code_iata: 'JFK', timezone: 'America/New_York' } }];
  // 11:07 PM on the 5th in New York.
  assert.equal(flightDayNote('AA1234', '2026-11-06', f, new Date('2026-11-06T04:07:00Z')), null);
  assert.equal(flightDayNote('AA1234', '2026-11-06', f, new Date('2026-11-06T12:07:00Z'))?.title, 'AA1234 today: Scheduled');
  // After it has left.
  assert.equal(flightDayNote('AA1234', '2026-11-06', f, new Date('2026-11-06T23:30:00Z')), null);
});

test('T-1: check-in only for a confirmed flight row, with the airline reference and never Duffel\'s order id', () => {
  const at = nyc('2026-11-05', 11);
  const due = duePings(input({ bookings: [flight] }), at);
  assert.deepEqual(kinds(due), ['flight_checkin:ana', 'flight_checkin:ben']);
  assert.equal(due[0].note.title, 'Your flight is tomorrow');
  assert.match(due[0].note.body ?? '', /RDU → JFK/);
  assert.match(due[0].note.body ?? '', /Booking reference MHW2Y3/);
  // No check-in time is invented.
  assert.doesNotMatch(due[0].note.body ?? '', /\d+\s*hours?/i);

  assert.doesNotMatch(duePings(input({ bookings: [{ ...flight, provider_ref: 'ord_00009hthhsUZ8W4LxQgkjo' }] }), at)[0].note.body ?? '', /ord_/);
  for (const status of ['pending', 'awaiting_approval', 'redirected', 'quoted', 'cancelled']) {
    assert.deepEqual(duePings(input({ bookings: [{ ...flight, status }] }), at), [], status);
  }
  // A flight line somebody typed is not a flight row.
  assert.deepEqual(duePings(input({ bookings: [], lines: [{ id: 'x', type: 'flight', title: 'AA1234', scheduled_time: 'Day 1 · 8 AM', is_confirmed: true }] }), at), []);
  // Sitting the flight out (driving): not pinged about it.
  assert.deepEqual(kinds(duePings(input({ bookings: [flight], optOuts: new Map([['f1', new Set(['ben'])]]) }), at)), ['flight_checkin:ana']);
});

test('two confirmed flights the same day and nothing saying whose is whose: neither is named', () => {
  const second = { ...flight, id: 'f2', detail: 'Delta · PIT → JFK · 2026-11-06' };
  assert.deepEqual(duePings(input({ bookings: [flight, second] }), nyc('2026-11-05', 11)), []);
  const split = new Map([['f1', new Set(['ben'])], ['f2', new Set(['ana'])]]);
  const due = duePings(input({ bookings: [flight, second], optOuts: split }), nyc('2026-11-05', 11));
  assert.match(due.find(p => p.userId === 'ana')?.note.body ?? '', /RDU/);
  assert.match(due.find(p => p.userId === 'ben')?.note.body ?? '', /PIT/);
});

test('the morning of: only what AeroAPI says, in the departure airport\'s own zone', () => {
  const note = flightDayNote('AA1234', '2026-11-06', [
    { status: 'Scheduled', scheduled_out: '2026-11-07T13:00:00Z', origin: { code_iata: 'RDU', timezone: 'America/New_York' } },
    { status: 'Delayed', scheduled_out: '2026-11-06T13:00:00Z', estimated_out: '2026-11-06T13:45:00Z', gate_origin: 'C19', terminal_origin: '2', origin: { code_iata: 'RDU', timezone: 'America/New_York' } },
  ]);
  assert.deepEqual(note, { title: 'AA1234 today: Delayed', body: 'Departs RDU now 8:45 AM (was 8:00 AM), terminal 2, gate C19.' });
  // Nothing about that date, nothing said.
  assert.equal(flightDayNote('AA1234', '2026-11-06', [{ status: 'Scheduled', scheduled_out: '2026-11-08T13:00:00Z', origin: { timezone: 'America/New_York' } }]), null);
  // No gate given, none invented.
  assert.doesNotMatch(flightDayNote('AA1234', '2026-11-06', [{ scheduled_out: '2026-11-06T13:00:00Z', origin: { timezone: 'America/New_York' } }])?.body ?? '', /gate|terminal/);
});

test('clock text reads as a person writes it', () => {
  assert.equal(clockText('19:30'), '7:30 PM');
  assert.equal(clockText('8pm'), '8 PM');
  assert.equal(clockText('12:05 AM'), '12:05 AM');
  assert.equal(clockText('evening'), null);
});

// ── the run: claim, then send, once ──

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, opts: { noPingLog?: boolean } = {}) {
  const claimed = new Set<string>();
  const log: { table: string; op: string; rows?: unknown }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let pending: { op: 'insert' | 'update'; rows: unknown } | null = null;
    const result = async () => {
      if (pending?.op === 'insert' && table === 'ping_log') {
        if (opts.noPingLog) return { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } };
        const r = pending.rows as Row;
        const key = `${r.plan_id}|${r.user_id}|${r.kind}|${r.local_day}`;
        // The unique index: checked and taken in one step, as Postgres does.
        if (claimed.has(key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        claimed.add(key);
        log.push({ table, op: 'claim', rows: key });
        return { data: { id: key }, error: null };
      }
      if (pending?.op === 'insert') { log.push({ table, op: 'insert', rows: pending.rows }); return { data: null, error: null }; }
      if (pending?.op === 'update') return { data: null, error: null };
      return { data: (tables[table] ?? []).filter(r => filters.every(f => f(r))), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, not: () => q, lte: () => q, or: () => q, limit: () => q, order: () => q,
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return q; },
      insert: (rows: unknown) => { pending = { op: 'insert', rows }; return q; },
      update: (rows: unknown) => { pending = { op: 'update', rows }; return q; },
      delete: () => q,
      single: () => result(),
      maybeSingle: () => result(),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result().then(ok, bad),
    };
    return q;
  };
  return { db: { from } as never, log, claimed };
}

const world = (extra: Partial<Record<string, Row[]>> = {}) => ({
  plans: [plan() as unknown as Row],
  group_members: [{ group_id: 'g1', user_id: 'ana' }, { group_id: 'g1', user_id: 'ben' }],
  itinerary_items: [{ ...dinner, plan_id: 'p1' }],
  bookings: [{ ...dinnerBooked, plan_id: 'p1' }],
  item_optouts: [],
  plan_notification_mutes: [],
  push_subscriptions: [],
  ...extra,
});

test('a second run sends nothing: the claim is the unique index, not a read', async () => {
  const { db, log } = fakeDb(world());
  const now = nyc('2026-11-06', 16);
  const first = await runPings(db, { now, send: null, aero: null });
  assert.deepEqual(first.sent, { tonight: 2 });
  const second = await runPings(db, { now, send: null, aero: null });
  assert.deepEqual(second.sent, {});
  assert.equal(second.already, 2);
  // Exactly two bell rows were ever written.
  assert.equal(log.filter(l => l.table === 'notifications' && l.op === 'insert').length, 2);
});

test('two runs at the same instant still send each ping once', async () => {
  const { db, log } = fakeDb(world());
  const now = nyc('2026-11-06', 16);
  const [a, b] = await Promise.all([runPings(db, { now, send: null, aero: null }), runPings(db, { now, send: null, aero: null })]);
  assert.equal((a.sent.tonight ?? 0) + (b.sent.tonight ?? 0), 2);
  assert.equal(log.filter(l => l.table === 'notifications' && l.op === 'insert').length, 2);
});

test('the next hour of the same evening is the same local day, so it sends nothing either', async () => {
  const { db } = fakeDb(world());
  await runPings(db, { now: nyc('2026-11-06', 16), send: null, aero: null });
  // 18:00 in New York is 23:00 UTC; 19:00 would be the 7th in UTC.
  const later = await runPings(db, { now: nyc('2026-11-06', 18), send: null, aero: null });
  assert.deepEqual(later.sent, {});
});

test('with no ping_log the run sends nothing at all, since nothing could stop a second send', async () => {
  const { db, log } = fakeDb(world(), { noPingLog: true });
  const r = await runPings(db, { now: nyc('2026-11-06', 16), send: null, aero: null });
  assert.equal(r.stopped, 'ping_log_missing');
  assert.equal(log.filter(l => l.table === 'notifications').length, 0);
});

test('somebody who muted the plan is sent nothing and nothing is claimed for them', async () => {
  const { db, claimed } = fakeDb(world({ plan_notification_mutes: [{ plan_id: 'p1', user_id: 'ben' }] }));
  const r = await runPings(db, { now: nyc('2026-11-06', 16), send: null, aero: null });
  assert.deepEqual(r.sent, { tonight: 1 });
  assert.equal(r.muted, 1);
  assert.deepEqual([...claimed].map(k => k.split('|')[1]), ['ana']);
});

test('with no AeroAPI key the morning-of flight ping is skipped, not guessed', async () => {
  const { db, log } = fakeDb(world({ bookings: [{ ...flight, plan_id: 'p1' }], itinerary_items: [] }));
  const r = await runPings(db, { now: nyc('2026-11-06', 7), send: null, aero: null });
  assert.deepEqual(r.sent, {});
  assert.equal(r.skipped.flight_day_no_aeroapi_key, 2);
  assert.equal(log.filter(l => l.table === 'notifications').length, 0);
});

test('with a key, AeroAPI is asked once per flight and its answer is the ping', async () => {
  const { db, log } = fakeDb(world({ bookings: [{ ...flight, plan_id: 'p1' }], itinerary_items: [] }));
  let asked = 0;
  const aero = async () => { asked++; return [{ status: 'On time', scheduled_out: '2026-11-06T13:00:00Z', gate_origin: 'C19', origin: { code_iata: 'RDU', timezone: 'America/New_York' } }]; };
  const r = await runPings(db, { now: nyc('2026-11-06', 7), send: null, aero });
  assert.deepEqual(r.sent, { flight_day: 2 });
  assert.equal(asked, 1);
  const bell = log.find(l => l.table === 'notifications')?.rows as Row[];
  assert.equal(bell[0].title, 'AA1234 today: On time');
  assert.equal(bell[0].body, 'Departs RDU 8:00 AM, gate C19.');
});

test('a dry run works out what is due and claims and sends nothing', async () => {
  const { db, claimed, log } = fakeDb(world());
  const r = await runPings(db, { now: nyc('2026-11-06', 16), send: null, aero: null, dry: true });
  assert.deepEqual(r.sent, { tonight: 2 });
  assert.equal(claimed.size, 0);
  assert.equal(log.length, 0);
});
