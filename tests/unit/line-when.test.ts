// Every dinner was asked for on the trip's first night, at a time nobody
// chose. The evidence is a row production still holds, written by the retired
// concierge queue (tests/unit/date-change.test.ts keeps it verbatim):
//
//   'Reservation request: Seafood dinner at the chef’s counter at Desert
//    Bistro,  · 2026-09-17 Day 3 · Evening · party of 2'
//
// The date in it is the trip's start, 2026-09-17; the "time" is the words
// "Day 3 · Evening". Day 3 of that trip is the 19th. These tests hold the
// line's own night and clock all the way from the words to the request, the
// hand-off link and the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lineWhen, labelWithClock, clockSaid, whenSaid, dateSaid } from '../../lib/line-when.ts';
import { rowWhen } from '../../lib/ics.ts';
import { itemFromRow, rowFromItem, itemsFromRows, typeForKind } from '../../lib/contracts/itinerary-item.ts';
import { asRequest, type BookableLine } from '../../lib/booking/line-request.ts';
import { tableReservations } from '../../lib/booking/providers/rest.ts';
import { datedLink, reservationUrl } from '../../lib/booking/reservations.ts';
import { stampStatedTime, asGenSlot, type GenDay } from '../../lib/itinerary-readback.ts';
import { findLinks } from '../../lib/find-links.ts';
import { getNextAction, type NextActionInput } from '../../lib/next-action.ts';
import { isJourney } from '../../lib/travel-slot.ts';

// Moab, from the row above. The start is the row's own date; the end is the
// one fact here not read off that row — a four-day trip, so day 3 is inside it.
const MOAB = { startDate: '2026-09-17', endDate: '2026-09-20' };
const DESERT_BISTRO: BookableLine = {
  id: 'l-desert-bistro', type: 'restaurant',
  title: 'Seafood dinner at the chef’s counter at Desert Bistro',
  subtitle: null, scheduled_time: 'Day 3 · Evening', cost_cents: 8500,
  booking_mode: 'ahead', venue_name: 'Desert Bistro', venue_phone: '+1 435-259-0756',
};
const ids = { planId: 'p-moab', groupId: 'g-moab' };
const plan = { start_date: MOAB.startDate, end_date: MOAB.endDate };
const noFlight = { from: null, to: null };

// ─── The words, as a date and a clock ────────────────────────────────────

test("a line's day is a date counted from the plan's own start", () => {
  assert.deepEqual(lineWhen('Day 3 · Evening', MOAB), { day: 3, date: '2026-09-19', clock: null, part: 'Evening' });
  assert.deepEqual(lineWhen('Day 1 · Morning', MOAB), { day: 1, date: '2026-09-17', clock: null, part: 'Morning' });
  // Across a month end, on the calendar, never through a UTC instant.
  assert.equal(lineWhen('Day 3 · Evening', { startDate: '2026-10-30', endDate: '2026-11-02' }).date, '2026-11-01');
});

test('"Evening" is not seven o\'clock: a clock is only one somebody gave', () => {
  assert.equal(lineWhen('Day 3 · Evening', MOAB).clock, null);
  assert.equal(lineWhen('Day 3 · Evening · 7:30 PM', MOAB).clock, '19:30');
  assert.equal(lineWhen('Day 3 at 7pm', MOAB).clock, '19:00', 'typed into the Time / Day box');
  assert.equal(lineWhen('DAY 2 - 19:45', MOAB).clock, '19:45');
  assert.equal(lineWhen('Day 3 evening drinks', MOAB).clock, null);
});

