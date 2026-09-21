import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeMenu, citedPlace, properNames, isVouchedFor, unverifiedNames,
  withoutUnverified, bookingFor, cleanRef, wouldMangle, type RealPlace,
} from '../../lib/discovery/real-places.ts';

const place = (ref: string, name: string, kind = 'restaurant'): RealPlace =>
  ({ ref, name, kind, interest: `${kind}s`, url: null, city: 'Moab', source: 'osm' });

const MOAB = [
  place('p1', 'Milt\'s Stop & Eat'),
  place('p2', 'Moab Diner'),
  place('p3', 'Arches National Park', 'attraction'),
];

// ─── The bugs this exists to stop ────────────────────────────────────────

test('a restaurant nobody has heard of is caught', () => {
  // This shipped. The generator wrote a Moab day around "El Charro Loco",
  // which was checked afterwards and does not exist. Afterwards is too late,
  // so it is caught here, before anybody is told to go there.
  const plan = 'Dinner at El Charro Loco, then drinks nearby.';
  assert.deepEqual(unverifiedNames(plan, MOAB), ['El Charro Loco']);
});

test('a real place on the list passes', () => {
  const plan = 'Breakfast at Milt\'s Stop & Eat before the park.';
  assert.deepEqual(unverifiedNames(plan, MOAB), []);
});

test('the sentence\'s own capital letters are not businesses', () => {
  // Every one of these opens a clause. A detector that flags them flags
  // every plan ever written and gets turned off.
  const plan = 'Start the morning slowly. Then head north. After lunch, walk the rim.';
  assert.deepEqual(unverifiedNames(plan, MOAB), []);
});

test('a name reached through a small joining word is still one name', () => {
  assert.deepEqual(properNames('Visit the Museum of the American West today'),
    ['Museum of the American West']);
});

test('what the town is called is not an invented venue', () => {
  // The destination is real by definition — somebody is going there. It
  // arrives through `allow` rather than the map, because the map lists
  // venues in Moab and not Moab itself.
  const plan = 'Drive out of Moab towards Castle Valley.';
  assert.deepEqual(unverifiedNames(plan, MOAB, ['Moab', 'Castle Valley']), []);
});

test('a real gig venue is vouched for by its listing, not the map', () => {
  // 9:30 Club comes from a Ticketmaster row, so it is not in a menu built
  // from OpenStreetMap. It is still real, and the plan must be allowed to
  // say so.
  const plan = 'Doors at the 9:30 Club at eight.';
  assert.deepEqual(unverifiedNames(plan, [], ['9:30 CLUB']), []);
});

test('a near miss is not a match', () => {
  // "Moab Giants" matched "Moab Museum" once, on a shared word, and a
  // confident wrong confirmation is worse than no confirmation.
  assert.equal(isVouchedFor('Moab Giants', [place('p1', 'Moab Museum')]), false);
  assert.equal(isVouchedFor('Moab Diner', MOAB), true);
});

// ─── The menu ────────────────────────────────────────────────────────────

test('an empty town forbids naming anything', () => {
  const menu = placeMenu([]);
  assert.match(menu, /NO VERIFIED VENUES/);
  assert.match(menu, /Name no restaurants/);
  // Not a soft suggestion to be careful — the absence has to read as a rule.
  assert.doesNotMatch(menu, /if possible|try to|where you can/i);
});

test('the menu groups by kind and carries every ref', () => {
  const menu = placeMenu(MOAB);
  assert.match(menu, /restaurant:/);
  assert.match(menu, /attraction:/);
  for (const p of MOAB) assert.ok(menu.includes(`[${p.ref}] ${p.name}`), p.name);
});

test('the menu forbids describing what we were not told', () => {
  // The list gives a name and a kind. Everything else — what it is like
  // inside, what it costs, when it opens — is the invention this replaces.
  assert.match(placeMenu(MOAB), /Do not describe what a place is like inside/);
});

test('a citation resolves, and a made-up one does not', () => {
  assert.equal(citedPlace('p2', MOAB)?.name, 'Moab Diner');
  assert.equal(citedPlace('[p3]', MOAB)?.name, 'Arches National Park');
  assert.equal(citedPlace('p99', MOAB), null);
  assert.equal(citedPlace(null, MOAB), null);
  assert.equal(citedPlace('', MOAB), null);
});

// ─── What ships when the rule is broken anyway ───────────────────────────

test('an unsourceable name is softened, not shipped', () => {
  const { text, removed } = withoutUnverified(
    'Dinner at El Charro Loco, then drinks nearby.', MOAB);
  assert.equal(text, 'Dinner at a local spot, then drinks nearby.');
  assert.deepEqual(removed, ['El Charro Loco']);
  // The sentence is still about an evening. It is just no longer about a
  // restaurant that does not exist.
  assert.match(text, /Dinner/);
});

test('a verified name survives untouched', () => {
  const line = 'Breakfast at Milt\'s Stop & Eat, then Arches National Park.';
  const { text, removed } = withoutUnverified(line, MOAB);
  assert.equal(text, line);
  assert.deepEqual(removed, []);
});

test('two invented names do not both read as "a local spot"', () => {
  const { text } = withoutUnverified(
    'Lunch at Pasta Jay, dinner at Sunset Grille.', MOAB);
  assert.equal(text, 'Lunch at a local spot, dinner at another nearby.');
});

// ─── A promise the app cannot keep ───────────────────────────────────────

