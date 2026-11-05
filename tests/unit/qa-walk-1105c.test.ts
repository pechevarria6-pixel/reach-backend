// ─── The 5 November walk, second pass: the review of its fixes ──────────
// Each test here is a finding from reviewing commit 07dc497, said as the
// behaviour it should have had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { titledByListing } from '../../lib/discovery/listing-title.ts';
import { voteOpenNowAnsweredNotice } from '../../lib/vote-complete.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const APP = read('components/reach-app.jsx');
function fn(name: string): string {
  const at = APP.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} is in the app`);
  const end = APP.indexOf('\nfunction ', at + 10);
  return APP.slice(at, end < 0 ? undefined : end);
}
const PLAN = fn('PlanDetailScreen');

// ── 1. Ideas already found: the Book tab says pick, not find ────────────
test('R1: with ideas already found the Book tab points at them, not at finding them again', () => {
  assert.match(PLAN, /plan\.destStyle==="undecided"&&plan\.hasIdeas&&\(\s*(\/\/[^\n]*\n\s*)+<button className="bp" onClick=\{\(\)=>push\("groupTrip",\{planId,groupId\}\)\}[^>]*>\s*See them →/,
    'the same route as next-action\'s "See them →", with no find');
  // "Find them →" only where there is nothing to see yet.
  assert.match(PLAN, /\{!loadFailed&&plan\.destStyle==="undecided"&&!plan\.hasIdeas&&!\(!votingOpen&&prefs\)&&\(/);
  assert.match(PLAN, /\?plan\.hasIdeas\s*\?`The \$\{nightPlan\?"ideas for the night":"trip ideas"\} for \$\{planCalled\(plan\)\} are ready\./);
});

// ── 2. A night out waits for the evening, not the days ──────────────────
test('R2: the waiting line says evening on a night out and ideas on a plan with no place', () => {
  const at = PLAN.indexOf(':!votingOpen&&prefs');
  assert.ok(at > 0);
  const wait = PLAN.slice(at, at + 4000);
  assert.match(wait, /We plan the evening once everyone's in/);
  assert.match(wait, /are found once everyone's in, so they're built from every answer/);
  // The days sentence is the trip's, behind both checks.
  assert.match(wait, /:nightPlan\s*\?"We plan the evening[^"]*"\s*:"We write the days/);
  // Nothing on a night out says "days" in the empty Book tab.
  assert.match(wait, /\$\{nightPlan\?"no evening":"no days"\}/);
});

