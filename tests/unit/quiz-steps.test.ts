import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsFor, dateStepIndex } from '../../lib/quiz-steps.ts';

const Q = (id: string) => ({ id });

test('the blurb is asked before the dates', () => {
  // The one open question comes before a fortnight of calendar. Somebody who
  // knows they want a ski week for Kyle's fortieth says so first.
  const steps = stepsFor([Q('goalBlurb'), Q('tripType'), Q('budget')]);
  assert.deepEqual(steps.map(s => s.kind === 'dates' ? 'dates' : s.question.id),
    ['goalBlurb', 'dates', 'tripType', 'budget']);
});

test('with no blurb to ask, the dates lead', () => {
  // The blurb is carried over when it is already known, and then it is not
  // asked at all — so anchoring the dates at index 1 would have put them in
  // the middle of the lists for no reason.
  const steps = stepsFor([Q('tripType'), Q('budget')]);
  assert.deepEqual(steps.map(s => s.kind === 'dates' ? 'dates' : s.question.id),
    ['dates', 'tripType', 'budget']);
});

test('every question is asked exactly once, and the dates once', () => {
  // The failure this arithmetic has is showing a question twice or skipping
  // one, and nothing throws when it does.
  for (const asked of [
    [Q('goalBlurb')],
    [Q('goalBlurb'), Q('tripType')],
    [Q('tripType')],
    [Q('goalBlurb'), Q('a'), Q('b'), Q('c'), Q('d')],
  ]) {
    const steps = stepsFor(asked);
    assert.equal(steps.length, asked.length + 1, 'one screen per question, plus the dates');
    assert.equal(steps.filter(s => s.kind === 'dates').length, 1);
    const ids = steps.flatMap(s => s.kind === 'question' ? [s.question.id] : []);
    assert.deepEqual(ids, asked.map(q => q.id), 'same questions, same order, none lost');
  }
});

test('the date index is where the date step actually is', () => {
  assert.equal(dateStepIndex([Q('goalBlurb'), Q('tripType')]), 1);
  assert.equal(dateStepIndex([Q('tripType')]), 0);
});

test('no questions at all still asks for dates', () => {
  assert.deepEqual(stepsFor([]).map(s => s.kind), ['dates']);
});
