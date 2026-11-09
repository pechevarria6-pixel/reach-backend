// Pilot gate §A4: the delete audit, the reopen refusal, the lock-in report,
// one figure on every pay button, and the hand-off words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deletionRow, recordPlanDeletion } from '../../lib/integrity/plan-deletion.ts';
import { reopenCopy, reopenRefusal } from '../../lib/integrity/one-active-copy.ts';
import { lockInReport } from '../../lib/integrity/lock-in.ts';
import { confirmQuestion, BOOKED_IT } from '../../lib/integrity/redirect-words.ts';
import { shareDueCents, bookEverythingLabel } from '../../lib/checkout.ts';
import { getNextAction } from '../../lib/next-action.ts';

const PLAN = { id: 'p1', group_id: 'g1', title: 'Lisbon in March', status: 'planning', type: 'trip' };

test('the deletion record keeps who, what it was, what it held and the days', () => {
  const row = deletionRow({ planId: 'p1', deletedBy: 'u1', plan: PLAN, bookings: 2, contributions: 0,
    itinerary: [{ type: 'hotel', title: '3 nights', booking_mode: 'reach' }] });
  assert.equal(row.plan_id, 'p1');
  assert.equal(row.group_id, 'g1');
  assert.equal(row.deleted_by, 'u1');
  assert.equal(row.title, 'Lisbon in March');
  assert.equal(row.status, 'planning');
  assert.equal(row.bookings, 2);
  assert.deepEqual((row.snapshot as { itinerary: unknown[] }).itinerary, [{ type: 'hotel', title: '3 nights', booking_mode: 'reach' }]);
  assert.deepEqual((row.snapshot as { plan: unknown }).plan, PLAN);
});

const insertDb = (error: { code?: string; message?: string } | null, seen: string[] = []) => ({
  from: (t: string) => ({ insert: async () => { seen.push(t); return { error }; } }),
});

test('recordPlanDeletion writes plan_deletions, and tolerates the table not being there yet', async () => {
  const seen: string[] = [];
  const input = { planId: 'p1', deletedBy: 'u1', plan: PLAN, bookings: 0, contributions: 0 };
  assert.equal(await recordPlanDeletion(insertDb(null, seen), input), 'written');
  assert.deepEqual(seen, ['plan_deletions']);
  assert.equal(await recordPlanDeletion(insertDb({ code: 'PGRST205', message: "Could not find the table 'public.plan_deletions'" }), input), 'pending');
  assert.equal(await recordPlanDeletion(insertDb({ code: '42P01' }), input), 'pending');
  assert.equal(await recordPlanDeletion(insertDb({ code: '23502' }), input), 'failed');
  const throws = { from: () => ({ insert: async () => { throw new Error('network'); } }) };
  assert.equal(await recordPlanDeletion(throws as never, input), 'failed', 'never throws into the delete');
});

test('DELETE /api/plans/[id] records the deletion after the plan is gone, and reads the plan with its error checked', () => {
  const src = readFileSync('app/api/plans/[planId]/route.ts', 'utf8');
  const del = src.slice(src.indexOf('export async function DELETE'));
  assert.ok(del.includes('recordPlanDeletion('), 'the audit row is written');
  assert.ok(del.indexOf("from('plans').delete()") < del.indexOf('recordPlanDeletion('), 'only once the delete happened');
  assert.ok(del.indexOf("from('itinerary_items')") < del.indexOf("from('plans').delete()"), 'the days are read before they cascade away');
  assert.match(del, /error: planErr/);
});

