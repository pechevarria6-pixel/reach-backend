// ─── The Scout is promised only what Discover can show ──────────────────
// A place is named only when it has its own website, so food trucks never
// appear, and nothing we hold says when a place opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUIZ_SCREENS } from '../../lib/quiz-screens.ts';
import { DIAL_COPY, RESULT_COPY, RESTAURANT, dialLabel, scoreQuiz } from '../../lib/traveler-profile.ts';

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

// The words that tell two answers apart: not "the", not "I've".
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'i', "i've", 'ive', 'you', 'your', 'it', 'is', 'on', 'in', 'then', 'one', 'more', 'only', 'somewhere', 'spot', 'can\'t', 'where\'s']);
const words = (l: string) => new Set(l.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/)
  .map(w => w.replace(/'s$/, '').replace(/'$/, '').replace(/s$/, '')).filter(w => w.length > 2 && !STOP.has(w)));

// "Locals' favorite" and "The spot only locals know" on one screen: a person
// cannot tell them apart, and one gave nothing while the other gave the most
// Scout points.
test('no two answers on a single-answer screen share the word that sets them apart', () => {
  for (const s of QUIZ_SCREENS) {
    if (!s.blend || !s.options) continue;
    for (let i = 0; i < s.options.length; i++) for (let j = i + 1; j < s.options.length; j++) {
      const a = words(s.options[i].l), b = words(s.options[j].l);
      const shared = [...a].filter(w => b.has(w));
      assert.deepEqual(shared, [], `${s.id}: "${s.options[i].l}" and "${s.options[j].l}" both say ${shared.join(', ')}`);
    }
  }
});

// The reveal said "Nobody's heard of it" to whoever tapped "The spot only
// locals know", and "Off the beaten path" to whoever tapped "Somewhere I've
// never heard of".
test("the reveal's Finds dial says each screen-4 answer back in its own terms", () => {
  const restaurant = QUIZ_SCREENS.find(s => s.id === 'restaurant')!;
  const said = Object.fromEntries(restaurant.options!.map(o => [o.v, dialLabel('novelty', RESTAURANT[o.v as keyof typeof RESTAURANT].d.novelty)]));
  assert.deepEqual(said, {
    famous: 'Tried-and-true',
    locals: 'Neighborhood favorites',
    new: 'Somewhere new to you',
    truck: 'Local secrets',
  });
  // And no stop speaks in another answer's words.
  for (const o of restaurant.options!) {
    const stop = words(said[o.v]);
    for (const other of restaurant.options!) {
      if (other.v === o.v) continue;
      const echo = [...words(other.l)].filter(w => stop.has(w) && !words(o.l).has(w));
      assert.deepEqual(echo, [], `"${o.l}" is told "${said[o.v]}", which is "${other.l}"'s wording`);
    }
  }
  // A 🚚 is a food truck, which Discover never shows.
  assert.ok(!restaurant.options!.some(o => o.e === '🚚'));
});
