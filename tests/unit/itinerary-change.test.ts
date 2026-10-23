import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockedIn, changeRight, suggestionsClosed, refusal, shownSuggestions } from '../../lib/itinerary-change.ts';
import { bookingOnSwap, CANNOT_CANCEL } from '../../lib/itinerary-bookings.ts';
import { replaceLine } from '../../lib/itinerary-replace.ts';

test('locked in: past planning, or anything moving, and cancelled rows count for nothing', () => {
  assert.equal(lockedIn('planning', [], 0), false);
  assert.equal(lockedIn('voting', [{ status: 'quoted' }], 0), false, 'a held quote is not moving');
  assert.equal(lockedIn('planning', [{ status: 'cancelled' }], 0), false);
  assert.equal(lockedIn('approved', [], 0), true);
  assert.equal(lockedIn('planning', [{ status: 'awaiting_approval' }], 0), true);
  assert.equal(lockedIn('planning', [], 4500), true, 'money in is locked');
  assert.equal(lockedIn('planning', null, 'x'), false);
});

test('before lock a member suggests; after it only the organiser or the booker changes a line', () => {
  assert.equal(changeRight({ solo: false, organiser: false, locked: false }), 'suggest');
  assert.equal(changeRight({ solo: false, organiser: true, locked: false }), 'apply');
  assert.equal(changeRight({ solo: false, organiser: false, locked: true }), 'locked_out');
  assert.equal(changeRight({ solo: false, organiser: false, locked: true, bookedIt: true }), 'apply');
  assert.equal(changeRight({ solo: true, organiser: false, locked: true }), 'apply', 'a trip for one is its one person’s');
});

test('no suggestions on a trip for one, and none once locked in', () => {
  assert.equal(suggestionsClosed({ solo: true, locked: false }), 'solo');
  assert.equal(suggestionsClosed({ solo: false, locked: true }), 'locked');
  assert.equal(suggestionsClosed({ solo: false, locked: false }), null);
  assert.match(refusal('suggest', 'Sam') as string, /^Sam makes changes/);
  assert.match(refusal('locked_out', null) as string, /locked in, so the organiser/);
  assert.equal(refusal('apply', 'Sam'), null);
});

test("a suggestion counts its suggester's 👍 once, and the most liked comes first", () => {
  const rows = [
    { id: 's1', item_id: 'i', suggested_by: 'sam', candidate_ref: 'v:00000001', candidate: { name: 'Bar X' }, note: null, status: 'open', created_at: '2026-10-01T10:00:00Z' },
    { id: 's2', item_id: 'i', suggested_by: 'ana', candidate_ref: 'v:00000002', candidate: { name: 'Bar Y' }, note: null, status: 'open', created_at: '2026-10-01T11:00:00Z' },
    { id: 's3', item_id: 'i', suggested_by: 'ana', candidate_ref: 'v:00000003', candidate: {}, note: null, status: 'dismissed', created_at: '2026-10-01T09:00:00Z' },
  ];
  const votes = [{ suggestion_id: 's2', user_id: 'me' }, { suggestion_id: 's2', user_id: 'ana' }, { suggestion_id: 's1', user_id: 'sam' }];
  const out = shownSuggestions(rows, votes, 'me', new Map([['sam', 'Sam'], ['ana', 'Ana']]));
  assert.deepEqual(out.map(s => [s.id, s.votes]), [['s2', 2], ['s1', 1]]);
  assert.equal(out[0].votedByMe, true);
  assert.equal(out[1].suggestedBy.name, 'Sam');
  assert.equal(out[1].mine, false);
});

test('a swap lets go of a booking not yet made, and refuses one that is', () => {
  assert.deepEqual(bookingOnSwap(null), { action: 'none' });
  assert.deepEqual(bookingOnSwap({ id: 'b', status: 'cancelled' }), { action: 'none' });
  assert.deepEqual(bookingOnSwap({ id: 'b', status: 'awaiting_approval', vertical: 'restaurant' }), { action: 'retire', bookingId: 'b' });
  const hotel = bookingOnSwap({ id: 'b', status: 'confirmed', vertical: 'hotel' });
  assert.equal(hotel.action, 'refuse');
  if (hotel.action === 'refuse') {
    assert.equal(hotel.message, CANNOT_CANCEL.hotel);
    assert.match(hotel.message, /Reach can't cancel it for you/);
  }
  // Bought on the seller's own site: a real reservation, whatever the status says.
  assert.equal(bookingOnSwap({ id: 'b', status: 'awaiting_approval', mode: 'redirect', confirmation_number: 'ABC123' }).action, 'refuse');
  const now = '2026-10-23T18:00:00.000Z';
  const mid = bookingOnSwap({ id: 'b', status: 'awaiting_approval', approved_at: now, updated_at: now });
  assert.ok(mid.action === 'refuse' && mid.code === 'booking_now');
});

/** A database that answers one update, and records what it was filtered on. */
function fakeDb(answer: { data: unknown; error: unknown }) {
  const filters: string[] = [];
  const q: Record<string, unknown> = {
    update: () => q,
    eq: (c: string, v: unknown) => { filters.push(`${c}=${v}`); return q; },
    is: (c: string) => { filters.push(`${c} is null`); return q; },
    select: () => q,
    maybeSingle: () => Promise.resolve(answer),
  };
  return { db: { from: () => q } as never, filters };
}

test('one line is written in place, on the version read, and a lost race writes nothing', async () => {
  const ok = fakeDb({ data: { id: 'i3', title: 'New' }, error: null });
  const out = await replaceLine(ok.db, 'p1', 'i3', { title: 'End the night at SPIN', venue_name: null }, { title: 'New' });
  assert.equal(out.status, 'swapped');
  assert.deepEqual(ok.filters, ['id=i3', 'plan_id=p1', 'title=End the night at SPIN', 'venue_name is null'],
    'taken only on the line as it was read');
  const raced = fakeDb({ data: null, error: null });
  assert.deepEqual(await replaceLine(raced.db, 'p1', 'i3', { title: 'x', venue_name: 'SPIN' }, {}), { status: 'changed' });
});
