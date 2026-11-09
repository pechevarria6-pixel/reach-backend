// L3 (price parity) and L4 (lane, provider, commission) — pilot gate §A4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commissionFor, laneOf, configuredBps, providerCommissionCents } from '../../lib/booking/commission.ts';
import { publicPriceOf, parityOf, directLink, paidAtDeskCents, PARITY_TOLERANCE, CHEAPER_DIRECTLY } from '../../lib/integrity/price-parity.ts';
import { stampFor, stampLedger, schemaPending } from '../../lib/integrity/stamp.ts';

// The Vendue, as LiteAPI quoted it on the demo plan (production row, read 2026-11-08).
const vendue = (over: Record<string, unknown> = {}, rate: Record<string, unknown> = {}) => ({
  id: 'b-hotel', vertical: 'hotel', mode: 'native', provider: 'liteapi', status: 'awaiting_approval',
  price_cents: 91438, currency: 'USD',
  request_payload: { hotel: { city: 'Charleston', rooms: 1, checkin: '2026-12-04', checkout: '2026-12-06', hotelId: 'lp2bb09' }, party: 1 },
  response_payload: {
    hotel: { name: 'The Vendue' },
    commission: [{ amount: 0, currency: 'USD' }],
    retailRate: {
      total: [{ amount: 914.38, currency: 'USD' }],
      taxesAndFees: [
        { amount: 128.01, currency: 'USD', included: false, description: 'TAX' },
        { amount: 4.56, currency: 'USD', included: false, description: 'Destination charge' },
        { amount: 43.6, currency: 'USD', included: false, description: 'Property service charge' },
      ],
      suggestedSellingPrice: [{ amount: 1051.54, currency: 'USD', source: '' }],
      ...rate,
    },
  },
  ...over,
});

test('lane comes from the row mode, and an unknown mode is not guessed', () => {
  assert.equal(laneOf({ mode: 'native' }), 'native');
  assert.equal(laneOf({ mode: 'redirect' }), 'redirect');
  assert.equal(laneOf({ mode: 'concierge' }), 'concierge');
  assert.equal(laneOf({ mode: 'reach' }), null);
  assert.equal(laneOf({ mode: null }), null);
});

test("commission: the provider's own figure first — LiteAPI said 0, so 0", () => {
  assert.deepEqual(commissionFor(vendue(), {}), { cents: 0, source: 'provider' });
  assert.equal(providerCommissionCents(vendue({}, {}) as never), 0);
  const paid = vendue({ response_payload: { commission: [{ amount: 45.72, currency: 'USD' }] } });
  assert.deepEqual(commissionFor(paid, {}), { cents: 4572, source: 'provider' });
});

test('commission: a configured rate when the provider says nothing, and null — never 0 — when nobody knows', () => {
  const flight = { mode: 'native', provider: 'duffel', price_cents: 5486, currency: 'USD', response_payload: { id: 'off_1' } };
  assert.deepEqual(commissionFor(flight, {}), { cents: null, source: null });
  assert.deepEqual(commissionFor(flight, { COMMISSION_BPS_DUFFEL: '100' }), { cents: 55, source: 'configured' });
  assert.equal(configuredBps('duffel', { COMMISSION_BPS_DUFFEL: 'lots' }), null);
  assert.equal(configuredBps('duffel', { COMMISSION_BPS_DUFFEL: '' }), null);
  // A commission in another currency is not added to a USD booking.
  assert.equal(providerCommissionCents({ currency: 'USD', response_payload: { commission: [{ amount: 3, currency: 'EUR' }] } }), null);
});

test("public price: LiteAPI's suggested selling price, single room only", () => {
  assert.equal(publicPriceOf(vendue()), 105154);
  const tworooms = vendue({ request_payload: { hotel: { rooms: 2, checkin: '2026-12-04', checkout: '2026-12-06' } } });
  assert.equal(publicPriceOf(tworooms), null, 'per-rate SSP is ambiguous for a multi-room offer');
  assert.equal(publicPriceOf({ ...vendue(), mode: 'redirect' }), null);
  assert.equal(publicPriceOf({ vertical: 'flight', mode: 'native', provider: 'duffel', price_cents: 5486, response_payload: {} }), null,
    'no public figure for a flight is null, not parity');
});

