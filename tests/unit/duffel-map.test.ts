import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountToCents, offerExpired, minutesLeft, duffelGender, duffelTitle,
  toDuffelPassenger, describeOffer, flightIdent, describeConditions, departed,
} from '../../lib/booking/duffel-map.ts';

test('a decimal string becomes cents without losing one', () => {
  // The value a real offer returned. Number("240.84") * 100 is 24083.999…,
  // and truncating it is a cent the group's split never accounts for.
  assert.equal(amountToCents('240.84'), 24084);
  assert.equal(amountToCents('0.01'), 1);
  assert.equal(amountToCents('1000'), 100000);
  assert.equal(amountToCents(240.84), 24084);
});

test('a price that is not a price is not zero', () => {
  // Zero would read as "this flight is free" on a checkout screen.
  assert.equal(amountToCents(null), null);
  assert.equal(amountToCents(''), null);
  assert.equal(amountToCents('free'), null);
  assert.equal(amountToCents('-5'), null);
});

test('a held price lapses', () => {
  const now = new Date('2026-09-18T21:00:00Z');
  assert.equal(offerExpired('2026-09-18T21:50:57Z', now), false);
  assert.equal(offerExpired('2026-09-18T20:59:59Z', now), true);
  // No expiry stated is not an expired offer.
  assert.equal(offerExpired(null, now), false);
  assert.equal(offerExpired('not a date', now), false);
});

test('how long is left, for a screen that should say so', () => {
  const now = new Date('2026-09-18T21:00:00Z');
  assert.equal(minutesLeft('2026-09-18T21:50:00Z', now), 50);
  assert.equal(minutesLeft('2026-09-18T20:00:00Z', now), 0, 'never negative');
  assert.equal(minutesLeft(null, now), null);
});

test('Duffel takes two gender markers and Reach stores four', () => {
  assert.equal(duffelGender('female'), 'f');
  assert.equal(duffelGender('male'), 'm');
  assert.equal(duffelTitle('female'), 'ms');
  assert.equal(duffelTitle('male'), 'mr');
  // An X passport marker and a declined answer are both real, and neither
  // can be sent. Guessing one issues a ticket that is refused at the gate.
  assert.equal(duffelGender('x'), null);
  assert.equal(duffelGender('unspecified'), null);
  assert.equal(duffelGender(null), null);
});

const WHO = {
  firstName: 'Priya', lastName: 'Raman',
  dateOfBirth: '1991-04-02', gender: 'female',
  email: 'priya@example.com', phone: '+15551234567',
};

test('a complete traveller becomes a passenger, carrying the offer id', () => {
  const r = toDuffelPassenger('pas_0000BAXtSQN8kylM2rzisM', WHO, 'Priya');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.passenger, {
    // Duffel matches an order to its offer by this id. Inventing one is an
    // order refused after the group has already paid.
    id: 'pas_0000BAXtSQN8kylM2rzisM',
    given_name: 'Priya', family_name: 'Raman',
    born_on: '1991-04-02', gender: 'f', title: 'ms',
    email: 'priya@example.com', phone_number: '+15551234567',
  });
});

test('each missing thing is named, and no value is', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...WHO, lastName: '' }, /legal name/],
    [{ ...WHO, dateOfBirth: null }, /date of birth/],
    [{ ...WHO, gender: 'x' }, /gender marker/],
    [{ ...WHO, email: '' }, /email/],
  ];
  for (const [who, expected] of cases) {
    const r = toDuffelPassenger('pas_1', who as never, 'Marco');
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.match(r.why, expected);
    // The reason travels to a screen the whole group reads.
    for (const secret of ['1991-04-02', 'priya@example.com', '+15551234567']) {
      assert.equal(r.why.includes(secret), false, `reason leaked ${secret}`);
    }
  }
});

test('an offer describes itself the way a person would read it', () => {
  const offer = {
    owner: { name: 'American Airlines' },
    total_amount: '240.84', total_currency: 'USD',
    slices: [{
      origin: { iata_code: 'RDU' }, destination: { iata_code: 'LIS' },
      segments: [{
        departing_at: '2026-11-02T00:46:00',
        marketing_carrier: { iata_code: 'AA' }, marketing_carrier_flight_number: '10',
      }],
    }],
  };
  assert.equal(describeOffer(offer), 'American Airlines · RDU → LIS · 2026-11-02');
  assert.equal(flightIdent(offer), 'AA10');
});

test('a half-described offer does not throw', () => {
  assert.equal(flightIdent({}), null);
  assert.equal(flightIdent({ slices: [{ segments: [{}] }] }), null);
  assert.equal(describeOffer({}), 'Airline');
});

// The terms a real offer came back with: no changes, refundable less $40.
// A group is entitled to read that before it pays, not after.
test('fare conditions read as words, not a nested object', () => {
  assert.deepEqual(
    describeConditions({
      change_before_departure: { allowed: false, penalty_amount: null, penalty_currency: null },
      refund_before_departure: { allowed: true, penalty_amount: '40.00', penalty_currency: 'USD' },
    }),
    ['No changes once booked', 'Refundable before departure, less 40.00 USD'],
  );
  assert.deepEqual(describeConditions(undefined), []);
  assert.deepEqual(
    describeConditions({ refund_before_departure: { allowed: false } }),
    ['Non-refundable'],
  );
});

test('a flight that has gone is not offered', () => {
  const today = new Date('2026-09-18T12:00:00Z');
  // The real case: a trip whose dates passed yesterday. Duffel answers this
  // with "Field 'departure_date' must be after 2026-09-17".
  assert.equal(departed('2026-09-17', today), true);
  // Later today has not departed. Comparing instants would say it had.
  assert.equal(departed('2026-09-18', today), false);
  assert.equal(departed('2026-11-02', today), false);
  assert.equal(departed(null, today), false);
});

test('an X marker is a concierge case, not a blank to fill in', () => {
  // The distinction the booking path turns on: a missing date of birth is
  // theirs to fix, an X passport marker is not. The passport is right and
  // the automated channel is what is narrow.
  const missing = toDuffelPassenger('pas_1', { ...WHO, dateOfBirth: null }, 'Marco');
  assert.equal(missing.ok, false);
  if (missing.ok === false) assert.equal(missing.problem, 'dob');

  for (const marker of ['x', 'unspecified']) {
    const r = toDuffelPassenger('pas_1', { ...WHO, gender: marker }, 'Sam');
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.equal(r.problem, 'gender');
      // Worth being careful about: this sentence is read by the person it is
      // about. It says the channel is narrow, not that they are wrong.
      assert.match(r.why, /can't go through automatic booking/);
      assert.doesNotMatch(r.why, /invalid|unsupported|error/i);
    }
  }
});
