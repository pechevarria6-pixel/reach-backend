import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voteOpenedNote } from '../../lib/vote-complete.ts';

// The QA run on 2026-11-05: A sent the Charleston trip to the group for a
// vote (PATCH { status: "voting" }, 200) and B heard nothing — no bell, no
// phone. The vote waits on B, and B had no way to know it was open short of
// opening the app on the right screen.

test('opening a vote tells the rest of the group, by name, with the options and a way in', () => {
  const note = voteOpenedNote({
    planId: 'p1', groupId: 'g1', title: 'Charleston long weekend', by: 'Test', night: false,
    options: ['Downtown Charleston', 'Folly Beach', 'Mount Pleasant'],
  });
  assert.equal(note.kind, 'vote_open');
  assert.equal(note.title, 'Test wants your vote');
  assert.equal(note.body, 'Downtown Charleston · Folly Beach · Mount Pleasant — vote on Charleston long weekend.');
  assert.equal(note.url, '/home?vote=p1&group=g1');
  assert.equal(note.planId, 'p1');
});

test('with no name or no options it still says only what is true', () => {
  const note = voteOpenedNote({ planId: 'p1', groupId: 'g1', title: 'Where next?', by: null, night: true, options: [] });
  assert.equal(note.title, 'The vote is open');
  assert.equal(note.body, 'Vote on your next night out.');
});

const route = readFileSync('app/api/plans/[planId]/route.ts', 'utf8');

test('the plan route announces a vote it opened, once, to everybody but whoever opened it', () => {
  // Only the request that moved the status: a double tap is two requests.
  assert.match(route, /if \(openingVote\) q = q\.neq\('status', 'voting'\);/);
  const send = route.indexOf('voteOpenedNote(');
  assert.ok(send > 0, 'the route sends the vote-open note');
  const guard = route.lastIndexOf('if (openingVote && !writeError && updated', send);
  assert.ok(guard > 0 && send - guard < 600, 'only after the write that opened it');
});
