// ─── The 5 November walk, second pass: two accounts at iPhone 14 width ───
// One test (or more) per item found, each written to fail on the bug as it
// was. Behaviour where the rule is a pure helper; the shape of the source
// where it is JSX nobody can render here.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { titledByListing, titleIsVenue } from '../../lib/discovery/listing-title.ts';
import { yelpEvents, yelpPlaces, switchedOff } from '../../lib/discovery/yelp.ts';
import { getNextAction, type NextActionInput } from '../../lib/next-action.ts';
import { planSections } from '../../lib/calendar.ts';
import { everyoneHasAnswered } from '../../lib/everyone-in.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const APP = read('components/reach-app.jsx');
/** The body of a component, from its declaration to the next top-level function. */
function fn(name: string): string {
  const at = APP.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} is in the app`);
  const end = APP.indexOf('\nfunction ', at + 10);
  return APP.slice(at, end < 0 ? undefined : end);
}

// ── 1. The Book tab of an undecided plan ────────────────────────────────
test('1: the empty Book tab names the plan with planCalled, never the "Where next?" placeholder', () => {
  const plan = fn('PlanDetailScreen');
  assert.doesNotMatch(plan, /write the whole \$\{plan\.title\} plan/);
  assert.match(plan, /write the plan for \$\{planCalled\(plan\)\}/);
});
test('1: with no place yet it offers finding the ideas, not "Plan my days for me"', () => {
  const plan = fn('PlanDetailScreen');
  // The same route as next-action's "Find them →" (findNow).
  assert.match(plan, /plan\.destStyle==="undecided"&&\(\s*\/\/[^\n]*\n\s*<button className="bp" onClick=\{\(\)=>push\("groupTrip",\{planId,groupId,find:"1"\}\)\}/);
  assert.match(plan, /\{!loadFailed&&plan\.destStyle!=="undecided"&&\(\s*<>/, 'the days button is not offered without a place');
});

// ── 2. Ideas for you: "Asking again in a moment" ───────────────────────
test('2: the retry is spent only when it fires, and "Asking again" shows only while one is set', () => {
  const picks = fn('TripPicks');
  assert.doesNotMatch(picks, /autoRetried\.current=true;\s*timer=setTimeout/, 'not spent as it is scheduled');
  assert.match(picks, /setRetrySet\(true\);\s*timer=setTimeout\(\(\)=>\{if\(!live\)return;autoRetried\.current=true;setRetrySet\(false\)/);
  assert.match(picks, /\{retrySet\?" Asking again in a moment\.":""\}/);
  assert.doesNotMatch(picks, /autoRetried\.current&&attempt===0\?" Asking again/);
  // A re-run (the location settling) clears what the last run promised.
  assert.match(picks, /let timer=null;\s*setRetrySet\(false\);/);
});

// ── 4. The plan's own card misses a tie ─────────────────────────────────
test('4: the plan screen reads the same vote Home read while its own is on the way', () => {
  const plan = fn('PlanDetailScreen');
  const load = plan.slice(plan.indexOf('const loadVote=async()=>{'), plan.indexOf('const votesCast='));
  assert.match(load, /NEXT_READS\.get\(planId\)/);
  assert.match(load, /setVoteView\(v=>v\|\|d\.vote\)/);
});

// ── 6b. Detail chips nothing verifies ───────────────────────────────────
test('6b: no "Full experience" or "Group booking" chip, and no price box without a price', () => {
  const detail = fn('ExpDetailScreen');
  for (const chip of ['Full experience', 'Group booking', 'Group reservation', 'Drinks & vibes', 'Evening out']) {
    assert.ok(!detail.includes(chip), chip);
  }
  assert.doesNotMatch(detail, /\{exp\.price\|\|"—"\}/);
  assert.match(detail, /\{exp\.price&&\(/);
});

// ── 6c. An event titled only with its venue ─────────────────────────────
test('6c: a title that is just the venue takes the listing\'s own word for what it is', () => {
  const venue = 'The Lounge at Martin Marietta Center for the Performing Arts';
  assert.ok(titleIsVenue(venue, venue));
  assert.ok(titleIsVenue('The Lounge at Martin Marietta', venue), 'cut short');
  assert.ok(!titleIsVenue('Liza Treyger', 'Raleigh Improv'));
  assert.ok(!titleIsVenue('The Lounge', 'The Lounge Bar'), 'too short to say');
  const comedy = titledByListing({ title: venue, venue, category: 'Comedy', date: '2026-11-05', source: 'ticketmaster' });
  assert.equal(comedy?.title, 'Comedy');
  assert.equal(titledByListing({ title: venue, venue, category: 'Event', date: '2026-11-05', source: 'ticketmaster' }), null,
    'the listing says nothing more: left out');
  const place = { title: 'Raleigh Improv', venue: 'Raleigh Improv', category: 'Comedy club', date: null, source: 'osm' };
  assert.equal(titledByListing(place), place, 'a place is called by its name');
  const route = read('app/api/nearby/route.ts');
  assert.match(route, /\.map\(f => titledByListing\(f\)\)/);
});

// ── 6d. Yelp's expired trial is not "a source not answering" ───────────
const realFetch = globalThis.fetch;
const yelpKey = process.env.YELP_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (yelpKey === undefined) delete process.env.YELP_API_KEY; else process.env.YELP_API_KEY = yelpKey;
});
test('6d: TRIAL_EXPIRED and an unaccepted key are a lane not configured', async () => {
  assert.ok(switchedOff(403, '{"error":{"code":"TRIAL_EXPIRED","description":"Your trial has expired."}}'));
  assert.ok(switchedOff(401, ''));
  assert.ok(!switchedOff(500, 'TRIAL_EXPIRED'), 'a server error may answer next time');
  assert.ok(!switchedOff(429, ''));
  process.env.YELP_API_KEY = 'test';
  globalThis.fetch = (async () => new Response('{"error":{"code":"TRIAL_EXPIRED"}}', { status: 403 })) as typeof fetch;
  const seeker = { lat: 35.18, lng: -79.39, city: 'Southern Pines', interests: ['live music'], browse: [], avoid: [] } as any;
  const [events, places] = await Promise.all([yelpEvents(seeker), yelpPlaces(seeker)]);
  assert.equal(events.status, 'no_key');
  assert.equal(places.status, 'no_key');
  // And the footer reads errors only.
  assert.match(APP, /sources\.some\(s=>s\.status==="error"\)&&visible\.length>0/);
});

// ── 7. A night out is one evening ───────────────────────────────────────
const A = 'u-org', B = 'u-new';
const members = (bReady: boolean) => [
  { userId: A, name: 'Test Organiser', ready: true, answered: true },
  { userId: B, name: 'NEW Member', ready: bReady, answered: bReady },
];
function input(me: string, over: Partial<NextActionInput['plan']> = {}, readiness = { members: members(true), waitingOn: [] as string[], solo: false }): NextActionInput {
  return {
    plan: { id: 'p1', groupId: 'g1', status: 'planning', type: 'restaurant', title: 'Dinner in Southern Pines', destStyle: 'fixed',
      hasOptions: false, createdBy: A, itinerary: [], ...over },
    bookings: [], funding: null, readiness, essentials: null, memberCount: 2, me,
    now: new Date('2026-11-05T15:00:00Z'),
  };
}
test('7: a night out with no plan yet is "Plan the evening", never "the days"', () => {
  const a = getNextAction(input(A))!;
  assert.equal(a.title, 'Plan the evening');
  assert.doesNotMatch(`${a.title} ${a.body}`, /days|day-by-day/);
  const trip = getNextAction(input(A, { type: 'trip', title: 'Charleston long weekend' }))!;
  assert.equal(trip.title, 'Plan the days', 'a trip still has days');
});
test('7: the member still to answer for a night out is not told about "nights out"', () => {
  const b = getNextAction(input(B, {}, { members: members(false), waitingOn: ['NEW'], solo: false }))!;
  assert.equal(b.title, 'Add your two cents');
  assert.doesNotMatch(b.body ?? '', /nights out/);
  assert.match(b.body ?? '', /evening's plan/);
});
test('7: the Budget tab points at the Book tab, and says evening on a night out', () => {
  const plan = fn('PlanDetailScreen');
  assert.doesNotMatch(plan, /Itinerary tab and every event/);
  assert.match(plan, /nightPlan\s*\?"Costs appear here once the evening has a plan\. Build it on the Book tab/);
});

// ── 8. The header's status chip in light mode ───────────────────────────
test('8: the plan header chip has fixed light-on-dark colours, not the page pill', () => {
  const plan = fn('PlanDetailScreen');
  assert.doesNotMatch(plan, /\{na&&<span className=\{`pill \$\{nextTone\(na\)\}`\}>\{na\.chip\}<\/span>\}/);
  assert.match(plan, /\{na&&<span className="pill" style=\{HEADER_CHIP\[nextTone\(na\)\]/);
  assert.match(APP, /const HEADER_CHIP=\{\s*"pill-g":\{background:"rgba\(16,185,129,\.30\)",color:"#ecfdf5"\}/);
});

// ── 9. Minor ────────────────────────────────────────────────────────────
test('9a: a called-off or finished plan is not "Coming up"', () => {
  const sections = planSections([
    { id: 'live', startDate: '2027-01-22', endDate: '2027-01-25', status: 'voting' },
    { id: 'off', startDate: '2027-01-29', endDate: '2027-01-30', status: 'cancelled' },
    { id: 'done', startDate: '2027-02-05', status: 'completed' },
  ], '2026-11-05');
  const up = sections.find(s => s.key === 'upcoming')!;
  assert.deepEqual(up.plans.map(p => p.id), ['live']);
  assert.deepEqual(sections.find(s => s.key === 'off')?.plans.map(p => p.id), ['off'], 'kept, under its own heading');
  assert.deepEqual(sections.find(s => s.key === 'past')?.plans.map(p => p.id), ['done']);
});
test('9b: no "Change vote to this" on an option you vetoed', () => {
  assert.match(APP, /\{!vetoed&&<button disabled=\{!!busy\|\|mine\} onClick=\{\(\)=>cast\(o\)\}/);
  assert.match(APP, /\{!vetoed&&<button disabled=\{!!voteBusy\|\|mine\} onClick=\{\(\)=>castVote\(opt\)\}/);
});
test('9c: "everyoneIn" is whether everyone answered, not whether this request announced it', async () => {
  const fake = (members: string[], said: string[]) => ({
    from: (t: string) => ({ select: () => ({ eq: async () => t === 'group_members'
      ? { data: members.map(user_id => ({ user_id })), error: null }
      : { data: said.map(user_id => ({ user_id, submitted_at: '2026-11-05T12:00:00Z' })), error: null } }) }),
  }) as never;
  assert.equal(await everyoneHasAnswered(fake(['a', 'b'], ['a', 'b']), 'p', 'g'), true);
  assert.equal(await everyoneHasAnswered(fake(['a', 'b'], ['a']), 'p', 'g'), false);
  const route = read('app/api/plans/[planId]/preferences/route.ts');
  assert.match(route, /everyoneIn: everyone, announced/);
  assert.match(route, /announced \? true : await everyoneHasAnswered\(/);
});
