import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWallet, confirmationsOf, flightOf, hotelOf, liveFromAero, localDate, worthAsking,
  celebrationDue, itineraryEvents, boughtElsewhere, type WalletBookingRow, type CelebrationInput,
} from '../../lib/wallet.ts';
import { getNextAction, type NextActionInput, type NextBooking } from '../../lib/next-action.ts';
import { itemFromRow } from '../../lib/contracts/itinerary-item.ts';
import { BookingRow } from '../../lib/contracts/booking.ts';
import { buildIcs } from '../../lib/ics.ts';

// Shapes as the providers write them (lib/booking/providers/*): a Duffel
// flight's confirmed payload keeps only the order, its reference and the
// ident; a quote's carries the option with times.
const duffelConfirmed: WalletBookingRow = {
  id: 'b-flight', vertical: 'flight', status: 'confirmed', mode: 'native', provider: 'duffel',
  provider_ref: 'QX7RTB', detail: 'American Airlines · RDU → LIS · 2026-11-02',
  request_payload: { flight: { origin: 'RDU', destination: 'LIS', departDate: '2026-11-02', returnDate: '2026-11-09' } },
  response_payload: { orderId: 'ord_0000AbC', bookingReference: 'QX7RTB', flightIdent: 'AA10' },
  itinerary_item_id: 'l-flight',
};
const liteConfirmed: WalletBookingRow = {
  id: 'b-hotel', vertical: 'hotel', status: 'confirmed', mode: 'native', provider: 'liteapi',
  provider_ref: 'LB-55120', detail: 'Hotel Avenida confirmed',
  request_payload: { hotel: { hotelId: 'lp1', checkin: '2026-11-02', checkout: '2026-11-09', rooms: 1 } },
  response_payload: { bookingId: 'LB-55120', hotelConfirmationCode: 'AV-889', hotel: { name: 'Hotel Avenida' } },
  itinerary_item_id: 'l-hotel',
};

test('rows the fixtures use are rows the contract accepts', () => {
  for (const r of [duffelConfirmed, liteConfirmed]) assert.ok(BookingRow.safeParse(r).success, r.id);
});

test('every confirmation number, labelled by where it came from', () => {
  assert.deepEqual(confirmationsOf(duffelConfirmed), [{ label: 'Booking reference', value: 'QX7RTB', source: 'provider' }]);
  assert.deepEqual(confirmationsOf(liteConfirmed), [
    { label: "Hotel's confirmation", value: 'AV-889', source: 'provider' },
    { label: 'Booking ID', value: 'LB-55120', source: 'provider' },
  ]);
  // A ticket bought on the seller's site: the number is the member's, never Reach's.
  const typed = confirmationsOf({ id: 'b-t', vertical: 'event', status: 'awaiting_approval', mode: 'redirect', confirmation_number: ' TM-1 ' });
  assert.deepEqual(typed, [{ label: 'Confirmation number', value: 'TM-1', source: 'entered' }]);
});

test("a Duffel order id is not offered as a confirmation number", () => {
  const noRef = { ...duffelConfirmed, provider_ref: 'ord_0000AbC', response_payload: { orderId: 'ord_0000AbC', bookingReference: null } };
  assert.deepEqual(confirmationsOf(noRef), []);
});

test('a provider ref on an unconfirmed row is a quote, not a confirmation', () => {
  assert.deepEqual(confirmationsOf({ ...liteConfirmed, status: 'awaiting_approval' }), []);
});

test('the flight strip: what was asked for, and times only where the provider gave them', () => {
  const f = flightOf(duffelConfirmed);
  assert.equal(f.ident, 'AA10');
  assert.deepEqual(f.out, { from: 'RDU', to: 'LIS', date: '2026-11-02', departs: null, arrives: null, flights: null, stops: null });
  assert.deepEqual(f.back, { from: 'LIS', to: 'RDU', date: '2026-11-09', departs: null, arrives: null, flights: null, stops: null });
  assert.equal(f.live, null, 'no terminal or gate without AeroAPI');
  const withOption = flightOf({ ...duffelConfirmed, response_payload: { option: { out: {
    from: 'RDU', to: 'LIS', departs: '2026-11-02T18:05:00', arrives: '2026-11-03T07:40:00', stops: 0, flights: 'AA10',
  } } } });
  assert.equal(withOption.out?.departs, '2026-11-02T18:05');
  assert.equal(withOption.out?.arrives, '2026-11-03T07:40');
  assert.equal(withOption.ident, 'AA10');
  assert.equal(withOption.back?.departs, null);
});

