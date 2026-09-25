// ─── The quiz stays fast ─────────────────────────────────────────────────
// Six screens, about a minute. Only screen 2 (interests) and screen 6 (No
// way, José) need a Done tap; every other screen goes on when tapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUIZ_SCREENS, needsDone, onOptionPress, stepAfter, BLEND_WINDOW_MS } from '../../lib/quiz-screens.ts';
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

// Hold "Asleep" on screen 5 to start a blend, then tap Skip inside the 1.5 s
// window. Skip moved to screen 6; the blend's timer, still running, then
// added one more — step 6, QUIZ_SCREENS[6] undefined, and the quiz crashed.
// On screens 1 and 3 the same move jumped a whole screen.
test('a blend timer that outlives its screen goes nowhere', () => {
  const total = QUIZ_SCREENS.length;
  const late = QUIZ_SCREENS.findIndex(s => s.id === 'late');
  assert.equal(late, 4);
  // Skip ran first: the person is on screen 6 when the timer fires.
  assert.equal(stepAfter(late, late + 1, total), null, 'stale timer must not advance');
  assert.equal(stepAfter(0, 1, total), null, 'screen 1 hold + Skip must not jump screen 2');
  // Back ran first.
  assert.equal(stepAfter(2, 1, total), null);
  // A timer that fires on its own screen goes on, and the last one finishes.
  assert.equal(stepAfter(late, late, total), late + 1);
  assert.equal(stepAfter(total - 1, total - 1, total), 'finish');
  // Never a step past the last screen, whatever it is handed.
  for (let armed = 0; armed < total; armed++) for (let now = 0; now < total; now++) {
    const to = stepAfter(armed, now, total);
    assert.ok(to === null || to === 'finish' || (to >= 0 && to < total));
  }
});

test('Skip and Back cancel a pending advance, and the timers carry the screen they were armed on', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  const skip = app.slice(app.indexOf('const skip=()=>{'), app.indexOf('const eatEverything=()=>{'));
  assert.ok(skip.length > 0);
  assert.match(skip, /cancelPending\(\)/, 'Skip must cancel the blend timer');
  assert.match(app, /const cancelPending=\(\)=>\{clearTimeout\(advanceTimer\.current\);/);
  assert.match(app, /onClick=\{\(\)=>\{cancelPending\(\);setStep\(n=>Math\.max\(0,n-1\)\);\}\} aria-label="Previous question"/);
  assert.match(app, /setTimeout\(\(\)=>next\(final,sk,armedOn\),170\)/);
  assert.match(app, /setTimeout\(\(\)=>next\(final,sk,armedOn\),BLEND_WINDOW_MS\)/);
  assert.match(app, /const to=stepAfter\(from,stepNow\.current,total\);\s*if\(to===null\)return;/);
});
