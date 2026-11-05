// Run with: npm run test:unit
// The third live walk, 2026-11-05: what it found after 07dc497 and 1658bea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('components/reach-app.jsx', 'utf8');
const gen = readFileSync('app/api/trips/generate/route.ts', 'utf8');

test('"Find them →" on a plan for one finds, instead of a locked button under "Everyone answers first"', () => {
  assert.match(app, /const ready=isSolo\?\(!!answered&&answered\.allReady!==false\)/);
  assert.doesNotMatch(app, /if\(!find\|\|findAsked\.current\|\|step!=="wait"\|\|generating\|\|isSolo\)return;/);
  assert.match(app, /const allAnswered=isSolo\s*\n\s*\?\(!!answered&&answered\.allReady!==false\)/);
  assert.match(app, /isSolo\?"Your trip ideas":"Everyone answers first"/);
  assert.match(app, /isSolo\?\(nightWait\?"Find my nights out":"Find my trips"\)/);
});

test('a plan for one keeps the ideas it found, and tells nobody else about them', () => {
  assert.match(gen, /if \(groupPlan && ideasAvailable\) \{/);
  assert.match(gen, /if \(isGroup\) await tellTheGroup\(/);
});

test('the group list names the options of a vote instead of drawing counts it never has', () => {
  const at = app.indexOf('plan.status==="voting"&&!plan.hasIdeas&&plan.options.length>0');
  assert.ok(at > 0);
  const block = app.slice(at, at + 600);
  assert.doesNotMatch(block, /plan\.votes\[opt\]/);
  assert.match(block, /Vote in progress: /);
});

test('a cached gig says its venue once', () => {
  const cache = readFileSync('lib/discovery/cache.ts', 'utf8');
  assert.match(cache, /!String\(e\.when_text \?\? ''\)\.toLowerCase\(\)\.includes\(String\(venue\.name\)\.toLowerCase\(\)\)/);
});
