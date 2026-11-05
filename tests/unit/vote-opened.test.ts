import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voteOpenedNote, voteOpenedNotes } from '../../lib/vote-complete.ts';

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
  const send = route.indexOf('voteOpenedNotes(');
  assert.ok(send > 0, 'the route sends the vote-open notes');
  const guard = route.lastIndexOf('if (openingVote && !writeError && updated', send);
  assert.ok(guard > 0 && send - guard < 1200, 'only after the write that opened it');
  // Who may vote now is read, not assumed: POST /vote refuses until everyone's in.
  assert.ok(route.slice(guard, send).includes('planReadiness('), 'readiness is read before anybody is told to vote');
});

// The 5 November walk again: the vote was opened while B had not answered.
// B heard "Test wants your vote" and POST /vote answered 403.
const base = {
  planId: 'p1', groupId: 'g1', title: 'Charleston long weekend', by: 'Test', night: false,
  options: ['Downtown Charleston', 'Folly Beach'], actorId: 'a', memberIds: ['a', 'b', 'c'],
};

test('a vote opened before everyone is in asks the waiting member for answers, not a vote', () => {
  const sends = voteOpenedNotes({ ...base, readiness: { allReady: false, members: [
    { userId: 'a', ready: true }, { userId: 'b', ready: false }, { userId: 'c', ready: true },
  ] } });
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].to, ['b'], 'c has answered and cannot vote yet either: told nothing');
  assert.equal(sends[0].note.kind, 'prefs');
  assert.doesNotMatch(sends[0].note.title, /vote/i);
  assert.equal(sends[0].note.title, 'Test is waiting on you');
  assert.match(sends[0].note.body ?? '', /Say what you want from Charleston long weekend/);
  assert.equal(sends[0].note.url, '/home?answer=p1');
});

test('everybody in: everybody but the opener hears "wants your vote"', () => {
  const sends = voteOpenedNotes({ ...base, readiness: { allReady: true, members: [] } });
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].to, ['b', 'c']);
  assert.equal(sends[0].note.title, 'Test wants your vote');
});

test('a readiness read that failed tells nobody anything', () => {
  assert.deepEqual(voteOpenedNotes({ ...base, readiness: null }), []);
});
