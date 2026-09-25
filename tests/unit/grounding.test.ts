import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeMenu, unverifiedNames, withoutUnverified, bookingFor, type RealPlace,
  menuLine, namedPlace, readBackCoherence, strays,
} from '../../lib/discovery/real-places.ts';
import { misfits, neutralLine } from '../../lib/discovery/category.ts';

// ─── The rule this whole product rests on ───────────────────────────────
// Reach may only state what it has verified. These freeze the behaviour
// that was wrong this morning, so it cannot come back quietly.

test('a town we hold nothing for is told to name nothing', () => {
  // The honest answer, not a degraded one. An itinerary naming no venues in
  // a town we have never swept beats one naming a restaurant that is not
  // there — somebody stands outside a laundrette either way, and only one
  // of those is our doing.
  const menu = placeMenu([]);
  assert.match(menu, /NO VERIFIED VENUES/);
  assert.match(menu, /Name no restaurants, bars, shops, venues or businesses at all/);
  // Not softened into a suggestion.
  assert.doesNotMatch(menu, /if possible|try to|where you can|prefer/i);
});

test('an invented venue is caught before it reaches anybody', () => {
  // "El Charro Loco" shipped in a Moab itinerary and does not exist.
  const verified: RealPlace[] = [
    { ref: 'p1', name: "Milt's Stop & Eat", kind: 'restaurant', interest: null, url: null, city: 'Moab', source: 'osm' },
  ];
  assert.deepEqual(unverifiedNames('Dinner at El Charro Loco, then drinks.', verified), ['El Charro Loco']);
  const { text } = withoutUnverified('Dinner at El Charro Loco, then drinks.', verified);
  assert.doesNotMatch(text, /El Charro Loco/);
  assert.match(text, /Dinner/);
});

test('a verified venue is left exactly as it is', () => {
  const verified: RealPlace[] = [
    { ref: 'p1', name: "Milt's Stop & Eat", kind: 'restaurant', interest: null, url: null, city: 'Moab', source: 'osm' },
  ];
  const line = "Breakfast at Milt's Stop & Eat before the park.";
  assert.deepEqual(unverifiedNames(line, verified), []);
  assert.equal(withoutUnverified(line, verified).text, line);
});

test('Reach never claims to book what it cannot book', () => {
  // "Reach will book this" over a restaurant table is the promise this
  // session removed twice — the second time because I put it back.
  const diner: RealPlace = { ref: 'p1', name: 'Moab Diner', kind: 'restaurant', interest: null, url: null, city: 'Moab', source: 'osm' };
  const room: RealPlace = { ref: 'p2', name: 'The Gonzo Inn', kind: 'hotel', interest: 'hotels', url: null, city: 'Moab', source: 'osm' };
  assert.equal(bookingFor('reach', diner), 'ahead');
  assert.equal(bookingFor('reach', null), 'ahead');
  assert.equal(bookingFor('reach', null, true), 'ahead');   // a ticket is the seller's
  assert.equal(bookingFor('reach', room), 'reach');          // a room it does book
});

test('a poisoned answer is rejected, not tidied up', () => {
  // The read-back exists because a prompt rule is a request. Feed it an
  // answer naming a place nobody verified and it must come out changed.
  const verified: RealPlace[] = [
    { ref: 'p1', name: 'Pullen Arts Center', kind: 'arts centre', interest: null, url: null, city: 'Raleigh', source: 'osm' },
  ];
  const poisoned = 'Dinner at The Gilded Heron, then a nightcap at Vellum Bar.';
  const { text, removed } = withoutUnverified(poisoned, verified);
  assert.equal(removed.length, 2);
  assert.doesNotMatch(text, /Gilded Heron|Vellum Bar/);
});

// ─── The line has to describe the place it names ─────────────────────────
// Plan f979c880 named SPIN, which we hold as a bar on F Street and nothing
// more, and said it was good for dancing — under a tip about the monuments
// on the Mall. Every name was vouched for; the evening described somewhere
// else. These hold the read-back that catches it.

