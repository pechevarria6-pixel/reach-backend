// "Something else…" on one slot (checkout spec Task 7a): the new stop comes
// from the verified menu only, is read back exactly as the full generator
// reads a day back, and never changes any other stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oneSlotReadBack, readBackDays, asGenSlot, type GenDay, type ReadBackEnv } from '../../lib/itinerary-readback.ts';
import type { RealPlace } from '../../lib/discovery/real-places.ts';
import { readFileSync } from 'node:fs';

const at = (lat: number, lng: number) => ({ lat, lng, miles: 0.5 });
const MENU: RealPlace[] = [
  { ref: 'p1', name: 'The Pour House', kind: 'bar', interest: 'bars', url: 'https://pourhouse.example', city: 'Raleigh', source: 'osm', ...at(35.776, -78.639) },
  { ref: 'p2', name: 'Bida Manda', kind: 'restaurant', interest: 'restaurants', url: 'https://bidamanda.example', city: 'Raleigh', source: 'osm', ...at(35.777, -78.638) },
  { ref: 'p3', name: 'Kings', kind: 'bar', interest: 'live music', url: 'https://kings.example', city: 'Raleigh', source: 'osm',
    whatsOn: ['Live music Friday nights'], ...at(35.775, -78.640) },
  { ref: 'p4', name: 'Poole\'s Diner', kind: 'restaurant', interest: 'restaurants', url: null, city: 'Raleigh', source: 'osm', ...at(35.778, -78.641) },
];

const env = (over: Partial<ReadBackEnv> = {}): ReadBackEnv => ({
  realPlaces: MENU, vouchers: ['Raleigh'], destination: 'Raleigh', isNightPlan: true,
  realEvent: null, nightPrefs: {}, vetoes: [], planForLog: null, ...over,
});

const slot = (plan: string, place_ref = '', booking: 'ahead' | 'walk_in' | 'reach' = 'walk_in') =>
  ({ ...asGenSlot({ plan, booking, cost: 20 }), place_ref, tip: '', because: '', payment: '' });

const evening = (): GenDay => ({
  day: 1, title: 'Friday', cost_today: 80, daytime: [],
  morning: slot('A drink at The Pour House to start', 'p1'),
  afternoon: slot('Dinner at Bida Manda', 'p2', 'ahead'),
  evening: slot('A walk down Fayetteville Street'),
});

test('a new stop from the menu is offered, and carries what its row holds', () => {
  const out = oneSlotReadBack({ day: evening(), part: 'evening', index: null, fresh: slot('Live music at Kings to finish', 'p3'), env: env() });
  assert.ok('slot' in out, JSON.stringify(out));
  assert.equal(out.slot.plan, 'Live music at Kings to finish');
  assert.equal(out.slot.place_url, 'https://kings.example', "the row's own site, attached by the read-back");
  assert.equal(out.slot.whats_on, 'Live music Friday nights', 'what is on, from the venue, not the model');
});

test('a name nothing vouches for is softened exactly as the full generator softens it', () => {
  const fresh = slot('Catch a set at The Blue Note Lounge', '');
  const out = oneSlotReadBack({ day: evening(), part: 'evening', index: null, fresh, env: env() });
  // The full read-back on the same line, for comparison.
  const whole = evening(); whole.evening = slot('Catch a set at The Blue Note Lounge', '');
  const [full] = readBackDays([whole], env({ quiet: true }));
  const got = 'slot' in out ? out.slot.plan : '';
  assert.equal(got, full.evening.plan, 'one slot is held to the same rule as a whole day');
  assert.doesNotMatch(got, /Blue Note/, 'the invented venue never reaches the screen');
});

test('a second dinner is refused as not sitting with the day — not as nothing fitting', () => {
  const out = oneSlotReadBack({ day: evening(), part: 'evening', index: null, fresh: slot("Dinner at Poole's Diner", 'p4', 'ahead'), env: env() });
  assert.deepEqual(out, { refused: 'clashes' });
});

test('the other stops are never changed — not even when the new one is the earlier meal', () => {
  // Putting a dinner in the first slot would make the existing dinner the
  // "second meal" and drop it. That is another stop changing: refused.
  const day = evening();
  const before = JSON.stringify(day);
  const out = oneSlotReadBack({ day, part: 'morning', index: null, fresh: slot("Dinner at Poole's Diner", 'p4', 'ahead'), env: env() });
  assert.deepEqual(out, { refused: 'moved_another' });
  assert.equal(JSON.stringify(day), before, 'the day handed in is not touched');
});

