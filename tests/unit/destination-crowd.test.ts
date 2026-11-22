// Run with: npm run test:unit
// Destination diversity, Task 5: "Busy places?" — one quiz screen, pick all
// that fit (the owner's rule for every screen), blended into one stored
// answer the selector reads; editable in Profile; skippable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crowdFromPicks, CROWD_OPTIONS } from '../../lib/crowd-tolerance.ts';
import { QUIZ_SCREENS, needsDone } from '../../lib/quiz-screens.ts';
import { QuizAnswers } from '../../lib/contracts/traveler-profile.ts';

const STORE = readFileSync('lib/quiz-store.ts', 'utf8');
const ROUTE = readFileSync('app/api/trips/generate/route.ts', 'utf8');
const APP = readFileSync('components/reach-app.jsx', 'utf8');

test('picks blend into one answer; nothing picked is not an answer', () => {
  assert.equal(crowdFromPicks(['avoid']), 'avoid');
  assert.equal(crowdFromPicks(['love']), 'love');
  assert.equal(crowdFromPicks(['fine']), 'fine');
  assert.equal(crowdFromPicks(['love', 'avoid']), 'fine');
  assert.equal(crowdFromPicks(['love', 'fine']), 'love');
  assert.equal(crowdFromPicks(['avoid', 'fine']), 'avoid');
  assert.equal(crowdFromPicks('avoid'), 'avoid');
  assert.equal(crowdFromPicks([]), null);
  assert.equal(crowdFromPicks(['loud']), null, 'only the offered answers count');
  assert.equal(crowdFromPicks(null), null);
});

test('one screen, before "No way, José", pick all that fit and Done', () => {
  const at = QUIZ_SCREENS.findIndex(s => s.id === 'crowd');
  assert.equal(at, QUIZ_SCREENS.findIndex(s => s.id === 'no_way') - 1);
  const s = QUIZ_SCREENS[at];
  assert.equal(s.title, 'Busy places?');
  assert.ok(s.blend && needsDone(s));
  assert.deepEqual(s.options!.map(o => o.l), ['Love the buzz', "Don't mind", 'Rather avoid']);
  assert.deepEqual(CROWD_OPTIONS.map(o => o.v), ['love', 'fine', 'avoid']);
  // The screens other code reaches by position have not moved.
  assert.deepEqual([0, 2, 3, 4].map(i => QUIZ_SCREENS[i].id), ['first_move', 'plan', 'restaurant', 'late']);
});

test('the contract keeps the picks, so Profile can show them after a reload', () => {
  const p = QuizAnswers.safeParse({ crowd: ['love', 'avoid'] });
  assert.ok(p.success && JSON.stringify(p.data.crowd) === JSON.stringify(['love', 'avoid']));
  assert.equal(QuizAnswers.safeParse({ crowd: ['loud'] }).success, false);
});

test('saved where the selector reads it, only when this request answered it', () => {
  assert.match(STORE, /if \(req\.answers && 'crowd' in req\.answers\) v3\.crowd_tolerance = crowdFromPicks\(req\.answers\.crowd\);/);
  assert.match(STORE, /quiz_skipped_at\|crowd_tolerance/, 'before the migration, a missing column falls back rather than failing the save');
  assert.match(ROUTE, /trip_summary,crowd_tolerance\)`/);
  assert.match(APP, /<CrowdSetting saved=\{profileQuiz\.answers\?\.crowd\}/);
  assert.match(APP, /postQuiz\(\{answers:\{crowd:sel\}\}\)/);
});
