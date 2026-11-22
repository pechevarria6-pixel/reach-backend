// Run with: npm run test:unit
// REACH-DESTINATION-DIVERSITY-2026-11-22, Part B: "Why this" reaches the card.
// The line is built in code from the selector's reasons (lib/claims.ts
// whyThisLine). A fact the app holds and does not pass on is this codebase's
// commonest bug (CLAUDE.md), so this follows why_this from the generator's
// option, through the saved set on the plan, to the card — on first showing
// and on coming back to the Vote tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ideasFrom, readIdeas } from '../../lib/trip-vote.ts';
import { whyThisLine } from '../../lib/claims.ts';

const APP = readFileSync('components/reach-app.jsx', 'utf8');
const GEN = readFileSync('app/api/trips/generate/route.ts', 'utf8');

test('the generator writes why_this from code, never from the model', () => {
  assert.match(GEN, /t\.why_this = why \? whyThisLine\(t\.why_reasons/);
  assert.equal(typeof whyThisLine, 'function');
});

test('why_this survives saving the ideas and reading them back', () => {
  const trips = [
    { destination: 'Asheville', tier: 'mid', why_this: 'Breweries and trails, about 5 hours away.', why_reasons: ['tag:breweries'] },
    { destination: 'Savannah', tier: 'mid', why_this: null },
  ];
  const saved = ideasFrom(trips, { set: 's1', foundBy: 'u', foundAt: '2026-11-22T00:00:00Z', mode: 'trip' });
  const back = readIdeas(JSON.parse(JSON.stringify(saved)));
  assert.ok(back);
  assert.equal((back!.options[0] as Record<string, unknown>).why_this, 'Breweries and trails, about 5 hours away.');
  assert.equal((back!.options[1] as Record<string, unknown>).why_this, null);
});

test('the card shows it labelled, and only when there is a sentence', () => {
  assert.match(APP, /\{typeof trip\.why_this==="string"&&trip\.why_this&&\(/);
  assert.match(APP, /Why this: \{trip\.why_this\}/);
});

test('both places the card is drawn hand it the whole option', () => {
  // The Vote tab spreads the saved option; the options screen passes it as is.
  assert.match(APP, /<TripIdeaCard key=\{o\.id\} trip=\{\{\.\.\.o,/);
  assert.match(APP, /<TripIdeaCard key=\{trip\.id\} trip=\{trip\}/);
});
