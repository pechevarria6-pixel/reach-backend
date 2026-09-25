import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  claimNudge, releaseNudge, limitsNudge, NUDGE_ACTION,
  claimPeople, releasePeople, nudgedUntil, personKey, PERSON_NUDGE_ACTION,
} from '../../lib/nudge.ts';

type Row = { id: string; action: string; resource_id: string; created_at: string; [k: string]: unknown };

// A small stand-in for the audit_logs table: enough of the query builder for
// what lib/nudge.ts asks of it, over rows held in memory. Every call yields
// to the event loop before it answers, the way a network round trip does, so
// two requests started together really do interleave.
function fakeDb(rows: Row[] = []) {
  let n = 0;
  const log: string[] = [];
  const tick = () => new Promise(r => setImmediate(r));
  const db = {
    rows, log,
    from() {
      return {
        select() {
          const filters: Array<(r: Row) => boolean> = [];
          const q: any = {
            eq(col: string, v: unknown) { filters.push(r => r[col] === v); return q; },
            in(col: string, vs: unknown[]) { filters.push(r => vs.includes(r[col])); return q; },
            gte(col: string, v: string) { filters.push(r => String(r[col]) >= v); return q; },
            order() { return q; },
            then(ok: (v: unknown) => void, bad?: (e: unknown) => void) {
              return tick().then(() => {
                log.push('read');
                const data = rows.filter(r => filters.every(f => f(r)))
                  .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
                return { data, error: null };
              }).then(ok, bad);
            },
          };
          return q;
        },
        insert(input: any) {
          const many = Array.isArray(input);
          const write = async () => {
            await tick();
            log.push('insert');
            const made = (many ? input : [input]).map((row: any) => ({ id: `z${++n}`, created_at: db.now, ...row }));
            rows.push(...made);
            return made;
          };
          return {
            select: () => ({
              single: async () => ({ data: { id: (await write())[0].id }, error: null }),
              then: (ok: (v: unknown) => void, bad?: (e: unknown) => void) =>
                write().then(made => ({ data: made.map((m: Row) => ({ id: m.id, resource_id: m.resource_id })), error: null })).then(ok, bad),
            }),
          };
        },
        delete() {
          const drop = (ids: string[]) => {
            for (const id of ids) {
              const i = rows.findIndex(r => r.id === id);
              if (i >= 0) rows.splice(i, 1);
            }
            return { error: null };
          };
          return {
            eq: async (_: string, id: string) => { await tick(); return drop([id]); },
            in: async (_: string, ids: string[]) => { await tick(); return drop(ids); },
          };
        },
      };
    },
    now: '2026-09-23T12:00:00.000Z',
  };
  return db;
}

const at = (iso: string) => new Date(iso);
const nudgesFor = (db: ReturnType<typeof fakeDb>, planId: string, userId: string) =>
  db.rows.filter(r => r.action === PERSON_NUDGE_ACTION && r.resource_id === personKey(planId, userId));

// ─── The minute, per trip ────────────────────────────────────────────────

test('the first nudge for a trip goes, and a second inside the minute is refused', async () => {
  const db = fakeDb();
  const first = await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:00:00.000Z'));
  assert.equal(first.allowed, true);
  assert.ok(first.claimId);

  db.now = '2026-09-23T12:00:20.000Z';
  const again = await claimNudge(db as never, 'plan-1', 'u2', at('2026-09-23T12:00:20.000Z'));
  assert.equal(again.allowed, false);
  assert.equal(again.retryAfterSeconds, 40);
  // A refused press is not left on the record to push the minute along.
  assert.equal(db.rows.filter(r => r.action === NUDGE_ACTION).length, 1);
});