test('no check-in time is invented: only one the provider row states', () => {
  assert.equal(hotelOf(liteConfirmed).checkinTime, null);
  assert.equal(hotelOf(liteConfirmed).name, 'Hotel Avenida');
  assert.equal(hotelOf(liteConfirmed).address, null);
  assert.deepEqual([hotelOf(liteConfirmed).checkin, hotelOf(liteConfirmed).checkout], ['2026-11-02', '2026-11-09']);
  const stated = hotelOf({ ...liteConfirmed, response_payload: { hotel: { name: 'X', checkinCheckoutTimes: { checkin: '15:00' } } } });
  assert.equal(stated.checkinTime, '15:00');
  const nonsense = hotelOf({ ...liteConfirmed, response_payload: { hotel: { checkinTime: 'afternoon' } } });
  assert.equal(nonsense.checkinTime, null);
});

test('the wallet: confirmed rows and ones bought elsewhere, without what I sit out', () => {
  const w = buildWallet({
    planId: 'p1', title: 'Lisbon', now: new Date('2026-10-23T12:00:00Z'), mySkips: ['b-tour'],
    bookings: [
      liteConfirmed, duffelConfirmed,
      { id: 'b-tour', vertical: 'activity', status: 'confirmed', provider: 'viator', provider_ref: 'V-1', detail: 'Sintra day' },
      { id: 'b-q', vertical: 'activity', status: 'quoted', provider: 'viator', provider_ref: 'offer-9', detail: 'Boat' },
      { id: 'b-fail', vertical: 'event', status: 'failed', provider: 'ticketmaster', detail: 'Fado' },
      { id: 'b-resy', vertical: 'restaurant', status: 'awaiting_approval', mode: 'redirect', provider: 'resy', confirmation_number: 'R-77', detail: 'Ramiro' },
      { id: 'b-open', vertical: 'restaurant', status: 'awaiting_approval', mode: 'redirect', provider: 'resy', detail: 'Cervejaria' },
    ],
  });
  assert.equal(w.asOf, '2026-10-23T12:00:00.000Z');
  assert.deepEqual(w.entries.map(e => e.bookingId), ['b-flight', 'b-hotel', 'b-resy']);
  assert.equal(w.entries[2].bookedElsewhere, true);
  assert.equal(w.entries[1].title, 'Hotel Avenida confirmed');
});

// ─── AeroAPI: our flight, on our date, or nothing ───────────────────────

const aero = [
  // Yesterday's AA10 — first in AeroAPI's list, and not ours.
  { ident_iata: 'AA10', scheduled_out: '2026-11-01T22:05:00Z', origin: { code_iata: 'RDU', timezone: 'America/New_York' }, terminal_origin: '1', gate_origin: 'B4' },
  { ident_iata: 'AA10', scheduled_out: '2026-11-02T23:05:00Z', origin: { code_iata: 'RDU', timezone: 'America/New_York' }, terminal_origin: '2', gate_origin: 'C9' },
];

test('terminal and gate come from the AeroAPI flight on the booked local date', () => {
  const live = liveFromAero(aero, { date: '2026-11-02', from: 'RDU' }, new Date('2026-11-02T12:00:00Z'));
  assert.deepEqual(live, { terminal: '2', gate: 'C9', source: 'aeroapi', checkedAt: '2026-11-02T12:00:00.000Z' });
});

test('a departure after 8pm Eastern is still that day in Raleigh, not the next UTC day', () => {
  // 23:05Z on 2 November is 18:05 in New York; 01:30Z on the 3rd is 20:30 on the 2nd.
  assert.equal(localDate('2026-11-03T01:30:00Z', 'America/New_York'), '2026-11-02');
  const late = [{ scheduled_out: '2026-11-03T01:30:00Z', origin: { code_iata: 'RDU', timezone: 'America/New_York' }, gate_origin: 'A1' }];
  assert.equal(liveFromAero(late, { date: '2026-11-02', from: 'RDU' })?.gate, 'A1');
  assert.equal(liveFromAero(late, { date: '2026-11-03', from: 'RDU' }), null);
});

