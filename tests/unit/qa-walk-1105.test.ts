// ─── The 5 November walk: an organiser and a member on www.alcanzar.io ───
// One test (or more) per thing found, each written to fail on the bug as it
// was. Behaviour where the rule is a pure helper; the shape of the source
// where it is JSX nobody can render here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  waitingFor, planStageLabel, planStandsLine, failureFrom, datesTally, voteHeading, tieWords, planCalled,
  waitRefusal, changeRefusal, planCalledAtStart,
} from '../../lib/plan-words.ts';
import { getNextAction, type NextActionInput } from '../../lib/next-action.ts';
import { stepsFor, stepCounter } from '../../lib/quiz-steps.ts';
import { createPlanSteps } from '../../lib/create-plan-steps.ts';
import { patchDecides } from '../../lib/trip-vote.ts';
import { forgetThisDevice } from '../../lib/push-client.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const APP = read('components/reach-app.jsx');
/** The body of a component, from its declaration to the next top-level function. */
function fn(name: string): string {
  const at = APP.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} is in the app`);
  const end = APP.indexOf('\nfunction ', at + 10);
  return APP.slice(at, end < 0 ? undefined : end);
}

const A = 'u-org', B = 'u-new';
const members = (bReady: boolean, aReady = true) => [
  { userId: A, name: 'Pat Organiser', ready: aReady, answered: aReady },
  { userId: B, name: 'NEW Member', ready: bReady, answered: bReady },
];

// ── 1. Ideas for you ─────────────────────────────────────────────────────
test('1: a refusal says the server\'s words and when it said to come back', () => {
  const f = failureFrom(503, { error: 'Still checking the towns near you. Try again in a moment.' }, '5', 'Couldn\'t put ideas together just now.');
  assert.equal(f.message, 'Still checking the towns near you. Try again in a moment.');
  assert.equal(f.retryIn, 5);
  assert.equal(failureFrom(500, { error: 'boom' }, '5', 'x').retryIn, null, 'only a 503 or 429 is asked again on its own');
  assert.equal(failureFrom(503, null, null, 'fallback').message, 'fallback');
  assert.equal(failureFrom(503, {}, '600', 'x').retryIn, 30, 'capped');
});
test('1: Ideas for you shows the reason, retries once on Retry-After, and always has Try again', () => {
  const picks = fn('TripPicks');
  assert.doesNotMatch(picks, /Couldn't put ideas together just now\. Try again shortly\./);
  assert.match(picks, /failureFrom\(r\.status,body,r\.headers\.get\("Retry-After"\)/);
  assert.match(picks, /timer=setTimeout\(\(\)=>\{if\(!live\)return;autoRetried\.current=true;/);
  assert.match(picks, /onClick=\{\(\)=>setAttempt\(a=>a\+1\)\}>Try again</);
});

// ── 2. Plan my days / Find our trips ────────────────────────────────────
test('2: a failed "Plan my days for me" stays on screen under the button, and the button becomes the retry', () => {
  const plan = fn('PlanDetailScreen');
  assert.match(plan, /setBuildError\(\{msg:e\?\.message/);
  assert.doesNotMatch(plan, /build itinerary failed",e\);\s*toast\(e\.message\)/, 'not a toast that goes in four seconds');
  assert.match(plan, /buildError\?\.retry\?"↻ Try again":"✨ Plan my days for me"/);
  assert.match(plan, /<BuildNote e=\{buildError\}/);
});
test('2: "Find our trips" shows the server\'s message as it is, with nothing added', () => {
  const trip = fn('GroupTripScreen');
  assert.match(trip, /const msg=err\.error\|\|"Generation failed";/);
  assert.match(trip, /setError\(msg\);setErrorWaits\(waitRefusal\(res\.status,err\)\);/);
  assert.match(trip, /\{shownError\}/);
  assert.doesNotMatch(trip, /setError\(`\$\{msg\}.*try again/i);
});