test('a night out is on its one date; a longer trip does not put an undated line on day one', () => {
  const tonight = { startDate: '2026-11-06', endDate: null };
  assert.deepEqual(lineWhen('The main event · 8:00 PM', tonight), { day: null, date: '2026-11-06', clock: '20:00', part: 'The main event' });
  assert.equal(lineWhen('To start', { startDate: '2026-11-06', endDate: '2026-11-06' }).date, '2026-11-06');
  // Moab is four days. "Saturday dinner" and "Before you go" name none of them.
  assert.equal(lineWhen('Saturday dinner', MOAB).date, null);
  assert.equal(lineWhen('Before you go', MOAB).date, null);
  // Day nine of a four-day trip is no date, not one after it ends.
  assert.equal(lineWhen('Day 9 · Evening', MOAB).date, null);
  assert.equal(lineWhen('Day 0 · Evening', MOAB).date, null);
  assert.equal(lineWhen('Day 2 · Evening', { startDate: null, endDate: null }).date, null, 'no dates, no date');
});

test('a clock added to a label keeps the part of the day, and every reader still finds it', () => {
  assert.equal(labelWithClock('Day 3 · Evening', '19:30'), 'Day 3 · Evening · 7:30 PM');
  assert.equal(labelWithClock('The main event', '20:00'), 'The main event · 8:00 PM');
  assert.equal(labelWithClock('Day 3 · Evening', null), 'Day 3 · Evening', 'no time given, none added');
  assert.equal(labelWithClock('Day 3 · Evening', 'evening'), 'Day 3 · Evening');
  assert.equal(labelWithClock('Day 3 at 7pm', '19:30'), 'Day 3 at 7pm', 'a line that already has a time keeps it');
  // lib/ics.ts, lib/pings.ts and lib/wallet.ts read rowWhen; it must agree.
  assert.deepEqual(rowWhen('Day 3 · Evening · 7:30 PM', MOAB.startDate), { date: '2026-09-19', time: '7:30 PM' });
  assert.deepEqual(rowWhen('The main event · 8:00 PM', '2026-11-06'), { date: '2026-11-06', time: '8:00 PM' });
  assert.equal(clockSaid('00:15'), '12:15 AM');
  assert.equal(clockSaid('12:00'), '12:00 PM');
});

test('when a table is for is said, and said as unknown when it is', () => {
  assert.equal(dateSaid('2026-09-19'), 'Sat, Sep 19');
  assert.equal(whenSaid(lineWhen('Day 3 · Evening · 7:30 PM', MOAB)), 'Sat, Sep 19 at 7:30 PM');
  assert.equal(whenSaid(lineWhen('Day 3 · Evening', MOAB)), 'Sat, Sep 19 (evening) — no time set yet');
  assert.equal(whenSaid(lineWhen('Saturday dinner', MOAB)), 'No date set yet');
  assert.doesNotMatch(whenSaid(lineWhen('Day 3 · Evening', MOAB)), /7:00|19:00/);
});

// ─── The contract carries both ───────────────────────────────────────────

test('the contract gives every line its date and clock, and they survive a write and a reload', () => {
  const row = { id: 'l1', title: DESERT_BISTRO.title, type: 'restaurant', scheduled_time: 'Day 3 · Evening · 7:30 PM' };
  const item = itemFromRow(row, MOAB);
  assert.equal(item.date, '2026-09-19');
  assert.equal(item.clock, '19:30');
  const back = itemFromRow(rowFromItem(item as unknown as Record<string, unknown>, 0), MOAB);
  assert.equal(back.date, item.date);
  assert.equal(back.clock, item.clock);
  // The date is the plan's, worked out on read: move the trip and the line moves.
  assert.equal(itemFromRow(row, { startDate: '2026-10-01', endDate: '2026-10-04' }).date, '2026-10-03');
  // Without the plan's dates there is no date — never the first day.
  assert.equal(itemFromRow(row).date, null);
  assert.equal(itemsFromRows([row], MOAB)[0].date, '2026-09-19');
});

test('every client list that builds lines from rows passes the plan\'s dates', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  // convertPlan and the post-build refresh: the two hand-written lists.
  assert.match(app, /itinerary:itemsFromRows\(p\.itinerary,\{startDate:p\.start_date,endDate:p\.end_date\}\)/);
  assert.match(app, /itinerary:itemsFromRows\(data\.itinerary,data\.plan\?\{startDate:data\.plan\.start_date,endDate:data\.plan\.end_date\}/);
  assert.doesNotMatch(app, /itemsFromRows\([^,)]+\)/, 'an itemsFromRows with no dates gives every line a null date');
  assert.doesNotMatch(app, /itineraryRows\(\w+\.itinerary(,\w+)?\)/, 'a line built on this device without its date');
  assert.doesNotMatch(app, /daytimeRows\(\w+\.itinerary\)/, 'the offered day without its date');
});