// The rows exactly as discovery_venues holds them (read 2026-09-25).
const SPIN: RealPlace = {
  ref: 'p4', name: 'SPIN', kind: 'bar', interest: 'cocktail bars', url: 'https://wearespin.com/location/washington-dc/',
  city: 'Washington', source: 'osm', street: '1332 F Street Northwest', lat: 38.8971265, lng: -77.0308623, miles: 0.3,
  hours: 'Mo-Th 16:00-23:00; Fr 16:00-01:00, Sa 14:00-01:00, Su 13:00-19:00',
};
const GRACE: RealPlace = {
  ref: 'p1', name: 'Grace Street Coffee Roasters at AIA', kind: 'cafe', interest: 'places to eat', url: null,
  city: 'Washington', source: 'osm', street: '1735 New York Avenue Northwest', lat: 38.8967297, lng: -77.0411247, miles: 0.8,
};
const RENWICK: RealPlace = {
  ref: 'p2', name: 'Renwick Gallery', kind: 'museum', interest: 'museums & history', url: null,
  city: 'Washington', source: 'osm', street: '1661 Pennsylvania Avenue Northwest', lat: 38.8991269, lng: -77.0390789, miles: 0.6,
};
const MXDC: RealPlace = {
  ref: 'p3', name: 'MXDC Cocina Mexicana', kind: 'restaurant', interest: 'mexican restaurants', url: null,
  city: 'Washington', source: 'osm', street: '600 14th Street Northwest', lat: 38.8976883, lng: -77.0322055, miles: 0.3,
};
const DC = [GRACE, RENWICK, MXDC, SPIN];

// The three kinds the spec named, as rows would hold them.
const PING_PONG: RealPlace = { ref: 'p5', name: 'Eleven Paddles', kind: 'bar', interest: 'ping pong bars', url: null, city: 'Washington', source: 'osm' };
const MUSEUM: RealPlace = { ref: 'p6', name: 'National Museum of African American History and Culture', kind: 'museum', interest: 'museums & history', url: null, city: 'Washington', source: 'osm' };
const ROOFTOP: RealPlace = { ref: 'p7', name: 'Top of the Gate', kind: 'bar', interest: 'rooftop bars', url: null, city: 'Washington', source: 'osm' };

type Slot = { plan: string; place_ref?: string | null; tip?: string | null; kind?: string | null; because?: string | null };

test('f979c880: SPIN is a bar, so dancing and monuments do not get to be said about it', () => {
  // The line and the tip, verbatim from the saved row.
  const line = 'End the night at SPIN, a bar with counter seating and a Friday-night pace good for dancing on your own terms.';
  const tip = 'The monuments near the Mall are spread further apart than the map suggests on foot — comfortable shoes matter more than a fast pace, and October evenings cool quickly once the sun drops.';
  assert.deepEqual(misfits(line, SPIN), ['dancing']);
  assert.deepEqual(misfits(tip, SPIN), ['monuments']);
  // Nothing we hold says ping-pong either, whatever the name suggests.
  assert.deepEqual(misfits('Ping-pong at SPIN', SPIN), ['ping-pong']);
});

test('f979c880: the whole day read back — the evening is the bar, and only the bar', () => {
  const morning: Slot = { plan: 'Drop the bags and start slow with a coffee at the counter at Grace Street Coffee Roasters at AIA before heading out to explore on foot.', place_ref: 'p1', tip: '' };
  const afternoon: Slot = { plan: 'Spend the afternoon at the Renwick Gallery, an easy solo wander through the galleries at your own pace.', place_ref: 'p2', tip: '' };
  // The day tip, where a slot tip would be: the failure had it here.
  const evening: Slot = {
    plan: 'End the night at SPIN, a bar with counter seating and a Friday-night pace good for dancing on your own terms.',
    place_ref: 'p4',
    tip: 'The monuments near the Mall are spread further apart than the map suggests on foot.',
    because: 'the dancing and pop energy they wanted for the first night',
  };
  const notes = readBackCoherence([{ day: 1, morning, afternoon, evening }], DC, { night: false });
  // The fallback is built from the row and nothing else: no neighbourhood
  // ("Shaw" was the spec's guess, and SPIN is Downtown), no hours.
  assert.equal(evening.plan, 'SPIN · Bar · 1332 F Street Northwest');
  assert.doesNotMatch(evening.plan, /Shaw|open|till|\d{1,2}(am|pm)/i);
  assert.equal(evening.tip, '');
  assert.equal(evening.because, '', 'the same dancing, in another field');
  // Typed by what it is, not by being the evening.
  assert.equal(evening.kind, 'bar');
  assert.equal(afternoon.kind, 'museum');
  assert.equal(morning.kind, 'cafe');
  // The morning and the gallery fit their rows and are left as written.
  assert.match(morning.plan, /^Drop the bags/);
  assert.match(afternoon.plan, /galleries at your own pace/);
  // All four stops are within a mile of each other: nothing is dropped.
  assert.deepEqual(notes.map(n => n.what).sort(), ['rewritten', 'tip_dropped']);
});

