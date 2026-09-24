import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atLocation, applyRules, correctionNote, TIERS } from '../../lib/generation-rules.ts';

const trip = (destination: string, total: number, tier = 'saver', city?: string) =>
  ({ destination, total_per_person: total, tier, city: city ?? null });

test('the place they asked for, said the ways a model says it', () => {
  const asked = 'Breckenridge';
  assert.equal(atLocation(trip('Breckenridge, Colorado', 1000), asked), true);
  assert.equal(atLocation(trip('Breckenridge Ski Resort', 1000), asked), true);
  assert.equal(atLocation(trip('Somewhere', 1000, 'saver', 'Breckenridge'), asked), true);
  // The failure that matters: asked for one town, shown another.
  assert.equal(atLocation(trip('Aspen, Colorado', 1000), asked), false);
  // Colorado alone is not Breckenridge, however close it sounds.
  assert.equal(atLocation(trip('Colorado', 1000), asked), false);
});

test('a multi-word place is met by its distinctive half', () => {
  assert.equal(atLocation(trip('Tahoe City, California', 900), 'Lake Tahoe'), true);
  assert.equal(atLocation(trip('Lisbon, Portugal', 900), 'Lake Tahoe'), false);
});

test('asking for nowhere in particular fails nothing', () => {
  assert.equal(atLocation(trip('Anywhere', 900), ''), true);
});

test('options are put in cost order and the tiers follow', () => {
  const r = applyRules([
    trip('Expensive', 3000, 'saver'),
    trip('Cheap', 1000, 'stretch'),
    trip('Middle', 2000, 'on_budget'),
  ], { location: null });

  assert.deepEqual(r.trips.map(t => t.destination), ['Cheap', 'Middle', 'Expensive']);
  assert.deepEqual(r.trips.map(t => t.tier), TIERS);
  assert.equal(r.fatal.length, 0, 'ordering is not worth a second attempt');
  assert.ok(r.fixed.some(f => /cheapest-first/.test(f)));
});

test('already correct options are left alone and reported clean', () => {
  const r = applyRules([
    trip('Cheap', 1000, 'saver'),
    trip('Middle', 2000, 'on_budget'),
    trip('Dear', 3000, 'stretch'),
  ], { location: null });
  assert.deepEqual(r.fixed, []);
  assert.deepEqual(r.fatal, []);
});

test('being in the wrong place is fatal, not fixable', () => {
  // Somebody asked for Breckenridge. Two of these are other holidays.
  const r = applyRules([
    trip('Breckenridge, Colorado', 1000, 'saver'),
    trip('Aspen, Colorado', 2000, 'on_budget'),
    trip('Vail, Colorado', 3000, 'stretch'),
  ], { location: 'Breckenridge' });

  assert.equal(r.fatal.length, 2);
  assert.ok(r.fatal.some(f => /Aspen/.test(f)));
  assert.ok(r.fatal.some(f => /Vail/.test(f)));
});

test('a blurb-only trip may go anywhere', () => {
  const r = applyRules([
    trip('Breckenridge', 1000, 'saver'),
    trip('Chamonix', 2000, 'on_budget'),
    trip('Niseko', 3000, 'stretch'),
  ], { location: null });
  assert.deepEqual(r.fatal, []);
});

test('the wrong number of options is noted, not fatal', () => {
  // Two real options still beat an error page.
  const r = applyRules([trip('A', 1000, 'saver'), trip('B', 2000, 'on_budget')], { location: null });
  assert.equal(r.fatal.length, 0);
  assert.ok(r.fixed.some(f => /got 2/.test(f)));
});

test('the second attempt is told what was wrong with the first', () => {
  const report = applyRules([
    trip('Aspen', 1000, 'saver'),
  ], { location: 'Breckenridge' });
  const note = correctionNote(report, { location: 'Breckenridge' });
  assert.ok(note.includes('Aspen'));
  assert.ok(note.includes('Breckenridge'));
  assert.ok(/never the destination/i.test(note));
});

test('nothing in, nothing thrown', () => {
  const r = applyRules([], { location: 'Breckenridge' });
  assert.deepEqual(r.trips, []);
  assert.equal(r.fatal.length, 0);
});

import { oneMealPerEvening } from '../../lib/generation-rules.ts';
test("two dinners in one evening: the first stays, the second goes", () => {
  const { day, dropped } = oneMealPerEvening({
    morning: { plan: 'Start the night with a pint at Trophy Brewing' },
    afternoon: { plan: "Dinner at Vic's Italian Restaurant" },
    evening: { plan: "Dinner at the bar counter at Vinny's Italian Grill" },
  });
  assert.equal((day.afternoon as { plan: string }).plan, "Dinner at Vic's Italian Restaurant");
  assert.equal((day.evening as { plan: string }).plan, '');
  assert.equal(dropped.length, 1);
});
test('dinner then dessert and a last drink is one meal', () => {
  const { dropped } = oneMealPerEvening({
    morning: 'Dinner at Vic’s', afternoon: 'The show at the Pour House', evening: 'Dessert and a last drink nearby',
  });
  assert.equal(dropped.length, 0);
});

import { parseTrips } from '../../lib/trip-schema.ts';
const good = (id: string) => ({ id, destination: 'Greek night in South End', city: 'Charlotte', country_code: 'US', emoji: '🥙',
  tagline: 't', vibe: 'v', why_this_group: 'w', food_scene: 'f', music_scene: 'm', total_per_person: 80, tier: 'on_budget',
  costs: { flights: { per_person: 0, details: '' }, accommodation: { per_person: 0, details: '', example: 'South End' },
    ground_transport: { per_person: 10, details: '' }, food_drink: { per_person: 60, details: '' },
    activities: { per_person: 10, details: '' }, misc: { per_person: 0, details: '' } } });
test('one malformed option does not sink the rest', () => {
  const raw = JSON.stringify({ trips: [good('a'), good('b'), good('c'), { ...good('d'), country_code: 'USA' }] });
  const out = parseTrips(raw, 'test');
  assert.equal(out?.length, 3);
});
test('a blank country code is no answer, not a wrong one', () => {
  const out = parseTrips(JSON.stringify({ trips: [{ ...good('a'), country_code: '' }] }), 'test');
  assert.equal(out?.length, 1);
  assert.equal(out?.[0].country_code, null);
});

test('"before dinner" is not a meal — the real dinner stays', () => {
  const { day, dropped } = oneMealPerEvening({
    morning: { plan: 'Start with a pint at Trophy Brewing, a proper pub to ease in before dinner.' },
    afternoon: { plan: 'Sit-down dinner at Centro, the main event of the evening.' },
    evening: { plan: 'A show at Meymandi Concert Hall.' },
  });
  assert.equal(dropped.length, 0);
  assert.match((day.afternoon as { plan: string }).plan, /Centro/);
});