// ─── The request ─────────────────────────────────────────────────────────

test('the Desert Bistro dinner is asked for on day three, not the first night, and at no invented time', () => {
  const req = asRequest(DESERT_BISTRO, plan, ids, 'Moab', 'US', 2, null, noFlight,
    { platform: 'none', url: null, phone: DESERT_BISTRO.venue_phone });
  assert.ok(req?.restaurant);
  assert.equal(req!.restaurant!.date, '2026-09-19');
  assert.notEqual(req!.restaurant!.date, MOAB.startDate);
  assert.equal(req!.restaurant!.time, null, 'an evening with no stated time is asked for with none');
});

test('a time somebody gave goes into the request as a clock', () => {
  const req = asRequest({ ...DESERT_BISTRO, scheduled_time: 'Day 3 · Evening · 7:30 PM' }, plan, ids, 'Moab', 'US', 2, null, noFlight, null);
  assert.equal(req!.restaurant!.date, '2026-09-19');
  assert.equal(req!.restaurant!.time, '19:30');
});

test('a tour is booked for its own day, and an undated one on a longer trip is not booked for day one', () => {
  const product = { productCode: '5638853P1', title: 'Arches sunset tour', priceCents: 9900 };
  const tour: BookableLine = { ...DESERT_BISTRO, id: 'l-tour', type: 'activity', title: 'Sunset in Arches', scheduled_time: 'Day 2 · Afternoon' };
  assert.equal(asRequest(tour, plan, ids, 'Moab', 'US', 2, product, noFlight, null)?.activity?.date, '2026-09-18');
  assert.equal(asRequest({ ...tour, scheduled_time: 'Saturday' }, plan, ids, 'Moab', 'US', 2, product, noFlight, null), null);
});

// ─── The hand-off ────────────────────────────────────────────────────────

test('the hand-off link carries the line\'s night, and its time only when there is one', async () => {
  const at = (scheduled_time: string) => asRequest({ ...DESERT_BISTRO, scheduled_time }, plan, ids, 'Moab', 'US', 4, null, noFlight,
    { platform: 'opentable', url: null, phone: null })!;
  const timed = await tableReservations.quote(at('Day 3 · Evening · 7:30 PM'));
  assert.match(timed.redirectUrl!, /dateTime=2026-09-19T19%3A30/);
  assert.equal((timed.raw as { date: string }).date, '2026-09-19');
  const untimed = await tableReservations.quote(at('Day 3 · Evening'));
  assert.doesNotMatch(untimed.redirectUrl!, /dateTime/, 'no time, so no night-and-time pair — never 19:00');
  assert.equal((untimed.raw as { time: string | null }).time, null);
});

test('a published Resy or OpenTable link is moved onto the line\'s night', () => {
  // Rosie's and Nick's are stored with Resy links carrying old dates.
  const stale = 'https://resy.com/cities/ny/rosies?date=2022-05-14&seats=2';
  assert.equal(datedLink(stale, { date: '2026-09-19', partySize: 4 }), 'https://resy.com/cities/ny/rosies?date=2026-09-19&seats=4');
  assert.equal(datedLink(stale, { date: null }), 'https://resy.com/cities/ny/rosies?seats=2', 'unknown night: the stale one goes');
  assert.equal(
    datedLink('https://www.opentable.com/r/desert-bistro?dateTime=2025-01-02T19%3A00&covers=2', { date: '2026-09-19', time: null, partySize: 2 }),
    'https://www.opentable.com/r/desert-bistro?covers=2',
  );
  // Somebody else's booking engine is not ours to rewrite.
  const other = 'https://bookings.zenchef.com/results?rid=1&day=2022-05-14';
  assert.equal(datedLink(other, { date: '2026-09-19' }), other);
  // And through reservationUrl, the path every table takes.
  assert.match(reservationUrl('resy', { name: "Rosie's", knownUrl: stale, date: '2026-09-19' })!, /date=2026-09-19/);
});

