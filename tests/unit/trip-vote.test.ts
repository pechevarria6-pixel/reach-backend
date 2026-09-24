import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ideasFrom, readIdeas, withDays, isOrganiser, mayPick, findDecision, tallyVotes, waitingTripIn,
  voteTitles, patchDecides, daysDecision, ideasReadyCopy, shownTitle, pickedTitle,
  staleWaitingIn, patchCallsOff, calledOffCopy,
} from '../../lib/trip-vote.ts';

const meta = { set: 'S1', foundBy: 'u1', foundAt: '2026-09-23T10:00:00Z', mode: 'trip' as const };
const three = [
  { id: 'x', destination: 'Lisbon', city: 'Lisbon', country_code: 'PT', total_per_person: 900, tier: 'saver' },
  { id: 'x', destination: 'Porto', city: 'Porto', country_code: 'PT', total_per_person: 1100, tier: 'on_budget' },
  { id: 'y', destination: 'Seville', city: 'Seville', country_code: 'ES', total_per_person: 1400, tier: 'stretch' },
];

// ─── Who may pick ───────────────────────────────────────────────────────

test('the organiser is whoever set the trip up, or an admin', () => {
  assert.equal(isOrganiser({ role: 'member', createdBy: 'u1', userId: 'u1' }), true);
  assert.equal(isOrganiser({ role: 'admin', createdBy: 'u1', userId: 'u2' }), true);
  assert.equal(isOrganiser({ role: 'member', createdBy: 'u1', userId: 'u2' }), false);
});

test('a member who is not the organiser may not pick for the group', () => {
  assert.equal(mayPick({ role: 'member', createdBy: 'u1', userId: 'u2', memberCount: 4 }), false);
  assert.equal(mayPick({ role: 'member', createdBy: 'u1', userId: 'u1', memberCount: 4 }), true);
  assert.equal(mayPick({ role: 'admin', createdBy: 'u1', userId: 'u3', memberCount: 4 }), true);
});

test('a plan with no creator on record is not everybody\'s to pick', () => {
  // created_by is ON DELETE SET NULL. null === null must not make everybody the organiser.
  assert.equal(mayPick({ role: 'member', createdBy: null, userId: 'u2', memberCount: 3 }), false);
});

test('somebody on their own always picks', () => {
  assert.equal(mayPick({ role: 'member', createdBy: 'someone-else', userId: 'u1', memberCount: 1 }), true);
});

// ─── One set of ideas per plan ──────────────────────────────────────────

test('a second Find shows the saved ideas instead of building more', () => {
  const saved = ideasFrom(three, meta);
  assert.deepEqual(findDecision({ saved, regenerate: false, organiser: false }), { action: 'show' });
  assert.deepEqual(findDecision({ saved, regenerate: false, organiser: true }), { action: 'show' });
});

test('the first Find builds', () => {
  assert.deepEqual(findDecision({ saved: null, regenerate: false, organiser: false }), { action: 'generate', replacing: null });
});

test('only the organiser can swap the ideas for different ones, and it names the set replaced', () => {
  const saved = ideasFrom(three, meta);
  const refused = findDecision({ saved, regenerate: true, organiser: false });
  assert.equal(refused.action, 'refuse');
  assert.deepEqual(findDecision({ saved, regenerate: true, organiser: true }), { action: 'generate', replacing: 'S1' });
});

test('saved ideas get the set\'s own ids, never the model\'s', () => {
  const saved = ideasFrom(three, meta);
  // The model gave two of these the same id; a vote or a day must land on one.
  assert.deepEqual(saved.options.map(o => o.id), ['S1:1', 'S1:2', 'S1:3']);
  assert.deepEqual(saved.options.map(o => o.title), ['Lisbon', 'Porto', 'Seville']);
  assert.equal(saved.options[0].country_code, 'PT');
  assert.equal(saved.options[2].total_per_person, 1400);
});

test('three ideas at one place are told apart, so a vote names exactly one', () => {
  const same = three.map(t => ({ ...t, destination: 'Aspen' }));
  const titles = ideasFrom(same, meta).options.map(o => o.title);
  assert.deepEqual(titles, ['Aspen · saver', 'Aspen · on budget', 'Aspen · stretch']);
  assert.equal(new Set(titles).size, 3);
});