test('a ping-pong bar may be said to have ping-pong, and nothing else of the wrong kind', () => {
  assert.deepEqual(misfits('A few rounds of ping-pong at Eleven Paddles.', PING_PONG), []);
  assert.deepEqual(misfits('Eleven Paddles, with a DJ and dancing late.', PING_PONG), ['dancing']);
  assert.deepEqual(misfits('Eleven Paddles, a short walk from the monuments.', PING_PONG), ['monuments']);
});

test('a museum gets no DJ, no dancing and no cocktails', () => {
  const name = MUSEUM.name;
  assert.deepEqual(misfits(`A morning at the ${name}, working through the exhibits at your own pace.`, MUSEUM), []);
  assert.deepEqual(misfits(`${name}, where a DJ keeps the dancing going.`, MUSEUM), ['dancing']);
  assert.deepEqual(misfits(`Cocktails at the ${name}.`, MUSEUM), ['drinks']);
  // The history interest vouches for the memorials around it.
  assert.deepEqual(misfits(`The ${name}, then the memorials.`, MUSEUM), []);
});

test('a rooftop bar may be a rooftop; a plain bar may not', () => {
  assert.deepEqual(misfits('Sunset drinks on the rooftop at Top of the Gate.', ROOFTOP), []);
  assert.deepEqual(misfits('Top of the Gate, with views of the monuments.', ROOFTOP), ['monuments']);
  assert.deepEqual(misfits('Top of the Gate for dancing.', ROOFTOP), ['dancing']);
  assert.deepEqual(misfits('Up to the rooftop at SPIN.', SPIN), ['rooftop']);
});

test('a place’s own name is not a claim about it', () => {
  const grill: RealPlace = { ref: 'p10', name: 'Summit Grill', kind: 'restaurant', interest: 'places to eat', url: null, city: 'Moab', source: 'osm' };
  assert.deepEqual(misfits('Dinner at Summit Grill.', grill), []);
  assert.deepEqual(misfits('Dinner at Summit Grill, then a hike to the summit.', grill), ['trails']);
});

test('what is on at a place vouches like the row does', () => {
  const withNight: RealPlace = { ...SPIN, whatsOn: ['DJ Night — every Friday at 10 PM'] };
  assert.deepEqual(misfits('Friday is DJ night at SPIN.', withNight), []);
});

test('the fallback line holds only what the row holds', () => {
  assert.equal(neutralLine(SPIN), 'SPIN · Bar · 1332 F Street Northwest');
  assert.equal(neutralLine({ ...SPIN, street: null }), 'SPIN · Bar');
  assert.equal(neutralLine({ ...SPIN, kind: 'arts_centre' }), 'SPIN · Arts centre · 1332 F Street Northwest');
});

test('the menu line says what the place is and where, not only its name', () => {
  // "[p4] SPIN" was the whole of it, and the model filled the gap with a
  // dance floor.
  assert.equal(menuLine(SPIN), '  [p4] SPIN — bar · cocktail bars · 1332 F Street Northwest');
  assert.equal(menuLine({ ...SPIN, interest: 'bars' }), '  [p4] SPIN — bar · 1332 F Street Northwest');
  assert.equal(menuLine({ ...SPIN, interest: null, street: null }), '  [p4] SPIN — bar');
  const menu = placeMenu([SPIN]);
  assert.match(menu, /\[p4\] SPIN — bar · cocktail bars · 1332 F Street Northwest/);
  assert.match(menu, /Do not describe what a place is like inside/);
  assert.match(menu, /tip is about that slot only/);
  // And still no hours stated as ours.
  assert.match(menu, /hours per OpenStreetMap: Mo-Th/);
});

