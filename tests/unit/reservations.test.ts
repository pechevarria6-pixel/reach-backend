import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reservationUrl, reserveLabel, usableTime, usableParty, chargesUpfront,
  platformFromHtml, phoneFromHtml,
  reservationFromHtml, resolveReservation, isCertain, methodNote,
} from '../../lib/booking/reservations.ts';

test('a time is a time, and "Day 3 · Evening" is not', () => {
  // The itinerary stores prose in scheduled_time, and it reached a provider
  // once already as if it were a clock time.
  assert.equal(usableTime('19:30'), '19:30');
  assert.equal(usableTime('9:05'), '09:05');
  assert.equal(usableTime('Day 3 · Evening'), null);
  assert.equal(usableTime('evening'), null);
  assert.equal(usableTime('25:00'), null);
  assert.equal(usableTime(null), null);
});

test('a party is a plausible number of people', () => {
  assert.equal(usableParty(4), 4);
  assert.equal(usableParty(0), 2, 'a table for nobody is a table for two');
  assert.equal(usableParty(null), 2);
  assert.equal(usableParty(900), 20);
});

test('a link the restaurant published beats one we build', () => {
  const url = reservationUrl('resy', { name: 'Desert Bistro', knownUrl: 'https://resy.com/cities/moab/desert-bistro' });
  assert.equal(url, 'https://resy.com/cities/moab/desert-bistro');
});

test('the date, time and party are carried into the link', () => {
  const ot = reservationUrl('opentable', { name: 'Desert Bistro', date: '2026-11-02', time: '19:30', partySize: 4 });
  assert.ok(ot?.includes('covers=4'), ot!);
  assert.ok(ot?.includes('2026-11-02T19%3A30'), ot!);
  const resy = reservationUrl('resy', { name: 'Desert Bistro', date: '2026-11-02', partySize: 4 });
  assert.ok(resy?.includes('seats=4'), resy!);
});

test('prose in the time field never reaches the link', () => {
  const ot = reservationUrl('opentable', { name: 'X', date: '2026-11-02', time: 'Day 3 · Evening' });
  assert.equal(ot?.includes('dateTime'), false, 'a date with no usable time is sent without one');
});

test('not knowing the platform is an answer, not a guess', () => {
  // Sending somebody to Resy for a restaurant that has never been on Resy is
  // the same lie as offering tickets to a wine bar.
  assert.equal(reservationUrl('none', { name: 'Desert Bistro' }), null);
  assert.equal(reserveLabel('none'), 'Call to book');
  assert.equal(reservationUrl('resy', { name: '   ' }), null);
});

test('the button says whose platform it is', () => {
  assert.equal(reserveLabel('resy'), 'Reserve on Resy');
  assert.equal(reserveLabel('opentable'), 'Reserve on OpenTable');
  assert.equal(reserveLabel('tock'), 'Reserve on Tock');
});

test('only a prepaid booking is money the group owes now', () => {
  // A held table costs nothing today, so it must not inflate what everybody
  // is asked to pay in.
  assert.equal(chargesUpfront('resy', 12000), false);
  assert.equal(chargesUpfront('opentable', null), false);
  assert.equal(chargesUpfront('tock', 12000), true, 'a Tock deposit is paid at booking');
  assert.equal(chargesUpfront('tock', null), false);
});

test('a link to the platform is proof; the word is not', () => {
  // "resy" appears inside "nursery" and in any sentence about a reservation
  // policy. Only the domain counts.
  assert.equal(platformFromHtml('<p>Our nursery has a reservation policy.</p>').platform, 'none');
  assert.equal(platformFromHtml('<a href="https://resy.com/cities/ral/pooles">Book</a>').platform, 'resy');
  assert.equal(platformFromHtml('<iframe src="https://www.opentable.com/r/pooles"></iframe>').platform, 'opentable');
  assert.equal(platformFromHtml('<a href="https://www.exploretock.com/desertbistro">Reserve</a>').platform, 'tock');
});