test('reading back refuses anything that is not a set of ideas', () => {
  assert.equal(readIdeas(null), null);
  assert.equal(readIdeas({ options: [] }), null);
  assert.equal(readIdeas({ set: 'S', options: [{ destination: 'no id' }] }), null);
  const back = readIdeas(JSON.parse(JSON.stringify(ideasFrom(three, meta))));
  assert.equal(back?.options.length, 3);
  assert.equal(back?.rev, 1);
});

test('writing one idea\'s days bumps the revision and touches only that idea', () => {
  const saved = ideasFrom(three, meta);
  const next = withDays(saved, 'S1:2', [{ day: 1 }]);
  assert.equal(next?.rev, 2);
  assert.deepEqual(next?.options[1].itinerary, [{ day: 1 }]);
  assert.equal(next?.options[0].itinerary, undefined);
  assert.equal(withDays(saved, 'S0:2', [{ day: 1 }]), null);
});

// ─── The count ──────────────────────────────────────────────────────────

const titles = ['Lisbon', 'Porto', 'Seville'];
const members = ['a', 'b', 'c', 'd'];

test('votes are counted per idea, one per member', () => {
  const v = tallyVotes({
    titles, memberIds: members, me: 'a', vetoes: [],
    votes: [
      { user_id: 'a', option: 'Lisbon' }, { user_id: 'b', option: 'Lisbon' },
      { user_id: 'c', option: 'Porto' }, { user_id: 'a', option: 'Porto' },
    ],
  });
  assert.deepEqual(v.counts, { Lisbon: 2, Porto: 1, Seville: 0 });
  assert.equal(v.voted, 3);
  assert.equal(v.myVote, 'Lisbon');
  assert.equal(v.leader, 'Lisbon');
  assert.deepEqual(v.notVoted, ['d']);
  assert.equal(v.everyoneVoted, false);
});

test('a tie has no leader — it is the organiser\'s call', () => {
  const v = tallyVotes({
    titles, memberIds: members, me: 'a', vetoes: [],
    votes: [
      { user_id: 'a', option: 'Lisbon' }, { user_id: 'b', option: 'Porto' },
      { user_id: 'c', option: 'Lisbon' }, { user_id: 'd', option: 'Porto' },
    ],
  });
  assert.equal(v.leader, null);
  assert.deepEqual(v.tied, ['Lisbon', 'Porto']);
  assert.equal(v.everyoneVoted, true);
});

test('no votes is neither a leader nor a tie', () => {
  const v = tallyVotes({ titles, memberIds: members, me: 'a', votes: [], vetoes: [] });
  assert.equal(v.leader, null);
  assert.deepEqual(v.tied, []);
});

test('a vote on an old idea, or from somebody who has left, is not counted', () => {
  const v = tallyVotes({
    titles, memberIds: members, me: 'a', vetoes: [],
    votes: [{ user_id: 'a', option: 'Madrid' }, { user_id: 'gone', option: 'Porto' }],
  });
  assert.equal(v.voted, 0);
  assert.deepEqual(v.counts, { Lisbon: 0, Porto: 0, Seville: 0 });
  assert.equal(v.myVote, null);
});

test('a group of one is never "everyone has voted"', () => {
  const v = tallyVotes({ titles, memberIds: ['a'], me: 'a', vetoes: [], votes: [{ user_id: 'a', option: 'Porto' }] });
  assert.equal(v.everyoneVoted, false);
});

// ─── Veto privacy ───────────────────────────────────────────────────────

test('vetoes are counts: the screen learns how many, and never who', () => {
  const v = tallyVotes({
    titles, memberIds: members, me: 'a', votes: [],
    vetoes: [
      { user_id: 'b', option: 'Seville' }, { user_id: 'c', option: 'Seville' },
      { user_id: 'a', option: 'Porto' }, { user_id: 'b', option: 'Seville' },
    ],
  });
  assert.deepEqual(v.vetoes, { Lisbon: 0, Porto: 1, Seville: 2 });
  // My own, and only my own.
  assert.deepEqual(v.myVetoes, ['Porto']);
  // Nothing in what goes to the screen names anybody else.
  const sent = JSON.stringify({ ...v, notVoted: undefined });
  assert.equal(sent.includes('"b"'), false);
  assert.equal(sent.includes('"c"'), false);
});

