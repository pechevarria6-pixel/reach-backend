import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  netCollectedCents, fundingOf, priceRose, acceptedPrice, isPurchase, unpriced,
  planBooked, travellersMissing, airlineOnly, type Person,
} from '../../lib/booking/approval.ts';
import { claimBooking, finishClaim } from '../../lib/booking/claim.ts';
import { failuresByLine } from '../../lib/booking/failures.ts';
import { airlineSite, airlineHandoff } from '../../lib/booking/duffel-map.ts';

// ─── The money ──────────────────────────────────────────────────────────

test('money held is what was paid, less what Stripe gave back', () => {
  const contribs = [
    { status: 'succeeded', amount_cents: 10000, user_id: 'a' },
    { status: 'succeeded', amount_cents: 10000, refunded_cents: 4000, user_id: 'b' },
    { status: 'pending', amount_cents: 10000, user_id: 'c' },
    { status: 'refunded', amount_cents: 10000, refunded_cents: 10000, user_id: 'd' },
  ];
  assert.equal(netCollectedCents(contribs), 16000);
  assert.equal(netCollectedCents(contribs, 'b'), 6000);
  // Before the column exists, nothing has been refunded.
  assert.equal(netCollectedCents([{ status: 'succeeded', amount_cents: 500 }]), 500);
});

test('a plan paid in full and then partly refunded is not funded', () => {
  const f = fundingOf([{ price_cents: 20000 }], [
    { status: 'succeeded', amount_cents: 20000, refunded_cents: 5000 },
  ]);
  assert.deepEqual(f, { targetCents: 20000, collectedCents: 15000, shortfallCents: 5000, funded: false });
});

// ─── The price ──────────────────────────────────────────────────────────

test('a rise is worth asking about above $25 or 5%', () => {
  assert.equal(priceRose(10000, 10400), false, '4% and $4');
  assert.equal(priceRose(10000, 10600), true, '6%');
  assert.equal(priceRose(100000, 102600), true, '$26');
  assert.equal(priceRose(10000, 9000), false, 'a drop just proceeds');
  assert.equal(priceRose(10000, undefined), false);
});

test('"accept the new price" means nothing unless a new price was offered', () => {
  // This flag was honoured on its own, so any member could send it and skip
  // the price check entirely.
  assert.equal(acceptedPrice({ acceptNewPrice: true }, { pending_price_cents: null }), null);
  assert.equal(acceptedPrice({ acceptNewPrice: true }, {}), null);
  assert.equal(acceptedPrice({}, { pending_price_cents: 12000 }), null);
  assert.equal(acceptedPrice({ acceptNewPrice: 'yes' }, { pending_price_cents: 12000 }), null);
  assert.equal(acceptedPrice({ acceptNewPrice: true }, { pending_price_cents: 12000 }), 12000);
});

test('a hotel, flight or activity with no price is not bought', () => {
  assert.equal(unpriced({ vertical: 'hotel', mode: 'native', price_cents: null }), true);
  assert.equal(unpriced({ vertical: 'flight', mode: 'native', price_cents: 0 }), true);
  assert.equal(unpriced({ vertical: 'activity', mode: 'native', price_cents: 4500 }), false);
  // Redirects cost nothing through Reach and have no price on purpose.
  assert.equal(unpriced({ vertical: 'flight', mode: 'redirect', price_cents: null }), false);
  assert.equal(unpriced({ vertical: 'restaurant', mode: 'redirect', price_cents: 0 }), false);
  assert.equal(isPurchase({ vertical: 'event', mode: 'redirect' }), false);
});

// ─── The plan ───────────────────────────────────────────────────────────

test('a plan is not booked while anything is pending, mid-booking or failed', () => {
  assert.equal(planBooked(['confirmed', 'pending']), false, 'the priced-concierge flight nobody booked');
  assert.equal(planBooked(['confirmed', 'booking']), false);
  assert.equal(planBooked(['confirmed', 'awaiting_approval']), false);
  assert.equal(planBooked(['confirmed', 'failed']), false);
  assert.equal(planBooked(['confirmed', 'redirected', 'cancelled', 'quoted']), true);
  assert.equal(planBooked([]), false);
});

// ─── The people ─────────────────────────────────────────────────────────

