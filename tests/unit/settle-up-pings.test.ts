import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dueSettleUps, runPings, money, newest, SETTLE_QUIET_MS,
  type SettleInput, type SettlePlan,
} from '../../lib/pings.ts';
import type { SettleLine } from '../../lib/money.ts';

// New York by longitude, UTC-5, as in pings.test.ts.
const NYC = -74;
const nyc = (day: string, hour: number) => new Date(Date.parse(`${day}T00:00:00Z`) + (hour + 5) * 3_600_000);

const plan = (over: Partial<SettlePlan> = {}): SettlePlan => ({
  id: 'p1', group_id: 'g1', title: 'Brooklyn weekend', type: 'trip', status: 'booked',
  start_date: '2026-11-06', end_date: '2026-11-08', solo_mode: false, created_by: 'ana',
  destination_lng: NYC, destination_city: 'Brooklyn', ...over,
});
// Ben owes Ana $42.
const owes: SettleLine = { from: 'ben', to: 'ana', amountCents: 4200, pending: null };
const NOW = nyc('2026-11-12', 11);
const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000).toISOString();

const input = (over: Partial<SettleInput> = {}): SettleInput => ({
  plan: plan(),
  memberIds: ['ana', 'ben', 'cy'],
  ledger: { solo: false, settlementsAvailable: true, lines: [owes] },
  lastChange: daysBefore(NOW, 4),
  names: new Map([['ana', 'Ana'], ['cy', 'Cy']]),
  lastSent: new Map(),
  ...over,
});

// ── who, and what it says ──

test('the payer, and only the payer, is told who is waiting and for how much', () => {
  const due = dueSettleUps(input(), NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0].userId, 'ben');
  assert.equal(due[0].kind, 'settle_up');
  assert.equal(due[0].localDay, '2026-11-12');
  assert.equal(due[0].note.title, 'Ana is still waiting on $42');
  assert.equal(due[0].note.body, 'From Brooklyn trip. Once you have paid, mark it paid so the trip squares up.');
  // Nobody else on the trip hears about Ben's money.
  assert.ok(!due.some(p => p.userId === 'ana' || p.userId === 'cy'));
});

test('one reminder per payer, however many people they owe, largest first', () => {
  const lines: SettleLine[] = [
    { from: 'ben', to: 'cy', amountCents: 1850, pending: null },
    owes,
  ];
  const due = dueSettleUps(input({ ledger: { solo: false, settlementsAvailable: true, lines } }), NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0].note.title, 'Ana is still waiting on $42');
  assert.match(due[0].note.body ?? '', /Also still to pay: Cy, \$18\.50\./);
});

test('a payment somebody said they sent and nobody confirmed is asked about, not assumed', () => {
  const pendingLine = { ...owes, pending: { id: 's1', amountCents: 4200, method: 'venmo', createdAt: daysBefore(NOW, 4) } };
  const due = dueSettleUps(input({ ledger: { solo: false, settlementsAvailable: true, lines: [pendingLine] } }), NOW);
  assert.match(due[0].note.body ?? '', /If it has gone, mark it paid/);
});

test('with no name for the payee it says what is owed, and invents nobody', () => {
  const due = dueSettleUps(input({ names: new Map() }), NOW);
  assert.equal(due[0].note.title, 'You still owe $42 from Brooklyn trip');
});

test('money reads as a person writes it', () => {
  assert.equal(money(4200), '$42');
  assert.equal(money(4250), '$42.50');
  assert.equal(money(5), '$0.05');
});

// ── never ──

test('a trip of one is never reminded: nobody to settle with', () => {
  assert.deepEqual(dueSettleUps(input({ ledger: { solo: true, settlementsAvailable: true, lines: [owes] } }), NOW), []);
  assert.deepEqual(dueSettleUps(input({ plan: plan({ solo_mode: true }), memberIds: ['ben'] }), NOW), []);
});

test('nothing owed, or only a zero line kept for its claim, sends nothing', () => {
  assert.deepEqual(dueSettleUps(input({ ledger: { solo: false, settlementsAvailable: true, lines: [] } }), NOW), []);
  assert.deepEqual(dueSettleUps(input({ ledger: { solo: false, settlementsAvailable: true, lines: [{ ...owes, amountCents: 0 }] } }), NOW), []);
});

