// Run with: npm run test:unit
// Nightlife on the quiz's "What are you into?" screen (owner, 2026-11-08).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Q2_TILES, INTEREST_ARCHETYPE } from '../../lib/traveler-profile.ts';
import { tasteFrom } from '../../lib/discovery/taste.ts';

test('the quiz offers a night out: bars, clubs and breweries, in full rows of three', () => {
  for (const t of ['Bars & cocktails', 'Clubs & dancing', 'Breweries']) {
    assert.ok((Q2_TILES as readonly string[]).includes(t), t);
    assert.ok(INTEREST_ARCHETYPE[t], `${t} counts towards a kind of traveller`);
  }
  assert.equal(Q2_TILES.length % 3, 0, 'the grid is three wide');
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /\{id:"bars",e:"🍸",l:"Bars & cocktails"\}/, 'every tile has its emoji');
  assert.match(app, /\{id:"clubs",e:"🪩",l:"Clubs & dancing"\}/);
});

test('a nightlife tile means the places it names, and the nos still win', () => {
  assert.deepEqual(tasteFrom({ favorite_activities: ['Bars & cocktails'] }).interests, ['cocktail bars', 'pubs']);
  assert.deepEqual(tasteFrom({ favorite_activities: ['Clubs & dancing'] }).interests, ['nightclubs', 'dancing']);
  assert.deepEqual(tasteFrom({ favorite_activities: ['Bars & cocktails', 'Clubs & dancing'], drink_style: 'Not drinking' }).interests, ['dancing']);
  assert.deepEqual(tasteFrom({ favorite_activities: ['Clubs & dancing'], no_way_jose: ['Clubs'] }).interests, ['dancing']);
});
