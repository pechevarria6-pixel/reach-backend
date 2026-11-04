// Learning how each restaurant takes a booking — from links it published,
// its map entry, and its own page read politely — and never guessing.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownBookingUrl, platformBookingUrl } from '../../lib/booking/booking-links.ts';
import {
  bookingChannel, platformFromHtml, reservationFromHtml, reservationUrl, usableStoredUrl,
} from '../../lib/booking/reservations.ts';
import { reservationFromOsm } from '../../lib/booking/osm-reservation.ts';
import {
  awaitingMigration, onePerSite, reservationDueFilter, rowUpdate, settleVenue, siteQueue, windowFrom,
} from '../../lib/discovery/reservation-crawl.ts';

// ─── Links that book nothing (each one was stored as a booking link) ────
test('a stylesheet is not a booking page', () => {
  // Ronnie Sushi's row, verbatim.
  assert.equal(ownBookingUrl('https://ronniesushi.com/files/reserve-css.css', 'https://ronniesushi.com/'), null);
  assert.equal(reservationFromHtml('<link href="/files/reserve-css.css" rel="stylesheet">', 'https://ronniesushi.com/').method, 'unknown');
});

test("a platform's own host, naming no restaurant, is not a restaurant on it", () => {
  assert.equal(platformBookingUrl('https://widgets.resy.com'), null, 'Mission on the Bay');
  assert.equal(platformBookingUrl('https://widgets.resy.com/embed.js'), null);
  assert.equal(platformBookingUrl('https://www.opentable.com/'), null);
  assert.equal(platformBookingUrl('https://www.opentable.com/s?term=pizza'), null);
  assert.equal(platformBookingUrl('https://www.exploretock.com/search?query=x'), null);
  assert.equal(platformFromHtml('<footer><a href="https://www.opentable.com/">Find us on OpenTable</a></footer>').platform, 'none');
});

test('an events page, a hotel room and a bare booking engine are not a table', () => {
  assert.equal(ownBookingUrl('https://www.transfercofoodhall.com/book-an-event', 'https://www.transfercofoodhall.com/'), null);
  assert.equal(ownBookingUrl('https://hotels.cloudbeds.com/reservation/VZIoow', 'https://daybeds.example/'), null);
  assert.equal(ownBookingUrl('https://bookings.zenchef.com/', 'https://peppe.example/'), null);
  assert.equal(ownBookingUrl('https://otherbusiness.com/reservations', 'https://therestaurant.com/'), null,
    'a booking page on somebody else\'s site is not theirs');
});

test('their own booking page, or a booking engine naming them, is kept', () => {
  assert.equal(ownBookingUrl('/book-a-table', 'https://trancio.co.uk/'), 'https://trancio.co.uk/book-a-table');
  assert.equal(ownBookingUrl('https://www.tablecheck.com/shops/tamafuji-us-kapahulu/reserve', 'https://tamafuji.example/'),
    'https://www.tablecheck.com/shops/tamafuji-us-kapahulu/reserve');
  // "spa" is inside "spanish"; whole words only.
  assert.ok(ownBookingUrl('https://www.covermanager.com/reservation/module_group/grupo-yakitoro/spanish', 'https://yakitoro.example/'));
});

test("a date somebody else searched for is taken out of the link", () => {
  const found = platformBookingUrl('https://resy.com/cities/ny/rosies?date=2022-05-01&seats=2');
  assert.equal(found?.platform, 'resy');
  assert.equal(found?.url, 'https://resy.com/cities/ny/rosies');
  // And a stored row with one is corrected as it is read.
  assert.equal(usableStoredUrl('resy', 'https://resy.com/cities/ny/rosies?date=2022-05-01'), 'https://resy.com/cities/ny/rosies');
});

