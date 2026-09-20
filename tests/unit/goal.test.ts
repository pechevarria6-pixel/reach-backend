import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answersFromGoal, tripTypesFromGoal, goalAnswersTripType, isNegated, findPhrase, summarise,
} from '../../lib/goal.ts';

// ─── What somebody does not want ────────────────────────────────────────

test('a thing somebody hates is never read as a thing they want', () => {
  // The example the whole negation pass exists for. A matcher that only
  // looks for words finds "clubs" in this sentence and books one.
  const r = answersFromGoal("Tim's 40th, he hates clubs, somewhere we can actually talk");
  assert.ok(!Object.values(r.answers).flat().includes('clubs'));
  assert.ok(r.noWay.includes('clubs'), 'it becomes a hard no instead');
  assert.deepEqual(r.answers.nightEnergy, ['chilled'], '"actually talk" is the answer they did give');
});

test('a refusal binds to its own clause, not the whole sentence', () => {
  // "no clubs, live music" must not read the "no" as attaching to the music,
  // or one refusal silently cancels everything that follows it.
  const r = answersFromGoal('no clubs, live music and dinner');
  assert.ok(r.noWay.includes('clubs'));
  assert.deepEqual(r.answers.nightKind, ['livemusic', 'dinner'], 'in the order they were said');
});

test('every way of saying no is a no', () => {
  for (const said of [
    'no camping', 'not camping', 'without camping', 'we hate camping',
    'avoid camping', 'rather not camping', "don't want camping",
  ]) {
    assert.ok(answersFromGoal(said).noWay.includes('camping'), said);
    assert.ok(!(answersFromGoal(said).answers.tripType ?? []).includes('nature'), `${said} is not a want`);
  }
});

test('a refusal with nowhere to go on the list is dropped, not forced', () => {
  // The trip quiz has no "not a beach" option. Rather than put it somewhere
  // approximate, the beach question simply gets asked properly.
  const r = answersFromGoal('not a beach holiday this time');
  assert.equal(r.noWay.includes('beach'), false);
  assert.equal(r.answers.tripType, undefined, 'and it is certainly not a want');
});

// ─── What they do want ──────────────────────────────────────────────────

test('the trip type is taken from what they wrote', () => {
  assert.deepEqual(tripTypesFromGoal("ski trip with the boys in Aspen to celebrate Kyle's promotion"), ['adventure']);
  assert.equal(goalAnswersTripType('a week on the beach'), true);
});

test('a word inside another word is not a match', () => {
  // "whisky" contains "ski". This is the oldest bug in this module.
  assert.deepEqual(tripTypesFromGoal('whisky tasting weekend in Islay'), []);
  assert.equal(goalAnswersTripType('whisky tasting weekend in Islay'), false);
});

test('the longer phrase wins when one sits inside the other', () => {
  // "boutique hotel" contains "hotel", so a plain word search answered the
  // same question twice from one phrase somebody wrote once.
  const r = answersFromGoal('relaxed spa week, boutique hotel');
  assert.deepEqual(r.answers.accommodation, ['boutique']);
});

test('a question that takes one answer gets one', () => {
  // Offering somebody two paces would be answering a question nobody asked.
  const r = answersFromGoal('a relaxed, spontaneous week away');
  assert.equal(r.answers.pace?.length, 1);
});

test('several answers are kept in the order they were said', () => {
  const r = answersFromGoal('dinner then drinks and live music');
  assert.deepEqual(r.answers.nightKind, ['dinner', 'drinks', 'livemusic']);
});

test('a blurb that says nothing specific answers nothing', () => {
  // The safe direction. Every question gets asked properly.
  for (const vague of ['', '  ', 'a trip', 'somewhere nice', 'just getting away']) {
    const r = answersFromGoal(vague);
    assert.deepEqual(r.answers, {}, vague);
    assert.deepEqual(r.noWay, [], vague);
  }
});

test('the phrase that produced each answer is kept, so it can be shown', () => {
  const r = answersFromGoal('sushi then drinks by the water');
  assert.equal(r.because['nightFood:japanese'], 'sushi');
  assert.equal(r.because['nightWhere:water'], 'by the water');
});

// ─── The pieces underneath ──────────────────────────────────────────────

test('a phrase is found only as whole words', () => {
  assert.ok(findPhrase('we want sushi tonight', 'sushi') >= 0);
  assert.equal(findPhrase('whisky tasting', 'ski'), -1);
});

test('negation looks back only as far as the clause it is in', () => {
  const text = 'no clubs, live music';
  assert.equal(isNegated(text, text.indexOf('clubs')), true);
  assert.equal(isNegated(text, text.indexOf('live music')), false);
});

test('the summary names what was taken, so nothing is assumed silently', () => {
  const r = answersFromGoal('dinner and live music, no big crowds');
  const line = summarise(r, (_q, option) => option);
  assert.match(line as string, /dinner/);
  assert.match(line as string, /no big crowds/);
});