test('the link they published is kept, because it beats one we build', () => {
  const found = platformFromHtml('<a href="https://resy.com/cities/ral/pooles-diner">Book a table</a>');
  assert.equal(found.url, 'https://resy.com/cities/ral/pooles-diner');
});

test('no platform is the right answer for a place you telephone', () => {
  assert.deepEqual(platformFromHtml('<h1>Valenti\'s</h1><p>Call us on 910-555-0100</p>'),
    { platform: 'none', url: null });
  assert.deepEqual(platformFromHtml(''), { platform: 'none', url: null });
  assert.deepEqual(platformFromHtml(null), { platform: 'none', url: null });
});

test('a telephone link is picked up for the places with no platform', () => {
  assert.equal(phoneFromHtml('<a href="tel:+1 (910) 555-0100">Call</a>'), '+19105550100');
  assert.equal(phoneFromHtml('<p>no link here</p>'), null);
});

// ─── Certainty, not inference ───────────────────────────────────────────
test('a page that pairs a number with booking is a phone booking', () => {
  const yes = reservationFromHtml('<p>For reservations, call <a href="tel:9102451105">910-245-1105</a></p>');
  assert.equal(yes.method, 'phone');
  assert.equal(yes.phone, '9102451105');
});

test('a number and the word "reservation" in different places is not proof', () => {
  // Two facts near each other are not one fact. Saying "call to book" here
  // would hand somebody our uncertainty to resolve at the door.
  const maybe = reservationFromHtml(
    '<nav>About</nav><p>Our reservation policy is under review.</p><footer><a href="tel:9102451105">Call us</a></footer>');
  assert.equal(maybe.method, 'unknown');
  assert.equal(maybe.phone, '9102451105', 'the number is still kept, it is just not a claim');
  assert.equal(isCertain(maybe), false);
});

test('a waitlist is not a reservation', () => {
  // Verbatim shape from Valenti's in Southern Pines. Reading this as a
  // booking form would send somebody expecting a held table to a queue.
  const v = reservationFromHtml('<p>For Reservations Sanford location: <a href="/waitlist">join waitlist</a></p>');
  assert.equal(v.method, 'waitlist');
  assert.match(methodNote('waitlist', null), /no tables/);
});

test('a place that says it takes none is believed', () => {
  for (const said of ['We do not take reservations', 'Walk-ins only', 'first come, first served']) {
    assert.equal(reservationFromHtml(`<p>${said}</p>`).method, 'walk_in', said);
  }
});

test('the front page links to the booking page, which is followed', async () => {
  // Poole's Diner shape: the front page says only "Reservations" and links
  // out; the OpenTable widget lives on that second page. Reading the front
  // page alone would call this their own form when it is OpenTable.
  const pages: Record<string, string> = {
    'https://example-diner.com/': '<a href="/reservations">Reservations</a>',
    'https://example-diner.com/reservations': '<iframe src="https://www.opentable.com/r/example"></iframe>',
  };
  const found = await resolveReservation('https://example-diner.com/', async u => pages[u] ?? null);
  assert.equal(found.method, 'third_party');
  assert.equal(found.platform, 'opentable');
});

test('a booking page with a form of their own stays their own', async () => {
  const pages: Record<string, string> = {
    'https://example-trattoria.com/': '<a href="/book-a-table">Book a table</a>',
    'https://example-trattoria.com/book-a-table': '<form id="reserve">Party size</form>',
  };
  const found = await resolveReservation('https://example-trattoria.com/', async u => pages[u] ?? null);
  assert.equal(found.method, 'own_form');
  assert.equal(found.url, 'https://example-trattoria.com/book-a-table');
});

test('an unresolved restaurant says we are checking, never "call to book"', () => {
  assert.match(methodNote('unknown', '9102451105'), /checking/i);
  assert.doesNotMatch(methodNote('unknown', '9102451105'), /call to book/i);
});