test('a stored link is checked even when the venue website is not to hand', () => {
  // DayBeds Beach Restaurant's row: a hotel-room booking page.
  assert.equal(usableStoredUrl('none', 'https://hotels.cloudbeds.com/reservation/VZIoow'), null);
  // Miso Phat Sushi's own OpenTable link spells the id "restRef".
  assert.ok(usableStoredUrl('opentable',
    'https://www.opentable.com/booking/restref/availability?lang=en-US&correlationId=34e9&restRef=1481500&otSource=Restaurant%20website'));
});

test('a link to a different restaurant on the platform is not theirs', () => {
  // Cascina Doss's page, read on 2026-11-04, links Ikoyi in London.
  assert.equal(platformBookingUrl('https://www.opentable.com/r/ikoyi-reservations-london?restref=161697', undefined, 'Cascina Doss'), null);
  assert.equal(platformFromHtml('<a href="https://www.opentable.com/r/ikoyi-reservations-london">Ikoyi</a>', undefined, 'Cascina Doss').platform, 'none');
  // Their own, however the platform spells them.
  assert.ok(platformBookingUrl('https://www.opentable.com/r/mulino-reservations-raleigh', undefined, 'Mulino Italian Kitchen & Bar'));
  assert.ok(platformBookingUrl('https://www.sevenrooms.com/reservations/pizzapunksglasgow', undefined, 'Pizza Punks'));
  assert.ok(platformBookingUrl('https://www.yelp.com/reservations/uncle-julios-dallas-6', undefined, "Uncle Julio's"));
  assert.ok(platformBookingUrl('https://www.opentable.com/r/mago-oakland', undefined, 'Mägo'));
  // No slug to compare: an id is not refused.
  assert.ok(platformBookingUrl('https://www.opentable.com/restaurant/profile/220507/reserve?rid=220507', undefined, 'Helmand'));
  // And the map's link is held to the same rule.
  assert.equal(reservationFromOsm({ name: 'Cascina Doss', osm_tags: { 'reservation:website': 'https://www.opentable.com/r/ikoyi-reservations-london' } }), null);
});

test('a template a script fills in is not a link, and a Dutch booking page is one', () => {
  // Both read off real pages on 2026-11-04.
  assert.equal(ownBookingUrl('reservation.manageUrl', 'https://stksteakhouse.com/'), null, 'STK');
  assert.equal(ownBookingUrl('/book/{{ venue.slug }}', 'https://x.example/'), null);
  assert.equal(ownBookingUrl('https://www.restaurantolivegarden.nl/reserveren', 'https://www.restaurantolivegarden.nl/'),
    'https://www.restaurantolivegarden.nl/reserveren');
});

test("their own booking subdomain, Toast Tables and Oddle are their booking page", () => {
  assert.equal(ownBookingUrl('https://booking.dastaan.co.uk/restaurant/leeds?web', 'https://dastaan.co.uk/'), 'https://booking.dastaan.co.uk/restaurant/leeds?web');
  assert.ok(ownBookingUrl('https://toast.app/r/9aadaf8e-9fc7-466d-814b-dbbd0bddef99/reserve', 'https://mui.example/'));
  assert.ok(ownBookingUrl('https://reserve.oddle.me/en_SG/centralthai', 'https://fico.example/'));
});

test("OpenTable's widget script gives the restaurant's id, which becomes OpenTable's booking page", () => {
  const page = '<script src="//www.opentable.com/widget/reservation/loader?rid=70969&type=standard&theme=tall"></script>';
  assert.deepEqual(platformFromHtml(page), {
    platform: 'opentable',
    url: 'https://www.opentable.com/booking/restref/availability?rid=70969&restref=70969',
  });
});

