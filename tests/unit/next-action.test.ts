import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  getNextAction, NEXT_STATES, usd, providerName,
  type NextActionInput, type NextAction, type NextState, type NextBooking, type Cta,
} from '../../lib/next-action.ts';
import { BookingRow } from '../../lib/contracts/booking.ts';
import { ItineraryItemRow, itemFromRow } from '../../lib/contracts/itinerary-item.ts';
import { isSoloCount } from '../../lib/joining.ts';

// ─── Fixtures, on the contract shapes ────────────────────────────────────
// Every booking goes through BookingRow and every line through
// ItineraryItemRow → itemFromRow, so a fixture cannot be a shape the app
// never produces.

const ME = 'u-me', SAM = 'u-sam', ALEX = 'u-alex';

function booking(r: Partial<NextBooking> & { id: string }): NextBooking {
  const parsed = BookingRow.safeParse(r);
  assert.ok(parsed.success, `fixture ${r.id} is not a BookingRow: ${parsed.success ? '' : parsed.error.message}`);
  return r;
}
function line(r: Record<string, unknown>) {
  const parsed = ItineraryItemRow.safeParse({ title: 'A line', ...r });
  assert.ok(parsed.success, `line fixture is not an ItineraryItemRow`);
  return itemFromRow({ title: 'A line', ...r });
}

const HOTEL_LINE = line({ id: 'l-hotel', title: '3 nights at the Gonzo Inn', type: 'hotel', booking_mode: 'reach' });
const FLIGHT_LINE = line({ id: 'l-flight', title: 'RDU → CNY', type: 'flight', booking_mode: 'reach' });
const DINNER_LINE = line({ id: 'l-dinner', title: 'Dinner', venue_name: 'Desert Bistro', type: 'restaurant', booking_mode: 'ahead', venue_website: 'https://desertbistro.com' });
const WALK_IN = line({ id: 'l-pint', title: 'A pint', type: 'restaurant', booking_mode: 'walk_in' });

const hotel = (status: string, extra: Partial<NextBooking> = {}) => booking({
  id: 'b-hotel', vertical: 'hotel', status, price_cents: 60000, mode: 'native', provider: 'liteapi',
  itinerary_item_id: 'l-hotel', detail: '3 nights at the Gonzo Inn', ...extra,
});
const flight = (status: string, extra: Partial<NextBooking> = {}) => booking({
  id: 'b-flight', vertical: 'flight', status, price_cents: 30000, mode: 'native', provider: 'duffel',
  itinerary_item_id: 'l-flight', detail: 'American Airlines · RDU → CNY', ...extra,
});
// The shape POST /api/bookings writes for a table or a seat: every quote
// becomes 'awaiting_approval', and checkout never approves a redirect, so it
// stays there. 'redirected' is only written for a flight handed off at approval.
const table = (extra: Partial<NextBooking> = {}) => booking({
  id: 'b-table', vertical: 'restaurant', status: 'awaiting_approval', mode: 'redirect', provider: 'resy',
  redirect_url: 'https://resy.com/cities/moab/desert-bistro', detail: 'Desert Bistro', ...extra,
});

/** Nobody asked yet: plan-readiness counts each member ready, and nobody has answered. */
const notAsked = (ids: string[]) => ({
  members: ids.map(userId => ({ userId, name: userId === ME ? 'Pat Me' : userId === SAM ? 'Sam Lee' : 'Alex Kim', ready: true, answered: false })),
  waitingOn: [], solo: false,
});

const answers = (who: Record<string, boolean>) => ({
  members: Object.entries(who).map(([userId, answered]) => ({
    userId, name: userId === ME ? 'Pat Me' : userId === SAM ? 'Sam Lee' : 'Alex Kim', ready: answered, answered,
  })),
  waitingOn: Object.entries(who).filter(([id, a]) => !a && id !== ME).map(([id]) => (id === SAM ? 'Sam' : 'Alex')),
  solo: false,
});
const detailsOf = (missing: Record<string, string[]>) => ({
  travelers: Object.entries(missing).map(([userId, m]) => ({ userId, name: userId === ME ? 'Pat Me' : 'Sam Lee', ready: !m.length, missing: m })),
});

const FUNDED = { memberCount: 3, targetCents: 90000, collectedCents: 90000, funded: true, myPaidCents: 30000, myRemainingCents: 0 };

/** A group trip of three that has been decided, planned and locked in. */
function base(over: Partial<NextActionInput> = {}): NextActionInput {
  return {
    plan: { id: 'p1', groupId: 'g1', status: 'approved', type: 'trip', title: 'Moab', destStyle: 'fixed',
      hasOptions: false, createdBy: ME, itinerary: [HOTEL_LINE], ...(over.plan ?? {}) },
    bookings: [], funding: null, readiness: answers({ [ME]: true, [SAM]: true, [ALEX]: true }),
    essentials: null, memberCount: 3, me: ME,
    now: new Date('2026-09-25T15:00:00Z'),
    ...over,
    ...(over.plan ? { plan: { id: 'p1', groupId: 'g1', status: 'approved', type: 'trip', title: 'Moab', destStyle: 'fixed', hasOptions: false, createdBy: ME, itinerary: [HOTEL_LINE], ...over.plan } } : {}),
  };
}