// ── 3. The last answer opens a vote that was waiting on it ──────────────
const plan = {
  id: 'p1', group_id: 'g1', status: 'voting', title: 'Charleston long weekend', type: 'trip',
  destination_style: 'decided', vote_options: ['Downtown Charleston', 'Folly Beach'],
};
test('R3: once everyone is in on an open vote, the group hears it is open — all but the last to answer', () => {
  const n = voteOpenNowAnsweredNotice({ plan, readiness: { allReady: true }, memberIds: ['a', 'b'], actorId: 'b' });
  assert.ok(n);
  assert.deepEqual(n.to, ['a']);
  assert.equal(n.note.kind, 'vote_open');
  assert.equal(n.note.title, 'The vote is open');
  assert.equal(n.note.body, 'Downtown Charleston · Folly Beach — vote on Charleston long weekend.');
  assert.equal(n.key, 'p1:vote-open:Downtown Charleston|Folly Beach', 'once per set of options');
});
test('R3: nothing said while somebody is still to answer, with no vote open, or when readiness failed', () => {
  assert.equal(voteOpenNowAnsweredNotice({ plan, readiness: { allReady: false }, memberIds: ['a', 'b'], actorId: 'b' }), null);
  assert.equal(voteOpenNowAnsweredNotice({ plan, readiness: null, memberIds: ['a', 'b'], actorId: 'b' }), null);
  assert.equal(voteOpenNowAnsweredNotice({ plan: { ...plan, status: 'planning' }, readiness: { allReady: true }, memberIds: ['a', 'b'], actorId: 'b' }), null);
  assert.equal(voteOpenNowAnsweredNotice({ plan: { ...plan, vote_options: [] }, readiness: { allReady: true }, memberIds: ['a', 'b'], actorId: 'b' }), null);
});
test('R3: the preferences route tells the group, once, after saving — and never fails the save for it', () => {
  const route = read('app/api/plans/[planId]/preferences/route.ts');
  const lib = read('lib/vote-complete.ts');
  const call = route.indexOf('tellVoteOpenIfAnswersComplete(ctx.db');
  assert.ok(call > route.indexOf("console.error('[plan preferences POST] failed'"), 'after the save');
  assert.match(route.slice(call, call + 400), /\.catch\(/);
  const body = lib.slice(lib.indexOf('export async function tellVoteOpenIfAnswersComplete'));
  assert.ok(body.indexOf('claimOnce(') > 0 && body.indexOf('claimOnce(') < body.indexOf('notifyUsers('), 'claimed before it is sent');
  assert.match(body, /planReadiness\(db, planId, groupId, plan\.solo_mode === true, \{ undecided: isUndecided\(plan\) \}\)/,
    'the same readiness the /vote gate reads');
});
test('R3: the organiser is not told "Sent round for a vote" when nobody can vote yet', () => {
  // Nor "The vote's open" over a Vote tab that says it isn't yet.
  assert.match(PLAN, /toast\(votingOpen\?"Sent round for a vote":"Sent for a vote\. Voting opens once everyone has answered/);
});

// ── 4. A title is renamed only in the listing's own words ───────────────
test('R4: an event titled with its venue is renamed only by a lane that classifies its own listings', () => {
  const venue = 'Durham Performing Arts Center';
  const row = { title: venue, venue, category: 'Theatre', date: '2026-11-07', source: 'harvest' };
  assert.equal(titledByListing(row, 'harvest'), null, "the venue's map kind is not what the event is");
  // A cached Ticketmaster gig is a finding of the cache lane: its category is our label.
  assert.equal(titledByListing({ ...row, source: 'ticketmaster' }, 'harvest'), null);
  assert.equal(titledByListing({ ...row, category: 'Comedy', source: 'yelp-events' }, 'yelp-events')?.title, 'Comedy');
  assert.equal(titledByListing({ ...row, category: 'Comedy', source: 'ticketmaster' }, 'ticketmaster')?.title, 'Comedy');
  // A real title is never touched, whichever lane.
  const gig = { ...row, title: 'Liza Treyger' };
  assert.equal(titledByListing(gig, 'harvest'), gig);
});

// ── 5. Home's vote read is used only while fresh, only until ours ──────
test('R5: the held vote is age-checked like readNextInputs and dropped when the fresh read fails', () => {
  const load = PLAN.slice(PLAN.indexOf('const loadVote=async()=>{'), PLAN.indexOf('const votesCast='));
  assert.match(load, /if\(held&&Date\.now\(\)-held\.at<30000\)held\.p\.then/);
  assert.match(load, /if\(!settled&&d\?\.vote\)/, 'a late held read never overwrites ours');
  assert.match(load, /else setVoteView\(v=>heldVote&&v===heldVote\?null:v\)/);
});

// ── 6. Detail: price as listed, and Where only from a field that says where
test('R6: a held price is "as listed", never "per person"', () => {
  const detail = fn('ExpDetailScreen');
  assert.doesNotMatch(detail, />per person</);
  assert.doesNotMatch(detail, /\{exp\.price\} per person/);
  assert.match(detail, />as listed</);
  assert.match(detail, /\{exp\.price\} · as listed/);
});
test('R6: Where is the venue for an event and the street or town for a place — never a kind or a time', () => {
  const detail = fn('ExpDetailScreen');
  const src = detail.slice(detail.indexOf('const getIncludes=()=>{'));
  const body = src.slice(0, src.indexOf('\n  };') + 4);
  // Run the real function on the cases from the review.
  const getIncludes = (exp: Record<string, unknown>) =>
    new Function('exp', `${body.replace('const getIncludes=', 'return (')}\n)();`)(exp) as string[];
  assert.deepEqual(getIncludes({ title: 'Pullen Park', sub: 'Park', venue: 'Pullen Park', date: null }), [], 'a kind is not a place');
  assert.deepEqual(getIncludes({ title: 'Pullen Park', sub: 'Park · Raleigh', venue: 'Pullen Park', date: null }), ['📍 Raleigh']);
  assert.deepEqual(getIncludes({ title: 'Wheel throwing', sub: 'Thursdays 7pm', venue: null, date: null, whenText: 'Thursdays 7pm' }), [], 'a time is not a place');
  assert.deepEqual(getIncludes({ title: 'Liza Treyger', sub: 'Thu, Nov 5 · Raleigh Improv', venue: 'Raleigh Improv', date: '2026-11-05' }), ['📍 Raleigh Improv']);
});

// ── 9a. The heading says called off; the card does not say it again ─────
test('R9a: no "Called off" pill on a card under the "Called off" heading', () => {
  assert.match(APP, /plan\.status==="cancelled"\s*\?section\.key==="off"\?null:<span className="pill pill-m">Called off<\/span>/);
});
