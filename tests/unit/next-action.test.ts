import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  getNextAction, NEXT_STATES, usd, providerName,
  type NextActionInput, type NextAction, type NextState, type NextBooking, type Cta,
} from '../../lib/next-action.ts';
import { BookingRow } from '../../lib/contracts/booking.ts';
import { ItineraryItemRow, itemFromRow } from '../../lib/contracts/itinerary-item.ts';
import { stepStates, type Review } from '../../lib/plan-steps.ts';
import { isSoloCount } from '../../lib/joining.ts';

// ─── Fixtures, on the contract shapes ────────────────────────────────────
// Every booking goes through BookingRow and every line through
// ItineraryItemRow → itemFromRow, so a fixture cannot be a shape the app
// never produces.

const ME = 'u-me', SAM = 'u-sam', ALEX = 'u-alex';
const signed = { at: '2026-09-24T20:00:00Z', by: ME };
const ALL_SIGNED: Review = { overview: signed, budget: signed, bookings: signed };
const TO_BUDGET: Review = { overview: signed, budget: signed };

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
const table = (extra: Partial<NextBooking> = {}) => booking({
  id: 'b-table', vertical: 'restaurant', status: 'redirected', mode: 'redirect', provider: 'resy',
  redirect_url: 'https://resy.com/cities/moab/desert-bistro', detail: 'Desert Bistro', ...extra,
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

/** A group trip of three that has been decided and planned. */
function base(over: Partial<NextActionInput> = {}): NextActionInput {
  return {
    plan: { id: 'p1', groupId: 'g1', status: 'approved', type: 'trip', title: 'Moab', destStyle: 'fixed',
      hasOptions: false, createdBy: ME, itinerary: [HOTEL_LINE], ...(over.plan ?? {}) },
    bookings: [], funding: null, readiness: answers({ [ME]: true, [SAM]: true, [ALEX]: true }),
    signoffs: TO_BUDGET, essentials: null, memberCount: 3, me: ME,
    now: new Date('2026-09-25T15:00:00Z'),
    ...over,
    ...(over.plan ? { plan: { id: 'p1', groupId: 'g1', status: 'approved', type: 'trip', title: 'Moab', destStyle: 'fixed', hasOptions: false, createdBy: ME, itinerary: [HOTEL_LINE], ...over.plan } } : {}),
  };
}

const FIXTURES: { name: string; state: NextState; input: NextActionInput }[] = [
  { name: 'I have not said what I want', state: 'needs_trip_input', input: base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'planning', itinerary: [] },
    readiness: answers({ [ME]: false, [SAM]: true, [ALEX]: false }), signoffs: {} }) },
  { name: 'nothing planned yet', state: 'needs_trip_input', input: base({ plan: { id: 'p1', itinerary: [] }, signoffs: {} }) },
  { name: 'I answered, Sam and Alex have not', state: 'waiting_on_others', input: base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'planning', itinerary: [] },
    readiness: answers({ [ME]: true, [SAM]: false, [ALEX]: false }), signoffs: {} }) },
  { name: 'the vote is open and I have not voted', state: 'vote_open', input: base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'voting', hasOptions: true, itinerary: [] },
    vote: { decided: false, myVote: null, everyoneVoted: false, mayPick: true, stillToVote: ['you', 'Sam'] }, signoffs: {} }) },
  { name: 'I voted, Sam has not', state: 'waiting_on_others', input: base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'voting', hasOptions: true, itinerary: [] },
    vote: { decided: false, myVote: 'Moab', everyoneVoted: false, mayPick: true, stillToVote: ['Sam'] }, signoffs: {} }) },
  { name: 'planned, not signed off, I organise', state: 'lock_in', input: base({ signoffs: {} }) },
  { name: 'planned, not signed off, Sam organises', state: 'waiting_on_others', input: base({
    plan: { id: 'p1', createdBy: SAM }, signoffs: {}, vote: { organiser: { name: 'Sam', isYou: false } } }) },
  { name: 'signed off, nothing priced yet', state: 'lock_in', input: base() },
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
  { name: 'all booked, the Book tab not signed', state: 'sign_off', input: base({
    bookings: [hotel('confirmed')], funding: FUNDED }) },
  { name: 'all booked and signed off', state: 'booked', input: base({
    bookings: [hotel('confirmed')], funding: FUNDED, signoffs: ALL_SIGNED }) },
  { name: 'a walk-in night, signed off', state: 'booked', input: base({
    plan: { id: 'p1', type: 'restaurant', itinerary: [WALK_IN] }, signoffs: ALL_SIGNED }) },
];