test('no match, no zone, no gate: nothing is said', () => {
  assert.equal(liveFromAero(aero, { date: '2026-11-05', from: 'RDU' }), null);
  assert.equal(liveFromAero([{ scheduled_out: '2026-11-02T23:05:00Z', gate_origin: 'C9' }], { date: '2026-11-02', from: 'RDU' }), null);
  assert.equal(liveFromAero(aero, { date: '2026-11-02', from: 'CLT' }), null, 'a different airport is a different flight');
  assert.equal(liveFromAero(null, { date: '2026-11-02', from: 'RDU' }), null);
});

test('AeroAPI is only asked about a flight a day or two out', () => {
  const now = new Date('2026-11-01T15:00:00Z');
  assert.equal(worthAsking('2026-11-02', now), true);
  assert.equal(worthAsking('2026-11-10', now), false);
  assert.equal(worthAsking(null, now), false);
});

// ─── The celebration claim is spent only when getNextAction says booked ──

const ME = 'u-me';
const line = (r: Record<string, unknown>) => itemFromRow({ title: 'A line', ...r });
const HOTEL_LINE = line({ id: 'l-hotel', title: 'Hotel', type: 'hotel', booking_mode: 'reach' });
const FLIGHT_LINE = line({ id: 'l-flight', title: 'Flight', type: 'flight', booking_mode: 'reach' });
const DINNER_LINE = line({ id: 'l-dinner', title: 'Dinner', type: 'restaurant', booking_mode: 'ahead', venue_website: 'https://example.com' });
const hotel = (status: string, extra: Partial<NextBooking> = {}): NextBooking => ({
  id: 'b-hotel', vertical: 'hotel', status, price_cents: 60000, mode: 'native', provider: 'liteapi', itinerary_item_id: 'l-hotel', detail: 'Hotel', ...extra,
});
const flight = (status: string, extra: Partial<NextBooking> = {}): NextBooking => ({
  id: 'b-flight', vertical: 'flight', status, price_cents: 30000, mode: 'native', provider: 'duffel', itinerary_item_id: 'l-flight', detail: 'Flight', ...extra,
});
const FUNDED = { memberCount: 2, targetCents: 90000, collectedCents: 90000, funded: true, myPaidCents: 45000, myRemainingCents: 0 };

function plan(itinerary: ReturnType<typeof line>[], bookings: NextBooking[], skips: { ref: string; userId: string }[] = []): NextActionInput {
  return {
    plan: { id: 'p1', groupId: 'g1', status: 'approved', type: 'trip', title: 'Lisbon', destStyle: 'fixed', hasOptions: false, createdBy: ME, itinerary },
    bookings, funding: FUNDED, essentials: null, memberCount: 2, me: ME, skips,
    readiness: { members: [{ userId: ME, name: 'Pat', ready: true, answered: true }, { userId: 'u-sam', name: 'Sam', ready: true, answered: true }], waitingOn: [], solo: false },
    now: new Date('2026-10-23T15:00:00Z'),
  };
}