test('reopening behind another plan says so kindly, and never "Here it is" over a screen that is not it', () => {
  const words = reopenCopy('trip', { title: 'Lisbon in March' });
  assert.equal(words, "This group is already planning Lisbon in March. A group plans one trip at a time, so this one can't be picked back up just yet — it'll still be here once Lisbon in March is done.");
  assert.doesNotMatch(words, /here it is/i);
  assert.doesNotMatch(words, /call (it|that) off|cancel/i, 'the reader may not be the organiser');
  assert.match(reopenCopy('night'), /one night out at a time/);
  const body = reopenRefusal({ error: 'This group is already planning a trip. Here it is.', code: 'one_active' as const, planId: 'p2', kind: 'trip' as const }, { title: null });
  assert.equal(body.planId, 'p2');
  assert.equal(body.code, 'one_active');
  assert.doesNotMatch(body.error, /here it is/i);
  const src = readFileSync('app/api/plans/[planId]/route.ts', 'utf8');
  assert.equal((src.match(/reopenRefusal\(/g) ?? []).length, 2, 'both PATCH refusals use the reopen words');
});

test('lock-in report: priced things counted, every unpriced line named', () => {
  assert.equal(lockInReport({ created: 2, failures: [], skipped: [] }, { solo: true }).message,
    'Locked in — 2 things priced. Checkout has the prices; nothing is charged until you pay.');
  const r = lockInReport({ created: 1, failures: [{ title: 'The hotel', error: 'No rates available' }],
    skipped: [{ title: 'Round-trip flights', why: 'add your home airport in Profile' }] }, { solo: false });
  assert.equal(r.message, "Locked in for everyone — 1 thing priced. The hotel and 1 other couldn't be priced — checkout says why.");
  assert.deepEqual(r.notPriced.map(x => x.title), ['The hotel', 'Round-trip flights']);
  // A row priced for the old headcount is still in the total: not "not priced".
  assert.equal(lockInReport({ created: 0, repriced: 0, alreadyBooked: 1, failures: [{ title: 'Hotel', error: 'x', stillPriced: true }] }, { solo: true }).notPriced.length, 0);
  assert.match(lockInReport(null, { solo: true }).message, /checkout tries again/);
  assert.equal(lockInReport({ created: 0, failures: [], skipped: [] }, { solo: true }).message, 'Locked in. Nothing here is booked through Reach.');
});

test('the plan screen runs the bridge on Lock it in and reports it', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  const at = app.indexOf('if(na?.state==="lock_in"){');
  assert.ok(at > 0);
  const block = app.slice(at, at + 1200);
  const bridge = block.indexOf('fetchWithin(`/api/plans/${planId}/bookable`,{method:"POST"}');
  assert.ok(bridge > 0, 'the bridge is called');
  assert.ok(block.indexOf('updateStatus("approved")') < bridge, 'locked in first, then priced');
  assert.match(block, /lockInReport\(answer/);
});

test('one figure on every pay button: what is left of my share', () => {
  const part = { targetCents: 100000, myShareCents: 50000, myPaidCents: 20000, myRemainingCents: 30000 };
  assert.equal(shareDueCents(part), 30000);
  assert.equal(shareDueCents({ targetCents: 100000, myShareCents: 50000, myPaidCents: 20000 }), 30000, 'worked out when remaining is missing');
  assert.equal(shareDueCents({ targetCents: 0, myShareCents: 0 }), null, 'nothing priced is not $0');
  assert.equal(shareDueCents(null), null);
  assert.equal(bookEverythingLabel({ funding: part, estimateCents: 0, solo: false }), 'Book everything · $300 left of your share →');
  assert.equal(bookEverythingLabel({ funding: { targetCents: 1190, myRemainingCents: 1190, myPaidCents: 0 }, estimateCents: 0, solo: true }), 'Book everything · $11.90 →');
  assert.equal(bookEverythingLabel({ funding: null, estimateCents: 45000, solo: false }), 'Book everything · $450 est. each →');
  assert.equal(bookEverythingLabel({ funding: null, estimateCents: 0, solo: true }), 'Book everything →');
});

test("the rail's Chip in shows the same figure as the Book tab", () => {
  const plan = { id: 'p1', title: 'Moab', status: 'approved', type: 'trip', destStyle: 'desert', createdBy: 'u-me',
    memberIds: ['u-me', 'u-sam'], itinerary: [{ id: 'l-hotel', title: '3 nights', type: 'hotel', booking_mode: 'reach' }] };
  const funding = { targetCents: 120000, collectedCents: 20000, funded: false, memberCount: 2, myShareCents: 60000, myPaidCents: 20000, myRemainingCents: 40000 };
  const na = getNextAction({
    plan, me: 'u-me', memberCount: 2,
    bookings: [{ id: 'b1', vertical: 'hotel', status: 'awaiting_approval', price_cents: 120000, mode: 'native', provider: 'liteapi', itinerary_item_id: 'l-hotel', detail: '3 nights' }],
    funding,
  } as never);
  assert.equal(na.state, 'pay_share');
  assert.equal(na.title, 'Chip in $400');
  assert.match(bookEverythingLabel({ funding, estimateCents: 0, solo: false }), /\$400 /);
});

test('hand-off words: "Booked it ✓" everywhere, and the question fits the thing', () => {
  assert.equal(BOOKED_IT, 'Booked it ✓');
  assert.equal(confirmQuestion('restaurant'), 'Did you get the table?');
  assert.equal(confirmQuestion('event'), 'Did you get the tickets?');
  assert.equal(confirmQuestion('hotel'), 'Did you book the stay?');
  assert.equal(confirmQuestion(null), 'Did you book it?');
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.doesNotMatch(app, /""\}Did you get the table\?/, 'checkout asks by vertical');
});

test('checkout: a table Reach does not book never sits in the paid list, and a dearer native row is told so', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.ok(app.includes('(l.vertical==="restaurant"&&l.mode!=="native")'), 'the $0 "A table" rows go to the things you book yourself');
  assert.ok(app.includes('parityOf(it.raw)') && app.includes('{CHEAPER_DIRECTLY}'), 'the public price is offered where it is cheaper');
  // The way back to "Booked it ✓" after leaving checkout and coming back.
  assert.ok(app.includes('!handedOver[it.id]&&it.st!=="confirmed"&&it.st!=="redirected"'));
});