const person = (over: Partial<Person> = {}): Person => ({
  userId: 'u', name: 'Sam', firstName: 'Sam', lastName: 'Rivera', dateOfBirth: '1990-05-01',
  gender: 'female', phone: '+15551234567', email: 'sam@example.com', ...over,
});

test('everybody on a flight needs what the airline checks', () => {
  assert.deepEqual(travellersMissing('flight', [person()]), []);
  assert.deepEqual(travellersMissing('flight', [person(), person({ name: 'Marco', dateOfBirth: null })]), ['Marco']);
  assert.deepEqual(travellersMissing('flight', [person({ name: 'Ana', email: null })]), ['Ana']);
});

test('a room needs a legal name and an address for the confirmation', () => {
  assert.deepEqual(travellersMissing('hotel', [person({ dateOfBirth: null, phone: null })]), []);
  assert.deepEqual(travellersMissing('hotel', [person({ name: 'Jo', lastName: null })]), ['Jo']);
});

test('an X marker, or rather not say, goes to the airline', () => {
  assert.equal(airlineOnly([{ gender: 'male' }, { gender: 'female' }]), false);
  assert.equal(airlineOnly([{ gender: 'male' }, { gender: 'x' }]), true);
  assert.equal(airlineOnly([{ gender: 'unspecified' }]), true);
  // Not filled in is a blank for the readiness check, not a marker.
  assert.equal(airlineOnly([{ gender: null }, { gender: '' }]), false);
});