const CASES: { name: string; input: NextActionInput }[] = [
  { name: 'everything confirmed', input: plan([HOTEL_LINE, FLIGHT_LINE], [hotel('confirmed'), flight('confirmed')]) },
  { name: 'flight still pending', input: plan([HOTEL_LINE, FLIGHT_LINE], [hotel('confirmed'), flight('pending')]) },
  { name: 'one failed', input: plan([HOTEL_LINE, FLIGHT_LINE], [hotel('confirmed'), flight('failed')]) },
  { name: 'one held', input: plan([HOTEL_LINE, FLIGHT_LINE], [hotel('confirmed'), flight('quoted')]) },
  { name: 'a line with no row yet', input: plan([HOTEL_LINE, FLIGHT_LINE], [hotel('confirmed')]) },
  { name: 'a table still to book myself', input: plan([HOTEL_LINE, DINNER_LINE], [hotel('confirmed')]) },
  { name: 'the table said done', input: plan([HOTEL_LINE, { ...DINNER_LINE, filled: true }], [hotel('confirmed')]) },
  { name: 'flight bought on the airline site, with its number', input: plan([HOTEL_LINE, FLIGHT_LINE],
    [hotel('confirmed'), flight('redirected', { mode: 'redirect', confirmation_number: 'AA-PNR' })]) },
  { name: 'flight handed off, no number', input: plan([HOTEL_LINE, FLIGHT_LINE],
    [hotel('confirmed'), flight('redirected', { mode: 'redirect' })]) },
  { name: 'nothing to book at all', input: plan([line({ id: 'l-walk', booking_mode: 'walk_in' })], []) },
  { name: 'cancelled duplicate beside the confirmed one', input: plan([HOTEL_LINE], [hotel('confirmed'), hotel('cancelled', { id: 'b-hotel-2' })]) },
];

test('celebrationDue agrees with getNextAction.allBooked in every case', () => {
  let due = 0;
  for (const c of CASES) {
    const a = getNextAction(c.input);
    const mine = celebrationDue({
      bookings: c.input.bookings as CelebrationInput['bookings'],
      lines: c.input.plan.itinerary ?? [], skips: c.input.skips, memberCount: c.input.memberCount,
    });
    assert.equal(mine, !!a?.allBooked, c.name);
    if (mine) due++;
  }
  assert.ok(due >= 3, 'the cases include celebrations, not only refusals');
});

// ─── The calendar file ───────────────────────────────────────────────────