test('after the minute it can go again, and another trip is never held up', async () => {
  const db = fakeDb();
  await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:00:00.000Z'));
  db.now = '2026-09-23T12:00:05.000Z';
  assert.equal((await claimNudge(db as never, 'plan-2', 'u1', at('2026-09-23T12:00:05.000Z'))).allowed, true);
  db.now = '2026-09-23T12:01:01.000Z';
  assert.equal((await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:01:01.000Z'))).allowed, true);
});

test('two whole-group presses in the same instant take the minute once', async () => {
  const db = fakeDb();
  const now = at('2026-09-23T12:00:00.000Z');
  const [a, b] = await Promise.all([
    claimNudge(db as never, 'plan-1', 'u1', now),
    claimNudge(db as never, 'plan-1', 'u2', now),
  ]);
  // Both looked before either wrote: the race was really run.
  assert.deepEqual(db.log.slice(0, 2), ['read', 'read']);
  assert.equal([a, b].filter(c => c.allowed).length, 1);
  assert.equal(db.rows.filter(r => r.action === NUDGE_ACTION).length, 1);
});

test('a nudge that sent nothing gives the minute back', async () => {
  const db = fakeDb();
  const c = await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:00:00.000Z'));
  await releaseNudge(db as never, c.claimId);
  assert.equal(db.rows.length, 0);
  assert.equal((await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:00:02.000Z'))).allowed, true);
});

test('every nudge that reaches somebody is held to the minute — funding too', () => {
  assert.equal(limitsNudge('vote'), true);
  assert.equal(limitsNudge('prefs'), true);
  assert.equal(limitsNudge('funding'), true);
});

// ─── Once per person per twelve hours ────────────────────────────────────

test('a person nudged once cannot be nudged again on that plan for twelve hours, by anybody', async () => {
  const db = fakeDb();
  const first = await claimPeople(db as never, 'plan-1', 'org', ['sam'], at('2026-09-23T12:00:00.000Z'));
  assert.deepEqual(first.claimed.map(c => c.userId), ['sam']);
  assert.ok(first.claimed[0].claimId);

  // Somebody else, three hours later, a different thing to nudge about.
  db.now = '2026-09-23T15:00:00.000Z';
  const again = await claimPeople(db as never, 'plan-1', 'jo', ['sam'], at('2026-09-23T15:00:00.000Z'));
  assert.deepEqual(again.claimed, []);
  assert.deepEqual(again.held, [{ userId: 'sam', retryAfterSeconds: 9 * 3600 }]);
  assert.equal(nudgesFor(db, 'plan-1', 'sam').length, 1);

  // Twelve hours on, they can be.
  db.now = '2026-09-24T00:00:01.000Z';
  const later = await claimPeople(db as never, 'plan-1', 'jo', ['sam'], at('2026-09-24T00:00:01.000Z'));
  assert.deepEqual(later.claimed.map(c => c.userId), ['sam']);
});

test('remind everyone leaves out whoever was nudged lately and reaches the rest', async () => {
  const db = fakeDb();
  await claimPeople(db as never, 'plan-1', 'org', ['sam'], at('2026-09-23T12:00:00.000Z'));
  db.now = '2026-09-23T12:05:00.000Z';
  const all = await claimPeople(db as never, 'plan-1', 'org', ['sam', 'jo', 'ana'], at('2026-09-23T12:05:00.000Z'));
  assert.deepEqual(all.claimed.map(c => c.userId).sort(), ['ana', 'jo']);
  assert.deepEqual(all.held.map(h => h.userId), ['sam']);
});

test('the twelve hours are per plan: a night out does not use up the trip', async () => {
  const db = fakeDb();
  await claimPeople(db as never, 'trip', 'org', ['sam'], at('2026-09-23T12:00:00.000Z'));
  const night = await claimPeople(db as never, 'night', 'org', ['sam'], at('2026-09-23T12:00:01.000Z'));
  assert.deepEqual(night.claimed.map(c => c.userId), ['sam']);
});

test('a double-tap on one face sends one nudge', async () => {
  const db = fakeDb();
  const now = at('2026-09-23T12:00:00.000Z');
  const [a, b] = await Promise.all([
    claimPeople(db as never, 'plan-1', 'org', ['sam'], now),
    claimPeople(db as never, 'plan-1', 'org', ['sam'], now),
  ]);
  // Both requests read "nobody nudged Sam" before either wrote — the race
  // a read-then-write check loses.
  assert.deepEqual(db.log.slice(0, 2), ['read', 'read']);
  assert.equal(a.claimed.length + b.claimed.length, 1, 'exactly one of the two taps may send');
  assert.equal(a.held.length + b.held.length, 1, 'and the other is told Sam was just nudged');
  // The loser's claim is taken back out, so Sam's twelve hours start once.
  assert.equal(nudgesFor(db, 'plan-1', 'sam').length, 1);
});

test('a tap on a face and "remind everyone" at the same instant reach that person once', async () => {
  const db = fakeDb();
  const now = at('2026-09-23T12:00:00.000Z');
  const [tap, everyone] = await Promise.all([
    claimPeople(db as never, 'plan-1', 'jo', ['sam'], now),
    claimPeople(db as never, 'plan-1', 'org', ['sam', 'ana'], now),
  ]);
  const samSends = [tap, everyone].filter(c => c.claimed.some(x => x.userId === 'sam')).length;
  assert.equal(samSends, 1);
  assert.deepEqual(everyone.claimed.map(c => c.userId).includes('ana'), true, 'Ana still hears');
  assert.equal(nudgesFor(db, 'plan-1', 'sam').length, 1);
});

test('somebody no nudge reached gets their twelve hours back', async () => {
  const db = fakeDb();
  const c = await claimPeople(db as never, 'plan-1', 'org', ['sam', 'jo'], at('2026-09-23T12:00:00.000Z'));
  const sam = c.claimed.find(x => x.userId === 'sam')!;
  await releasePeople(db as never, [sam.claimId]);
  const again = await claimPeople(db as never, 'plan-1', 'org', ['sam', 'jo'], at('2026-09-23T12:00:05.000Z'));
  assert.deepEqual(again.claimed.map(x => x.userId), ['sam']);
  assert.deepEqual(again.held.map(x => x.userId), ['jo']);
});

test('the faces know when each person can next be nudged', async () => {
  const db = fakeDb();
  await claimPeople(db as never, 'plan-1', 'org', ['sam'], at('2026-09-23T12:00:00.000Z'));
  const until = await nudgedUntil(db as never, 'plan-1', ['sam', 'jo'], at('2026-09-23T13:00:00.000Z'));
  assert.deepEqual(until, { sam: '2026-09-24T00:00:00.000Z', jo: null });
});

// ─── The route uses them ────────────────────────────────────────────────

const route = readFileSync('app/api/plans/[planId]/notify/route.ts', 'utf8');

test('every nudge claims each person before anything is sent, and sends only to who it claimed', () => {
  const claim = route.indexOf('claimPeople(db, params.planId, ctx.user.id, aimedAt)');
  assert.ok(claim > 0, 'the route claims each person');
  const firstSend = Math.min(...['notifyUsers(db,', 'sendVoteNeeded(', 'sendFundingNeeded(', 'sendAnswersNeeded(']
    .map(s => route.indexOf(s, route.indexOf('export async function POST'))).filter(i => i > 0));
  assert.ok(claim < firstSend, 'claimed before the first send');
  for (const call of route.match(/notifyUsers\(db, (\w+),/g) ?? []) {
    assert.equal(call, 'notifyUsers(db, sendTo,', 'the bell and phone only for people claimed');
  }
});

test('the group-wide minute still holds a whole-group press, and not a single face', () => {
  assert.match(route, /if \(!target && limitsNudge\(kind\)\) \{\s*const claim = await claimNudge\(/);
});

test('a funding nudge reaches the bell and phone, and names no amount there', () => {
  const funding = route.slice(route.indexOf("kind: 'funding',"), route.indexOf('}, pushSender());', route.indexOf("kind: 'funding',")));
  assert.ok(funding.length > 0);
  assert.doesNotMatch(funding, /shares\[|shareCents|cents|dollars|\$\d/i);
});