test('"Find a table on OpenTable" searches the line\'s night when it has a time, and no night when it does not', () => {
  const timed = findLinks({ title: 'Look for dinner near the waterfront', type: 'restaurant', city: 'St. Augustine', date: '2026-09-19', clock: '19:30' });
  assert.match(timed[0].url, /dateTime=2026-09-19T19%3A30/);
  const untimed = findLinks({ title: 'Look for dinner near the waterfront', type: 'restaurant', city: 'St. Augustine', date: '2026-09-19', clock: null });
  assert.doesNotMatch(untimed[0].url, /dateTime/);
});

// ─── "I've got it" names the night ───────────────────────────────────────

function finishing(scheduled_time: string, bookings: NextActionInput['bookings'] = []) {
  const dinner = itemFromRow({ id: 'l-dinner', title: 'Dinner', venue_name: 'Desert Bistro', type: 'restaurant',
    booking_mode: 'ahead', venue_website: 'https://desertbistro.com', scheduled_time }, MOAB);
  const input: NextActionInput = {
    plan: { id: 'p-moab', groupId: 'g-moab', status: 'approved', type: 'trip', title: 'Moab', destStyle: 'fixed',
      hasOptions: false, createdBy: 'u-me', itinerary: [dinner] },
    bookings, funding: null,
    readiness: { members: [{ userId: 'u-me', name: 'Pat Me', ready: true, answered: true }], waitingOn: [], solo: true },
    essentials: null, memberCount: 1, me: 'u-me', now: new Date('2026-09-10T15:00:00Z'),
  } as NextActionInput;
  return getNextAction(input);
}

