// ─── The quiz stays fast ─────────────────────────────────────────────────
// Six screens, about a minute. Only screen 2 (interests) and screen 6 (No
// way, José) need a Done tap; every other screen goes on when tapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUIZ_SCREENS, needsDone, onOptionPress, BLEND_WINDOW_MS } from '../../lib/quiz-screens.ts';
import { scoreQuiz } from '../../lib/traveler-profile.ts';

/**
 * A scripted run: the fewest taps that answer every screen. A single-answer
 * screen is one tap, and it must advance by itself; a Done screen is one
 * answer and Done.
 */
function scriptedRun(picks: Record<string, string>) {
  let taps = 0;
  const answers: Record<string, unknown> = {};
  for (const s of QUIZ_SCREENS) {
    if (needsDone(s)) {
      taps += 1; // one answer
      taps += 1; // Done
      if (s.id === 'interests') answers.interests = [picks.interests];
      continue;
    }
    const r = onOptionPress({ picked: [], blending: false }, picks[s.field!], 'tap');
    taps += 1;
    assert.equal(r.advance, 'now', `${s.id} must go on after one tap`);
    answers[s.field!] = r.picked;
  }
  return { taps, answers };
}

test('six screens, and only interests and No way, José need Done', () => {
  assert.equal(QUIZ_SCREENS.length, 6);
  assert.deepEqual(QUIZ_SCREENS.filter(needsDone).map(s => s.id), ['interests', 'no_way']);
  assert.deepEqual(QUIZ_SCREENS.map((s, i) => [i + 1, needsDone(s)]).filter(([, d]) => d).map(([n]) => n), [2, 6]);
});

test('a scripted run through all six screens takes exactly 8 taps, and scores as the fixtures do', () => {
  const picks = { first_move: 'eat', interests: 'Live music', plan: 'daily', restaurant: 'locals', late: 'asleep' };
  const { taps, answers } = scriptedRun(picks);
  assert.equal(taps, 8);
  // Arrays of one from single taps score exactly as the scalar fixtures.
  const fixture = scoreQuiz({ first_move: 'eat', interests: ['Live music'], plan: 'daily', restaurant: 'locals', late: 'asleep' } as never, new Date(0));
  assert.deepEqual(scoreQuiz(answers as never, new Date(0)), fixture);
  assert.equal(fixture.dials.pace, 50);
});

test('a hold starts a blend, and taps within the window add to it', () => {
  const held = onOptionPress({ picked: ['eat'], blending: false }, 'wander', 'hold');
  assert.deepEqual(held, { picked: ['wander'], advance: 'after-window' });
  const more = onOptionPress({ picked: held.picked, blending: true }, 'eat', 'tap');
  assert.deepEqual(more, { picked: ['wander', 'eat'], advance: 'after-window' });
  const less = onOptionPress({ picked: more.picked, blending: true }, 'wander', 'tap');
  assert.deepEqual(less.picked, ['eat']);
  assert.equal(BLEND_WINDOW_MS, 1500);
  // A blend saved before still scores.
  assert.ok(scoreQuiz({ first_move: ['eat', 'wander'] }).scores.scout > 0);
});

test('the quiz screen renders Done only where needsDone says, and says how long and how far', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  const start = app.indexOf('function TravelerQuizScreen(');
  const screen = app.slice(start, app.indexOf('function QuizReveal(', start));
  assert.match(screen, /\{needsDone\(s\)&&\(/);
  assert.doesNotMatch(screen, /s\.blend\|\|/);
  assert.doesNotMatch(screen, /s\.blend\?toggle/);
  assert.match(screen, /\{\.\.\.pressProps\(o\.v\)\}/);
  assert.match(screen, /About a minute/);
  assert.match(screen, /\{step\+1\} of \{total\}/);
  assert.match(screen, /trackEvent\("quiz_completed",\{duration_ms:Date\.now\(\)-started\.current/);
});