const FIXTURES: { name: string; state: NextState; input: NextActionInput }[] = [
  { name: 'I have not said what I want', state: 'needs_trip_input', input: base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'planning', itinerary: [] },
    readiness: answers({ [ME]: false, [SAM]: true, [ALEX]: false }) }) },
  { name: 'nothing planned yet', state: 'needs_trip_input', input: base({ plan: { id: 'p1', status: 'planning', itinerary: [] } }) },
  { name: 'I answered, Sam and Alex have not', state: 'waiting_on_others', input: base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'planning', itinerary: [] },
    readiness: answers({ [ME]: true, [SAM]: false, [ALEX]: false }) }) },
  { name: 'the vote is open and I have not voted', state: 'vote_open', input: base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'voting', hasOptions: true, itinerary: [] },
    vote: { decided: false, myVote: null, everyoneVoted: false, mayPick: true, stillToVote: ['you', 'Sam'] } }) },
  { name: 'I voted, Sam has not', state: 'waiting_on_others', input: base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'voting', hasOptions: true, itinerary: [] },
    vote: { decided: false, myVote: 'Moab', everyoneVoted: false, mayPick: true, stillToVote: ['Sam'] } }) },
  { name: 'planned, not locked in, I organise', state: 'lock_in', input: base({ plan: { id: 'p1', status: 'planning' } }) },
  { name: 'planned, not locked in, Sam organises', state: 'waiting_on_others', input: base({
    plan: { id: 'p1', status: 'planning', createdBy: SAM }, vote: { organiser: { name: 'Sam', isYou: false } } }) },
  { name: 'locked in, nothing priced yet', state: 'pay_share', input: base() },
  { name: 'priced, my share unpaid', state: 'pay_share', input: base({
    bookings: [hotel('awaiting_approval')],
    funding: { memberCount: 3, targetCents: 60000, collectedCents: 0, funded: false, myPaidCents: 0, myRemainingCents: 20000 } }) },
  { name: 'my share paid, the others not', state: 'waiting_on_payments', input: base({
    bookings: [hotel('awaiting_approval')],
    funding: { memberCount: 3, targetCents: 60000, collectedCents: 20000, funded: false, myPaidCents: 20000, myRemainingCents: 0 } }) },
  { name: 'paid for, a flight waiting, my details missing', state: 'needs_travel_details', input: base({
    plan: { id: 'p1', itinerary: [HOTEL_LINE, FLIGHT_LINE] },
    bookings: [hotel('awaiting_approval'), flight('awaiting_approval')], funding: FUNDED,
    essentials: detailsOf({ [ME]: ['date of birth'], [SAM]: [] }) }) },
  { name: 'paid for, waiting to be booked', state: 'ready_to_book', input: base({
    bookings: [hotel('awaiting_approval')], funding: FUNDED, essentials: detailsOf({ [ME]: [], [SAM]: [] }) }) },
  { name: 'the table is on Resy and nobody has said they got it', state: 'finish_elsewhere', input: base({
    bookings: [hotel('confirmed'), table()], funding: FUNDED }) },
  { name: 'a dinner to book ahead on its own site', state: 'finish_elsewhere', input: base({
    plan: { id: 'p1', itinerary: [HOTEL_LINE, DINNER_LINE] }, bookings: [hotel('confirmed')], funding: FUNDED }) },
  { name: 'the hotel is with the provider', state: 'booking_in_progress', input: base({
    bookings: [hotel('booking', { approved_at: '2026-09-25T14:59:30Z', updated_at: '2026-09-25T14:59:30Z' })], funding: FUNDED }) },
  { name: 'the flight could not be booked', state: 'needs_attention', input: base({
    plan: { id: 'p1', itinerary: [HOTEL_LINE, FLIGHT_LINE] },
    bookings: [hotel('confirmed'), flight('failed')], funding: FUNDED }) },
  { name: 'the price went up $31', state: 'needs_attention', input: base({
    bookings: [hotel('awaiting_approval')], funding: FUNDED, outcome: { status: 409, priceChangeCents: 3100 } }) },
  { name: 'the hotel is held', state: 'needs_attention', input: base({
    plan: { id: 'p1', itinerary: [HOTEL_LINE, FLIGHT_LINE] },
    bookings: [flight('confirmed'), hotel('quoted')], funding: FUNDED }) },
  { name: 'all booked', state: 'booked', input: base({
    bookings: [hotel('confirmed')], funding: FUNDED }) },
  { name: 'a walk-in night, locked in', state: 'booked', input: base({
    plan: { id: 'p1', type: 'restaurant', itinerary: [WALK_IN] } }) },
];

/** A fixture by the start of its name, so a new fixture never shifts another test's input. */
const fx = (name: string) => {
  const f = FIXTURES.find(x => x.name.startsWith(name));
  assert.ok(f, `no fixture named ${name}`);
  return f.input;
};

const run = (i: NextActionInput) => getNextAction(i) as NextAction;

