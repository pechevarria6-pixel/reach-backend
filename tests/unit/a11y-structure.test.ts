// Run with: npm run test:unit
// REACH-ACCESSIBILITY-PALETTE-2026-11-22, Task 4: structure and interaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterSignUp, startKind } from '../../lib/after-sign-up.ts';

const APP = readFileSync('components/reach-app.jsx', 'utf8');
const LANDING = readFileSync('app/page.tsx', 'utf8');
const ONBOARDING = readFileSync('app/(app)/onboarding/page.tsx', 'utf8');

test('the front page\'s three kinds are links into sign-up, each carrying its kind', () => {
  for (const k of ['night', 'weekend', 'trip']) assert.match(LANDING, new RegExp(`<Link href="/sign-up\\?kind=${k}">`));
  assert.doesNotMatch(LANDING, /<span>🍽️ A night out<\/span>/, 'no longer plain text that looks tappable');
});

test('kind is one of three words, carried through sign-up and onboarding, never a path', () => {
  assert.equal(afterSignUp('?kind=night'), '/onboarding?kind=night');
  assert.equal(afterSignUp('?kind=%2Fhome'), '/onboarding');
  assert.equal(afterSignUp('?kind=https%3A%2F%2Fevil.example'), '/onboarding');
  assert.equal(afterSignUp('?redirect_url=%2Finvite%2FAbC_123-xyzDEF&kind=trip'), '/onboarding?next=%2Finvite%2FAbC_123-xyzDEF&kind=trip');
  assert.equal(startKind('weekend'), 'weekend');
  assert.equal(startKind('restaurant'), null);
  assert.match(ONBOARDING, /if \(kind\) \{ router\.push\(`\/home\?kind=\$\{kind\}`\); return; \}/);
  assert.match(APP, /if\(kind==="night"\)push\("createPlan",\{fresh:true,evening:true\}\);/);
});

test('every screen title and section label is a heading', () => {
  assert.doesNotMatch(APP, /<div className="pt"(?! role="heading" aria-level=\{1\})/);
  assert.doesNotMatch(APP, /className="sl"(?! role="heading" aria-level=\{2\})/);
  assert.match(APP, /<div className="display" role="heading" aria-level=\{1\}/, 'Home\'s greeting');
  assert.match(LANDING, /<h2 className="lp-eyebrow" id="lp-how-title">How it works<\/h2>/);
});

test('switches and choices say their state in words, not colour alone', () => {
  assert.match(APP, /role="switch" aria-checked=\{!!c\[t\.k\]\}/);
  assert.match(APP, /\{c\[t\.k\]\?"On":"Off"\}/);
  assert.equal((APP.match(/aria-pressed=\{!!\(selected\|\|isVeto\)\}/g) ?? []).length, 2);
});

test('small controls have a 44px target, and focus is visible on every kind of control', () => {
  assert.match(APP, /\.bsm\{min-height:44px;/);
  assert.match(APP, /\[role="switch"\]:focus-visible/);
  assert.match(APP, /\.inp:focus-visible\{outline:2px solid \$\{C\.accentText\}/);
  assert.match(LANDING, /\.lp-kinds a\{[^}]*min-height:44px/);
});

test('no field is labelled by its placeholder alone', () => {
  const fields = [...APP.matchAll(/<input\b[^>]*placeholder=/g)].length;
  assert.ok(fields > 0);
  assert.ok((APP.match(/className="fl-t"/g) ?? []).length >= 16);
});
