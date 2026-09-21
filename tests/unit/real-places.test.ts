import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeMenu, citedPlace, properNames, isVouchedFor, unverifiedNames,
  withoutUnverified, type RealPlace,
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
