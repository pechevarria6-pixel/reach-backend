// Run with: npm run test:unit
//
// Pilot gate A3 / directive P3: "Booked it ✓" on something a member paid for
// on the seller's own site becomes an expense the group settles up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expenseForBooking, removeBookingExpense, statedCents, writeBookingExpense } from '../../lib/rail/expense.ts';

const tickets = { id: 'b1', plan_id: 'p1', group_id: 'g1', vertical: 'event', provider: 'ticketmaster', detail: 'J. Cole · Crown Coliseum', price_cents: 36000 };
const who = { paidBy: 'ana', members: ['ana', 'ben', 'cy'], skips: [] as { ref: string; userId: string }[] };

test('the expense is what they paid, split between who is going, paid by who booked it', () => {
  const row = expenseForBooking(tickets, who, 34000)!;
  assert.equal(row.amount_cents, 34000);
  assert.equal(row.paid_by, 'ana');
  assert.deepEqual(row.split_between, ['ana', 'ben', 'cy']);
  assert.equal(row.booking_id, 'b1');
  assert.equal(row.description, 'J. Cole · Crown Coliseum — booked on Ticketmaster');
});

test('without an amount the listed price is used, and labelled as that', () => {
  const row = expenseForBooking(tickets, who, null)!;
  assert.equal(row.amount_cents, 36000);
  assert.match(row.description, /\(listed price\)$/);
});

test('somebody sitting it out is not split into it', () => {
  const row = expenseForBooking(tickets, { ...who, skips: [{ ref: 'b1', userId: 'cy' }, { ref: 'other', userId: 'ben' }] }, null)!;
  assert.deepEqual(row.split_between, ['ana', 'ben']);
});

test('no number nobody gave us, and nothing to settle on a trip of one', () => {
  assert.equal(expenseForBooking({ ...tickets, price_cents: null }, who, null), null, 'no price, no amount');
  assert.equal(expenseForBooking(tickets, { paidBy: 'ana', members: ['ana'], skips: [] }, 1000), null, 'solo');
  assert.equal(expenseForBooking(tickets, { ...who, skips: [{ ref: 'b1', userId: 'ben' }, { ref: 'b1', userId: 'cy' }] }, 1000), null,
    'only the payer is going');
  assert.equal(statedCents('abc'), null);
  assert.equal(statedCents(-5), null);
  assert.equal(statedCents(''), null);
  assert.equal(statedCents(1234.4), 1234);
});

function fakeDb(answers: ({ code?: string; message?: string } | null)[]) {
  const inserts: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  return {
    inserts, deletes,
    from() {
      const q: any = {
        insert(r: Record<string, unknown>) { inserts.push(r); return Promise.resolve({ error: answers.shift() ?? null }); },
        delete() { return q; },
        eq(_c: string, v: unknown) { deletes.push(v); return Promise.resolve({ error: answers.shift() ?? null }); },
      };
      return q;
    },
  };
}

test('one expense per booking: the index refusing a second is not an error', async () => {
  const row = expenseForBooking(tickets, who, null)!;
  assert.deepEqual(await writeBookingExpense(fakeDb([null]), row), { ok: true, kept: 'written' });
  assert.deepEqual(await writeBookingExpense(fakeDb([{ code: '23505' }]), row), { ok: true, kept: 'already' });
});

test('before the link column exists it is written without it, never lost', async () => {
  const db = fakeDb([{ code: 'PGRST204', message: "Could not find the 'booking_id' column of 'expenses'" }, null]);
  assert.deepEqual(await writeBookingExpense(db, expenseForBooking(tickets, who, null)!), { ok: true, kept: 'without_link' });
  assert.equal(db.inserts.length, 2);
  assert.ok(!('booking_id' in db.inserts[1]));
  assert.equal((await writeBookingExpense(fakeDb([{ code: '42501' }]), expenseForBooking(tickets, who, null)!)).ok, false);
});

test('"not booked after all" takes back only that booking\'s expense', async () => {
  const db = fakeDb([null]);
  assert.deepEqual(await removeBookingExpense(db, 'b1'), { ok: true });
  assert.deepEqual(db.deletes, ['b1']);
  assert.deepEqual(await removeBookingExpense(fakeDb([{ code: '42703' }]), 'b1'), { ok: true }, 'no column, nothing linked to remove');
});

test('"Booked it ✓" writes it only on the press that marked it done; the PATCH adds and removes it', () => {
  const confirm = readFileSync('app/api/bookings/[id]/confirmation/route.ts', 'utf8');
  assert.match(confirm, /booking\.status === 'confirmed' \? 'already' : await settleUpLine\(ctx, booking, statedCents\(body\?\.amountCents\)\)/);
  const patch = readFileSync('app/api/bookings/[id]/route.ts', 'utf8');
  assert.match(patch, /body\.status === 'confirmed' && booking\.status !== 'confirmed'\) \{\s*await settleUpLine/);
  assert.match(patch, /body\.status !== 'confirmed' && booking\.status === 'confirmed'\) \{\s*await takeOffSettleUp/);
});
