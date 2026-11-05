// Run with: npm run test:unit
//
// Where a vote was lost, counted twice, or ignored outside the one place
// that already counted it properly (tallyVotes, behind GET /vote). Each
// test here is a screen or a notification that was reading the raw votes
// table, or a rule the server did not hold:
//
//   - the plan's own GET, which a set-place vote's screen reads, counted
//     a vote from somebody who had left and a vote on an option no longer
//     on the list — "The group picked Porto — 3 of 3" with one of the three
//     gone and another never asked
//   - the nudge faces counted the same stale rows as "voted", so a member
//     the vote screen lists as still to vote could not be reminded
//   - any member could close a set-place vote (status off 'voting') or
//     rewrite its options mid-vote: the organiser's act, done by anybody
//   - "Everyone has voted … The pick is yours" on a vote with no pick, and
//     "Most votes: X" with no word of the vetoes the card shows beside it
//   - the next step said "Vote →" while the server refused every vote,
//     waiting on a member who had not answered
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planTally, votedMembers, patchDecides, everyoneVotedCopy, ideasFrom } from '../../lib/trip-vote.ts';
import { getNextAction, type NextActionInput } from '../../lib/next-action.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// ─── The plan's own tally ────────────────────────────────────────────────

test('the plan GET counts only votes on the options, from people still in the group', () => {
  const plan = { vote_options: ['Lisbon', 'Porto'] };
  const t = planTally({
    plan,
    memberIds: ['a', 'b', 'c'],
    me: 'c',
    votes: [
      { user_id: 'a', option: 'Porto' },
      // Left the group after voting.
      { user_id: 'gone', option: 'Porto' },
      // Voted on an option no longer on the list.
      { user_id: 'c', option: 'Madrid' },
    ],
  });
  assert.deepEqual(t.votes, { Lisbon: 0, Porto: 1 });
  assert.equal(t.totalVotes, 1, 'one member has a vote on something anybody can see');
  assert.equal(t.myVote, null, 'a vote on an option that is gone is not a vote — it would lock the card');
});

test('with saved ideas the plan GET counts on their titles, whatever vote_options says', () => {
  const saved = ideasFrom([{ destination: 'Lisbon' }, { destination: 'Porto' }], { set: 'S', foundBy: 'a', foundAt: '', mode: 'trip' });
  const t = planTally({
    plan: { trip_options: saved, vote_options: ['Cancun'] },
    memberIds: ['a', 'b'], me: 'a',
    votes: [{ user_id: 'a', option: 'Lisbon' }, { user_id: 'b', option: 'Cancun' }],
  });
  assert.deepEqual(t.votes, { Lisbon: 1, Porto: 0 });
  assert.equal(t.totalVotes, 1);
  assert.equal(t.myVote, 'Lisbon');
});