test('parity compares like for like: SSP includes taxes, so ours includes what the hotel collects at the desk', () => {
  assert.equal(paidAtDeskCents(vendue()), 12801 + 456 + 4360);
  const p = parityOf(vendue())!;
  assert.equal(p.ourCents, 91438 + 17617);
  assert.equal(p.publicCents, 105154);
  assert.equal(p.cheaperPubliclyByCents, 109_055 - 105_154);
  assert.equal(p.tellMember, false, 'under 4% is inside the tolerance');
});

test('public cheaper by more than the tolerance: the member is told, with a way to book it directly', () => {
  const cheap = vendue({}, { suggestedSellingPrice: [{ amount: 800, currency: 'USD' }] });
  const p = parityOf(cheap)!;
  assert.equal(p.tellMember, true);
  assert.ok(p.publicCents < p.ourCents * (1 - PARITY_TOLERANCE));
  const href = directLink(cheap)!;
  assert.match(href, /^https:\/\/www\.booking\.com\/searchresults\.html\?/);
  assert.match(href, /checkin=2026-12-04/);
  assert.match(href, /The\+Vendue%2C\+Charleston/);
  assert.equal(CHEAPER_DIRECTLY, 'Cheaper if you book this one directly →');
  // A stored public price wins over re-reading the payload.
  assert.equal(parityOf({ ...vendue(), public_price_cents: 70000 })!.tellMember, true);
});

test('stampFor: lane, commission and the public price, once per quote', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  const patch = stampFor({ ...vendue(), lane: null }, now, {})!;
  assert.deepEqual(patch, { lane: 'native', commission_cents: 0, public_price_cents: 105154, public_price_checked_at: now.toISOString() });
  const done = stampFor({ ...vendue(), lane: 'native', commission_cents: 0, public_price_checked_at: '2026-11-01T00:00:00Z' }, now, {});
  assert.equal(done, null);
  // A redirect is never price-checked: Reach is not selling it.
  const gig = stampFor({ mode: 'redirect', provider: 'ticketmaster', lane: null }, now, {});
  assert.deepEqual(gig, { lane: 'redirect' });
});

type Up = { patch: Record<string, unknown>; id: string };
function fakeDb(rows: Record<string, unknown>[], updateError: { code?: string; message?: string } | null = null) {
  const ups: Up[] = [];
  return {
    ups,
    db: {
      from: () => ({
        select: () => ({ eq: () => ({ not: async () => ({ data: rows, error: null }) }) }),
        update: (patch: Record<string, unknown>) => ({ eq: async (_c: string, id: string) => { ups.push({ patch, id }); return { error: updateError }; } }),
      }),
    },
  };
}

test('stampLedger writes each row once, and passes over a database without the columns', async () => {
  const ok = fakeDb([{ ...vendue(), lane: null, commission_cents: null, public_price_checked_at: null }]);
  const out = await stampLedger(ok.db as never, 'p1', new Date('2026-11-08T00:00:00Z'));
  assert.deepEqual(out, { stamped: 1, failed: 0, pending: false });
  assert.equal(ok.ups[0].id, 'b-hotel');

  // Before sql/pilot-gate-2026-11-08.sql: `*` has no lane, nothing is written.
  const before = fakeDb([vendue()]);
  assert.deepEqual(await stampLedger(before.db as never, 'p1'), { stamped: 0, failed: 0, pending: true });
  assert.equal(before.ups.length, 0);

  // A column refused mid-way is the migration, not a failed booking.
  const refused = fakeDb([{ ...vendue(), lane: null }], { code: 'PGRST204', message: "Could not find the 'public_price_cents' column" });
  assert.deepEqual(await stampLedger(refused.db as never, 'p1'), { stamped: 0, failed: 0, pending: true });
  assert.equal(schemaPending({ code: '42P01' }), true);
  assert.equal(schemaPending({ code: '23505' }), false);
});
