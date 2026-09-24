import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreQuiz, dialsSetBy } from '../../lib/traveler-profile.ts';
import { QuizAnswers } from '../../lib/contracts/traveler-profile.ts';

test('two first moves blend into two archetypes, with the screen\'s weight shared', () => {
  const one = scoreQuiz({ first_move: 'eat' });
  const two = scoreQuiz({ first_move: ['eat', 'wander'] });
  assert.equal(two.scores.taster + two.scores.scout, one.scores.taster);
  assert.ok(two.scores.taster > 0 && two.scores.scout > 0);
});

test('picking everything is not a louder answer than picking one', () => {
  const all = scoreQuiz({ first_move: ['eat', 'wander', 'famous', 'slow', 'group'] });
  const total = Object.values(all.scores).reduce((a, b) => a + b, 0);
  const single = Object.values(scoreQuiz({ first_move: 'eat' }).scores).reduce((a, b) => a + b, 0);
  assert.ok(total <= single + 1e-9);
});

test('a dial is the average of where the picks put it', () => {
  assert.equal(scoreQuiz({ plan: ['loose', 'hourly'] }).dials.pace, 63);
  assert.equal(scoreQuiz({ late: ['asleep', 'next_spot'] }).dials.energy, 45);
  assert.equal(scoreQuiz({ plan: 'daily' }).dials.pace, 50);
  assert.deepEqual(scoreQuiz({ plan: ['loose'] }).unanswered.includes('pace'), false);
});

test('one pick given as a string or a list of one scores the same', () => {
  const a = scoreQuiz({ restaurant: 'new' }, new Date(0));
  const b = scoreQuiz({ restaurant: ['new'] }, new Date(0));
  assert.deepEqual(a, b);
});

test('unknown picks are ignored in the score and refused at the door', () => {
  assert.equal(scoreQuiz({ plan: ['nonsense' as never] }).unanswered.includes('pace'), true);
  assert.equal(QuizAnswers.safeParse({ plan: ['loose', 'nonsense'] }).success, false);
  assert.equal(QuizAnswers.safeParse({ plan: ['loose', 'hourly'] }).success, true);
  assert.equal(QuizAnswers.safeParse({ plan: [] }).success, false);
});

test('a blended answer still says which dials it set', () => {
  assert.deepEqual(dialsSetBy({ plan: ['loose', 'hourly'], late: ['asleep'] }), ['pace', 'energy']);
});