test('GET /api/plans/[id] answers its tally from planTally, not from the raw rows', () => {
  const route = read('app/api/plans/[planId]/route.ts');
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function PATCH'));
  assert.match(get, /planTally\(/);
  assert.doesNotMatch(get, /tally\[v\.option\]/, 'the hand-rolled count is gone');
});

// ─── Who the nudge counts as having voted ───────────────────────────────

test('a vote on an option that is gone does not make somebody "already voted"', () => {
  const who = votedMembers({
    plan: { vote_options: ['Lisbon', 'Porto'] },
    memberIds: ['a', 'b', 'c'],
    votes: [{ user_id: 'a', option: 'Lisbon' }, { user_id: 'b', option: 'Madrid' }, { user_id: 'gone', option: 'Porto' }],
  });
  assert.deepEqual([...who].sort(), ['a']);
});

test('the nudge reads who has voted the way the vote screen does', () => {
  const notify = read('app/api/plans/[planId]/notify/route.ts');
  const standing = notify.slice(notify.indexOf('async function standing'), notify.indexOf('async function loadPlan'));
  assert.match(standing, /votedMembers\(/);
});

// ─── Closing a vote on a set place ──────────────────────────────────────

test('closing an open vote on a set place, or rewriting its options, is the organiser\'s', () => {
  const open = { undecided: false, onlyIfUndecided: false, pickOption: null, voteOpen: true };
  assert.equal(patchDecides({ ...open, fields: { status: 'approved' } }), true, 'locking it in closes the vote');
  assert.equal(patchDecides({ ...open, fields: { status: 'planning' } }), true);
  assert.equal(patchDecides({ ...open, fields: { vote_options: ['Somewhere else'] } }), true);
  // Anything else while the vote is open is anybody's.
  assert.equal(patchDecides({ ...open, fields: { status: 'voting' } }), false);
  assert.equal(patchDecides({ ...open, fields: { title: 'Summer' } }), false);
  // No vote open: the vote list on a decided plan is still anybody's.
  assert.equal(patchDecides({ ...open, voteOpen: false, fields: { vote_options: ['A'] } }), false);
  assert.equal(patchDecides({ ...open, voteOpen: false, fields: { status: 'approved' } }), false);
});

test('the plan PATCH tells patchDecides whether a vote is open', () => {
  const route = read('app/api/plans/[planId]/route.ts');
  assert.match(route, /voteOpen:\s*plan\.status === 'voting'/);
});

// ─── "Everyone has voted", as the organiser is told it ──────────────────

test('a vote on where says the pick is theirs; a vote on a set place has no pick', () => {
  const where = everyoneVotedCopy({ undecided: true, leader: 'Porto', tied: [], vetoes: { Porto: 0 }, shown: t => t });
  assert.equal(where, 'Most votes: Porto. The pick is yours.');
  const set = everyoneVotedCopy({ undecided: false, leader: 'Porto', tied: [], vetoes: {}, shown: t => t });
  assert.doesNotMatch(set, /pick/i);
  assert.match(set, /Most votes: Porto/);
  const tie = everyoneVotedCopy({ undecided: true, leader: null, tied: ['A', 'B'], vetoes: {}, shown: t => t });
  assert.match(tie, /tie between A and B/);
});

test('the leader\'s vetoes are said beside "Most votes", as the card says them', () => {
  const one = everyoneVotedCopy({ undecided: true, leader: 'Porto', tied: [], vetoes: { Porto: 1 }, shown: t => t });
  assert.match(one, /Most votes: Porto, with 1 veto against it\./);
  const two = everyoneVotedCopy({ undecided: true, leader: 'Porto', tied: [], vetoes: { Porto: 2 }, shown: t => t });
  assert.match(two, /2 vetoes against it/);
});

test('the organiser\'s notification is built from the real vetoes', () => {
  const tell = read('lib/vote-complete.ts');
  assert.doesNotMatch(tell, /vetoes: \[\]/);
  assert.match(tell, /readVetoes\(/);
  assert.match(tell, /everyoneVotedCopy\(/);
});

// ─── The next step while votes are refused ──────────────────────────────

const ME = 'u-me', SAM = 'u-sam', JO = 'u-jo';
function voting(over: Partial<NextActionInput> = {}): NextActionInput {
  return {
    plan: { id: 'p1', groupId: 'g1', status: 'voting', type: 'trip', title: 'Where next?', destStyle: 'undecided',
      hasOptions: true, createdBy: ME, itinerary: [] },
    bookings: [], funding: null, essentials: null, memberCount: 3, me: ME,
    // Jo joined after the ideas came out and has not said what they want:
    // POST /vote answers 403 "Votes open when everyone's in — waiting on Jo".
    readiness: {
      members: [
        { userId: ME, name: 'Pat Me', ready: true, answered: true },
        { userId: SAM, name: 'Sam Lee', ready: true, answered: true },
        { userId: JO, name: 'Jo Park', ready: false, answered: false },
      ],
      waitingOn: ['Jo'], solo: false,
    },
    vote: { decided: false, myVote: null, everyoneVoted: false, mayPick: true, stillToVote: ['you', 'Sam', 'Jo'], organiser: { name: 'Pat', isYou: true } },
    now: new Date('2026-09-25T15:00:00Z'),
    ...over,
  };
}

test('while the vote waits on somebody\'s answers, nobody is sent to a vote the server refuses', () => {
  const a = getNextAction(voting())!;
  assert.equal(a.state, 'waiting_on_others');
  assert.deepEqual(a.waitingOn, ['Jo']);
  assert.equal(a.cta?.kind, 'nudge');
  assert.equal((a.cta as { nudge?: string }).nudge, 'prefs', 'Jo is reminded to answer — a vote reminder lands on a refusal');
  // Already voted: still Jo's answers being waited on, not Jo's vote.
  const voted = getNextAction(voting({ vote: { decided: false, myVote: 'Lisbon', everyoneVoted: false, mayPick: true, stillToVote: ['Sam', 'Jo'] } }))!;
  assert.equal((voted.cta as { nudge?: string }).nudge, 'prefs');
  // Once Jo has answered, the vote is open as before.
  const open = getNextAction(voting({ readiness: { members: [], waitingOn: [], solo: false } }))!;
  assert.equal(open.state, 'vote_open');
});

// ─── The last one still to vote leaves ──────────────────────────────────

test('a vote completed by the last one still to vote leaving is announced to the organiser', async () => {
  const { everyoneVotedNotice } = await import('../../lib/vote-complete.ts');
  const plan = { id: 'p1', group_id: 'g1', status: 'voting', destination_style: 'undecided', created_by: 'pat', vote_options: ['Lisbon', 'Porto'] };
  const votes = [{ user_id: 'pat', option: 'Porto' }, { user_id: 'sam', option: 'Porto' }];
  const three = [
    { userId: 'pat', role: 'member', name: 'Pat' }, { userId: 'sam', role: 'member', name: 'Sam' },
    { userId: 'jo', role: 'member', name: 'Jo' },
  ];
  // Jo still in, still to vote: nothing to tell.
  assert.equal(everyoneVotedNotice({ plan, members: three, votes, vetoes: [], actorId: 'sam' }), null);
  // Jo leaves: the vote is complete, and Pat, who did not cast the last vote, is told.
  const n = everyoneVotedNotice({ plan, members: three.filter(m => m.userId !== 'jo'), votes, vetoes: [], actorId: 'jo' });
  assert.ok(n);
  assert.deepEqual(n.told, ['pat']);
  assert.equal(n.note.body, 'Most votes: Porto. The pick is yours.');
  assert.equal(n.key, 'p1:votes');
  // A vote that is not open any more is never announced.
  assert.equal(everyoneVotedNotice({ plan: { ...plan, status: 'planning' }, members: three.filter(m => m.userId !== 'jo'), votes, vetoes: [], actorId: 'jo' }), null);
});

test('leaving a group checks the open votes it may have completed', () => {
  const route = read('app/api/groups/[id]/members/route.ts');
  const del = route.slice(route.indexOf('export async function DELETE'));
  assert.match(del, /tellWhereLeavingCompletesTheVote\(/);
  const vote = read('app/api/plans/[planId]/vote/route.ts');
  assert.match(vote, /from '@\/lib\/vote-complete'/, 'the vote and the leaving share one announcement');
});

test('a veto read that failed announces nothing, rather than a leader with its vetoes left out', () => {
  const src = readFileSync(new URL('../../lib/vote-complete.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function tellOrganiserIfEveryoneVoted'));
  const guard = fn.indexOf('vetoRead as { error?: unknown }).error) return false');
  assert.ok(guard > 0 && guard < fn.indexOf('claimOnce('), 'checked before the one announcement is claimed');
});