test('SevenRooms, Yelp Reservations and TheFork are recognised, a Yelp review page is not', () => {
  assert.equal(platformBookingUrl('https://www.sevenrooms.com/reservations/dearlybeloved')?.platform, 'sevenrooms');
  assert.equal(platformBookingUrl('https://www.yelp.com/reservations/suki-ichiro-restaurant-new-york/widget')?.platform, 'yelp');
  assert.equal(platformBookingUrl('https://www.yelp.com/biz/suki-ichiro-new-york'), null);
  assert.equal(platformBookingUrl('https://widget.thefork.com/en/21a139b7-3e17-41ba-921a-4e8cc69e0564')?.platform, 'thefork');
  assert.equal(platformBookingUrl('https://www.thefork.it/ristorante/da-mario-r12345')?.platform, 'thefork');
  assert.equal(platformFromHtml("<script>SevenroomsWidget.init({ venueId: 'dearlybeloved', triggerId: 'x' })</script>").url,
    'https://www.sevenrooms.com/reservations/dearlybeloved');
});

test("a Resy widget proves Resy, and its link is left empty rather than made up", () => {
  const page = `<script src="https://widgets.resy.com/embed.js"></script>
    <script>resyWidget.addButton(document.getElementById('resyButton-x'), {"venueId": 5286, "apiKey": "k"})</script>`;
  assert.deepEqual(platformFromHtml(page), { platform: 'resy', url: null });
});

test('a platform with no search page of ours gets the restaurant\'s link or nothing — never Tock\'s search', () => {
  assert.equal(reservationUrl('sevenrooms', { name: 'Dearly Beloved' }), null);
  assert.equal(reservationUrl('yelp', { name: 'Suki' }), null);
  assert.equal(reservationUrl('sevenrooms', { name: 'Dearly Beloved', knownUrl: 'https://www.sevenrooms.com/reservations/dearlybeloved' }),
    'https://www.sevenrooms.com/reservations/dearlybeloved');
  // A stored link that books nothing is passed over for the platform's search.
  assert.match(reservationUrl('resy', { name: 'Mission on the Bay', knownUrl: 'https://widgets.resy.com' }) ?? '', /resy\.com\/cities\/search/);
});

// ─── The map entry ──────────────────────────────────────────────────────
test('reservation=no on the map is walk-in, and reservation=yes alone says nothing about how', () => {
  assert.equal(reservationFromOsm({ osm_tags: { reservation: 'no' } })?.method, 'walk_in');
  assert.equal(reservationFromOsm({ osm_tags: { reservation: 'yes' }, phone: '+12122288383' }), null,
    'they take bookings, but "call to book" read off this would be a guess');
  assert.equal(reservationFromOsm({ osm_tags: { reservation: 'required' } }), null);
  assert.equal(reservationFromOsm({ osm_tags: { reservation: 'Mo-Th' } }), null, 'free text is not an answer');
});

test("the map's reservation:website settles it when it names the restaurant or their own booking page", () => {
  const resy = reservationFromOsm({ osm_tags: { 'reservation:website': 'https://resy.com/cities/ny/altro-paradiso', reservation: 'yes' } });
  assert.equal(resy?.method, 'third_party');
  assert.equal(resy?.platform, 'resy');
  const own = reservationFromOsm({ website: 'https://navateet.com/', osm_tags: { 'reservation:website': 'https://navateet.com/reservations/' } });
  assert.equal(own?.method, 'own_form');
  assert.equal(own?.url, 'https://navateet.com/reservations/');
  // Gee's map entry gives its brunch menu; a mapper's slip is not a form.
  assert.equal(reservationFromOsm({ website: 'https://www.geesrestaurant.co.uk/', osm_tags: { 'reservation:website': 'https://www.geesrestaurant.co.uk/menus/brunch/' } }), null);
  // Chubby Fish's is a waitlist: not a table, and not settled from the map.
  assert.equal(reservationFromOsm({ website: 'https://www.chubbyfishsushi.com/', osm_tags: { 'reservation:website': 'https://www.chubbyfishsushi.com/waitlist' } }), null);
});