test('before the settlements table exists nothing can be marked paid, so nobody is asked to', () => {
  const why: string[] = [];
  assert.deepEqual(dueSettleUps(input({ ledger: { solo: false, settlementsAvailable: false, lines: [owes] }, onSkip: w => why.push(w) }), NOW), []);
  assert.deepEqual(why, ['settle_up_no_settlements_table']);
});

test('a plan nobody placed, or with no dates, has no daytime and no end to count from', () => {
  assert.deepEqual(dueSettleUps(input({ plan: plan({ destination_lng: null }) }), NOW), []);
  assert.deepEqual(dueSettleUps(input({ plan: plan({ start_date: null, end_date: null }) }), NOW), []);
});

test('only in the trip\'s daytime', () => {
  assert.equal(dueSettleUps(input(), nyc('2026-11-12', 9)).length, 0);
  assert.equal(dueSettleUps(input(), nyc('2026-11-12', 10)).length, 1);
  assert.equal(dueSettleUps(input(), nyc('2026-11-12', 20)).length, 1);
  assert.equal(dueSettleUps(input(), nyc('2026-11-12', 21)).length, 0);
});

test('thirty days after the last day the reminders stop', () => {
  const late = nyc('2026-12-08', 11);
  assert.equal(dueSettleUps(input({ lastChange: daysBefore(late, 10) }), late).length, 1);
  const later = nyc('2026-12-09', 11);
  assert.equal(dueSettleUps(input({ lastChange: daysBefore(later, 10) }), later).length, 0);
});

// ── older than three days ──

test('a line is only reminded about once the ledger has stood still three days', () => {
  const why: string[] = [];
  assert.deepEqual(dueSettleUps(input({ lastChange: daysBefore(NOW, 2.9), onSkip: w => why.push(w) }), NOW), []);
  assert.deepEqual(why, ['settle_up_too_new']);
  assert.equal(dueSettleUps(input({ lastChange: new Date(NOW.getTime() - SETTLE_QUIET_MS).toISOString() }), NOW).length, 1);
  // Owed, and nothing says since when: not three days anybody can show.
  assert.deepEqual(dueSettleUps(input({ lastChange: null }), NOW), []);
});

test('the newest stamp wins, and junk is not a stamp', () => {
  assert.equal(newest('2026-11-01T00:00:00Z', null, 'soon', '2026-11-03T10:00:00Z', undefined), '2026-11-03T10:00:00.000Z');
  assert.equal(newest(null, ''), null);
});

test('at most once every three days per payer', () => {
  const sent = (day: string) => input({ lastSent: new Map([['ben', day]]) });
  assert.equal(dueSettleUps(sent('2026-11-12'), NOW).length, 0);
  assert.equal(dueSettleUps(sent('2026-11-11'), NOW).length, 0);
  assert.equal(dueSettleUps(sent('2026-11-10'), NOW).length, 0);
  assert.equal(dueSettleUps(sent('2026-11-09'), NOW).length, 1);
});