test('the card that asks "I\'ve got it" says which night the table is for', () => {
  const timed = finishing('Day 3 · Evening · 7:30 PM');
  assert.equal(timed.state, 'finish_elsewhere');
  assert.equal(timed.secondary?.label, "I've got it ✓");
  assert.match(timed.body!, /It's for Sat, Sep 19 at 7:30 PM\./);
  const untimed = finishing('Day 3 · Evening');
  assert.match(untimed.body!, /It's for Sat, Sep 19, and no time is set yet/);
  assert.doesNotMatch(untimed.body!, /7:00|19:00/);
  assert.match(finishing('Saturday dinner').body!, /Which night it's for isn't set yet/);
  // The table handed to Resy, waiting on "I've got it" for its booking row.
  const handed = finishing('Day 3 · Evening · 7:30 PM', [{
    id: 'b-table', vertical: 'restaurant', status: 'awaiting_approval', mode: 'redirect', provider: 'resy',
    itinerary_item_id: 'l-dinner', redirect_url: 'https://resy.com/cities/moab/desert-bistro?date=2026-09-19&seats=2', detail: 'Desert Bistro',
  }]);
  assert.equal(handed.title, 'Finish on Resy');
  assert.equal(handed.secondary?.label, "I've got it ✓");
  assert.match(handed.body!, /It's for Sat, Sep 19 at 7:30 PM\./);
});

test('checkout asks "Did you get the table?" for the line\'s own night', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.ok(app.includes('{it.when?`For ${it.when}. `:""}Did you get the table?'));
  assert.ok(app.includes('when:tableWhen(b),'), 'each table row carries its night');
  // The checkout list is built from the booking contract, whose id is
  // itineraryItemId; looking up itinerary_item_id alone found no line.
  assert.ok(app.includes('b?.itinerary_item_id??b?.itineraryItemId'));
});

// ─── The time the person set, on the slot it is about ────────────────────

const s = (plan: string, extra: Record<string, unknown> = {}) => ({ ...asGenSlot({ plan, booking: 'walk_in', cost: 20 }), ...extra });
const raleighEvening = (): GenDay => ({
  day: 1, title: 'Friday', cost_today: 80, daytime: [],
  morning: s('A drink at The Pour House to start', { kind: 'bar' }),
  afternoon: s('Dinner at Bida Manda', { kind: 'restaurant' }),
  evening: s('Live music at Kings', { kind: 'bar', ticket_url: 'https://www.ticketmaster.com/e/1' }),
});

test('a dinner out puts its time on the dinner, a concert on the ticket, any other evening on its start', () => {
  const dinner = [raleighEvening()];
  assert.equal(stampStatedTime(dinner, { time: '19:30', planType: 'restaurant' }), true);
  assert.deepEqual([dinner[0].morning.time, dinner[0].afternoon.time, dinner[0].evening.time], [null, '19:30', null]);
  const gig = [raleighEvening()];
  stampStatedTime(gig, { time: '20:00', planType: 'concert' });
  assert.deepEqual([gig[0].morning.time, gig[0].afternoon.time, gig[0].evening.time], [null, null, '20:00']);
  const night = [raleighEvening()];
  stampStatedTime(night, { time: '7:05', planType: 'trip' });
  assert.equal(night[0].morning.time, '07:05');
});

test('no plain slot for the time, no time anywhere — and never one the model wrote', () => {
  const noDinner = [{ ...raleighEvening(), afternoon: s('Somewhere to eat in Glenwood South') }];
  assert.equal(stampStatedTime(noDinner, { time: '19:30', planType: 'restaurant' }), false);
  assert.ok([noDinner[0].morning, noDinner[0].afternoon, noDinner[0].evening].every(sl => sl.time === null));
  const written = [{ ...raleighEvening(), afternoon: s('Dinner at Bida Manda', { kind: 'restaurant', time: '18:00' }) }];
  assert.equal(stampStatedTime(written, { time: null }), false);
  assert.equal(written[0].afternoon.time, null, 'only the route writes a time');
  assert.equal(stampStatedTime([raleighEvening()], { time: 'evening', planType: 'restaurant' }), false);
});

test('the screen\'s builders put the time in the line and give it its date', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  const src = app.slice(app.indexOf('const asSlot='), app.indexOf('// Returning null from a screen'));
  const { itineraryRows } = new Function('isJourney', 'typeForKind', 'lineWhen', 'labelWithClock',
    `${src}; return { itineraryRows };`)(isJourney, typeForKind, lineWhen, labelWithClock);
  const day = raleighEvening();
  stampStatedTime([day], { time: '19:30', planType: 'restaurant' });
  const rows = itineraryRows([day], true, { startDate: '2026-11-06', endDate: '2026-11-06' });
  const dinner = rows.find((r: { title: string }) => r.title === 'Dinner at Bida Manda');
  assert.equal(dinner.time, 'The main event · 7:30 PM');
  assert.equal(dinner.date, '2026-11-06');
  assert.equal(dinner.clock, '19:30');
  const start = rows.find((r: { title: string }) => r.title.startsWith('A drink'));
  assert.equal(start.time, 'To start');
  assert.equal(start.clock, null);
  // The trip's own days: Day 3's evening is the 19th in Moab.
  const trip = itineraryRows([{ ...raleighEvening(), day: 3 }], false, MOAB);
  assert.equal(trip[2].time, 'Day 3 · Evening');
  assert.equal(trip[2].date, '2026-09-19');
});

test('"The main event · 7:30 PM" is still the main event to "Something else…"', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  const from = app.indexOf('function slotOfLine(');
  const src = app.slice(from, app.indexOf('\n}\n', from) + 3);
  const slotOfLine = new Function('lineWhen', `${src}; return slotOfLine;`)(lineWhen);
  assert.deepEqual(slotOfLine({ time: 'The main event · 7:30 PM' }, [], true), { day: 1, part: 'afternoon' });
  assert.deepEqual(slotOfLine({ time: 'To start' }, [], true), { day: 1, part: 'morning' });
  assert.deepEqual(slotOfLine({ time: 'Day 3 · Evening · 7:30 PM' }, [], false), { day: 3, part: 'evening' });
});
