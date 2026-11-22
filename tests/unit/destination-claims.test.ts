// Run with: npm run test:unit
// Destination diversity, Task 4: a claim about a place needs its evidence,
// some claims are never allowed, and the "Why this" line is built in code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLAIM_EVIDENCE, BANNED_ALWAYS, unsupportedClaims, pitchHits, stripClaims, forbiddenClaimsLine, whyThisLine,
} from '../../lib/claims.ts';
import { tagPickersFrom, askedTags, fixedPlacesBlock } from '../../lib/destination-context.ts';

const ROUTE = readFileSync('app/api/trips/generate/route.ts', 'utf8');
const GUARD = readFileSync('scripts/check-vocabulary.mjs', 'utf8');
const APP = readFileSync('components/reach-app.jsx', 'utf8');

test('a claim stands only on its evidence; the always-banned never stand', () => {
  assert.deepEqual(unsupportedClaims('A less crowded coast in March', []), ['less crowded']);
  assert.deepEqual(unsupportedClaims('A less crowded coast in March', ['evidence:quiet-this-month']), []);
  assert.deepEqual(unsupportedClaims('Eco-friendly lodges', ['evidence:quiet-this-month']), ['eco-friendly']);
  assert.deepEqual(unsupportedClaims('A hidden gem', ['evidence:quiet-this-month', 'evidence:low-popularity']), ['hidden gem']);
  assert.deepEqual(unsupportedClaims('Great breweries and live music', []), []);
});

test('the pitch is checked field by field, and a second miss loses the sentence, not the card', () => {
  const trip = { tagline: 'Uncrowded beaches.', why_this_group: 'Breweries for everyone. Truly off the beaten path!', vibe: 'Easy' };
  const hits = pitchHits(trip, []);
  assert.deepEqual(hits.map(h => h.field), ['tagline', 'why_this_group']);
  assert.equal(stripClaims(trip.why_this_group, ['off the beaten path']), 'Breweries for everyone.');
  assert.equal(stripClaims(trip.tagline, ['uncrowded']), '');
});

test('the prompt forbids every phrase without any other file spelling one out', () => {
  const line = forbiddenClaimsLine();
  for (const p of [...Object.keys(CLAIM_EVIDENCE), ...BANNED_ALWAYS]) assert.ok(line.includes(`"${p}"`), p);
  assert.ok(fixedPlacesBlock([]).includes(line));
});

test('the vocabulary guard bans exactly the same phrases, everywhere but lib/claims.ts', () => {
  const listed = (GUARD.match(/const UNSUPPORTED_CLAIMS = \[([\s\S]*?)\];/)?.[1] ?? '').match(/'[^']+'/g)?.map(s => s.slice(1, -1)) ?? [];
  assert.deepEqual([...listed].sort(), [...BANNED_ALWAYS, ...Object.keys(CLAIM_EVIDENCE)].sort());
  assert.match(GUARD, /f === CLAIMS_HOME \? \[\] : UNSUPPORTED_CLAIMS/);
});

test('"Why this" is built from what was said and what we hold; no reasons, no line', () => {
  const pickers = tagPickersFrom([
    { favorite_activities: ['Breweries', 'Live music'] }, { favorite_activities: ['Breweries'] }, { favorite_activities: ['Breweries'] },
  ]);
  assert.equal(pickers['breweries'], 3);
  const ctx = { pickers, asked: [] as string[], solo: false, month: 3 };
  assert.equal(whyThisLine(['tag:breweries', 'tag:live music', 'evidence:quiet-this-month'], ctx), 'Three of you picked breweries · One of you picked live music · quiet in March');
  assert.equal(whyThisLine(['tag:outdoors'], { ...ctx, asked: askedTags('hiking weekend') }), 'You asked for outdoors');
  assert.equal(whyThisLine(['tag:breweries'], { pickers: { breweries: 1 }, asked: [], solo: true, month: null }), 'You picked breweries');
  assert.equal(whyThisLine([], ctx), null);
  assert.equal(whyThisLine(['evidence:low-popularity'], { ...ctx, month: null }), null, 'nothing a member said, nothing to say');
});

test('the route checks the pitch, rewrites once, strips the rest, and builds the line in code', () => {
  const at = ROUTE.indexOf('pitchHits(t as Record<string, unknown>, t.why_reasons)');
  assert.ok(at > 0);
  const block = ROUTE.slice(at, at + 4000);
  assert.ok(block.indexOf('askForJSON(') < block.indexOf('stripClaims('), 'rewrite first, strip second');
  assert.match(block, /whyThisLine\(t\.why_reasons/);
  assert.match(APP, /Why this: \{trip\.why_this\}/);
});