test('calendar events carry a confirmation only from a confirmed booking or a typed one', () => {
  const events = itineraryEvents({
    startDate: '2026-11-02',
    items: [
      { id: 'l-flight', title: 'Fly to Lisbon', scheduled_time: 'Day 1 · 6:05 PM' },
      { id: 'l-hotel', title: 'Hotel Avenida', scheduled_time: 'Day 2', venue_name: 'Hotel Avenida' },
      { id: 'l-tour', title: 'Sintra day', scheduled_time: 'Day 3 · 9:00 AM' },
      { id: 'l-dinner', title: 'Dinner', scheduled_time: 'Day 3 · 8:30 PM', venue_name: 'Ramiro', confirmation_number: 'R-77', venue_website: 'https://ramiro.pt' },
      { id: 'l-boat', title: 'Boat trip', scheduled_time: 'Day 4 · Morning' },
    ],
    bookings: [
      duffelConfirmed, liteConfirmed,
      { id: 'b-tour', vertical: 'activity', status: 'confirmed', provider: 'viator', provider_ref: 'V-1', itinerary_item_id: 'l-tour' },
      { id: 'b-boat', vertical: 'activity', status: 'quoted', provider: 'viator', provider_ref: 'offer-9', itinerary_item_id: 'l-boat' },
    ],
    mySkips: ['b-tour'],
  });
  const by = Object.fromEntries(events.map(e => [e.uid, e]));
  assert.equal(by['l-tour'], undefined, 'a line I sit out is not on my calendar');
  assert.equal(by['l-flight'].description, 'Booking reference: QX7RTB');
  assert.equal(by['l-flight'].time, '6:05 PM');
  assert.equal(by['l-hotel'].date, '2026-11-03');
  assert.equal(by['l-hotel'].location, null, 'the venue is not repeated when it is the title');
  assert.match(by['l-hotel'].description ?? '', /Hotel's confirmation: AV-889/);
  assert.equal(by['l-dinner'].description, 'Confirmation number (typed in on Reach): R-77');
  assert.equal(by['l-dinner'].location, 'Ramiro');
  assert.equal(by['l-boat'].description, null, 'a quote is not a confirmation');
  assert.equal(by['l-boat'].time, null, '"Morning" is not a time');

  const ics = buildIcs(events, { name: 'Lisbon', now: new Date('2026-10-23T12:00:00Z') });
  assert.match(ics, /DTSTART:20261104T203000/, 'Day 3 at 8:30 PM is the fourth, floating, never the UTC day');
  assert.doesNotMatch(ics, /Sintra/);
});

// ─── Rows as the real paths write them ──────────────────────────────────
// tableReservations.book (lib/booking/providers/rest.ts) writes a table
// hand-off as status 'redirected', mode 'redirect' and provider_ref
// `RES-<timestamp>` — Reach's own handle, a number no restaurant issued.
// "I've got it" (POST /api/bookings/[id]/confirmation) then writes status
// 'confirmed' and the typed number in the same update.
const resyHandedOff: WalletBookingRow = {
  id: 'b-resy-real', vertical: 'restaurant', status: 'redirected', mode: 'redirect', provider: 'resy',
  provider_ref: 'RES-LX3K9A', detail: 'Ramiro · 8:30 PM · 4', itinerary_item_id: 'l-dinner',
};
const resyGotIt: WalletBookingRow = { ...resyHandedOff, status: 'confirmed', confirmation_number: 'R-77' };
const resyWalkIn: WalletBookingRow = { ...resyHandedOff, status: 'confirmed', confirmation_number: null };
const ticketsGotIt: WalletBookingRow = {
  id: 'b-tm', vertical: 'event', status: 'confirmed', mode: 'redirect', provider: 'ticketmaster',
  confirmation_number: 'TM-4411', detail: 'J. Cole', itinerary_item_id: 'l-show',
};

test('a hand-off\'s provider_ref is never offered as the seller\'s confirmation', () => {
  assert.deepEqual(confirmationsOf(resyGotIt), [{ label: 'Confirmation number', value: 'R-77', source: 'entered' }]);
  assert.deepEqual(confirmationsOf(resyWalkIn), [], 'walk-in with no number: no number at all, least of all RES-…');
  // Reach's own booking of a tour is still the provider's answer.
  assert.deepEqual(confirmationsOf({ id: 't', vertical: 'activity', status: 'confirmed', mode: 'native', provider: 'viator', provider_ref: 'V-1' }),
    [{ label: 'Confirmation', value: 'V-1', source: 'provider' }]);

  const events = itineraryEvents({
    startDate: '2026-11-02',
    items: [{ id: 'l-dinner', title: 'Dinner at Ramiro', scheduled_time: 'Day 3 · 8:30 PM' }],
    bookings: [resyGotIt],
  });
  assert.equal(events[0].description, 'Confirmation number (typed in on Reach): R-77');
  assert.doesNotMatch(JSON.stringify(events), /RES-/);
});

test('a booking finished on the seller\'s site is flagged so once "I\'ve got it" confirms it', () => {
  for (const r of [resyGotIt, resyWalkIn, ticketsGotIt]) assert.equal(boughtElsewhere(r), true, r.id);
  assert.equal(boughtElsewhere(duffelConfirmed), false);
  assert.equal(boughtElsewhere(liteConfirmed), false);
  const w = buildWallet({ planId: 'p1', bookings: [duffelConfirmed, resyGotIt, ticketsGotIt] });
  const by = Object.fromEntries(w.entries.map(e => [e.bookingId, e]));
  assert.equal(by['b-flight'].bookedElsewhere, false);
  assert.equal(by['b-resy-real'].bookedElsewhere, true);
  assert.equal(by['b-tm'].bookedElsewhere, true);
  assert.deepEqual(by['b-tm'].confirmations, [{ label: 'Confirmation number', value: 'TM-4411', source: 'entered' }]);
});

test('a 💡 day tip on the wrong line is not that event\'s description (f979c880)', () => {
  const events = itineraryEvents({
    startDate: '2026-11-02',
    items: [
      { id: 'l-spin', title: 'SPIN', scheduled_time: 'Day 1 · 9:00 PM', subtitle: '💡 Get up early and walk between the monuments before the crowds' },
      { id: 'l-lunch', title: 'Lunch', scheduled_time: 'Day 1 · 1:00 PM', subtitle: 'Ask for the half-smoke' },
    ],
    bookings: [],
  });
  const by = Object.fromEntries(events.map(e => [e.uid, e]));
  assert.equal(by['l-spin'].description, null);
  assert.equal(by['l-lunch'].description, 'Ask for the half-smoke', 'the slot\'s own tip still goes in');
});
