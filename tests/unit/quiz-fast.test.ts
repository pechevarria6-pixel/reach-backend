// ─── Every quiz screen takes more than one answer ────────────────────────
// The owner, 2026-09-25: "make it multiple choice availablity dont just have
// people have the option to only do 1". Six screens, about a minute; every
// screen can take several picks and ends with Done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUIZ_SCREENS, needsDone, onOptionPress, stepAfter } from '../../lib/quiz-screens.ts';
import { scoreQuiz } from '../../lib/traveler-profile.ts';

test('six screens, and every one ends with Done', () => {
  assert.equal(QUIZ_SCREENS.length, 6);
  assert.deepEqual(QUIZ_SCREENS.filter(s => !needsDone(s)).map(s => s.id), []);
});

test('no screen that asks about you is single-choice', () => {
  for (const s of QUIZ_SCREENS.filter(s => s.options)) {
    assert.ok(s.blend || s.multi, `${s.id} must take more than one answer`);
    assert.match(String(s.sub), /all that fit|as many/i, `${s.id} must say it takes more than one`);
  }
});

test('a tap adds, a second tap takes away, and nothing moves on by itself', () => {
  const one = onOptionPress({ picked: [], blending: false }, 'eat', 'tap');
  assert.deepEqual(one, { picked: ['eat'], advance: 'stay' });
  const two = onOptionPress({ picked: one.picked, blending: false }, 'wander', 'tap');
  assert.deepEqual(two.picked, ['eat', 'wander']);
  const back = onOptionPress({ picked: two.picked, blending: false }, 'eat', 'tap');
  assert.deepEqual(back.picked, ['wander']);
});

test('several picks blend in the score; one pick scores as it always did', () => {
  const blended = scoreQuiz({ first_move: ['eat', 'wander'], plan: ['loose', 'hourly'] });
  assert.ok(blended.scores.taster > 0 && blended.scores.scout > 0);
  assert.equal(blended.dials.pace, 63);
  const fixture = scoreQuiz({ first_move: 'eat', plan: 'daily' } as never, new Date(0));
  assert.deepEqual(scoreQuiz({ first_move: ['eat'], plan: ['daily'] }, new Date(0)), fixture);
});

test('the quiz screen has no hidden press-and-hold, and Done needs a pick on a pick-all screen', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  const start = app.indexOf('function TravelerQuizScreen(');
  const screen = app.slice(start, app.indexOf('function QuizReveal(', start));
  assert.doesNotMatch(screen, /onPointerDown/);
  assert.match(screen, /\{needsDone\(s\)&&\(/);
  assert.match(screen, /s\.blend&&!\(answers\[s\.field\]\|\|\[\]\)\.length/);
  assert.match(screen, /About a minute/);
  assert.match(screen, /\{step\+1\} of \{total\}/);
});

test('a pending move that outlives its screen goes nowhere', () => {
  const total = QUIZ_SCREENS.length;
  assert.equal(stepAfter(4, 5, total), null);
  assert.equal(stepAfter(total - 1, total - 1, total), 'finish');
  assert.equal(stepAfter(0, 0, total), 1);
});