test('a number the map gives for tables is a phone booking, dialable as stored', () => {
  const f = reservationFromOsm({ osm_tags: { 'reservation:phone': '(919) 555-0142', reservation: 'yes' }, countries: ['US'] });
  assert.equal(f?.method, 'phone');
  assert.equal(f?.phone, '+19195550142');
});

// ─── Reading the site politely ──────────────────────────────────────────
const venue = (over: Record<string, unknown> = {}) => ({ id: 'v1', name: 'X', website: 'https://x.example/', phone: null, osm_tags: {}, countries: ['US'], ...over });

test('a site whose robots.txt refuses us is not read at all', async () => {
  let reads = 0;
  const s = await settleVenue(venue(), { allowed: async () => false, read: async () => { reads += 1; return '<a href="https://resy.com/cities/ny/x">Book</a>'; } });
  assert.equal(s.outcome, 'blocked');
  assert.equal(reads, 0);
});

test('the booking page a site links to is read only if robots.txt allows that page too', async () => {
  const pages: Record<string, string> = {
    'https://x.example/': '<a href="/reservations">Reservations</a>',
    'https://x.example/reservations': '<iframe src="https://www.opentable.com/r/x-raleigh"></iframe>',
  };
  const read: string[] = [];
  const s = await settleVenue(venue(), {
    allowed: async u => !u.endsWith('/reservations'),
    read: async u => { read.push(u); return pages[u] ?? null; },
  });
  assert.deepEqual(read, ['https://x.example/'], 'the disallowed page was not fetched');
  assert.equal(s.finding?.method, 'own_form', 'what the front page proves, and no more');
});

test("the crawl holds a site's platform link to the restaurant's own name", async () => {
  const s = await settleVenue(venue({ name: 'Cascina Doss' }), {
    allowed: async () => true,
    read: async () => '<a href="https://www.opentable.com/r/ikoyi-reservations-london">Ikoyi</a>',
  });
  assert.notEqual(s.finding?.method, 'third_party');
});

test('a site that is down is unreachable, not a restaurant we learned about', async () => {
  const s = await settleVenue(venue(), { allowed: async () => true, read: async () => null });
  assert.equal(s.outcome, 'unreachable');
  assert.equal(s.finding, null);
});

test('the map settles a restaurant without fetching anything', async () => {
  let asked = 0;
  const s = await settleVenue(venue({ osm_tags: { reservation: 'no' } }), {
    allowed: async () => { asked += 1; return true; }, read: async () => { asked += 1; return null; },
  });
  assert.equal(s.outcome, 'settled');
  assert.equal(s.source, 'osm');
  assert.equal(asked, 0);
});

// ─── What is written ────────────────────────────────────────────────────
const settled = (platform: string, method = 'third_party') => ({
  outcome: 'settled' as const, source: 'site' as const, fetched: true,
  finding: { method: method as 'third_party', platform: platform as 'resy', url: 'https://example/', phone: '9195550142' },
});

test('before the migration, SevenRooms is left unsettled rather than filed as something else', () => {
  const s = settled('sevenrooms');
  const patch = rowUpdate(venue(), s, false);
  assert.equal(patch?.reservation_platform, undefined);
  assert.equal(patch?.reservation_method, undefined);
  assert.equal(awaitingMigration(s, false), true);
  assert.equal(rowUpdate(venue(), s, true)?.reservation_platform, 'sevenrooms');
});

test('a look that settled nothing is recorded once the migration has run, so it waits out the back-off', () => {
  const patch = rowUpdate(venue(), { outcome: 'nothing_found', finding: null, source: null, fetched: true }, true);
  assert.equal(patch?.reservation_check, 'nothing_found');
  assert.ok(patch?.reservation_checked_at);
  assert.equal(patch?.reservation_method, undefined, 'and nothing is claimed about how they book');
  assert.equal(rowUpdate(venue(), { outcome: 'nothing_found', finding: null, source: null, fetched: true }, false), null);
});

