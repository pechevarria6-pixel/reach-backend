// Run with: npm run test:unit
//
// The flight that was quoted, on the fare whose terms were shown, is the one
// approval prices again and book() buys — or neither happens. Before this,
// both started from the route and the date and bought the cheapest offer at
// that moment, whose terms nobody had been shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pinQuoted, fareTermsOf, shownTerms, termsChanged } from '../../lib/booking/pin.ts';
import { pickOffer } from '../../lib/booking/providers/flights.duffel.ts';

const seg = (code: string) => ({ marketing_carrier: { iata_code: code.slice(0, 2) }, marketing_carrier_flight_number: code.slice(2) });
const offer = (id: string, out: string, back: string, conditions?: Record<string, unknown>) => ({
  id, slices: [{ segments: [seg(out)] }, { segments: [seg(back)] }], conditions,
});
const basic = { change_before_departure: { allowed: false }, refund_before_departure: { allowed: false } };
const main = { change_before_departure: { allowed: true, penalty_amount: '75.00', penalty_currency: 'USD' }, refund_before_departure: { allowed: false } };

test('a stored quote pins the exact flights and the terms shown for them', () => {
  const req = { vertical: 'flight', flight: { origin: 'RDU', destination: 'PVR', departDate: '2026-11-02' } };
  const pinned = pinQuoted(req, 'flight', { offerKey: 'AA100/AA101', conditions: ['No changes once booked', 'Non-refundable'] });
  assert.deepEqual(pinned.flight, {
    origin: 'RDU', destination: 'PVR', departDate: '2026-11-02',
    offerKey: 'AA100/AA101', fareTerms: ['No changes once booked', 'Non-refundable'],
  });
  // A new choice drops the old fare's terms rather than keep them beside new flights.
  const again = pinQuoted({ ...pinned, flight: { ...pinned.flight } }, 'flight', { offerKey: 'DL5/DL6', conditions: [] });
  assert.equal((again.flight as Record<string, unknown>).offerKey, 'DL5/DL6');
  assert.equal('fareTerms' in (again.flight as Record<string, unknown>), false);
  // Nothing to pin: left as it is.
  assert.equal(pinQuoted(req, 'flight', { offerKey: null }), req);
  // A hotel keeps the hotel it was priced at.
  assert.deepEqual(pinQuoted({ vertical: 'hotel', hotel: { city: 'X' } }, 'hotel', { hotelId: 'lp1' }).hotel, { city: 'X', hotelId: 'lp1' });
  assert.equal(fareTermsOf({ conditions: [] }), null, 'the airline saying nothing is not "no conditions"');
});

test('the route that stores a quote pins it, as the options route and a re-price do', () => {
  assert.match(readFileSync('app/api/bookings/route.ts', 'utf8'), /row\.request_payload = pinQuoted\(row\.request_payload/);
  assert.match(readFileSync('app/api/bookings/[id]/options/route.ts', 'utf8'), /request_payload: pinQuoted\(request/);
  assert.match(readFileSync('lib/booking/reprice.ts', 'utf8'), /const stored = pinQuoted\(request/);
});

test('the pinned flights on the pinned fare, never the cheapest fare on the same flights', () => {
  const offers = [offer('cheap_basic', 'AA100', 'AA101', basic), offer('main', 'AA100', 'AA101', main), offer('other', 'DL5', 'DL6', main)];
  const shownMain = ['Changes allowed for 75.00 USD', 'Non-refundable'];
  assert.equal(pickOffer(offers, { offerKey: 'AA100/AA101', fareTerms: shownMain }).offer?.id, 'main');
  // Without terms shown, the cheapest of those flights (the old behaviour for unpinned rows).
  assert.equal(pickOffer(offers, { offerKey: 'AA100/AA101' }).offer?.id, 'cheap_basic');
  // Not pinned at all: the cheapest there is.
  assert.equal(pickOffer(offers, {}).offer?.id, 'cheap_basic');
});

test('a pinned fare no longer on sale is refused, with the options as the way on', () => {
  const offers = [offer('cheap_basic', 'AA100', 'AA101', basic)];
  const gone = pickOffer(offers, { offerKey: 'AA100/AA101', fareTerms: ['Changes allowed for 75.00 USD', 'Non-refundable'] });
  assert.equal(gone.offer, null);
  assert.match(gone.error!, /no longer on sale on the fare you were shown — pick another from the options/);
  const soldOut = pickOffer(offers, { offerKey: 'UA1/UA2' });
  assert.equal(soldOut.offer, null);
  assert.match(soldOut.error!, /pick another from the options/);
  // Approval answers a failed quote as unavailable, which checkout meets
  // with the options panel for a hotel or a flight.
  const approve = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  assert.match(approve, /if \(fresh\.status === 'failed' \|\| !fresh\.priceCents\) \{\s*return unavailable\(/);
});

test('approval refuses a room or fare whose terms are not the ones shown', () => {
  assert.equal(shownTerms('hotel', { cancellationPolicies: { refundableTag: 'RFN' } }), 'RFN');
  assert.equal(shownTerms('flight', { conditions: ['Non-refundable'] }), 'Non-refundable');
  assert.equal(shownTerms('flight', { conditions: [] }), null, 'nothing shown, nothing to hold it to');
  const approve = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  assert.match(approve, /if \(termsChanged\(vertical, booking\.response_payload, fresh\.raw\)\) \{\s*return unavailable\(/);
  // A refundable room is held to the cancellation deadline the screen named.
  const rfn = (at: string) => ({ cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [{ cancelTime: at, amount: 50 }] } });
  assert.equal(shownTerms('hotel', rfn('2026-10-30 18:00:00')), 'RFN from 2026-10-30 18:00');
  assert.equal(termsChanged('hotel', rfn('2026-10-30 18:00:00'), rfn('2026-10-30 18:00:00')), false);
  assert.equal(termsChanged('hotel', rfn('2026-10-30 18:00:00'), rfn('2026-10-28 18:00:00')), true, 'an earlier deadline is other terms');
  assert.equal(termsChanged('hotel', rfn('2026-10-30 18:00:00'), { cancellationPolicies: { refundableTag: 'NRFN' } }), true);
  // Stored before the deadline was read: the flag alone is what was shown.
  assert.equal(termsChanged('hotel', { cancellationPolicies: { refundableTag: 'RFN' } }, rfn('2026-10-28 18:00:00')), false);
  assert.equal(termsChanged('flight', { conditions: ['Non-refundable'] }, { conditions: ['Refundable'] }), true);
  assert.equal(termsChanged('flight', { conditions: [] }, { conditions: ['Refundable'] }), false);
});

test('approval pins a flight quoted before pinning from its own quote, and refuses one it cannot', () => {
  // A row whose request_payload predates the pin still has the quote's offerKey.
  const legacy = { vertical: 'flight', flight: { origin: 'RDU', destination: 'PVR', departDate: '2026-11-02' } };
  const pinned = pinQuoted(legacy, 'flight', { offerKey: 'AA100/AA101', conditions: ['Non-refundable'] });
  assert.equal((pinned.flight as Record<string, unknown>).offerKey, 'AA100/AA101');
  // With no offerKey anywhere, nothing is pinned, and approval must not fall
  // through to pickOffer's cheapest-on-the-route.
  assert.equal('offerKey' in (pinQuoted(legacy, 'flight', { conditions: [] }).flight as Record<string, unknown>), false);
  const src = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  assert.match(src, /Object\.assign\(request, pinQuoted\(request[^)]*, vertical, booking\.response_payload\)\)/);
  assert.match(src, /if \(!request\.flight\?\.offerKey\) \{\s*return unavailable\(/);
});