test('another member\'s view shows the same counts and none of my vetoes', () => {
  const vetoes = [{ user_id: 'a', option: 'Porto' }];
  const theirs = tallyVotes({ titles, memberIds: members, me: 'b', votes: [], vetoes });
  assert.deepEqual(theirs.myVetoes, []);
  assert.equal(theirs.vetoes.Porto, 1);
});

// ─── The duplicate guard ────────────────────────────────────────────────

const TODAY = '2026-09-23';

test('a group trip still waiting on answers or votes blocks a second one', () => {
  assert.equal(waitingTripIn([
    { id: 'p2', type: 'trip', destination_style: 'undecided', status: 'voting', created_at: '2026-09-22' },
    { id: 'p1', type: 'trip', destination_style: 'undecided', status: 'planning', created_at: '2026-09-20' },
  ], { type: 'trip', today: TODAY }), 'p1');
});

test('a decided, cancelled or finished trip does not', () => {
  assert.equal(waitingTripIn([
    { id: 'p1', type: 'trip', destination_style: null, status: 'planning' },
    { id: 'p2', type: 'trip', destination_style: 'undecided', status: 'cancelled' },
    { id: 'p3', type: 'trip', destination_style: 'undecided', status: 'completed' },
  ], { type: 'trip', today: TODAY }), null);
});

test('a waiting plan whose dates have passed blocks nothing, and is the one to close', () => {
  const plans = [
    // A night out left in "voting" past its date.
    { id: 'old', type: 'restaurant', destination_style: 'undecided', status: 'voting', start_date: '2026-09-12', end_date: '2026-09-12', created_at: '2026-09-01' },
  ];
  assert.equal(waitingTripIn(plans, { type: 'restaurant', today: TODAY }), null);
  assert.deepEqual(staleWaitingIn(plans, { type: 'restaurant', today: TODAY }), ['old']);
});

test('a waiting plan on today, still to come, or with no dates yet still blocks', () => {
  for (const dates of [
    { start_date: TODAY, end_date: TODAY },
    { start_date: '2026-10-02', end_date: '2026-10-06' },
    { start_date: '2026-09-20', end_date: '2026-09-25' }, // under way
    { start_date: null, end_date: null },
  ]) {
    const plans = [{ id: 'w', type: 'trip', destination_style: 'undecided', status: 'planning', ...dates }];
    assert.equal(waitingTripIn(plans, { type: 'trip', today: TODAY }), 'w', JSON.stringify(dates));
    assert.deepEqual(staleWaitingIn(plans, { type: 'trip', today: TODAY }), []);
  }
});

test('an older plan past its date does not hide a live one behind it', () => {
  assert.equal(waitingTripIn([
    { id: 'old', type: 'trip', destination_style: 'undecided', status: 'planning', start_date: '2026-08-01', end_date: '2026-08-05', created_at: '2026-07-01' },
    { id: 'new', type: 'trip', destination_style: 'undecided', status: 'planning', start_date: '2026-11-01', end_date: '2026-11-05', created_at: '2026-09-20' },
  ], { type: 'trip', today: TODAY }), 'new');
});

test('a trip being decided does not block a night out, nor the other way round', () => {
  const trip = { id: 't', type: 'trip', destination_style: 'undecided', status: 'voting', start_date: '2026-10-10', end_date: '2026-10-14' };
  const night = { id: 'n', type: 'restaurant', destination_style: 'undecided', status: 'planning', start_date: '2026-09-26', end_date: '2026-09-26' };
  assert.equal(waitingTripIn([trip], { type: 'restaurant', today: TODAY }), null);
  assert.equal(waitingTripIn([night], { type: 'trip', today: TODAY }), null);
  assert.equal(waitingTripIn([trip, night], { type: 'trip', today: TODAY }), 't');
  assert.equal(waitingTripIn([trip, night], { type: 'restaurant', today: TODAY }), 'n');
  // Nor is one kind closed on the other's account.
  assert.deepEqual(staleWaitingIn([{ ...night, start_date: '2026-09-01', end_date: '2026-09-01' }], { type: 'trip', today: TODAY }), []);
});