// ── the run ──

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const claimed = new Set<string>();
  const log: { table: string; op: string; rows?: unknown }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let pending: { op: 'insert' | 'update'; rows: unknown } | null = null;
    const result = async () => {
      if (pending?.op === 'insert' && table === 'ping_log') {
        const r = pending.rows as Row;
        const key = `${r.plan_id}|${r.user_id}|${r.kind}|${r.local_day}`;
        if (claimed.has(key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        claimed.add(key);
        (tables.ping_log ??= []).push({ ...r });
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
      neq: (c: string, v: unknown) => { filters.push(r => r[c] !== v); return q; },
      gte: (c: string, v: string) => { filters.push(r => String(r[c]) >= v); return q; },
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
  group_members: [{ group_id: 'g1', user_id: 'ana' }, { group_id: 'g1', user_id: 'ben' }, { group_id: 'g1', user_id: 'cy' }],
  itinerary_items: [],
  bookings: [],
  item_optouts: [],
  expenses: [{ plan_id: 'p1', created_at: '2026-11-07T20:00:00Z' }],
  contributions: [],
  settlements: [],
  users: [{ id: 'ana', first_name: 'Ana' }, { id: 'cy', first_name: 'Cy' }],
  plan_notification_mutes: [],
  push_subscriptions: [],
  ...extra,
});
const ledger = async () => ({ solo: false, settlementsAvailable: true, lines: [owes] });
const bells = (log: { table: string; op: string; rows?: unknown }[]) =>
  log.filter(l => l.table === 'notifications' && l.op === 'insert').flatMap(l => l.rows as Row[]);

test('a run reminds the payer once, and the next runs that day and the next two days send nothing', async () => {
  const { db, log } = fakeDb(world());
  const first = await runPings(db, { now: NOW, send: null, aero: null, ledger });
  assert.equal(first.sent.settle_up, 1);
  const sentTo = bells(log);
  assert.deepEqual(sentTo.map(b => b.user_id), ['ben']);
  assert.equal(sentTo[0].title, 'Ana is still waiting on $42');
  assert.equal(sentTo[0].plan_id, 'p1');

  // Later the same day: the claim refuses it.
  const again = await runPings(db, { now: nyc('2026-11-12', 15), send: null, aero: null, ledger });
  assert.equal(again.sent.settle_up ?? 0, 0);
  // The next two days: the last claim is too recent.
  for (const day of ['2026-11-13', '2026-11-14']) {
    const r = await runPings(db, { now: nyc(day, 11), send: null, aero: null, ledger });
    assert.equal(r.sent.settle_up ?? 0, 0, day);
    assert.equal(r.skipped.settle_up_recent, 1, day);
  }
  // Three days on, if it is still owed, once more.
  const later = await runPings(db, { now: nyc('2026-11-15', 11), send: null, aero: null, ledger });
  assert.equal(later.sent.settle_up, 1);
  assert.equal(bells(log).length, 2);
  assert.ok(bells(log).every(b => b.user_id === 'ben'));
});

test('two runs at the same instant remind the payer once', async () => {
  const { db, log } = fakeDb(world());
  await Promise.all([
    runPings(db, { now: NOW, send: null, aero: null, ledger }),
    runPings(db, { now: NOW, send: null, aero: null, ledger }),
  ]);
  assert.equal(bells(log).length, 1);
});

test('a payer who muted the trip is sent nothing and nothing is claimed for them', async () => {
  const { db, log, claimed } = fakeDb(world({ plan_notification_mutes: [{ plan_id: 'p1', user_id: 'ben' }] }));
  const r = await runPings(db, { now: NOW, send: null, aero: null, ledger });
  assert.equal(r.muted, 1);
  assert.equal(bells(log).length, 0);
  assert.equal(claimed.size, 0);
});

test('a trip with no money on it is not read at all', async () => {
  let reads = 0;
  const { db } = fakeDb(world({ expenses: [] }));
  await runPings(db, { now: NOW, send: null, aero: null, ledger: async () => { reads++; return ledger(); } });
  assert.equal(reads, 0);
});

test('a ledger that moved yesterday — a part payment, a new expense — waits', async () => {
  const { db, log } = fakeDb(world({ settlements: [{ plan_id: 'p1', created_at: '2026-11-05T00:00:00Z', paid_at: daysBefore(NOW, 1) }] }));
  const r = await runPings(db, { now: NOW, send: null, aero: null, ledger });
  assert.equal(r.skipped.settle_up_too_new, 1);
  assert.equal(bells(log).length, 0);
});

test('a ledger that cannot be read reminds nobody', async () => {
  const { db, log } = fakeDb(world());
  const r = await runPings(db, { now: NOW, send: null, aero: null, ledger: async () => { throw new Error('down'); } });
  assert.equal(r.skipped.settle_up_ledger_unreadable, 1);
  assert.equal(bells(log).length, 0);
});

test('the cron route runs the settle-up pass through runPings, not a schedule of its own', async () => {
  const { readFileSync } = await import('node:fs');
  const route = readFileSync(new URL('../../app/api/cron/pings/route.ts', import.meta.url), 'utf8');
  assert.match(route, /runPings\(/);
  const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');
  assert.doesNotMatch(vercel, /settle/);
});