/** The same plan for one person: no group, no readiness to wait on. */
function alone(i: NextActionInput): NextActionInput {
  return {
    ...i, memberCount: 1,
    readiness: { members: [], waitingOn: [], solo: true },
    vote: i.vote ? { ...i.vote, organiser: null, stillToVote: [] } : i.vote,
    // One person's share is the whole trip, so what they have paid is what
    // is in, and what is left is theirs.
    funding: i.funding ? {
      ...i.funding, memberCount: 1, myPaidCents: i.funding.collectedCents,
      myRemainingCents: Math.max(0, (i.funding.targetCents ?? 0) - (i.funding.collectedCents ?? 0)),
    } : i.funding,
    essentials: i.essentials ? { travelers: i.essentials.travelers.filter(t => t.userId === ME) } : i.essentials,
  };
}

// ─── Each state, from its fixture ────────────────────────────────────────

for (const f of FIXTURES) {
  test(`${f.name} → ${f.state}`, () => {
    assert.equal(run(f.input).state, f.state);
  });
}

test('every state has a fixture', () => {
  const covered = new Set(FIXTURES.map(f => f.state));
  assert.deepEqual(NEXT_STATES.filter(s => !covered.has(s)), []);
});

test('a trip called off has no next action', () => {
  assert.equal(getNextAction(base({ plan: { id: 'p1', status: 'cancelled' } })), null);
});

test('this file and lib/joining.ts agree on what solo is', () => {
  // The solo rule here is written out, not imported (the client bundle), so
  // it is held to isSoloCount by what it does to a wait.
  for (const n of [0, 1, 2, 5, Number.NaN]) {
    const group = run({ ...fx('I answered'), memberCount: n });
    assert.equal(group.state === 'waiting_on_others', !isSoloCount(n), `memberCount ${n}`);
  }
});

// ─── Solo never waits on anybody ─────────────────────────────────────────

test('a plan for one never returns waiting_on_others or waiting_on_payments', () => {
  for (const f of FIXTURES) {
    const a = run(alone(f.input));
    assert.ok(a, f.name);
    assert.notEqual(a.state, 'waiting_on_others', f.name);
    assert.notEqual(a.state, 'waiting_on_payments', f.name);
    assert.equal(a.waitingOn, undefined, f.name);
    assert.ok(!(a.cta && a.cta.kind === 'nudge'), `${f.name}: nobody to remind`);
  }
  // Even a 402, which on a group means somebody else owes.
  const short = run(alone({ ...fx('priced, my share unpaid'), outcome: { status: 402 } }));
  assert.equal(short.state, 'pay_share');
});

test('waiting names people, first names only, and never the reader', () => {
  const a = run(fx('I answered'));
  assert.deepEqual(a.waitingOn, ['Sam', 'Alex']);
  assert.equal(a.title, 'Waiting on Sam and Alex');
  const v = run(fx('I voted'));
  assert.deepEqual(v.waitingOn, ['Sam']);
  assert.equal(v.cta?.label, 'Remind Sam');
});

// ─── What "booked" needs ────────────────────────────────────────────────

test('booked requires every counted row confirmed', () => {
  for (const f of FIXTURES) {
    const a = run(f.input);
    if (a.state !== 'booked') continue;
    if ((f.input.bookings ?? []).length) {
      assert.equal(a.claim, 'all_booked', f.name);
      assert.equal(a.allBooked, true, f.name);
    } else {
      // Nothing was booked, so nothing may say it was.
      assert.equal(a.allBooked, false, f.name);
      assert.doesNotMatch(`${a.title} ${a.body}`, /booked/i, f.name);
    }
  }
});

test('a redirect nobody has confirmed is never booked; one they have is left out of the count', () => {
  const signedAll = { funding: FUNDED };
  assert.equal(run(base({ ...signedAll, bookings: [hotel('confirmed'), table()] })).state, 'finish_elsewhere');
  const got = run(base({ ...signedAll, bookings: [hotel('confirmed'), table({ confirmation_number: 'RESY-4411' })] }));
  assert.equal(got.state, 'booked');
  assert.equal(got.claim, 'all_booked');
  // Only the redirect, confirmed by the person: Reach booked nothing, so it
  // is all set and not "all booked".
  const only = run(base({ ...signedAll, plan: { id: 'p1', itinerary: [] }, bookings: [table({ confirmation_number: 'RESY-4411' })],
    funding: { memberCount: 3, targetCents: 0, collectedCents: 0, funded: false, myPaidCents: 0, myRemainingCents: 0 } }));
  assert.equal(only.state, 'booked');
  assert.equal(only.allBooked, false);
});

test('a held row is never booked', () => {
  const a = run(base({ plan: { id: 'p1', itinerary: [HOTEL_LINE, FLIGHT_LINE] },
    bookings: [flight('confirmed'), hotel('quoted')], funding: FUNDED }));
  assert.notEqual(a.state, 'booked');
  assert.match(a.title, /on hold/);
});