// ─── Calling a plan off ─────────────────────────────────────────────────

test('only a move to cancelled is calling it off', () => {
  assert.equal(patchCallsOff({ status: 'cancelled' }), true);
  assert.equal(patchCallsOff({ status: 'planning' }), false);
  assert.equal(patchCallsOff({ title: 'x' }), false);
});

test('everybody else is told who called it off, and that they can start another', () => {
  const trip = calledOffCopy({ organiserName: 'Sam', title: 'Lisbon in October', night: false });
  assert.equal(trip.title, 'Sam called off Lisbon in October');
  assert.match(trip.body, /start another trip/);
  const night = calledOffCopy({ organiserName: null, title: null, night: true });
  assert.equal(night.title, 'The organiser called off the night out');
  assert.match(night.body, /start another night out/);
  // The placeholder an undecided plan carries is not a name.
  assert.equal(calledOffCopy({ organiserName: 'Sam', title: 'Where next?', night: false }).title, 'Sam called off the trip');
});

// ─── What a vote is counted against ─────────────────────────────────────

test('with saved ideas, the vote is on their titles whatever vote_options says', () => {
  const saved = ideasFrom(three, meta);
  // A member PATCHed vote_options to a list nobody was shown.
  assert.deepEqual(voteTitles({ trip_options: saved, vote_options: ['Cancun'] }), saved.options.map(o => o.title));
  // Or emptied it, which used to refuse every vote and hide the Vote tab.
  assert.equal(voteTitles({ trip_options: saved, vote_options: [] }).length, 3);
});

test('without saved ideas, vote_options is still what a vote names', () => {
  assert.deepEqual(voteTitles({ trip_options: null, vote_options: ['A', 'B'] }), ['A', 'B']);
  // Before the migration select('*') has no trip_options key at all.
  assert.deepEqual(voteTitles({ vote_options: ['A'] }), ['A']);
  assert.deepEqual(voteTitles({}), []);
});

test('rewriting the vote list on an undecided trip is deciding, so it is the organiser\'s', () => {
  const base = { undecided: true, onlyIfUndecided: false, pickOption: null };
  assert.equal(patchDecides({ ...base, fields: { vote_options: ['Cancun'] } }), true);
  assert.equal(patchDecides({ ...base, fields: { vote_options: [] } }), true);
  assert.equal(patchDecides({ ...base, fields: { trip_options: null } }), true);
  assert.equal(patchDecides({ ...base, fields: { status: 'planning' } }), true);
  assert.equal(patchDecides({ ...base, fields: { destination_style: null } }), true);
  // Anything else on an undecided trip is not a pick.
  assert.equal(patchDecides({ ...base, fields: { title: 'Summer' } }), false);
});

test('undoing a pick is deciding, so a member cannot reopen the vote', () => {
  const decided = { undecided: false, onlyIfUndecided: false, pickOption: null };
  // The exact request a member could send to a picked trip.
  assert.equal(patchDecides({ ...decided, picked: true, fields: { destination_style: 'undecided', status: 'voting' } }), true);
  // Either half on its own.
  assert.equal(patchDecides({ ...decided, picked: true, fields: { destination_style: 'undecided' } }), true);
  assert.equal(patchDecides({ ...decided, picked: true, fields: { status: 'voting' } }), true);
  // Putting "undecided" back is deciding on any decided trip.
  assert.equal(patchDecides({ ...decided, picked: false, fields: { destination_style: 'undecided' } }), true);
  // An ordinary plan, never picked from ideas, can still be sent round for a vote.
  assert.equal(patchDecides({ ...decided, picked: false, fields: { status: 'voting' } }), false);
  assert.equal(patchDecides({ ...decided, fields: { status: 'voting' } }), false);
  // And other edits to a picked trip are not a pick.
  assert.equal(patchDecides({ ...decided, picked: true, fields: { status: 'approved' } }), false);
  assert.equal(patchDecides({ ...decided, picked: true, fields: { title: 'Porto' } }), false);
});

