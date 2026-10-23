import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyUsers, type Sender } from '../../lib/notify-user.ts';

// A tiny stand-in for the database: records inserts, serves subscriptions.
function fakeDb(subs: Record<string, unknown>[], opts: { noTable?: boolean } = {}) {
  const log: { table: string; op: string; rows?: unknown }[] = [];
  const q = (table: string) => ({
    insert: async (rows: unknown) => { log.push({ table, op: 'insert', rows });
      return opts.noTable && table === 'notifications' ? { error: { code: '42P01', message: 'relation does not exist' } } : { error: null }; },
    select: () => ({ in: async () => ({ data: subs, error: null }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
    delete: () => ({ eq: async (_c: string, id: string) => { log.push({ table, op: 'delete', rows: id }); return { error: null }; } }),
  });
  return { db: { from: q } as never, log };
}

const note = { kind: 'prefs', title: "Peter's waiting on you", body: 'Say what you want from Rincón', url: '/home?answer=p1' };

test('everyone gets the bell; only people with a phone subscribed are pushed; the rest are the email list', async () => {
  const { db, log } = fakeDb([{ id: 's1', user_id: 'marco', endpoint: 'e1', p256dh: 'k', auth: 'a' }]);
  const send: Sender = async () => ({ ok: true });
  const d = await notifyUsers(db, ['marco', 'sam'], note, send);
  assert.equal(d.inApp, 2);
  assert.deepEqual(d.pushed, ['marco']);
  assert.deepEqual(d.unreached, ['sam']);
  assert.equal((log.find(l => l.op === 'insert')?.rows as unknown[]).length, 2);
});

test('a phone that has gone away is dropped, and its person falls back to email', async () => {
  const { db, log } = fakeDb([{ id: 's1', user_id: 'marco', endpoint: 'e1', p256dh: 'k', auth: 'a' }]);
  const d = await notifyUsers(db, ['marco'], note, async () => ({ ok: false, gone: true }));
  assert.deepEqual(d.unreached, ['marco']);
  assert.ok(log.some(l => l.table === 'push_subscriptions' && l.op === 'delete'));
});

test('with no push keys, nobody is claimed as pushed', async () => {
  const { db } = fakeDb([{ id: 's1', user_id: 'marco', endpoint: 'e1', p256dh: 'k', auth: 'a' }]);
  const d = await notifyUsers(db, ['marco'], note, null);
  assert.deepEqual(d.pushed, []);
  assert.deepEqual(d.unreached, ['marco']);
});

test('before the migration the bell is reported as not stored, not as delivered', async () => {
  const { db } = fakeDb([], { noTable: true });
  const d = await notifyUsers(db, ['marco'], note, null);
  assert.equal(d.stored, false);
  assert.equal(d.inApp, 0);
});

// plan_notification_mutes: "stop pinging me about this trip".
function mutingDb(muted: string[], opts: { noTable?: boolean } = {}) {
  const inserted: unknown[] = [];
  const from = (table: string) => ({
    insert: async (rows: unknown) => { inserted.push(rows); return { error: null }; },
    select: () => ({
      in: async () => ({ data: [], error: null }),
      eq: () => ({
        in: async (_c: string, ids: string[]) => table === 'plan_notification_mutes' && opts.noTable
          ? { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }
          : { data: muted.filter(m => ids.includes(m)).map(user_id => ({ user_id })), error: null },
      }),
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
  });
  return { db: { from } as never, inserted };
}

test('somebody who muted the plan gets nothing — no bell, no phone, and is not on the email list', async () => {
  const { db, inserted } = mutingDb(['sam']);
  const d = await notifyUsers(db, ['marco', 'sam'], { ...note, planId: 'p1' }, async () => ({ ok: true }));
  assert.deepEqual(d.muted, ['sam']);
  assert.deepEqual(d.unreached, ['marco']);
  assert.deepEqual((inserted[0] as { user_id: string }[]).map(r => r.user_id), ['marco']);
});

test('everybody muted: nothing is written at all', async () => {
  const { db, inserted } = mutingDb(['sam']);
  const d = await notifyUsers(db, ['sam'], { ...note, planId: 'p1' }, null);
  assert.equal(inserted.length, 0);
  assert.deepEqual(d.unreached, []);
});

test('before the mutes table exists, nobody has muted anything', async () => {
  const { db } = mutingDb(['sam'], { noTable: true });
  const d = await notifyUsers(db, ['sam'], { ...note, planId: 'p1' }, null);
  assert.deepEqual(d.muted, []);
  assert.equal(d.inApp, 1);
});
