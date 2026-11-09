// Run with: npm run test:unit
// UX F19-03 (S1): a server error must never read as an empty account.
// With /api/groups failing, Groups said "Nothing planned yet — Start planning"
// and Home said "Three ways to start", inviting a duplicate of trips we had
// simply failed to fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync('components/reach-app.jsx', 'utf8');
const fn = (name: string) => {
  const i = APP.indexOf(`function ${name}(`);
  assert.ok(i >= 0, name);
  return APP.slice(i, APP.indexOf('\nfunction ', i + 10));
};

test('a failed load is recorded, separately from loading and from empty', () => {
  const load = APP.slice(APP.indexOf('const loadGroups=async()=>{'), APP.indexOf('const loadGroups=async()=>{') + 3000);
  assert.match(load, /if\(!res\.ok\)\{setGroupsError\(true\)/);
  assert.match(load, /catch\(e\)\{[^}]*setGroupsError\(true\)/);
  assert.match(load, /setGroupsError\(false\)/, 'a good answer clears it');
});

test('Groups shows the retry, not "Nothing planned yet", when the load failed', () => {
  const g = fn('GroupsScreen');
  assert.match(g, /loadFailed&&<TripsLoadFailed onRetry=\{onRetry\}\/>/);
  assert.match(g, /!loading&&groups\.length===0&&!loadFailed&&\(/, 'the empty state is gated on not-failed');
  assert.match(g, /!\(loadFailed&&groups\.length===0\)/, 'no "+ New" over a failed load');
});

test('Home shows the retry, not "Three ways to start", when the load failed', () => {
  const h = fn('HomeScreen');
  assert.match(h, /loadFailed&&<TripsLoadFailed onRetry=\{onRetry\}\/>/);
  assert.match(h, /groups\.length===0&&!loading&&!loadFailed&&\(<>/);
});

test('the card says what happened and offers only the retry', () => {
  const c = fn('TripsLoadFailed');
  assert.match(c, /We couldn't load your trips/);
  assert.match(c, /Try again/);
  assert.equal(/createGroup|Start planning/.test(c), false);
});

test('both screens are handed the state and the retry, and onboarding is not triggered by a failure', () => {
  assert.equal((APP.match(/loadFailed=\{groupsError\} onRetry=\{loadGroups\}/g) ?? []).length, 2);
  assert.match(APP, /if\(groupsError\)return;/);
});
