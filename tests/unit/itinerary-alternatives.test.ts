import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  alternativesFor, placeRef, placeByRef, dateOfLine, swappedTitle, swappedLine, slotCostCents, titleNaming, whyLine, slotWindow, eveningSlot, type PlanLine,
} from '../../lib/itinerary-alternatives.ts';
import { ABOUT_THE_PLACE } from '../../lib/contracts/itinerary-item.ts';
import type { RealPlace } from '../../lib/discovery/real-places.ts';

// Downtown Washington, around SPIN at 1332 F Street NW.
const P = (o: Partial<RealPlace> & { name: string; kind: string }): RealPlace => ({
  ref: 'p0', interest: null, url: null, city: 'Washington', source: 'osm', street: null,
  lat: 38.8977, lng: -77.0306, ...o,
});
const SPIN = P({ name: 'SPIN', kind: 'bar', street: '1332 F Street Northwest', lat: 38.8973, lng: -77.0310 });
const ROOFTOP = P({ name: 'Top of the Gate', kind: 'bar', street: '2650 Virginia Ave NW', lat: 38.8990, lng: -77.0550,
  whatsOn: ['Live DJ, every Friday from 9 PM'] });
const POUR = P({ name: 'The Pour House', kind: 'bar', street: '319 Pennsylvania Ave SE', lat: 38.8868, lng: -76.9998 });
const FAR_BAR = P({ name: 'Galaxy Hut', kind: 'bar', street: '2711 Wilson Blvd', lat: 38.8875, lng: -77.0960 }); // Arlington, ~6 km
const PUB = P({ name: 'Old Ebbitt Grill', kind: 'restaurant', street: '675 15th St NW', lat: 38.8980, lng: -77.0331 });
const PUB2 = P({ name: 'Lincoln Restaurant', kind: 'restaurant', street: '1110 Vermont Ave NW', lat: 38.9036, lng: -77.0327 });
const MUSEUM = P({ name: 'Renwick Gallery', kind: 'museum', street: '1661 Pennsylvania Ave NW', lat: 38.8987, lng: -77.0391 });
const SHUT_FRIDAY_NIGHT = P({ name: 'Daytime Bar', kind: 'bar', street: '1 Somewhere St', lat: 38.8970, lng: -77.0300, hours: 'Mo-Fr 08:00-16:00' });
const NOWHERE = P({ name: 'Unmapped Bar', kind: 'bar', lat: null, lng: null });
const MENU = [SPIN, ROOFTOP, POUR, FAR_BAR, PUB, PUB2, MUSEUM, SHUT_FRIDAY_NIGHT, NOWHERE];

const evening: PlanLine = { id: 'i3', type: 'activity', title: 'End the night at SPIN', scheduled_time: 'Day 1 · Evening', venue_name: 'SPIN', booking_mode: 'walk_in' };
const dinner: PlanLine = { id: 'i2', type: 'restaurant', title: 'Dinner at Old Ebbitt Grill', scheduled_time: 'Day 1 · Afternoon', venue_name: 'Old Ebbitt Grill' };
const museum: PlanLine = { id: 'i1', type: 'activity', title: 'The Renwick Gallery', scheduled_time: 'Day 1 · Morning', venue_name: 'Renwick Gallery' };
const LINES = [museum, dinner, evening];

test('a bar is offered bars first, near the rest of the day, and never what is already on the plan', () => {
  const got = alternativesFor({ line: evening, lines: LINES, places: MENU, nightOut: false, startDate: '2026-10-23' });
  assert.equal(got.status, 'ok');
  if (got.status !== 'ok') return;
  assert.equal(got.alternatives.length, 3);
  const names = got.alternatives.map(a => a.name);
  assert.ok(!names.includes('SPIN'), 'not the place it already is');
  assert.ok(!names.includes('Renwick Gallery') && !names.includes('Old Ebbitt Grill'), 'nothing already on the plan');
  assert.ok(got.alternatives.slice(0, 2).every(a => a.kind === 'bar' && a.sameKind), 'bars before anything else');
  assert.equal(got.current.name, 'SPIN');
  assert.equal(got.current.ref, placeRef(SPIN));
});

test('an evening stays in one part of town: a bar across the river is not offered', () => {
  const got = alternativesFor({ line: evening, lines: LINES, places: MENU, nightOut: false, startDate: '2026-10-23' });
  assert.equal(got.status, 'ok');
  if (got.status !== 'ok') return;
  assert.ok(!got.alternatives.some(a => a.name === 'Galaxy Hut'));
});