test('a flight handed to the airline carries no price and names nobody', () => {
  const h = airlineHandoff(
    { priceCents: 23663, currency: 'USD', detail: 'American Airlines · RDU → PVR',
      raw: { option: { airline: 'American Airlines' }, airlineSite: 'https://www.aa.com' } },
    { origin: 'RDU', destination: 'PVR', departDate: '2026-11-02' },
  );
  assert.equal(h.mode, 'redirect');
  assert.equal(h.priceCents, undefined, 'not in anybody\'s share');
  assert.equal(h.redirectUrl, 'https://www.aa.com');
  assert.match(String(h.raw.note), /isn't buying this flight/);
  assert.match(String(h.raw.note), /about \$237/);
  assert.equal(h.raw.estimateCents, 23663);
  // No airline page: a search that sells every airline on the route.
  const g = airlineHandoff({ priceCents: 10000, detail: 'Duffel Airways', raw: {} }, { origin: 'RDU', destination: 'PVR', departDate: '2026-11-02' });
  assert.match(String(g.redirectUrl), /^https:\/\/www\.google\.com\/travel\/flights\?q=/);
});

test("the airline's site comes from the airline's own page, never a guess", () => {
  assert.equal(airlineSite('https://www.aa.com/i18n/customer-service/support/conditions-of-carriage.jsp'), 'https://www.aa.com');
  assert.equal(airlineSite('http://insecure.example/terms'), null);
  assert.equal(airlineSite('not a url'), null);
  assert.equal(airlineSite(null), null);
});

// ─── The claim ──────────────────────────────────────────────────────────
// A pretend bookings table with one row, which applies a conditional update
// the way Postgres does: only if every filter matches the row as it is now.

type RowState = Record<string, unknown>;
function oneRow(row: RowState, opts: { bookingAllowed: boolean }) {
  const db = {
    from() {
      let patch: RowState = {};
      const filters: [string, string, unknown][] = [];
      const run = () => {
        if (patch.status === 'booking' && !opts.bookingAllowed) {
          return { data: null, error: { code: '23514', message: 'new row for relation "bookings" violates check constraint "bookings_status_check"' } };
        }
        const hit = filters.every(([op, col, v]) => (op === 'is' ? row[col] === v || (v === null && row[col] == null) : row[col] === v));
        if (!hit) return { data: [], error: null };
        Object.assign(row, patch);
        return { data: [{ ...row }], error: null };
      };
      let single = false;
      const q = {
        update(p: RowState) { patch = p; return q; },
        eq(c: string, v: unknown) { filters.push(['eq', c, v]); return q; },
        is(c: string, v: unknown) { filters.push(['is', c, v]); return q; },
        select() { return q; },
        maybeSingle() { single = true; return q; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          const out = run();
          const shaped = single ? { data: (out.data as RowState[] | null)?.[0] ?? null, error: out.error } : out;
          return Promise.resolve(shaped).then(res, rej);
        },
      };
      return q;
    },
  };
  return db as never;
}

test('two approvals of one booking: exactly one reaches the provider', async () => {
  const row = { id: 'b1', status: 'awaiting_approval', approved_at: null };
  const db = oneRow(row, { bookingAllowed: true });
  const [a, b] = await Promise.all([
    claimBooking(db, 'b1', 'u1', null, new Date('2026-09-23T10:00:00.000Z')),
    claimBooking(db, 'b1', 'u2', null, new Date('2026-09-23T10:00:00.001Z')),
  ]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(row.status, 'booking');
  const lost = (a.ok ? b : a) as { taken: boolean };
  assert.equal(lost.taken, true);
});

test('before the migration the claim is taken on approved_at, still only once', async () => {
  const row = { id: 'b1', status: 'awaiting_approval', approved_at: null };
  const db = oneRow(row, { bookingAllowed: false });
  const a = await claimBooking(db, 'b1', 'u1', null, new Date('2026-09-23T10:00:00.000Z'));
  const b = await claimBooking(db, 'b1', 'u2', null, new Date('2026-09-23T10:00:00.001Z'));
  assert.equal(a.ok, true);
  assert.equal(a.ok && a.claim.how, 'stamp');
  assert.equal(b.ok, false);
  assert.equal(row.status, 'awaiting_approval', 'never a pending that reads as handed over');
});

test('the outcome is written only onto a row the claim still holds', async () => {
  const row: RowState = { id: 'b1', status: 'awaiting_approval', approved_at: null };
  const db = oneRow(row, { bookingAllowed: true });
  const got = await claimBooking(db, 'b1', 'u1', null, new Date('2026-09-23T10:00:00.000Z'));
  assert.ok(got.ok);
  const claim = (got as { claim: Parameters<typeof finishClaim>[2] }).claim;
  // Somebody else moved it while we were at the provider.
  row.status = 'failed';
  const lost = await finishClaim(db, 'b1', claim, { status: 'confirmed' });
  assert.equal(lost.row, null);
  assert.equal(row.status, 'failed');
  // Held: written.
  row.status = 'booking';
  const kept = await finishClaim(db, 'b1', claim, { status: 'confirmed' });
  assert.equal(kept.row?.status, 'confirmed');
});

// ─── Which line failed ──────────────────────────────────────────────────

test('a failure is named by its own line, not by where it sat in the list', () => {
  const requests = [
    { itineraryItemId: 'h1', title: '7 nights in Puerto Vallarta' },
    { itineraryItemId: 'f1', title: 'Flight to PVR' },
  ];
  const results = [
    { status: 'awaiting_approval', itineraryItemId: 'h1' },
    { status: 'failed', error: 'No flights found', itineraryItemId: 'f1' },
  ];
  assert.deepEqual(failuresByLine(requests, results), [{ title: 'Flight to PVR', error: 'No flights found' }]);
});

// ─── The route keeps its contract ───────────────────────────────────────

test('approve has no way round the money, and says what it answers', () => {
  const src = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  assert.doesNotMatch(src, /skipFundingCheck\s*[!=]==/, 'the funding bypass is back');
  assert.match(src, /Contract:/);
  for (const code of ['travellers_missing', 'not_funded', 'already_in_progress', 'price_changed', 'party_changed', 'unavailable', 'provider_failed']) {
    assert.match(src, new RegExp(`code: '${code}'`), `${code} is never answered`);
  }
  // The price is checked before the money, so a plan funded for the old price
  // is not waved through at the new one.
  assert.ok(src.lastIndexOf("code: 'price_changed'") < src.lastIndexOf("code: 'not_funded'"));
  // The claim comes after both, and before the provider.
  assert.ok(src.lastIndexOf("code: 'not_funded'") < src.indexOf('claimBooking('));
  assert.ok(src.indexOf('claimBooking(') < src.indexOf('provider.book('));
});

test('nothing books straight from the quote route', () => {
  const src = readFileSync('app/api/bookings/route.ts', 'utf8');
  assert.doesNotMatch(src, /body\.executeNow/);
  assert.doesNotMatch(src, /provider\.book\(/);
});

test('Kiwi and its invented birthday are gone', () => {
  const src = readFileSync('lib/booking/providers/rest.ts', 'utf8');
  assert.doesNotMatch(src, /kiwiFlights/);
  assert.doesNotMatch(src, /1990-01-01/);
});