test('a row I sit out is not mine to finish; one everybody sits out is not counted', () => {
  const skipped = run(base({ bookings: [hotel('confirmed'), table()], funding: FUNDED,
    skips: [{ ref: 'b-table', userId: ME }] }));
  assert.notEqual(skipped.state, 'finish_elsewhere');
  // A failed dinner everybody sits out is not a gap in the trip.
  const everyone = [ME, SAM, ALEX].map(userId => ({ ref: 'b-dinner', userId }));
  const failedDinner = booking({ id: 'b-dinner', vertical: 'restaurant', status: 'failed', mode: 'native', provider: 'resy' });
  const a = run(base({ bookings: [hotel('confirmed'), failedDinner], funding: FUNDED, skips: everyone }));
  assert.equal(a.claim, 'all_booked');
});

test('nothing reaches booked before it is locked in', () => {
  for (const f of FIXTURES) {
    for (const input of [f.input, alone(f.input)]) {
      const open = run({ ...input, plan: { ...input.plan, status: 'planning' } });
      if ((input.bookings ?? []).length || input.funding?.collectedCents) continue; // moving: past lock-in whatever the status says
      assert.notEqual(open.state, 'booked', `${f.name} (${input.memberCount})`);
    }
  }
});

// ─── Rows in the shapes production writes ────────────────────────────────

const EVENT_LINE = line({ id: 'l-gig', title: 'J. Cole', type: 'event', booking_mode: 'reach' });
const gig = (extra: Partial<NextBooking> = {}) => booking({
  id: 'b-gig', vertical: 'event', status: 'awaiting_approval', mode: 'redirect', provider: 'ticketmaster',
  redirect_url: 'https://ticketmaster.com/x', itinerary_item_id: 'l-gig', detail: 'J. Cole', ...extra,
});
const NO_MONEY = { memberCount: 3, targetCents: 0, collectedCents: 0, funded: false, myPaidCents: 0, myRemainingCents: 0 };
const nightOut = (over: Partial<NextActionInput> = {}) => base({
  plan: { id: 'p1', type: 'restaurant', title: 'J. Cole', itinerary: [EVENT_LINE] }, bookings: [gig()], funding: NO_MONEY, ...over,
});
/** The flight handed to the airline at approval (approve route: mode 'redirect', status 'redirected'). */
const handedFlight = (extra: Partial<NextBooking> = {}) => flight('redirected', { mode: 'redirect', redirect_url: 'https://aa.com/b/1', ...extra });
const flightGotElsewhere = () => base({
  plan: { id: 'p1', itinerary: [HOTEL_LINE, FLIGHT_LINE] },
  bookings: [hotel('confirmed'), handedFlight({ confirmation_number: 'ABC123' })], funding: FUNDED,
});
/** A group of three, a hotel booked, and a flight line /bookable skipped, so it has no row. */
const flightUnrowed = (me: string, createdBy: string) => base({
  plan: { id: 'p1', createdBy, itinerary: [HOTEL_LINE, FLIGHT_LINE] }, me,
  bookings: [hotel('confirmed')], funding: FUNDED,
  vote: { organiser: { name: 'Sam', isYou: me === createdBy } },
});

const EXTRA: [string, NextActionInput][] = [
  ['a Ticketmaster seat, as POST /api/bookings writes it', nightOut()],
  ['a Ticketmaster seat somebody got', nightOut({ bookings: [gig({ confirmation_number: 'X1' })] })],
  ['a flight bought on the airline\'s site', flightGotElsewhere()],
  ['a flight line skipped, as a member', flightUnrowed(ME, SAM)],
  ['a flight line skipped, as the organiser', flightUnrowed(SAM, SAM)],
  ['undecided, nobody asked yet', base({ plan: { id: 'p1', destStyle: 'undecided', status: 'planning', itinerary: [] },
    readiness: notAsked([ME, SAM, ALEX]) })],
  ['undecided, readiness unread', base({ plan: { id: 'p1', destStyle: 'undecided', status: 'planning', itinerary: [] },
    readiness: null })],
];
const ex = (name: string) => EXTRA.find(([n]) => n.startsWith(name))![1];

test('a redirect in the shape production writes reaches finish_elsewhere, with the link and "I\'ve got it"', () => {
  const a = run(ex('a Ticketmaster seat, as'));
  assert.equal(a.state, 'finish_elsewhere');
  assert.equal(a.title, 'Finish on Ticketmaster');
  assert.deepEqual(a.cta, { label: 'Finish on Ticketmaster →', kind: 'link', href: 'https://ticketmaster.com/x' });
  assert.deepEqual(a.secondary, { label: "I've got it ✓", kind: 'confirm', bookingId: 'b-gig' });
  // The Resy table in the same shape, on a line Reach does not track.
  const t = run(fx('the table is on Resy'));
  assert.equal(t.state, 'finish_elsewhere');
  // And the flight handed off at approval, which is written 'redirected'.
  const f = run(base({ plan: { id: 'p1', itinerary: [HOTEL_LINE, FLIGHT_LINE] },
    bookings: [hotel('confirmed'), handedFlight()], funding: FUNDED }));
  assert.equal(f.state, 'finish_elsewhere');
  assert.equal(f.title, 'Finish on the airline');
});