test('a number is stored dialable, and never over one already held', () => {
  assert.equal(rowUpdate(venue(), settled('resy'), true)?.phone, '+19195550142');
  assert.equal(rowUpdate(venue({ phone: '+12125550100' }), settled('resy'), true)?.phone, undefined);
});

test('one site is read once a night however many rows name it', () => {
  const rows = [
    venue({ id: 'a', website: 'https://tonkatsukuro.com/' }),
    venue({ id: 'b', website: 'https://tonkatsukuro.com/' }),
    venue({ id: 'c', website: 'https://chain.example/raleigh' }),
    venue({ id: 'd', website: 'https://chain.example/durham' }),
  ];
  const sites = onePerSite(rows, 10);
  assert.deepEqual(sites.map(s => s.rows.map(r => r.id)), [['a', 'b'], ['c']], 'a second page on the same host waits');
});

test('the back-off is the harvester\'s, outcome by outcome', () => {
  const f = reservationDueFilter(Date.parse('2026-11-04T00:00:00Z'));
  assert.match(f, /reservation_check\.eq\.blocked,reservation_checked_at\.lt\.2026-08-06/, '90 days');
  assert.match(f, /reservation_check\.eq\.unreachable,reservation_checked_at\.lt\.2026-10-28/, '7 days');
  assert.doesNotMatch(f, /settled/, 'a settled restaurant is not asked again');
});

test('the four answers a person needs', () => {
  assert.equal(bookingChannel('third_party'), 'online');
  assert.equal(bookingChannel('own_form'), 'online');
  assert.equal(bookingChannel('phone'), 'phone');
  assert.equal(bookingChannel('walk_in'), 'walk_in');
  assert.equal(bookingChannel('waitlist'), 'walk_in');
  assert.equal(bookingChannel(null), 'unknown');
});

// ─── OpenTable's own profile page ───────────────────────────────────────
test("OpenTable's profile page for one restaurant, by its id, is that restaurant on OpenTable", () => {
  const page = '<a href="https://www.opentable.com/restaurant/profile/123456/reserve">Reserve</a>';
  assert.equal(platformFromHtml(page).platform, 'opentable');
  assert.equal(platformFromHtml(page).url, 'https://www.opentable.com/restaurant/profile/123456/reserve');
  assert.ok(platformBookingUrl('https://www.opentable.co.uk/restaurant/profile/98765'));
  assert.ok(usableStoredUrl('opentable', 'https://www.opentable.com/restaurant/profile/123456/reserve'),
    'a stored profile link is kept, not swapped for a name search');
  assert.equal(platformBookingUrl('https://www.opentable.com/restaurant/profile/'), null, 'no id is no restaurant');
  assert.equal(platformBookingUrl('https://www.opentable.com/restaurant/profile/123456/photos'), null);
});

// ─── Not going round in circles ─────────────────────────────────────────
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(4, '0') }));
const reader = (rows: Array<{ id: string }>) => async (after: string | null, upTo: string | null, limit: number) => ({
  data: rows.filter(r => (after === null || r.id > after) && (upTo === null || r.id <= upTo)).slice(0, limit),
  error: null,
});

test('each night starts somewhere new, and wraps round rather than coming up short', async () => {
  const rows = ids(1000);
  const a = await windowFrom(reader(rows), '0100', 50);
  const b = await windowFrom(reader(rows), '0700', 50);
  assert.equal(a.data[0].id, '0101');
  assert.equal(b.data[0].id, '0701');
  assert.equal(a.data.filter(r => b.data.includes(r)).length, 0, 'two starts, two different nights');
  const end = await windowFrom(reader(rows), '0990', 50);
  assert.equal(end.data.length, 50, 'near the end it carries on from the start');
  assert.equal(new Set(end.data.map(r => r.id)).size, 50, 'and never takes a row twice');
  assert.equal(end.data[8].id, '0999');
  assert.equal(end.data[9].id, '0000');
});