test('somewhere else means somewhere else', () => {
  const same = oneSlotReadBack({ day: evening(), part: 'morning', index: null, fresh: slot('Another round at The Pour House', 'p1'), env: env() });
  assert.deepEqual(same, { refused: 'same_place' });
  const repeat = oneSlotReadBack({ day: evening(), part: 'evening', index: null, fresh: slot('Back to The Pour House', 'p1'), env: env() });
  assert.deepEqual(repeat, { refused: 'same_place' }, 'not a stop the day already goes to');
});

test('a saved plan\'s rows carry no place_ref: the same place is still caught by name', () => {
  // itinerary_items and the client's slotRow never hold a ref, so the
  // screen's `current` and the day's other stops arrive as bare text.
  const saved = (): GenDay => ({
    day: 1, title: 'Friday', cost_today: 80, daytime: [],
    morning: slot('A drink at The Pour House to start'),
    afternoon: slot('Dinner at Bida Manda', '', 'ahead'),
    evening: slot('Live music at Kings'),
  });
  const swap = oneSlotReadBack({ day: saved(), part: 'evening', index: null, fresh: slot('One more song at Kings to finish', 'p3'), env: env() });
  assert.deepEqual(swap, { refused: 'same_place' }, 'Kings for Kings is not something else');
  const repeat = oneSlotReadBack({ day: saved(), part: 'evening', index: null, fresh: slot('Last round back at The Pour House', 'p1'), env: env() });
  assert.deepEqual(repeat, { refused: 'same_place' }, 'not a stop the day already goes to, named without a ref');
  const fine = oneSlotReadBack({ day: saved(), part: 'evening', index: null, fresh: slot("Late plates at Poole's Diner", 'p4', 'ahead'), env: env() });
  assert.notDeepEqual(fine, { refused: 'same_place' }, 'a different place is not refused as the same one');
});

test('nothing on the menu fits: an empty answer is said, never filled', () => {
  const out = oneSlotReadBack({ day: evening(), part: 'evening', index: null, fresh: slot(''), env: env() });
  assert.deepEqual(out, { refused: 'nothing_fits' });
});

test('a veto holds on one slot as it does on a day', () => {
  const out = oneSlotReadBack({ day: evening(), part: 'evening', index: null, fresh: slot('Live music at Kings to finish', 'p3'), env: env({ vetoes: ['live music'] }) });
  assert.deepEqual(out, { refused: 'nothing_fits' });
});

test('"Reach will book this" is not kept on a table', () => {
  const out = oneSlotReadBack({ day: evening(), part: 'evening', index: null, fresh: slot('Live music at Kings to finish', 'p3', 'reach'), env: env() });
  assert.ok('slot' in out);
  assert.notEqual(out.slot.booking, 'reach');
});

test('the route answers a slot request with that slot and nothing else, after the read-back', () => {
  const src = readFileSync(new URL('../../app/api/trips/generate/route.ts', import.meta.url), 'utf8');
  const branch = src.slice(src.indexOf('    if (slotAsk) {'), src.indexOf('    const prompt = isNightPlan ? `Plan one evening out'));
  assert.ok(branch.length > 0, 'the slot branch exists');
  assert.match(branch, /ONE_SLOT_JSON_SCHEMA/, 'the model is asked for one slot');
  assert.match(branch, /\$\{menu\}/, 'from the same verified menu');
  assert.match(branch, /oneSlotReadBack\(/, 'read back like the full generator');
  assert.doesNotMatch(branch, /attachDays|saveIdeas|itinerary_items|replaceItinerary/, 'nothing is saved here');
  assert.match(branch, /NextResponse\.json\(\{\s*slot: out\.slot,/, 'the answer is the read-back slot');
  // And the place it names, by the stable ref the per-item PATCH takes, so
  // the screen applies it to one line — taken from the read-back slot.
  assert.match(branch, /const named = placeOf\(out\.slot, realPlaces\);/);
  assert.match(branch, /to: named \? placeRef\(named\) : null/);
});
