import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceItinerary, outcomeMessage } from '../../lib/itinerary-replace.ts';

/** A database that records the order it was asked to do things. */
function fakeDb(opts: { rows?: { id: string }[]; failRead?: boolean; failDelete?: boolean } = {}) {
  const order: string[] = [];
  const rows = opts.rows ?? [{ id: 'old-1' }, { id: 'old-2' }, { id: 'old-3' }];
  const db = {
    order,
    from() {
      const q: Record<string, unknown> = {
        select: () => { order.push('read'); return q; },
        eq: () => Promise.resolve({ data: rows, error: opts.failRead ? { message: 'no' } : null }),
        delete: () => { order.push('delete'); return { in: () => Promise.resolve({ error: opts.failDelete ? { message: 'no' } : null }) }; },
      };
      return q;
    },
  };
  return db as never;
}

const ROWS = [{ title: 'Day one' }, { title: 'Day two' }];

test('the new days are written before the old ones are removed', async () => {
  // The order is the entire fix. Delete-then-insert is one failed insert
  // away from an itinerary that no longer exists.
  const db = fakeDb();
  const order: string[] = (db as unknown as { order: string[] }).order;
  await replaceItinerary(db, 'p1', ROWS, async () => { order.push('insert'); return null; });
  assert.deepEqual(order, ['read', 'insert', 'delete'],
    'insert must come before delete — reversing this is the bug');
});

test('an insert that fails removes nothing at all', async () => {
  const db = fakeDb();
  const order: string[] = (db as unknown as { order: string[] }).order;
  const out = await replaceItinerary(db, 'p1', ROWS, async () => 'boom');
  assert.equal(out.status, 'insert_failed');
  assert.ok(!order.includes('delete'), 'the old itinerary is still there, untouched');
  assert.match(outcomeMessage(out) as string, /still there/);
});

test('a delete that fails duplicates rather than loses', async () => {
  // Visible and annoying, and a second save clears it. A wipe is neither.
  const out = await replaceItinerary(fakeDb({ failDelete: true }), 'p1', ROWS, async () => null);
  assert.deepEqual(out, { status: 'duplicated', stale: 3 });
  assert.match(outcomeMessage(out) as string, /Save again/);
});

test('nothing is touched when the current days cannot even be read', async () => {
  const db = fakeDb({ failRead: true });
  const order: string[] = (db as unknown as { order: string[] }).order;
  const out = await replaceItinerary(db, 'p1', ROWS, async () => { order.push('insert'); return null; });
  assert.equal(out.status, 'unreadable');
  assert.deepEqual(order, ['read'], 'no insert, no delete');
});

test('saving days onto an empty plan deletes nothing', async () => {
  const db = fakeDb({ rows: [] });
  const order: string[] = (db as unknown as { order: string[] }).order;
  const out = await replaceItinerary(db, 'p1', ROWS, async () => { order.push('insert'); return null; });
  assert.deepEqual(out, { status: 'replaced', removed: 0 });
  assert.ok(!order.includes('delete'));
});

test('clearing an itinerary removes the old days and writes none', async () => {
  const db = fakeDb();
  const order: string[] = (db as unknown as { order: string[] }).order;
  const out = await replaceItinerary(db, 'p1', [], async () => { order.push('insert'); return null; });
  assert.deepEqual(out, { status: 'replaced', removed: 3 });
  assert.ok(!order.includes('insert'), 'nothing to insert');
});