test('a redirect somebody has got moves on, and never back to "isn\'t booked yet"', () => {
  const a = run(ex('a Ticketmaster seat somebody got'));
  assert.notEqual(a.state, 'finish_elsewhere');
  assert.doesNotMatch(a.title, /isn't booked yet/);
  const got = run(base({ funding: FUNDED, bookings: [hotel('confirmed'), table({ confirmation_number: 'R-1' })] }));
  assert.equal(got.state, 'booked');
});

test('a flight bought on the airline\'s site, with the number to show for it, is booked', () => {
  const a = run(flightGotElsewhere());
  assert.equal(a.state, 'booked');
  // The hotel is Reach's and confirmed; the flight is left out of the count
  // and done on the Book list, so nothing is waiting and nothing is a gap.
  assert.equal(a.claim, 'all_booked');
  assert.equal(a.allBooked, true);
  // Without the number it is still theirs to finish.
  const open = run(base({ plan: { id: 'p1', itinerary: [HOTEL_LINE, FLIGHT_LINE] },
    bookings: [hotel('confirmed'), handedFlight()], funding: FUNDED }));
  assert.equal(open.state, 'finish_elsewhere');
  assert.equal(open.allBooked, false);
  // The same for a ticket on a line Reach tracks.
  assert.equal(run(ex('a Ticketmaster seat somebody got')).state, 'booked');
});

test('a line Reach books with no row, after something is booked, is not sent back to lock in', () => {
  for (const [who, i] of [['member', flightUnrowed(ME, SAM)], ['organiser', flightUnrowed(SAM, SAM)]] as const) {
    const a = run(i);
    assert.equal(a.state, 'needs_attention', who);
    assert.notEqual(a.title, 'Lock it in', who);
    assert.doesNotMatch(`${a.title} ${a.body}`, /Nothing is booked|still have/, who);
    assert.equal(a.title, 'RDU → CNY has no price yet', who);
    assert.equal(a.cta?.kind === 'navigate' && a.cta.route.screen, 'checkout', who);
  }
});

test('"Everyone has answered" only when everyone has', () => {
  for (const name of ['undecided, nobody asked yet', 'undecided, readiness unread']) {
    const a = run(ex(name));
    assert.equal(a.state, 'needs_trip_input', name);
    assert.doesNotMatch(`${a.title} ${a.body}`, /Everyone|each of you/, name);
  }
  const all = run(base({ plan: { id: 'p1', destStyle: 'undecided', status: 'planning', itinerary: [] } }));
  assert.equal(all.title, 'Everyone has answered');
});

// ─── One thing to press, and words that are true ─────────────────────────

const everyAction = () => FIXTURES.flatMap(f => [
  { name: f.name, solo: false, a: run(f.input) },
  { name: `${f.name} (solo)`, solo: true, a: run(alone(f.input)) },
]).concat([
  // Group-only sentences, reached only with more than one person: drawn so
  // check:solo-copy has claims about other people to hold to a guard.
  { name: 'a 402 on a group', solo: false, a: run({ ...fx('paid for, waiting'), outcome: { status: 402 } }) },
  { name: 'everyone voted, my pick', solo: false, a: run(base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'voting', hasOptions: true, itinerary: [] },
    vote: { decided: false, myVote: 'Moab', everyoneVoted: true, mayPick: true, stillToVote: [] } })) },
  { name: 'everyone answered', solo: false, a: run(base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'planning', itinerary: [] } })) },
  ...EXTRA.flatMap(([name, input]) => [
    { name, solo: false, a: run(input) },
    { name: `${name} (solo)`, solo: true, a: run(alone(input)) },
  ]),
]);

test('each state has one CTA, except a booking with the provider, which has nothing to press', () => {
  for (const { name, a } of everyAction()) {
    if (a.state === 'booking_in_progress') { assert.equal(a.cta, null, name); continue; }
    assert.ok(a.cta && a.cta.label.trim(), name);
    if (a.cta.kind === 'navigate') assert.ok(a.cta.route.params.planId || a.cta.route.screen === 'profile', name);
    assert.ok(a.chip.trim(), name);
  }
});

test('finish elsewhere names the seller from the row, links to it, and offers "I\'ve got it"', () => {
  const a = run(FIXTURES.find(f => f.name.includes('Resy'))!.input);
  assert.equal(a.title, 'Finish on Resy');
  assert.deepEqual(a.cta, { label: 'Finish on Resy →', kind: 'link', href: 'https://resy.com/cities/moab/desert-bistro' });
  assert.deepEqual(a.secondary, { label: "I've got it ✓", kind: 'confirm', bookingId: 'b-table' });
  assert.equal(providerName({ provider: 'somewhere', redirect_url: 'https://www.tickets.example.com/x' }), 'tickets.example.com');
  assert.equal(providerName({ provider: null, redirect_url: null }), null);
});

test('money is said as money', () => {
  assert.equal(usd(147400), '$1,474');
  assert.equal(usd(1250), '$12.50');
  assert.equal(run(fx('priced, my share unpaid')).title, 'Chip in $200');
  assert.equal(run(alone(fx('priced, my share unpaid'))).title, 'Pay $600', 'one person pays the whole trip');
  assert.equal(run(fx('my share paid')).title, '$200 of $600 in');
  assert.equal(run(fx('the price went up')).title, 'Price went up $31');
});

