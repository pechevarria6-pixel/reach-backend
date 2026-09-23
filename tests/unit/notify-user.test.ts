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
