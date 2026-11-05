import { test } from 'node:test';
import assert from 'node:assert/strict';
import { everyoneIn } from '../../lib/everyone-in.ts';

test('only when every member has answered', () => {
  assert.equal(everyoneIn(['a', 'b', 'c'], ['a', 'b']), false);
  assert.equal(everyoneIn(['a', 'b', 'c'], ['c', 'a', 'b']), true);
});
test('a group of one is never announced to', () => {
  assert.equal(everyoneIn(['a'], ['a']), false);
});
test('an answer from somebody no longer in the group does not count', () => {
  assert.equal(everyoneIn(['a', 'b'], ['a', 'x']), false);
});

import { readFileSync } from 'node:fs';
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('leaving or being removed announces a trip that was waiting only on them', () => {
  const route = read('app/api/groups/[id]/members/route.ts');
  const del = route.slice(route.indexOf('export async function DELETE'));
  assert.ok(del.indexOf('announceWhereLeavingCompletesAnswers(') > del.indexOf(".delete().eq('group_id'"),
    'after the member is gone, so they are not counted or told');
  const lib = read('lib/everyone-in.ts');
  const fn = lib.slice(lib.indexOf('export async function announceWhereLeavingCompletesAnswers'));
  assert.match(fn, /announceIfEveryoneIn\(/, 'by the same rule as an answer');
});

test('"Everyone\'s in" never says the ideas are built before anybody pressed Find', () => {
  assert.doesNotMatch(read('lib/everyone-in.ts'), /ideas are built/);
});