test('a line naming a menu place without citing it is still read against it', () => {
  assert.equal(namedPlace('Last drinks at SPIN.', DC)?.ref, 'p4');
  // A name inside another word is not that name.
  assert.equal(namedPlace('A spinning class downtown.', DC), null);
  const evening: Slot = { plan: 'Dancing at SPIN until late.', place_ref: '' };
  readBackCoherence([{ day: 1, evening }], DC, { night: true });
  assert.equal(evening.plan, 'SPIN · Bar · 1332 F Street Northwest');
});

test('a line with no place is left alone, and so is its tip', () => {
  const morning: Slot = { plan: 'A walk past the monuments on the Mall.', place_ref: '', tip: 'Go early for the light.' };
  assert.deepEqual(readBackCoherence([{ day: 1, morning }], DC, { night: false }), []);
  assert.equal(morning.plan, 'A walk past the monuments on the Mall.');
  assert.equal(morning.tip, 'Go early for the light.');
  assert.equal(morning.kind, null);
});

// ─── Where the stops are ─────────────────────────────────────────────────

// Arlington's Ballston, ~8 km from downtown; Baltimore's Inner Harbor, ~56 km.
const BALLSTON: RealPlace = { ref: 'p8', name: 'Ballston Quarter', kind: 'marketplace', interest: 'markets & food halls', url: null, city: 'Arlington', source: 'osm', lat: 38.8816, lng: -77.1116, miles: 5 };
const HARBOR: RealPlace = { ref: 'p9', name: 'Harborplace', kind: 'marketplace', interest: 'markets & food halls', url: null, city: 'Baltimore', source: 'osm', lat: 39.2856, lng: -76.6122, miles: 35 };

test('an evening that crosses the river loses the stop on the far side', () => {
  const morning: Slot = { plan: 'A drink at SPIN.', place_ref: 'p4', tip: '' };
  const afternoon: Slot = { plan: 'Dinner at MXDC Cocina Mexicana.', place_ref: 'p3', tip: '' };
  const evening: Slot = { plan: 'Dessert at Ballston Quarter.', place_ref: 'p8', tip: 'Take the Orange line.' };
  const notes = readBackCoherence([{ day: 1, morning, afternoon, evening }], [...DC, BALLSTON], { night: true });
  assert.equal(evening.plan, '');
  assert.equal(evening.tip, '');
  assert.equal(evening.place_ref, null);
  assert.match(morning.plan, /SPIN/);
  const dropped = notes.filter(n => n.what === 'dropped_location');
  assert.equal(dropped.length, 1);
  const d = dropped[0] as { slot: string; place: string; km: number; reason: string };
  assert.equal(d.slot, 'evening');
  assert.equal(d.place, 'Ballston Quarter');
  assert.equal(d.reason, 'cluster');
  assert.ok(d.km >= 5, `km ${d.km}`);
});

test('the same stop is fine on a trip day, which can take a ride across the river', () => {
  const morning: Slot = { plan: 'Coffee at Grace Street Coffee Roasters at AIA.', place_ref: 'p1' };
  const evening: Slot = { plan: 'Dinner at Ballston Quarter.', place_ref: 'p8' };
  assert.deepEqual(readBackCoherence([{ day: 2, morning, evening }], [...DC, BALLSTON], { night: false }), []);
  assert.match(evening.plan, /Ballston/);
});

test('a stop beyond the destination radius is dropped, whatever the rest of the day', () => {
  const afternoon: Slot = { plan: 'Lunch at Harborplace.', place_ref: 'p9' };
  const notes = readBackCoherence([{ day: 1, afternoon }], [...DC, HARBOR], { night: false });
  assert.equal(afternoon.plan, '');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].what, 'dropped_location');
  assert.equal((notes[0] as { reason: string }).reason, 'radius');
});

test('the day is its biggest group, and a stop with no point is never a stray', () => {
  const stop = (place: RealPlace) => ({ place });
  // Two downtown and one far: the far one goes, even though it came first.
  const far: RealPlace = { ...BALLSTON, lat: 38.99, lng: -77.3 };
  assert.deepEqual(strays([stop(far), stop(SPIN), stop(MXDC)], 5).map(s => s.place.name), [far.name]);
  // Not knowing where something is is not evidence that it is far.
  assert.deepEqual(strays([stop(SPIN), stop({ ...BALLSTON, lat: null, lng: null })], 5), []);
  // Two stops far apart: the day was planned from its first.
  assert.deepEqual(strays([stop(SPIN), stop(BALLSTON)], 5).map(s => s.place.name), ['Ballston Quarter']);
});