/** The one fixture where the tab and the rows disagree, and the rows must win. */
const STALE_SIGN_OFF = base({
  plan: { id: 'p1', itinerary: [HOTEL_LINE, FLIGHT_LINE] },
  bookings: [hotel('confirmed'), flight('failed')], funding: FUNDED, signoffs: ALL_SIGNED,
});

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
  for (const f of [...FIXTURES, { name: 'stale', state: 'needs_attention' as NextState, input: STALE_SIGN_OFF }]) {
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
  const signedAll = { funding: FUNDED, signoffs: ALL_SIGNED };
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
    bookings: [flight('confirmed'), hotel('quoted')], funding: FUNDED, signoffs: ALL_SIGNED }));
  assert.notEqual(a.state, 'booked');
  assert.match(a.title, /on hold/);
});

test('a row I sit out is not mine to finish; one everybody sits out is not counted', () => {
  const skipped = run(base({ bookings: [hotel('confirmed'), table()], funding: FUNDED, signoffs: ALL_SIGNED,
    skips: [{ ref: 'b-table', userId: ME }] }));
  assert.notEqual(skipped.state, 'finish_elsewhere');
  // A failed dinner everybody sits out is not a gap in the trip.
  const everyone = [ME, SAM, ALEX].map(userId => ({ ref: 'b-dinner', userId }));
  const failedDinner = booking({ id: 'b-dinner', vertical: 'restaurant', status: 'failed', mode: 'native', provider: 'resy' });
  const a = run(base({ bookings: [hotel('confirmed'), failedDinner], funding: FUNDED, signoffs: ALL_SIGNED, skips: everyone }));
  assert.equal(a.claim, 'all_booked');
});

test('booked agrees with the tabs\' "Ready to go" in every fixture', () => {
  for (const f of FIXTURES) {
    for (const input of [f.input, alone(f.input)]) {
      const a = run(input);
      const readyToGo = stepStates(input.signoffs).bookings === 'done';
      assert.equal(a.state === 'booked', readyToGo, `${f.name} (${input.memberCount})`);
    }
  }
});

test('signed off, then something failed: the rows win and the screen says so', () => {
  const a = run(STALE_SIGN_OFF);
  assert.equal(a.state, 'needs_attention');
  assert.match(a.body ?? '', /signed off before this happened/);
});

// ─── One thing to press, and words that are true ─────────────────────────

const everyAction = () => FIXTURES.flatMap(f => [
  { name: f.name, solo: false, a: run(f.input) },
  { name: `${f.name} (solo)`, solo: true, a: run(alone(f.input)) },
]).concat([
  { name: 'stale', solo: false, a: run(STALE_SIGN_OFF) },
  // Group-only sentences, reached only with more than one person: drawn so
  // check:solo-copy has claims about other people to hold to a guard.
  { name: 'a 402 on a group', solo: false, a: run({ ...fx('paid for, waiting'), outcome: { status: 402 } }) },
  { name: 'everyone voted, my pick', solo: false, a: run(base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'voting', hasOptions: true, itinerary: [] },
    vote: { decided: false, myVote: 'Moab', everyoneVoted: true, mayPick: true, stillToVote: [] }, signoffs: {} })) },
  { name: 'everyone answered', solo: false, a: run(base({
    plan: { id: 'p1', destStyle: 'undecided', status: 'planning', itinerary: [] }, signoffs: {} })) },
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