test('restaurants a night leaves unrecorded are not at the front of the next one', async () => {
  // Twenty rows on one shared host: onePerSite reads one and passes over
  // the rest, and nothing records the ones it passed over.
  const rows = Array.from({ length: 400 }, (_, i) => venue({
    id: String(i).padStart(4, '0'),
    website: i < 20 ? `https://www.facebook.com/page${i}` : `https://r${i}.example/`,
  }));
  const read = reader(rows) as unknown as Parameters<typeof windowFrom<ReturnType<typeof venue>>>[0];
  const night1 = onePerSite((await windowFrom(read, '0000', 60)).data, 60);
  const night2 = onePerSite((await windowFrom(read, '0200', 60)).data, 60);
  const fb = (n: typeof night1) => n.filter(s => s.website.includes('facebook')).length;
  assert.ok(night2.length >= 50, `a night still reads most of its sites (${night2.length})`);
  assert.ok(fb(night1) <= 1 && fb(night2) === 0, 'the shared host does not follow the crawl round');
});

test('map entries that settle nothing never take more than half the sites', () => {
  const mapLeft = Array.from({ length: 77 }, (_, i) => venue({ id: `m${i}`, website: `https://m${i}.example/` }));
  const window = Array.from({ length: 180 }, (_, i) => venue({ id: `w${i}`, website: `https://w${i}.example/` }));
  const sites = onePerSite(siteQueue(mapLeft, window, 60), 60);
  assert.equal(sites.length, 60);
  assert.equal(sites.filter(s => s.rows[0].id.startsWith('m')).length, 30);
  assert.equal(sites.filter(s => s.rows[0].id.startsWith('w')).length, 30, 'the window always gets its half');
  const twice = siteQueue([venue({ id: 'a' })], [venue({ id: 'a' }), venue({ id: 'b' })], 60);
  assert.deepEqual(twice.map(v => v.id), ['a', 'b'], 'a row is offered once');
});

test('the route reads every list from a random start and never lets the map rows jump the whole queue', () => {
  const route = readFileSync(new URL('../../app/api/discovery/platforms/route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /\.unshift\(/);
  assert.match(route, /const mapRead = await window\(/);
  assert.match(route, /window\(\(\) => unsettled\(BASE_COLUMNS\)\.not\('website', 'is', null\)\.is\('reservation_checked_at', null\)/);
  assert.match(route, /onePerSite\(siteQueue\(mapLeft, siteRows, sitesPerRun\), sitesPerRun\)/);
  const sql = readFileSync(new URL('../../sql/reservation-coverage-2026-11-04.sql', import.meta.url), 'utf8');
  assert.match(sql, /discovery_venues_reservation_fresh\s+on public\.discovery_venues \(id\)\s+where kind = 'restaurant' and reservation_method is null and reservation_checked_at is null/);
});

// ─── Where an answer came from ──────────────────────────────────────────
test("the migration puts the map's own answers down to the map before it calls the rest the page's", () => {
  const sql = readFileSync(new URL('../../sql/reservation-coverage-2026-11-04.sql', import.meta.url), 'utf8');
  const osm = sql.search(/set reservation_source = 'osm'/);
  const site = sql.search(/set reservation_source = 'site'/);
  assert.ok(osm > 0 && site > osm, "the map's answers are found first");
  const clause = sql.slice(osm, site);
  // Every answer lib/booking/osm-reservation.ts can give is recognised.
  for (const method of ['walk_in', 'phone', 'own_form', 'third_party']) {
    assert.match(clause, new RegExp(`reservation_method = '${method}'`), method);
  }
  for (const platform of ['resy', 'opentable', 'tock', 'sevenrooms', 'yelp', 'thefork']) {
    assert.match(clause, new RegExp(`when '${platform}'`), platform);
  }
  assert.match(clause, /reservation_source is null/, 'and nothing already labelled is relabelled');
});