const copyOf = (a: NextAction) => [a.title, a.body, a.cta?.label, a.secondary?.label, a.chip].filter((s): s is string => !!s);

test('no copy renders a hole, or promises a message nothing sends', () => {
  for (const { name, a } of everyAction()) {
    for (const s of copyOf(a)) {
      assert.doesNotMatch(s, /undefined|NaN|null|\[object/, `${name}: ${s}`);
      // Nothing pushes on a confirmed booking yet (decision 17), so nothing
      // here says it will.
      assert.doesNotMatch(s, /ping you|let you know|we'll (email|text|tell)|notify you/i, `${name}: ${s}`);
    }
  }
});

// ─── The repo's own guards, run over every sentence this can produce ────
// The guards read app/ and components/, and this file's words reach a person
// only through a screen. So each action is written out as the screen would
// draw it — a button whose handler does what the CTA's kind says — and the
// real check:promises, check:solo-copy, check:vocabulary and check:spelling
// are run over it. A group action is drawn inside a member-count condition,
// as the screen must; a solo one is drawn bare, so any sentence about other
// people in it fails check:solo-copy.

const REPO = resolve(import.meta.dirname, '../..');
const handlerFor = (c: Cta) => c.kind === 'navigate' ? `()=>push("${c.route.screen}")`
  : c.kind === 'nudge' ? `()=>nudge("${c.nudge}")`
    : c.kind === 'link' ? '()=>window.open(href)'
      : '()=>fetch(confirmUrl,{method:"POST"})';
const jsxText = (s: string) => {
  assert.doesNotMatch(s, /[{}<>]/, `copy with markup characters: ${s}`);
  return s;
};

function draw(actions: { solo: boolean; a: NextAction }[], extra = ''): string {
  const blocks = actions.map(({ solo, a }) => {
    const button = (c: Cta | null | undefined) => c ? `<button onClick={${handlerFor(c)}}>${jsxText(c.label)}</button>` : '';
    const inner = `<div><h3>${jsxText(a.title)}</h3>${a.body ? `<p>${jsxText(a.body)}</p>` : ''}${button(a.cta)}${button(a.secondary)}<span>${jsxText(a.chip)}</span></div>`;
    return solo ? inner : `{memberCount>1?(${inner}):null}`;
  });
  return `export function NextActionCopy({memberCount,push,nudge,href,confirmUrl}){\n  return(<div>\n${blocks.join('\n')}\n${extra}\n  </div>);\n}\n`;
}

function guards(source: string): { name: string; status: number | null; out: string }[] {
  const dir = mkdtempSync(join(tmpdir(), 'next-action-copy-'));
  try {
    for (const d of ['app', 'components', 'lib']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'components', 'NextActionCopy.jsx'), source);
    return ['check-promises', 'check-solo-copy', 'check-vocabulary', 'check-spelling'].map(name => {
      const r = spawnSync(process.execPath, [join(REPO, 'scripts', `${name}.mjs`)], { cwd: dir, encoding: 'utf8' });
      return { name, status: r.status, out: `${r.stdout}${r.stderr}` };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


test('every action passes check:promises, check:solo-copy, check:vocabulary and check:spelling', () => {
  for (const g of guards(draw(everyAction()))) {
    assert.equal(g.status, 0, `${g.name} failed:\n${g.out}`);
  }
});

test('the harness can fail: a sentence about others on a solo screen, and a button that does nothing', () => {
  // Planted, so a green run above means something.
  const planted = draw([], '<p>Waiting on the rest of the group</p><button onClick={()=>setOpen(true)}>Remind them</button>');
  const byName = Object.fromEntries(guards(planted).map(g => [g.name, g.status]));
  assert.equal(byName['check-solo-copy'], 1);
  assert.equal(byName['check-promises'], 1);
});

// ─── The rail (decision 1: it replaces the three sign-off tabs) ──────────

const dots = (a: NextAction) => a.rail.map(d => d.key);
const at = (a: NextAction) => a.rail.find(d => d.state === 'current')?.key ?? 'done';
const allInputs = () => [
  ...FIXTURES.map(f => [f.name, f.input] as [string, NextActionInput]),
  ...EXTRA,
].flatMap(([name, input]) => [[name, input], [`${name} (solo)`, alone(input)]] as [string, NextActionInput][]);

test('the rail is read from the same answer: one dot is current, or all are done when booked', () => {
  for (const [name, input] of allInputs()) {
    const a = run(input);
    const current = a.rail.filter(d => d.state === 'current');
    if (a.state === 'booked') {
      assert.ok(a.rail.every(d => d.state === 'done'), name);
      continue;
    }
    assert.equal(current.length, 1, name);
    // Done, then current, then to do: never a done dot after an open one.
    const order = a.rail.map(d => d.state).join(',');
    assert.match(order, /^(done,)*current(,todo)*$/, `${name}: ${order}`);
    assert.equal(a.rail[0].key, 'plan', name);
    assert.equal(a.rail[a.rail.length - 1].key, 'booked', name);
  }
});

test('a night out with nothing to buy has no Pay dot', () => {
  for (const input of [fx('a walk-in night'), ex('a Ticketmaster seat, as'), base({
    plan: { id: 'p1', type: 'restaurant', itinerary: [DINNER_LINE] } })]) {
    const a = run(input);
    assert.ok(!dots(a).includes('pay'), `${input.plan.itinerary?.[0]?.title}: ${dots(a)}`);
  }
  // A trip with a hotel to buy does have one.
  assert.ok(dots(run(fx('priced, my share unpaid'))).includes('pay'));
  // Nothing booked, nothing to book: the last dot is not called Booked.
  assert.equal(run(fx('a walk-in night')).rail.at(-1)?.label, 'All set');
  assert.equal(run(fx('all booked')).rail.at(-1)?.label, 'Booked');
});

test('a vote dot only where there is a vote, and never on a plan for one', () => {
  const voting = fx('the vote is open');
  assert.deepEqual(dots(run(voting)), ['plan', 'vote', 'lock', 'booked']);
  assert.equal(at(run(voting)), 'vote');
  assert.ok(!dots(run(alone(voting))).includes('vote'));
  assert.ok(!dots(run(fx('priced, my share unpaid'))).includes('vote'));
});

test('each state sits on the dot it belongs to', () => {
  assert.equal(at(run(fx('nothing planned yet'))), 'plan');
  assert.equal(at(run(fx('planned, not locked in, I organise'))), 'lock');
  assert.equal(at(run(fx('planned, not locked in, Sam organises'))), 'lock');
  assert.equal(at(run(fx('locked in, nothing priced yet'))), 'pay');
  assert.equal(at(run(fx('priced, my share unpaid'))), 'pay');
  assert.equal(at(run(fx('my share paid'))), 'pay');
  assert.equal(at(run(fx('paid for, waiting to be booked'))), 'booked');
  assert.equal(at(run(fx('the hotel is with the provider'))), 'booked');
  assert.equal(at(run(fx('all booked'))), 'done');
  // A night out with nothing to buy goes from Lock in straight to Booked.
  const night = base({ plan: { id: 'p1', type: 'restaurant', itinerary: [DINNER_LINE] } });
  assert.equal(at(run(night)), 'booked');
  assert.equal(at(run({ ...night, plan: { ...night.plan, status: 'planning' } })), 'lock');
  // Options put to the group on a plan whose place is set: the vote is open
  // until it is locked in, and locking it in is what closes it.
  const fixedVote = run(base({ plan: { id: 'p1', status: 'voting', hasOptions: true },
    vote: { decided: true, myVote: 'Moab', organiser: { name: 'Pat', isYou: true } } }));
  assert.equal(fixedVote.state, 'lock_in');
  assert.equal(at(fixedVote), 'vote');
});

test('a group admin locks in a plan somebody else set up; a member waits on them', () => {
  const sams = fx('planned, not locked in, Sam organises');
  assert.equal(run(sams).state, 'waiting_on_others');
  const asAdmin = run({ ...sams, plan: { ...sams.plan, organiserIsMe: true } });
  assert.equal(asAdmin.state, 'lock_in');
  assert.equal(asAdmin.cta?.label, 'Lock it in →');
});

// ─── A vote on a set place: the route's `decided` says nothing about it ──
// GET /vote answers `decided: destination_style !== 'undecided'`, true from
// the start for options sent round on a plan whose place is set. Read as
// "the vote is over", it sent every member to "Waiting on Pat to lock it in"
// with nobody's vote in, and Home dropped the plan.
test('options on a set place: a member who has not voted is asked to vote', () => {
  const sams = { id: 'p1', status: 'voting', hasOptions: true, createdBy: SAM };
  const notVoted = run(base({ plan: sams,
    vote: { decided: true, myVote: null, everyoneVoted: false, mayPick: false, stillToVote: ['you', 'Alex'], organiser: { name: 'Pat', isYou: false } } }));
  assert.equal(notVoted.state, 'vote_open');
  assert.equal(notVoted.cta?.label, 'Vote →');
  assert.equal(at(notVoted), 'vote');
  // Voted, Alex has not: the wait names Alex, not the organiser.
  const voted = run(base({ plan: sams,
    vote: { decided: true, myVote: 'A', everyoneVoted: false, mayPick: false, stillToVote: ['Alex'], organiser: { name: 'Pat', isYou: false } } }));
  assert.equal(voted.state, 'waiting_on_others');
  assert.deepEqual(voted.waitingOn, ['Alex']);
  // The organiser is asked to vote too, and is not offered Lock it in with
  // nobody's vote in.
  const organiser = run(base({ plan: { id: 'p1', status: 'voting', hasOptions: true },
    vote: { decided: true, myVote: null, everyoneVoted: false, mayPick: true, stillToVote: ['you', 'Sam', 'Alex'], organiser: { name: 'Pat', isYou: true } } }));
  assert.equal(organiser.state, 'vote_open');
  const organiserVoted = run(base({ plan: { id: 'p1', status: 'voting', hasOptions: true },
    vote: { decided: true, myVote: 'A', everyoneVoted: false, mayPick: true, stillToVote: ['Sam', 'Alex'], organiser: { name: 'Pat', isYou: true } } }));
  assert.equal(organiserVoted.state, 'waiting_on_others');
  assert.deepEqual(organiserVoted.waitingOn, ['Sam', 'Alex']);
  // Everyone in: the organiser locks it in, a member waits on them — both still on the Vote dot.
  const allIn = { decided: true, myVote: 'A', everyoneVoted: true, mayPick: true, stillToVote: [] };
  const lock = run(base({ plan: { id: 'p1', status: 'voting', hasOptions: true }, vote: { ...allIn, organiser: { name: 'Pat', isYou: true } } }));
  assert.equal(lock.state, 'lock_in');
  assert.equal(at(lock), 'vote');
  const member = run(base({ plan: sams, vote: { ...allIn, mayPick: false, organiser: { name: 'Pat', isYou: false } } }));
  assert.equal(member.state, 'waiting_on_others');
  assert.match(member.title, /Pat to lock it in/);
  // A vote on WHERE is still closed by its pick landing.
  const picked = run(base({ plan: { id: 'p1', destStyle: 'undecided', status: 'voting', hasOptions: true, itinerary: [] },
    vote: { decided: true, myVote: null, everyoneVoted: false, mayPick: true, stillToVote: ['you'] } }));
  assert.notEqual(picked.state, 'vote_open');
});

// ─── A line /bookable skipped is not "priced at checkout" ────────────────
const BREWERY = line({ id: 'l-brew', title: 'Brewery tour', type: 'activity', booking_mode: 'reach' });

test('a line /bookable skipped, beside a priced row, is not "See what it costs"', () => {
  const a = run(base({ plan: { id: 'p1', itinerary: [HOTEL_LINE, BREWERY] },
    bookings: [hotel('awaiting_approval')],
    funding: { memberCount: 3, targetCents: 60000, collectedCents: 0, funded: false, myPaidCents: 0, myRemainingCents: 20000 } }));
  assert.equal(a.state, 'pay_share');
  assert.notEqual(a.title, 'See what it costs');
  assert.equal(a.checkoutStep, 'pay');
  assert.doesNotMatch(a.body ?? '', /Checkout prices/);
  assert.match(a.body ?? '', /Brewery tour isn't priced/);
});

test('every line skipped and no rows: says it has no price, never "Checkout prices it"', () => {
  const skipped = run(base({ plan: { id: 'p1', itinerary: [BREWERY] }, bookableSkipped: ['Brewery tour'] }));
  assert.equal(skipped.state, 'needs_attention');
  assert.equal(skipped.title, 'Brewery tour has no price yet');
  assert.match(skipped.body ?? '', /couldn't price it/);
  assert.equal(at(skipped), 'pay');
  // Nobody has asked /bookable yet: checkout is where it is priced.
  const unasked = run(base({ plan: { id: 'p1', itinerary: [BREWERY] } }));
  assert.equal(unasked.state, 'pay_share');
  assert.equal(unasked.title, 'See what it costs');
  assert.equal(unasked.checkoutStep, null);
});

test('the checkout button reads the answer as a label only on its own pay step', () => {
  const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
  assert.match(app, /na\?\.state==="pay_share"&&na\.checkoutStep==="pay"&&checkout\.canPay\?na\.title/);
  assert.match(app, /BOOKABLE_SKIPS\.set\(planId,/);
  assert.match(app, /bookableSkipped:BOOKABLE_SKIPS\.get\(plan\.id\)/);
});

// ─── The cached reads are dropped by every write that moves the answer ──
test('voting, answering, picking and a plan change each drop the cached next-action reads', () => {
  const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
  const body = (start: RegExp, len = 1800) => { const i = app.search(start); assert.ok(i >= 0, String(start)); return app.slice(i, i + len); };
  assert.match(body(/const castVoteOnServer=async/), /forgetNext\(planId\)/);
  assert.match(body(/const updatePlanOnServer=async/), /forgetNext\(planId\)/);
  assert.match(body(/body:JSON\.stringify\(\{option:o\.title\}\)/, 300), /forgetNext\(planId\)/);
  assert.match(body(/body:JSON\.stringify\(\{veto:o\.title,on\}\)/, 300), /forgetNext\(planId\)/);
  assert.match(body(/const ok=await pickTripIdea\(o,/, 300), /if\(ok\)forgetNext\(planId\)/);
  assert.match(body(/toast\("Thanks — that's you in"\)/, 300), /forgetNext\(planId\)/);
});

// ─── The rail, read aloud ────────────────────────────────────────────────
test('the rail says which step is current, and a done dot is a 44px target', () => {
  const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
  const rail = app.slice(app.indexOf('function ProgressRail('), app.indexOf('function NextStepCard('));
  assert.match(rail, /aria-current=\{now\?"step":undefined\}/);
  assert.match(rail, /current:"current step"/);
  assert.match(rail, /todo:"to do"/);
  assert.match(rail, /minHeight:44/);
});