// ── 3. "Couldn't check where this plan stands" ───────────────────────────
test('3: "Couldn\'t check" only once the read has failed; checking while it is on its way', () => {
  assert.equal(planStandsLine({ fundingFailed: false, funding: null, bookingsLoaded: true }), 'Checking where this plan stands…');
  assert.match(planStandsLine({ fundingFailed: true, funding: null, bookingsLoaded: true }) ?? '', /^Couldn't check/);
  assert.equal(planStandsLine({ fundingFailed: false, funding: { targetCents: 0 }, bookingsLoaded: true }), null);
  const plan = fn('PlanDetailScreen');
  assert.doesNotMatch(plan, /unknown=\{bookingsLoaded&&!funding\?/);
  assert.match(plan, /unknown=\{planStandsLine\(/);
  assert.match(plan, /else setFundingFailed\(true\)/);
});

// ── 4. Waiting on yourself ───────────────────────────────────────────────
test('4: the member being waited on is "you", and only the others are named', () => {
  const read = { members: members(false), solo: false };
  const b = waitingFor(read, B);
  assert.equal(b.mine, true);
  assert.equal(b.sentence, "You haven't said what you want from this trip yet.");
  assert.doesNotMatch(b.sentence ?? '', /NEW/);
  const a = waitingFor(read, A);
  assert.equal(a.mine, false);
  assert.equal(a.sentence, 'Waiting on NEW to say what they want from this trip.');
  const both = waitingFor({ members: members(false, false), solo: false }, B, { votes: true });
  assert.match(both.sentence ?? '', /^You and Pat haven't said/);
  assert.equal(waitingFor({ members: members(true), solo: false }, B).sentence, null);
  assert.equal(waitingFor({ members: members(false), solo: false, wentAhead: true }, B).sentence, null);
});
test('4: no screen says the server\'s third-person sentence to the person it is about', () => {
  const plan = fn('PlanDetailScreen');
  assert.doesNotMatch(plan, /prefs\.waiting\|\|/, 'the plan screen says it through waitingFor');
  assert.doesNotMatch(plan, /prefs\?\.waiting\|\|/);
  assert.match(plan, /const voteWait=waitingFor\(prefs,me/);
  assert.match(fn('GroupTripScreen'), /const wait=waitingFor\(answered,me,\{strict:true/);
});

// ── 5. One status word for everyone ──────────────────────────────────────
function input(me: string, over: Partial<NextActionInput['plan']> = {}, readiness = { members: members(false), waitingOn: ['NEW'], solo: false }): NextActionInput {
  return {
    plan: { id: 'p1', groupId: 'g1', status: 'planning', type: 'trip', title: 'Charleston', destStyle: 'undecided',
      hasOptions: false, createdBy: A, itinerary: [], ...over },
    bookings: [], funding: null, readiness, essentials: null, memberCount: 2, me,
    now: new Date('2026-11-05T15:00:00Z'),
  };
}
test('5: the organiser and the member read the same chip for the same plan', () => {
  const a = getNextAction(input(A))!, b = getNextAction(input(B))!;
  assert.equal(a.chip, b.chip);
  assert.equal(a.chip, 'Waiting');
});
test('5: a plan out for a vote never reads "Planning"', () => {
  const ready = { members: members(true), waitingOn: [], solo: false };
  const voting = { status: 'voting', destStyle: 'fixed', hasOptions: true, itinerary: [] };
  for (const who of [A, B]) {
    assert.equal(getNextAction(input(who, voting, ready))!.chip, 'Voting', who);
  }
  assert.equal(planStageLabel({ status: 'voting', hasOptions: true, readiness: { members: members(false) }, solo: false }), 'Waiting');
  assert.equal(planStageLabel({ status: 'planning', hasOptions: false, readiness: null, solo: true }), 'Planning');
});

// ── 6. Dates, said as dates ──────────────────────────────────────────────
test('6: the availability count is about dates, not answers', () => {
  assert.equal(datesTally(0, 2), "Dates: 0 of 2 have said when they're free.");
  assert.doesNotMatch(APP, /\$\{dates\.respondents\} of \$\{dates\.members\} have answered/);
  assert.match(APP, /datesTally\(dates\.respondents,dates\.members\)/);
  assert.doesNotMatch(APP, />When works for you\?</);
});

// ── 7. One tap to find ───────────────────────────────────────────────────
test('7: "Find them →" starts finding, rather than opening a second Find button', () => {
  const answered = { members: members(true).map(m => ({ ...m, answered: true })), waitingOn: [], solo: false };
  const a = getNextAction(input(B, {}, answered))!;
  assert.equal(a.cta?.label, 'Find them →');
  assert.equal(a.cta?.kind === 'navigate' ? a.cta.route.params.find : null, '1');
  const trip = fn('GroupTripScreen');
  assert.match(trip, /regenerate=false,find=false(,askReconnection=false)?\}\)/);
  assert.match(trip, /if\(!find\|\|findAsked\.current/);
  assert.match(trip, /findAsked\.current=true;\s*findOurTrips\(wp\);/);
});

// ── 8. The back button and the Edit plan pill ───────────────────────────
test('8: the plan header keeps the floating back button clear of "Edit plan"', () => {
  const plan = fn('PlanDetailScreen');
  const at = plan.indexOf('<ScreenHeader onBack={onBack} overlay/>');
  const row = plan.slice(plan.lastIndexOf('<div', at), at);
  assert.doesNotMatch(row, /justifyContent:"space-between"/, 'with the back button out of flow, space-between put the pill at the left');
  assert.match(row, /minHeight:44/);
  assert.match(plan.slice(at, at + 300), /marginLeft:"auto"/);
});

// ── 9. One total for the quiz ────────────────────────────────────────────
test('9: the step total does not drop when an answer settles a later question', () => {
  const qs = ['goalBlurb', 'tripType', 'pace', 'accommodation', 'budget'].map(id => ({ id }));
  const full = stepsFor(qs);
  const before = stepCounter(full, stepsFor(qs)[0], 0);
  const settled = stepsFor(qs.filter(q => q.id !== 'pace'));
  const after = stepCounter(full, settled[1], 1);
  assert.equal(before.total, after.total, 'one total for the flow');
  assert.equal(before.at, 1);
  assert.equal(after.at, 2);
  // Past the skipped question, the count jumps over it rather than going back.
  const accom = settled.findIndex(s => s.kind === 'question' && s.question.id === 'accommodation');
  assert.equal(stepCounter(full, settled[accom], accom).at, 5);
});
test('9: the quiz and the draft card count with the flow\'s own list', () => {
  assert.match(fn('TripQuiz'), /Step \{counter\.at\} of \{counter\.total\}/);
  assert.doesNotMatch(fn('TripQuiz'), /Step \{qStep\+1\} of \{totalSteps\}/);
  assert.match(APP, /const totalSteps=dr\.planType\?createPlanSteps\(dr\.planType\)\.length:null;/);
  assert.equal(createPlanSteps('restaurant').length, 5, 'the draft card said 4');
});

// ── 10. Votes can be changed ─────────────────────────────────────────────
test('10: a vote on options put to the group can be moved to another', () => {
  const plan = fn('PlanDetailScreen');
  const cast = plan.slice(plan.indexOf('const castVote=async opt=>{'), plan.indexOf('const vetoOption='));
  assert.doesNotMatch(cast, /if\(myVote\)return;/);
  assert.match(cast, /if\(myVote===opt\|\|voteBusy\)return;/);
  assert.match(cast, /moved\(p\.votes\|\|\{\},before,opt\)/, 'one off the old option as one goes on the new');
  assert.match(plan, /myVote\?"Change vote to this":"Vote for this"/);
  // The trip-ideas vote already moves; it stays that way.
  assert.match(fn('TripIdeas'), /if\(before&&c\[before\]>0\)c\[before\]-=1;/);
});

// ── 11. Vetoes on options put to the group ──────────────────────────────
test('11: options put to the group show their vetoes and can be vetoed', () => {
  const plan = fn('PlanDetailScreen');
  assert.match(plan, /body:JSON\.stringify\(\{veto:opt,on\}\)/);
  assert.match(plan, /\$\{plural\(x,"veto","vetoes"\)\}/);
  assert.match(plan, /voteView\?\.vetoesAvailable&&!mine&&/, 'never on the one you voted for: the server refuses it');
});

// ── 12. A closed vote says so first ──────────────────────────────────────
test('12: while votes are closed the wait is said first, and the vote faces wait', () => {
  const plan = fn('PlanDetailScreen');
  const vote = plan.slice(plan.indexOf('atab==="vote"&&!plan.hasIdeas'));
  const closed = vote.indexOf('{!votingOpen&&prefs&&(');
  const options = vote.indexOf('{plan.options.map(opt=>{');
  const faces = vote.indexOf('<WaitFaces planId={planId} kind="vote"');
  assert.ok(closed > 0 && closed < options, 'the closed state comes before the options');
  const openBlock = vote.indexOf('{votingOpen&&(()=>{');
  assert.ok(openBlock >= 0 && openBlock < faces && faces < vote.indexOf('})()}', openBlock), 'the vote faces only inside the votes-open block');
  assert.doesNotMatch(vote, /Voting opens once everyone has answered\./, 'said once, in the box above, not on every option');
});

// ── 13. The heading says what is being voted on ─────────────────────────
test('13: a set place is voted on as which plan for it', () => {
  assert.equal(voteHeading({ night: false, undecided: false, city: 'Charleston' }), 'Which plan for Charleston?');
  assert.equal(voteHeading({ night: false, undecided: true, city: null }), 'Where should we go?');
  assert.doesNotMatch(fn('PlanDetailScreen'), />Where should we go\?</);
  assert.doesNotMatch(fn('TripIdeas'), /"Where should we go\?"/);
});

// ── 14. A tie is settled ─────────────────────────────────────────────────
test('14: the organiser settles a tie; everyone else is told who will', () => {
  assert.match(tieWords({ tied: ['Beach', 'Food'], organiserIsMe: true, organiserName: 'Pat' }) ?? '', /your call/);
  assert.equal(tieWords({ tied: ['Beach', 'Food'], organiserIsMe: false, organiserName: 'Pat' }), 'Waiting on Pat to settle the tie.');
  assert.equal(tieWords({ tied: ['Beach'], organiserIsMe: true, organiserName: 'Pat' }), null);
  // The PATCH it sends is one the server gives the organiser (and refuses anybody else).
  assert.equal(patchDecides({ undecided: false, fields: { vote_options: ['Beach'], status: 'approved' }, onlyIfUndecided: false, pickOption: null, voteOpen: true }), true);
  const plan = fn('PlanDetailScreen');
  assert.match(plan, /updatePlanOnServer\(planId,\{vote_options:\[opt\],status:"approved"\}\)/);
  assert.match(plan, /tie&&organiserHere&&/);
  assert.match(fn('TripIdeas'), /v\.everyoneVoted&&v\.tied\.length\s*\?tieWords\(/);
});

// ── 15. Rebuild the days is the organiser's ─────────────────────────────
test('15: "We know … better now" is shown to the organiser only', () => {
  assert.match(fn('PlanDetailScreen'), /\{fresh\?\.stale&&!building&&\(soloTrip\|\|organiserHere\)&&\(/);
});

// ── 16. How a place books, only from what we hold ───────────────────────
test('16: neither "books by phone" nor "booked on their own site" is said from a phone number or a homepage', () => {
  const dinner = { id: 'l-d', title: 'Dinner', venue_name: 'Husk', type: 'restaurant', booking_mode: 'ahead', venue_website: 'https://husk.example', venue_phone: '+18435550100' };
  const a = getNextAction({ ...input(A, { status: 'approved', destStyle: 'fixed', itinerary: [dinner] },
    { members: members(true), waitingOn: [], solo: false }), funding: { memberCount: 2, targetCents: 0, collectedCents: 0 } as never })!;
  assert.equal(a.state, 'finish_elsewhere');
  assert.doesNotMatch(a.body ?? '', /booked on their own site|books by phone|tickets/);
  assert.notEqual(a.cta?.label, 'Book on their site →');
  assert.doesNotMatch(read('lib/reservations/reserve.ts'), /books by phone: \$\{/);
  assert.doesNotMatch(read('lib/next-action.ts'), /It's booked on their own site/);
});

// ── 17. A plan for one ──────────────────────────────────────────────────
test('17: a plan for one has no reminder to press, and no "Where next?" in a sentence', () => {
  const solo = getNextAction({ ...input(A, { title: 'Where next?' }, { members: [], waitingOn: [], solo: true }), memberCount: 1 })!;
  assert.notEqual(solo.cta?.kind, 'nudge');
  assert.doesNotMatch(solo.body ?? '', /Where next\?/);
  assert.equal(solo.body, "Where this trip goes isn't picked yet.");
  assert.equal(planCalled({ title: 'Where next?', type: 'trip' }), 'this trip');
  assert.match(read('lib/next-action.ts'), /if \(solo && out\.cta\?\.kind === 'nudge'\) out\.cta = null;/);
});

// ── 18. The weather ping opens Change ───────────────────────────────────
test('18: &change=<line> from the weather ping opens that line\'s Change sheet', () => {
  assert.match(read('lib/pings.ts'), /&change=\$\{encodeURIComponent\(line\.id\)\}/, 'the link the ping sends');
  assert.match(APP, /const changeLineId=params\.get\("change"\);/);
  assert.match(APP, /params\.delete\("change"\)/, 'cleared, so a refresh does not reopen it');
  const plan = fn('PlanDetailScreen');
  assert.match(plan, /changeLineId=null\}\)/);
  assert.match(plan, /const said=changeRefusal\(line,mayChangeRef\.current\);\s*if\(said\)toast\(said\);else setChanging\(line\);/);
});

// ── 19. Signing out forgets the device ──────────────────────────────────
test('19: sign-out tells the server, drops the subscription and clears the wallet', async () => {
  const calls: string[] = [];
  const out = await forgetThisDevice({
    getSubscription: async () => ({ endpoint: 'https://push.example/abc', unsubscribe: async () => { calls.push('unsubscribe'); return true; } }),
    fetch: async (url, init) => { calls.push(`${init.method} ${url} ${init.body}`); return { ok: true, status: 200 }; },
    clearWallet: async () => { calls.push('wallet'); },
  });
  assert.deepEqual(calls, ['DELETE /api/push {"endpoint":"https://push.example/abc"}', 'unsubscribe', 'wallet'], 'the server first, while the session can still delete its row');
  assert.deepEqual(out, { told: true, unsubscribed: true });
});
test('19: a server that cannot be told still leaves the phone unsubscribed and the wallet empty', async () => {
  const calls: string[] = [];
  await forgetThisDevice({
    getSubscription: async () => ({ endpoint: 'https://push.example/abc', unsubscribe: async () => { calls.push('unsubscribe'); return true; } }),
    fetch: async () => { throw new Error('offline'); },
    clearWallet: async () => { calls.push('wallet'); },
  });
  assert.deepEqual(calls, ['unsubscribe', 'wallet']);
  // No subscription: the wallet still goes.
  const none: string[] = [];
  await forgetThisDevice({ getSubscription: async () => null, fetch: async () => ({ ok: true, status: 200 }), clearWallet: async () => { none.push('wallet'); } });
  assert.deepEqual(none, ['wallet']);
});
test('19: both ways out call it before the session ends, and the wallet cache is the one sw.js keeps', () => {
  const wrapper = read('components/ReachApp.tsx');
  assert.ok(wrapper.indexOf('forgetThisDevice()') > 0 && wrapper.indexOf('forgetThisDevice()') < wrapper.indexOf("await signOut({ redirectUrl: '/sign-in' })"));
  assert.match(wrapper, /onSignOut=\{signOutHere\}/);
  assert.match(APP, /await Promise\.race\(\[forgetThisDevice\(\),/);
  const cache = /const WALLET_CACHE = '([^']+)'/.exec(read('public/sw.js'))?.[1];
  assert.ok(cache);
  assert.match(read('lib/push-client.ts'), new RegExp(`caches\\.delete\\('${cache}'\\)`));
  assert.match(read('app/api/push/route.ts'), /export async function DELETE/, 'the route to forget it exists');
});

// ─── Review of the walk's fixes ─────────────────────────────────────────

test('review 2: an event with only the venue\'s homepage is not said to sell tickets there', () => {
  const gig = { id: 'l-g', title: 'Gig', venue_name: 'The Pour House', type: 'event', booking_mode: 'ahead', venue_website: 'https://pourhouse.example' };
  const a = getNextAction({ ...input(A, { status: 'approved', destStyle: 'fixed', itinerary: [gig] },
    { members: members(true), waitingOn: [], solo: false }), funding: { memberCount: 2, targetCents: 0, collectedCents: 0 } as never })!;
  assert.equal(a.state, 'finish_elsewhere');
  assert.doesNotMatch(a.cta?.label ?? '', /ticket/i);
  assert.doesNotMatch(a.body ?? '', /ticket|seller/i);
  assert.doesNotMatch(read('lib/watch/tables.ts'), /books by phone, so/);
});

const rules = (o: Partial<Parameters<typeof changeRefusal>[1]> = {}) => ({
  may: () => false, changeable: () => true, locked: () => false, unpriced: () => false, ...o,
});
test('review 3: the weather link opens Change only where the screen\'s own Change button would be', () => {
  const cafe = { type: 'restaurant', venue_name: 'Husk' };
  assert.equal(changeRefusal(cafe, rules({ may: () => true })), null);
  assert.equal(changeRefusal(cafe, rules({ locked: () => true })), "The plan is locked in, so changing Husk is the organiser's call.");
  assert.equal(changeRefusal({ type: 'hotel', title: 'The stay' }, rules({ unpriced: () => true })), 'The stay has nothing priced yet to compare a change with.');
  const plan = fn('PlanDetailScreen');
  assert.doesNotMatch(plan, /if\(line&&CHANGEABLE_TYPES\.has\(line\.type\)\)setChanging/, 'the type alone let a member past Lock it in');
  assert.match(plan, /mayChangeRef\.current=\{\s*may:mayChange,/);
  assert.match(plan, /if\(!bookingsLoaded\|\|\(!funding&&!fundingFailed\)\|\|!mayChangeRef\.current\)return;/, 'waits on the funding lockedNow reads');
});
test('review 4: a failed bookings read says so, and "isn\'t on the plan" is said only of a line that is not', () => {
  assert.match(changeRefusal(null, rules()) ?? '', /isn't on the plan any more/);
  const there = changeRefusal({ type: 'transfer', title: 'Airport ride' }, rules({ changeable: () => false })) ?? '';
  assert.doesNotMatch(there, /isn't on the plan/);
  assert.match(there, /^Airport ride can't be swapped/);
  assert.match(fn('PlanDetailScreen'), /if\(bookingsFailed&&!bookingsLoaded\)\{\s*changeOpened\.current=true;\s*toast\("Couldn't load this plan's bookings/);
});
test('review 5: the plan hero carries the safe-area inset the floating back button sits under', () => {
  assert.match(APP, /\.hd-ov\{position:absolute;top:calc\(16px \+ env\(safe-area-inset-top\)\)/);
  const plan = fn('PlanDetailScreen');
  const at = plan.indexOf('<ScreenHeader onBack={onBack} overlay/>');
  const hero = plan.slice(plan.lastIndexOf('linear-gradient(145deg', at), at);
  assert.match(hero, /padding:"calc\(18px \+ env\(safe-area-inset-top\)\) 20px 22px"/);
});
test('review 7: a tie on a set place is settled, never locked in over', () => {
  const tieInput = (me: string) => ({
    ...input(me, { status: 'voting', destStyle: 'fixed', hasOptions: true, itinerary: [{ id: 'l1', title: 'Dinner', type: 'restaurant' }] },
      { members: members(true), waitingOn: [], solo: false }),
    funding: { memberCount: 2, targetCents: 0, collectedCents: 0 } as never,
    vote: { decided: true, myVote: 'Beach', everyoneVoted: true, stillToVote: [], tied: ['Beach', 'Food'],
      organiser: { name: 'Pat', isYou: me === A } },
  });
  const a = getNextAction(tieInput(A))!;
  assert.notEqual(a.state, 'lock_in', 'Lock it in approved the plan with the tie standing');
  assert.equal(a.title, "It's a tie");
  assert.equal(a.cta?.label, 'Settle it →');
  const b = getNextAction(tieInput(B))!;
  assert.equal(b.title, 'Waiting on Pat to settle the tie');
  // No tie: Lock it in as before.
  const clear = getNextAction({ ...tieInput(A), vote: { ...tieInput(A).vote, tied: [] } })!;
  assert.equal(clear.state, 'lock_in');
});
test('review 8: only a refusal that names who it waits on is re-said as "you"', () => {
  assert.equal(waitRefusal(409, { error: "NEW hasn't said…", waitingOn: ['NEW'] }), true);
  assert.equal(waitRefusal(409, { error: 'This trip was called off.' }), false);
  assert.equal(waitRefusal(409, { error: 'Somebody has already picked where this trip goes.', alreadyDecided: true }), false);
  assert.equal(waitRefusal(503, { waitingOn: ['NEW'] }), false);
  assert.match(fn('GroupTripScreen'), /const shownError=errorWaits&&wait\.mine\?wait\.sentence:error;/);
  assert.match(fn('PlanDetailScreen'), /const w=waitRefusal\(res\.status,d\)\?waitingFor\(/);
});
test('review 9: a plan with no name opens a sentence with a capital', () => {
  assert.equal(planCalledAtStart({ title: 'Where next?', type: 'trip' }), 'This trip');
  assert.equal(planCalledAtStart({ title: 'Charleston' }), 'Charleston');
  const voting = getNextAction({ ...input(A, { title: 'Where next?', status: 'voting', hasOptions: true },
    { members: members(true), waitingOn: [], solo: false }), vote: null })!;
  assert.equal(voting.title, 'This trip is being voted on');
});
test('review 10: before a kind is picked neither the bar nor the draft card says a total', () => {
  const flow = fn('CreatePlanFlow');
  assert.match(flow, /\(planType\?STEPS:STEPS\.slice\(0,step\+1\)\)\.map/);
  assert.match(APP, /Step \{\(dr\.step\|\|0\)\+1\}\{totalSteps\?` of \$\{totalSteps\}`:""\}/);
});
test('review 11: no comment promises a Try again the status never gives', () => {
  assert.doesNotMatch(fn('GroupTripScreen'), /The status decides whether a Try again is offered/);
  assert.doesNotMatch(fn('GroupTripScreen'), /errorStatus/);
});
test('review 12: a sign-out that fails can be tapped again, and says so', () => {
  const at = APP.indexOf('const handleSignOut=async()=>{');
  const body = APP.slice(at, APP.indexOf('\n  };', at));
  assert.match(body, /try\{await onSignOut\(\);\}\s*catch\(e\)\{[^}]*signingOut\.current=false;/);
  assert.match(body, /Couldn't sign you out/);
});
test('review 13: a throw after the server answered is not blamed on the connection', () => {
  const picks = fn('TripPicks');
  assert.match(picks, /const r=await fetch\("\/api\/recommendations\/trips"\+q\);\s*answered=true;/);
  assert.match(picks, /message:answered\?OUR_SIDE:"Couldn't reach Reach/);
  assert.match(fn('GroupTripScreen'), /setError\(answered\?OUR_SIDE:"Couldn't reach Reach/);
});