test('"Reach will book this" survives only where Reach can book', () => {
  const hotel = { ...place('p1', 'The Gonzo Inn', 'hotel'), interest: 'hotels' };
  const diner = place('p2', 'Moab Diner');

  // A room, which Reach does book.
  assert.equal(bookingFor('reach', hotel), 'reach');
  // A table, which it does not — whatever the model claimed. The member
  // books their own, on their own card, where their dining benefits live.
  assert.equal(bookingFor('reach', diner), 'ahead');
  // Claimed with nothing resolved at all: the least checkable case there is.
  assert.equal(bookingFor('reach', null), 'ahead');
  // A real listing with a page that sells tickets is the case we are most
  // certain about — and still not one Reach books. The ticket is bought from
  // whoever sells it, which is the whole point of the handoff.
  assert.equal(bookingFor('reach', null, true), 'ahead');
});

test('the modes Reach never promised are left alone', () => {
  assert.equal(bookingFor('ahead', null), 'ahead');
  assert.equal(bookingFor('walk_in', null), 'walk_in');
  // Anything unrecognised falls to the claim that promises least.
  assert.equal(bookingFor('nonsense', null), 'walk_in');
});

test('a name that begins with its own article is removed whole', () => {
  // "La Piazzetta" became "La a local spot": `la` is a joining word inside
  // names like Cafe de la Paix, and trimming it off the FRONT left the
  // article stranded in front of the replacement. A capitalised joiner
  // starts a name; a lowercase one joins one.
  const { text, removed } = withoutUnverified(
    'Italian-leaning brunch at La Piazzetta in the Romantic Zone.', MOAB, ['Romantic Zone']);
  assert.deepEqual(removed, ['La Piazzetta']);
  assert.equal(text, 'Italian-leaning brunch at a local spot in the Romantic Zone.');
  assert.doesNotMatch(text, /La a local spot/);
});

test('a lowercase joiner inside a name still joins it', () => {
  assert.deepEqual(properNames('Dinner at Cafe de la Paix tonight'), ['Cafe de la Paix']);
});

// ─── Found by running it against production, not by thinking ─────────────

test('a place_ref that is not one is not a citation', () => {
  // A live run put "http://null" in this field. It resolves to nothing, so
  // it did no harm, and it is still not a reference.
  assert.equal(cleanRef('http://null'), null);
  assert.equal(cleanRef('p12'), 'p12');
  assert.equal(cleanRef('[p3]'), 'p3');
  assert.equal(cleanRef('the diner'), null);
  assert.equal(cleanRef(null), null);
  assert.equal(citedPlace('http://null', MOAB), null);
});

test('a tip is dropped rather than left a broken sentence', () => {
  // "a local spot stays lively after evening shows let out" shipped from a
  // live run. Swapping a name works when it is the object of the sentence
  // and not when it is the subject.
  assert.equal(wouldMangle('The Black Cat stays lively after shows.', ['The Black Cat']), true);
  assert.equal(wouldMangle('Grab a pint at The Black Cat after.', ['The Black Cat']), false);
});

test('the article in front of a name goes with it', () => {
  // "The Pour House Music Hall" left "The another nearby" on the screen: the
  // name is detected without its leading article, because that is how
  // sentences begin as well as how names do.
  const { text } = withoutUnverified(
    'A short walk to The Pour House Music Hall for a band.', MOAB);
  assert.equal(text, 'A short walk to a local spot for a band.');
  assert.doesNotMatch(text, /The a local spot|The another nearby/);
});

test('a phrase about a place with extent is not softened into nonsense', () => {
  // "Walk the length of Main Street" came out as "walk the length of a
  // local spot". A venue has no length to walk.
  assert.equal(wouldMangle('Walk the length of Main Street on your own.', ['Main Street']), true);
  assert.equal(wouldMangle('Dinner at Main Street Grill afterwards.', ['Main Street Grill']), false);
});

test('a ticket exempts its own slot, not every slot in the plan', () => {
  // "Reach will book this" appeared over a restaurant table because the
  // exemption was asked of the plan ("does this trip have a gig?") instead
  // of the slot ("is this the gig?").
  // Neither is a Reach booking — a ticket is bought from the seller — but
  // they were reaching that answer by different routes, and only one of them
  // was about this slot at all.
  assert.equal(bookingFor('reach', null, true), 'ahead');    // the gig
  assert.equal(bookingFor('reach', null, false), 'ahead');   // dinner beside it
});

test('a ticketed event is arranged, never booked by Reach', () => {
  // It counted as a Reach booking, so it appeared in "1 booking Reach
  // handles" and in the total on the button that charges a card — for a
  // ticket nobody here is selling.
  assert.equal(bookingFor('reach', null, true), 'ahead');
  assert.equal(bookingFor('ahead', null, true), 'ahead');
});

test('what is on at a place goes in the menu, in the venue\'s own words', () => {
  // Read off the venue's own page by the harvester. It existed, Discover
  // used it, and the itinerary menu never looked — so a plan could name a
  // brewery with no idea there was a quiz on.
  const withNights: RealPlace = {
    ...place('p1', 'Red Bear Brewing', 'brewery'),
    whatsOn: ['Pub Trivia Night — every Wednesday Night at 7 PM'],
  };
  const menu = placeMenu([withNights]);
  assert.match(menu, /Pub Trivia Night — every Wednesday Night at 7 PM/);
  // And the model is told it may repeat it, because it is checkable.
  assert.match(menu, /read off the venue/);
});

test('a place with nothing listed gets nothing invented for it', () => {
  const menu = placeMenu([place('p1', 'Moab Diner')]);
  // The venue block only — the rules below it carry an example with a
  // bullet in, which is not a listing for anywhere.
  const venues = menu.split('RULES')[0];
  assert.doesNotMatch(venues, /·/);
  assert.match(menu, /do not\s+invent one for a place that has none/);
});
