// ─── The Scout is promised only what Discover can show ──────────────────
// A place is named only when it has its own website, so food trucks never
// appear, and nothing we hold says when a place opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUIZ_SCREENS } from '../../lib/quiz-screens.ts';
import { DIAL_COPY, RESULT_COPY, scoreQuiz } from '../../lib/traveler-profile.ts';

test('screen 4 offers only what Discover can surface, and the answers still score', () => {
  const restaurant = QUIZ_SCREENS.find(s => s.id === 'restaurant')!;
  const label = (v: string) => restaurant.options!.find(o => o.v === v)!.l;
  assert.equal(label('truck'), 'The spot only locals know');
  assert.equal(label('new'), "Somewhere I've never heard of");
  assert.equal(scoreQuiz({ restaurant: 'truck' }).dials.novelty, 95);
  assert.equal(scoreQuiz({ restaurant: 'new' }).dials.novelty, 80);
});

test('no Scout copy promises new openings or food trucks, and the guard bans both', () => {
  const said = [
    RESULT_COPY.scout.line,
    ...DIAL_COPY.novelty.stops.map(([, l]) => l),
    ...QUIZ_SCREENS.flatMap(s => (s.options ?? []).map(o => o.l)),
  ].join(' | ').toLowerCase();
  for (const p of ['food truck', 'opened last month', 'new opening']) assert.ok(!said.includes(p), p);
  const guard = readFileSync('scripts/check-vocabulary.mjs', 'utf8');
  for (const p of ["'food truck'", "'opened last month'", "'new openings'"]) assert.ok(guard.includes(p), `check:vocabulary bans ${p}`);
});
