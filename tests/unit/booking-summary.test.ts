import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingSummary } from '../../lib/booking/summary.ts';

test('nothing is summed up while a booking is still waiting', () => {
  assert.equal(bookingSummary([{ status: 'confirmed', vertical: 'hotel' }, { status: 'awaiting_approval', vertical: 'flight' }]), null);
  assert.equal(bookingSummary([{ status: 'confirmed', vertical: 'hotel' }, { status: 'booking', vertical: 'flight' }]), null);
  assert.equal(bookingSummary([{ status: 'confirmed', vertical: 'hotel' }, { status: 'pending', vertical: 'flight' }]), null);
});

test('no summary when nothing was booked', () => {
  assert.equal(bookingSummary([{ status: 'failed', vertical: 'hotel' }]), null);
  assert.equal(bookingSummary([]), null);
});

test('the round says what was booked, what failed and what was held', () => {
  const s = bookingSummary([
    { status: 'confirmed', vertical: 'hotel', detail: 'Hotel X', provider_ref: 'H1' },
    { status: 'failed', vertical: 'flight' },
    { status: 'quoted', vertical: 'car' },
    { status: 'cancelled', vertical: 'activity' },
  ]);
  assert.deepEqual(s?.booked, [{ label: 'Hotel', detail: 'Hotel X', confirmation: 'H1' }]);
  assert.deepEqual(s?.failed.map(l => l.label), ['Flight']);
  assert.deepEqual(s?.held.map(l => l.label), ['Car']);
});