test('a place the map says is shut that evening is not offered', () => {
  // 2026-10-23 is a Friday; "Mo-Fr 08:00-16:00" is shut after five.
  const got = alternativesFor({ line: evening, lines: LINES, places: MENU, nightOut: false, startDate: '2026-10-23', count: 20 });
  assert.equal(got.status, 'ok');
  if (got.status !== 'ok') return;
  assert.ok(!got.alternatives.some(a => a.name === 'Daytime Bar'));
  // And unknown is not shut: a bar with no point and no hours is kept, last.
  assert.equal(got.alternatives.at(-1)?.name, 'Unmapped Bar');
});

test('a restaurant line is never offered a museum, and a museum line never a restaurant', () => {
  const food = alternativesFor({ line: dinner, lines: LINES, places: MENU, nightOut: false, startDate: '2026-10-23' });
  assert.equal(food.status, 'ok');
  if (food.status === 'ok') assert.deepEqual(food.alternatives.map(a => a.name), ['Lincoln Restaurant']);
  const art = alternativesFor({ line: museum, lines: LINES, places: MENU, nightOut: false, startDate: '2026-10-23', count: 20 });
  assert.equal(art.status, 'ok');
  if (art.status === 'ok') assert.ok(art.alternatives.every(a => a.kind !== 'restaurant'));
});

test('every alternative says its price is an estimate and claims no difference we do not hold', () => {
  const got = alternativesFor({ line: evening, lines: LINES, places: MENU, nightOut: false, startDate: '2026-10-23' });
  assert.equal(got.status, 'ok');
  if (got.status !== 'ok') return;
  for (const a of got.alternatives) {
    assert.equal(a.price.estimate, true);
    assert.equal(a.price.deltaPerPersonCents, null);
    assert.match(a.price.note, /estimate/);
  }
});

