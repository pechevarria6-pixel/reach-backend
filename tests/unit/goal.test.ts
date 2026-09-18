import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripTypesFromGoal, goalAnswersTripType } from '../../lib/goal.ts';

test('a goal that plainly names the trip answers the question', () => {
  assert.deepEqual(tripTypesFromGoal('a week skiing with the lads'), ['adventure']);
  assert.deepEqual(tripTypesFromGoal('somewhere warm on a beach'), ['beach']);
  assert.deepEqual(tripTypesFromGoal('hiking in the mountains'), ['nature']);
  assert.deepEqual(tripTypesFromGoal('spa and yoga retreat'), ['wellness']);
});

test('a goal can name more than one', () => {
  const found = tripTypesFromGoal('beaches in the day, clubbing at night');
  assert.deepEqual(found.sort(), ['beach', 'party']);
});

test('a word that merely contains another does not count', () => {
  // "whisky" must not read as "ski", which is how a matcher starts booking
  // a ski trip for a distillery tour.
  assert.deepEqual(tripTypesFromGoal('a whisky tasting weekend'), []);
  // "skip" must not read as "ski". (An earlier version of this test used
  // "skip the museums", which legitimately matches museums — the test was
  // wrong, not the code.)
  assert.deepEqual(tripTypesFromGoal('skip the formalities'), []);
});

test('a vague goal is left to be asked properly', () => {
  // A question skipped wrongly is an answer nobody gave.
  assert.deepEqual(tripTypesFromGoal('somewhere nice with my sister'), []);
  assert.deepEqual(tripTypesFromGoal('her fortieth'), []);
  assert.deepEqual(tripTypesFromGoal(''), []);
  assert.deepEqual(tripTypesFromGoal(null), []);
  assert.deepEqual(tripTypesFromGoal('   '), []);
});

test('"city" alone is too common to count; "city break" is not', () => {
  assert.deepEqual(tripTypesFromGoal('leaving the city for once'), []);
  assert.deepEqual(tripTypesFromGoal('a city break in spring'), ['city']);
});

test('the gate follows the reading', () => {
  assert.equal(goalAnswersTripType('a week skiing'), true);
  assert.equal(goalAnswersTripType('somewhere nice'), false);
});