test('picking is deciding on any trip; the vote list on a decided trip is not', () => {
  assert.equal(patchDecides({ undecided: false, fields: {}, onlyIfUndecided: true, pickOption: null }), true);
  assert.equal(patchDecides({ undecided: false, fields: {}, onlyIfUndecided: false, pickOption: 'S1:1' }), true);
  assert.equal(patchDecides({ undecided: false, fields: { vote_options: ['A'] }, onlyIfUndecided: false, pickOption: null }), false);
});

// ─── Whose days stand ───────────────────────────────────────────────────

test('days are written onto an idea with none, by anybody', () => {
  assert.equal(daysDecision({ idea: { itinerary: null }, organiser: false }), 'write');
  assert.equal(daysDecision({ idea: { itinerary: [] }, organiser: false }), 'write');
  assert.equal(daysDecision({ idea: null, organiser: false }), 'write');
});

test('days already written are kept unless the organiser asks again', () => {
  assert.equal(daysDecision({ idea: { itinerary: [{ day: 1 }] }, organiser: false }), 'keep');
  assert.equal(daysDecision({ idea: { itinerary: [{ day: 1 }] }, organiser: true }), 'write');
});

// ─── "Your trip ideas are ready" ────────────────────────────────────────

test('the organiser is told to pick, not that they make the pick', () => {
  const org = ideasReadyCopy({ night: false, fresh: false, count: 3, forOrganiser: true, organiserName: 'Sam' });
  assert.doesNotMatch(org.body, /Sam/);
  assert.match(org.body, /make the pick/);
  const member = ideasReadyCopy({ night: false, fresh: false, count: 3, forOrganiser: false, organiserName: 'Sam' });
  assert.match(member.body, /^Three ideas, .*Sam makes the pick once you've voted\.$/);
});

test('one idea is "One idea", never "1 ideas"', () => {
  const c = ideasReadyCopy({ night: true, fresh: false, count: 1, forOrganiser: false, organiserName: null });
  assert.doesNotMatch(c.body + c.title, /1 ideas|idea for the night are/);
  assert.match(c.body, /^One idea,/);
  assert.equal(c.title, 'Your idea for the night is ready — vote');
});

// ─── An evening's name, from its own venues ─────────────────────────────

test('an evening keeps the name its venues give it beside its days, and the vote key does not move', () => {
  const saved = ideasFrom([{ destination: 'Downtown dinner & drinks' }, { destination: 'Riverside evening' }], { ...meta, mode: 'night' });
  const next = withDays(saved, 'S1:1', [{ day: 1 }], { venueTitle: 'Trophy Brewing & Kokoro Ramen' })!;
  assert.equal(next.options[0].venueTitle, 'Trophy Brewing & Kokoro Ramen');
  assert.equal(next.options[0].title, 'Downtown dinner & drinks');
  assert.deepEqual(voteTitles({ trip_options: next }), ['Downtown dinner & drinks', 'Riverside evening']);
  // Shown by the venues' name; the other, with no days yet, by its title.
  assert.equal(shownTitle(next.options, 'Downtown dinner & drinks'), 'Trophy Brewing & Kokoro Ramen');
  assert.equal(shownTitle(next.options, 'Riverside evening'), 'Riverside evening');
  // Picked: the plan is called after where it actually goes.
  assert.equal(pickedTitle(next.options[0]), 'Trophy Brewing & Kokoro Ramen');
  assert.equal(pickedTitle(next.options[1]), 'Riverside evening');
});

test('two evenings the venues would name alike are shown by their titles', () => {
  const options = [
    { title: 'A', venueTitle: 'Same & Place' },
    { title: 'B', venueTitle: 'Same & Place' },
  ];
  assert.equal(shownTitle(options, 'A'), 'A');
  assert.equal(shownTitle(options, 'B'), 'B');
});
