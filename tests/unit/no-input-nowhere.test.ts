// ─── No input that goes nowhere ──────────────────────────────────────────
// Two answers Reach used to collect and could do nothing with: "Anything
// you're weirdly into?" (Moments does not exist) and a cold-weather no-go
// (Reach holds no climate data). Both are off behind flags, answers kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dripAllowed, dripHasAHome, pickDrip, MOMENTS_ENABLED } from '../../lib/drip.ts';
import {
  CLIMATE_CHECKS_ENABLED, CANT_CHECK_WEATHER, offeredNoGos, savedWeatherNoGo, splitVetoes, weatherLine, isWeatherNoGo,
} from '../../lib/weather-no-go.ts';
import { answersFrom, answersBlock } from '../../lib/group-answers.ts';
import { answersFromGoal } from '../../lib/goal.ts';
import { DISLIKES } from '../../lib/traveler-profile.ts';

const app = readFileSync('components/reach-app.jsx', 'utf8');

test('both flags are off by default', () => {
  assert.equal(MOMENTS_ENABLED, false);
  assert.equal(CLIMATE_CHECKS_ENABLED, false);
});

test('with Moments off, the weirdly-into drip is never shown — and would be with it on', () => {
  const ctx = { screen: 'discover', answers: {} } as never;
  assert.equal(dripAllowed('free_interests', ctx), false);
  assert.equal(pickDrip(['free_interests'], ctx), null);
  assert.equal(dripHasAHome('free_interests', true), true);
  // Other drips are untouched.
  assert.equal(dripAllowed('drinks', ctx), true);
});

test('an answer already saved to free_interests is kept, not stripped', () => {
  const contract = readFileSync('lib/contracts/traveler-profile.ts', 'utf8');
  assert.match(contract, /free_interests: z\.string\(\)\.max\(300\)\.nullish\(\)/);
});

test('with climate checks off, no screen offers a weather no-go', () => {
  const tripQuiz = [
    { id: 'camping' }, { id: 'longFlights' }, { id: 'coldWeather' }, { id: 'hiking' },
  ];
  assert.deepEqual(offeredNoGos(tripQuiz, o => o.id).map(o => o.id), ['camping', 'longFlights', 'hiking']);
  assert.ok(!offeredNoGos(DISLIKES, d => d).includes('Cold weather' as never));
  const dbs = offeredNoGos(['Cold weather', 'Extreme heat', 'Crowds'], d => d);
  assert.deepEqual(dbs, ['Crowds']);
  // On, they come back.
  assert.equal(offeredNoGos(tripQuiz, o => o.id, true).length, 4);

  // Every place a person could choose one reads through the filter.
  assert.equal((app.match(/options:offeredNoGos\(\[/g) || []).length, 2, 'the taste quiz and the trip quiz');
  assert.match(app, /const DBS=offeredNoGos\(\["Cold weather","Extreme heat",/);
  assert.match(app, /const noChips=\[\.\.\.offeredNoGos\(DISLIKES,d=>d\)/);
  // Typing "no cold" does not tick a hidden box.
  assert.ok(!answersFromGoal('A week away, nothing cold please').noWay.includes('coldWeather'));
  assert.ok(answersFromGoal('A week away, no camping please').noWay.includes('camping'));
});

test('a saved cold no-go shows the one quiet line on the plan', () => {
  assert.equal(CANT_CHECK_WEATHER, "We can't check weather yet.");
  assert.equal(savedWeatherNoGo({ dealbreakers: ['Cold weather'] }), true);
  assert.equal(savedWeatherNoGo({ noWayJose: ['coldWeather'] }), true);
  assert.equal(savedWeatherNoGo({ dealbreakers: ['Crowds'], noWayJose: ['camping'] }), false);
  assert.match(app, /\{!CLIMATE_CHECKS_ENABLED&&savedWeatherNoGo\(\{dealbreakers:plan\.dealbreakers,noWayJose:myNoGos\}\)&&\(\s*<div[^>]*>\{CANT_CHECK_WEATHER\}<\/div>/);
});

test('the prompt never tells the model a weather no-go is enforced', () => {
  const { hard, weather } = splitVetoes(['camping', 'coldWeather', 'Cold weather']);
  assert.deepEqual(hard, ['camping']);
  assert.deepEqual(weather, ['coldWeather', 'Cold weather']);
  const line = weatherLine(weather);
  assert.match(line, /a wish, not a rule/);
  assert.match(line, /cannot be checked/);
  assert.doesNotMatch(line, /never include|absolute|veto/i);
  assert.equal(weatherLine([]), '');

  // The group's own answers say it as a wish, not a "will not".
  const read = answersFrom([{ user_id: 'u', submitted_at: '2026-09-24T00:00:00Z', answers: { noWayJose: ['camping', 'coldWeather'] }, users: { name: 'A' } }]);
  const block = answersBlock(read, { group: true });
  assert.match(block, /will not: camping/);
  assert.doesNotMatch(block, /will not:[^·\n]*coldWeather/);

  // Every veto list in the prompt is the hard list, never the raw one.
  const route = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  assert.match(route, /const \{ hard: allVetoes, weather: weatherNos \} = splitVetoes\(everyVeto\);/);
  assert.match(route, /const allVetoesHere = here\.hard;/);
  assert.doesNotMatch(route, /everyVeto\.join/);
  assert.ok(isWeatherNoGo('custom:Extreme heat'));
});

test('copy that claims the weather was checked is caught by check:vocabulary', () => {
  const guard = readFileSync('scripts/check-vocabulary.mjs', 'utf8');
  for (const p of ["'checked the weather'", "'weather checked'", "'avoids the cold'"]) assert.ok(guard.includes(p), p);
  assert.ok(!/weirdly into/i.test(app), 'no screen asks it');
});