test('hotels and flights are sent to their booking options; a town with nothing held offers nothing', () => {
  assert.deepEqual(alternativesFor({ line: { id: 'h', type: 'hotel', title: '3 nights' }, lines: [], places: MENU, nightOut: false }),
    { status: 'booking_line', type: 'hotel' });
  // A ticket or a journey is not something a menu replaces.
  assert.equal(alternativesFor({ line: { id: 'e', type: 'event', title: 'J. Cole', venue_name: 'SPIN' }, lines: [], places: MENU, nightOut: true }).status, 'not_a_place',
    'a gig at a venue on the menu is still a ticket, not a bar');
  const typed = alternativesFor({ line: dinner, lines: LINES, places: [], nightOut: false });
  assert.equal(typed.status, 'none');
  if (typed.status === 'none') assert.match(typed.reason, /haven't verified any places/);
});

test('the why line is built from the row and nothing else', () => {
  const line = whyLine(ROOFTOP, 2.1, 'Day 1');
  assert.equal(line, 'Bar · 2650 Virginia Ave NW · 1.3 mi from the rest of Day 1 · Live DJ, every Friday from 9 PM — from their own page');
  assert.equal(whyLine(P({ name: 'X', kind: 'place' }), null, 'Day 1'), '');
  assert.match(whyLine(P({ name: 'Y', kind: 'restaurant', reservation: 'required' }), null, 'Day 2'), /the map says to book ahead/);
});

test('a ref is the place, not its position on one menu', () => {
  const ref = placeRef(SPIN);
  assert.match(ref, /^v:[0-9a-f]{8}$/);
  const moved: RealPlace = { ...SPIN, ref: 'p9' };
  assert.equal(placeRef(moved), ref, 'the menu position does not change it');
  assert.notEqual(placeRef(POUR), ref);
  assert.equal(placeByRef(ref, [POUR, SPIN])?.name, 'SPIN');
  assert.equal(placeByRef('p4', MENU), null, 'a positional ref is never accepted');
});

test('Day 3 of a trip starting the 30th is the 1st, counted on the calendar', () => {
  assert.equal(dateOfLine('Day 3 · Evening', '2026-10-30', false), '2026-11-01');
  assert.equal(dateOfLine('The main event', '2026-10-30', true), '2026-10-30');
  assert.equal(dateOfLine('Before you go', '2026-10-30', false), null);
  assert.equal(dateOfLine('Day 1 · Morning', null, false), null);
});

test('the shape of the slot stays and the old place goes', () => {
  assert.equal(swappedTitle("Dinner at Vinny's Italian Grill, known for the lasagne", "Vinny's Italian Grill", "Vic's Italian Restaurant"),
    "Dinner at Vic's Italian Restaurant");
  assert.equal(swappedTitle('A long evening that starts slowly. Then SPIN', 'SPIN', 'The Pour House'), 'The Pour House');
  assert.equal(swappedTitle('Drinks somewhere lively', null, 'The Pour House'), 'The Pour House');
});

test('a swapped line clears or replaces every fact about the old place, and keeps the slot', () => {
  const photoed = { ...ROOFTOP, photo: { url: 'https://upload.wikimedia.org/x.jpg', credit: 'A. Person, CC BY-SA', link: null }, phone: '+12025550100' };
  const patch = swappedLine({ ...evening, cost_cents: 2500 }, SPIN, photoed);
  for (const k of ABOUT_THE_PLACE) assert.ok(k in patch, `${k} is about the place and must be set or cleared`);
  for (const k of ['id', 'plan_id', 'scheduled_time', 'sort_order', 'cost_cents']) assert.ok(!(k in patch), `${k} is the slot and stays`);
  assert.equal(patch.title, 'End the night at Top of the Gate');
  assert.equal(patch.venue_name, 'Top of the Gate');
  assert.equal(patch.venue_phone, '+12025550100');
  assert.equal(patch.venue_note, 'Live DJ, every Friday from 9 PM');
  assert.equal(patch.venue_image_credit, 'A. Person, CC BY-SA');
  assert.equal(patch.subtitle, null, "the old place's tip goes with it");
  assert.equal(patch.because, null);
  assert.equal(patch.type, 'activity');
  assert.equal(patch.is_confirmed, false);
  // Never "Reach will book this" over somewhere Reach cannot book.
  assert.notEqual(swappedLine({ ...dinner, booking_mode: 'reach' }, PUB, PUB2).booking_mode, 'reach');
});

test('open then means open in the slot\'s part of the day, whatever kind of place it is', () => {
  // 2026-10-23 is a Friday. An evening activity slot with only one other bar
  // near: the rest are other activities, and a museum shut at 17:30 is not one.
  const GALLERY = P({ name: 'National Gallery of Art', kind: 'museum', street: 'Constitution Ave NW', lat: 38.8913, lng: -77.0200, hours: 'Mo-Su 10:00-17:30' });
  const CLUB = P({ name: 'Late Club', kind: 'nightclub', street: '2 Somewhere St', lat: 38.8975, lng: -77.0305, hours: 'Mo-Su 22:00-04:00' });
  const menu = [SPIN, POUR, MUSEUM, GALLERY, CLUB];
  const drinks: PlanLine = { id: 'i9', type: 'activity', title: 'Drinks at SPIN', scheduled_time: 'Day 1 · Evening', venue_name: 'SPIN' };
  const ev = alternativesFor({ line: drinks, lines: [drinks], places: menu, nightOut: false, startDate: '2026-10-23', count: 20 });
  assert.equal(ev.status, 'ok');
  if (ev.status === 'ok') assert.ok(!ev.alternatives.some(a => a.name === 'National Gallery of Art'), 'shut by the evening');
  // And a morning slot is never offered a club that opens at ten at night.
  const walk: PlanLine = { id: 'i8', type: 'activity', title: 'The Renwick Gallery', scheduled_time: 'Day 1 · Morning', venue_name: 'Renwick Gallery' };
  const am = alternativesFor({ line: walk, lines: [walk], places: menu, nightOut: false, startDate: '2026-10-23', count: 20 });
  assert.equal(am.status, 'ok');
  if (am.status === 'ok') {
    assert.ok(!am.alternatives.some(a => a.name === 'Late Club'), 'shut all morning');
    assert.ok(am.alternatives.some(a => a.name === 'National Gallery of Art'), 'open at ten');
  }
});

test('the part of the day is read off the slot: a clock time first, then its word', () => {
  assert.equal(slotWindow('Day 2 · Morning', false), 'morning');
  assert.equal(slotWindow('Day 2 · Afternoon', false), 'afternoon');
  assert.equal(slotWindow('Day 2 · Evening', false), 'evening');
  assert.equal(slotWindow('Day 2 · Late night', false), 'night');
  assert.equal(slotWindow('Day 2 · 7:30 PM', false), 'evening');
  assert.equal(slotWindow('Day 2 · 10:00 AM', false), 'morning');
  assert.equal(slotWindow('Day 2 · 22:30', false), 'night');
  assert.equal(slotWindow('12:00 PM', false), 'afternoon');
  assert.equal(slotWindow('The main event', true), 'evening', 'a night out with nothing more said');
  assert.equal(slotWindow('Day 2', false), 'day', 'nothing said is the whole day');
  assert.equal(eveningSlot('Day 2 · 9:30 PM', false), true);
  assert.equal(eveningSlot('Day 2 · Morning', false), false);
});

// ─── "Something else…" lands on one line ────────────────────────────────
test('something else may be any menu type, and is still held to near, open and not already on the plan', () => {
  const MUSEUM2 = P({ name: 'Octagon Museum', kind: 'museum', street: '1799 New York Ave NW', lat: 38.8960, lng: -77.0410 });
  const FAR_MUSEUM = P({ name: 'Far Museum', kind: 'museum', street: 'Somewhere far', lat: 39.40, lng: -77.40 });
  const places = [...MENU, MUSEUM2, FAR_MUSEUM];
  const strict = alternativesFor({ line: dinner, lines: LINES, places, nightOut: false, startDate: '2026-10-23', count: 50 });
  const free = alternativesFor({ line: dinner, lines: LINES, places, nightOut: false, startDate: '2026-10-23', count: 50, anyType: true });
  assert.equal(strict.status, 'ok');
  assert.equal(free.status, 'ok');
  if (strict.status !== 'ok' || free.status !== 'ok') return;
  assert.ok(!strict.alternatives.some(a => a.name === 'Octagon Museum'), 'Change keeps a dinner a dinner');
  const names = free.alternatives.map(a => a.name);
  assert.ok(names.includes('Octagon Museum'), 'something else can be a different kind of stop');
  assert.ok(!names.includes('Renwick Gallery') && !names.includes('SPIN'), 'never what is already on the plan');
  assert.ok(!names.includes('Far Museum'), 'still near the rest of the day');
});

test('the title something else wrote is kept only while it names the place the line points at', () => {
  const kept = swappedLine(dinner, PUB, MUSEUM, 'A slow hour at the Renwick Gallery');
  assert.equal(kept.title, 'A slow hour at the Renwick Gallery');
  // A title about somewhere else is not trusted: the lead-in rule decides.
  const other = swappedLine(dinner, PUB, MUSEUM, 'Cocktails at Top of the Gate');
  assert.equal(other.title, 'Dinner at Renwick Gallery');
  assert.equal(titleNaming('', MUSEUM), null);
  assert.equal(titleNaming('x'.repeat(201) + ' Renwick Gallery', MUSEUM), null);
});

test('something else takes the rewrite\'s own estimate; a same-kind swap keeps the line\'s', () => {
  // A free walk that becomes a brunch is not $0.
  const walk = { ...dinner, cost_cents: 0 };
  const brunch = swappedLine(walk, PUB, MUSEUM, 'A slow hour at the Renwick Gallery', { costCents: slotCostCents(35) });
  assert.equal(brunch.cost_cents, 3500);
  // Without a title it is a pick from the same kind of place: nothing moves.
  const same = swappedLine({ ...dinner, cost_cents: 2500 }, PUB, PUB2, null, { costCents: 9900 });
  assert.equal('cost_cents' in same, false, 'the estimate stays on a same-kind swap');
  // No usable figure from the rewrite: the line keeps what it had.
  const none = swappedLine(walk, PUB, MUSEUM, 'A slow hour at the Renwick Gallery', { costCents: slotCostCents(undefined) });
  assert.equal('cost_cents' in none, false);
  assert.equal(slotCostCents(0), 0, 'free is a figure');
  assert.equal(slotCostCents(-5), null);
  assert.equal(slotCostCents(99999), null);
  assert.equal(slotCostCents('abc'), null);
});

test('the swap routes and the sheet carry the rewrite\'s cost', () => {
  const patch = readFileSync(new URL('../../app/api/plans/[planId]/itinerary/[itemId]/route.ts', import.meta.url), 'utf8');
  assert.match(patch, /costCents: title \? slotCostCents\(parsed\.data\.cost\)/);
  const sugg = readFileSync(new URL('../../app/api/plans/[planId]/itinerary/[itemId]/suggestions/route.ts', import.meta.url), 'utf8');
  assert.match(sugg, /cost_cents: slotCostCents\(body\.cost\)/);
  assert.match(sugg, /costCents: typeof snap\.cost_cents === 'number'/);
  const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
  assert.match(app, /apply\(freshTo,fresh\.plan,fresh\.cost\)/);
  assert.match(app, /the line takes this in place of its old one/);
});
