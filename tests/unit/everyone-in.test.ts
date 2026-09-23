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
