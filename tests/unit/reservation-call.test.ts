// The AI reservation-calling assistant: every gate, every outcome, the wording.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gate, dialTarget, modeFrom } from '../../lib/reservations/gate.ts';
import { checkFacts, opening, instructions, clock, spokenDate, type CallFacts } from '../../lib/reservations/script.ts';
import { settle, mentionsTime, mentionsParty, asClock, disclosedIn, type Turn } from '../../lib/reservations/outcome.ts';
import { callWording, nextOptions, type WordingContext } from '../../lib/reservations/wording.ts';
import { toE164, dialable, openForCalls, lineTypeOf, twilioLookup } from '../../lib/reservations/policy.ts';
import { retell, vapi, senderOf } from '../../lib/reservations/providers.ts';
import {
  placeCall, settleCall, DAILY_CAP,
  type Store, type CallRow, type PlaceInput, type PlaceDeps, type BookingRow,
} from '../../lib/reservations/call.ts';
import type { Provider, PlaceArgs } from '../../lib/reservations/providers.ts';
import { supabaseStore } from '../../lib/reservations/store.ts';

// ── fixtures ────────────────────────────────────────────────────────────
const VENUE_PHONE = '+19195550100';
const TEST_NUMBER = '+19195559999';
// 13:00 in Raleigh by the longitude estimate (UTC-5): open all afternoon.
const NOW = new Date('2026-11-04T18:00:00Z');
const TEST_ENV = {
  RESERVATION_CALLS_MODE: 'test', RESERVATION_TEST_NUMBER: TEST_NUMBER,
  RETELL_API_KEY: 'key_retell', RETELL_AGENT_ID: 'agent_1', RETELL_FROM_NUMBER: '+19195550001',
};
const LIVE_ENV = { ...TEST_ENV, RESERVATION_CALLS_MODE: 'live', RESERVATION_CALLS_LAWYER_APPROVED: 'yes' };

const FACTS: CallFacts = {
  restaurant: "Luigi's", venuePhone: VENUE_PHONE, date: '2026-11-06', time: '19:30',
  partySize: 4, firstName: 'Maria', notes: null,
};

function booking(over: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 'b0000000-0000-0000-0000-000000000001', plan_id: 'p1', vertical: 'restaurant', mode: 'redirect',
    provider: 'opentable', status: 'awaiting_approval', redirect_url: 'https://www.opentable.com/luigis',
    request_payload: { restaurant: { name: "Luigi's", partySize: 4 } }, ...over,
  };
}

function input(over: Partial<PlaceInput> = {}): PlaceInput {
  return {
    booking: booking(),
    plan: { id: 'p1', group_id: 'g1', solo: false, start_date: '2026-11-05', end_date: '2026-11-08' },
    requester: { id: 'u1', firstName: 'Maria' },
    venue: { name: "Luigi's", phone: '(919) 555-0100', opening_hours: 'Mo-Su 11:00-22:00', lng: -78.64, reserveUrl: 'https://www.opentable.com/luigis' },
    chosen: { date: '2026-11-06', time: '19:30', partySize: 4 },
    now: NOW,
    ...over,
  };
}

/** The store, in memory, keeping the same limits the database keeps. */
function memoryStore(opts: { migrated?: boolean; members?: string[] } = {}) {
  const calls: CallRow[] = [];
  const dnc = new Map<string, string>();
  const bookings = new Map<string, { status: string; detail?: string | null; provider_ref?: string | null }>();
  const notes: Array<{ to: string[]; title: string; body: string }> = [];
  let seq = 0;
  const migrated = opts.migrated !== false;
  const gone = { ok: false as const, why: 'not_migrated' as const };
  const store: Store = {
    async anyUndisclosed() { return migrated ? { ok: true, value: calls.some(c => c.disclosed === false) } : gone; },
    async onDoNotCall(phone) { return migrated ? { ok: true, value: dnc.has(phone) } : gone; },
    async callFor(id, mode) { return migrated ? { ok: true, value: calls.find(c => c.booking_id === id && c.mode === mode) ?? null } : gone; },
    async claim(row) {
      if (!migrated) return { ok: false, why: 'not_migrated' };
      if (calls.some(c => c.booking_id === row.booking_id && c.mode === row.mode)) return { ok: false, why: 'already' };
      const today = calls.filter(c => c.call_day === row.call_day).length;
      if (today >= DAILY_CAP) return { ok: false, why: 'cap' };
      const r: CallRow = { ...row, id: `c${++seq}`, day_slot: today + 1, status: 'placing', outcome: null, provider_call_id: null };
      calls.push(r);
      return { ok: true, row: r };
    },
    async markPlaced(id, pid) { const c = calls.find(x => x.id === id)!; c.status = 'calling'; c.provider_call_id = pid; return true; },
    async markUnknown(id) { calls.find(x => x.id === id)!.status = 'unknown'; return true; },
    async release(id) { const i = calls.findIndex(x => x.id === id && x.status === 'placing'); if (i >= 0) calls.splice(i, 1); return true; },
    async find(provider, pid, cid) {
      // A copy, as a database read is: what it says can be out of date by the time anybody acts on it.
      const c = calls.find(c => c.provider === provider && ((pid && c.provider_call_id === pid) || (cid && c.id === cid)));
      return { ok: true, value: c ? { ...c } : null };
    },
    async settleOnce(id, fields) {
      const c = calls.find(x => x.id === id);
      if (!c || (c as any).settled_at) return { ok: true, value: null };
      Object.assign(c, fields);
      return { ok: true, value: c };
    },
    async addDoNotCall(phone, reason) { if (!dnc.has(phone)) dnc.set(phone, reason); return true; },
    async moveBooking(id, from, to) {
      const b = bookings.get(id) ?? { status: 'awaiting_approval' };
      if (!from.includes(b.status)) return false;
      bookings.set(id, { ...b, ...to });
      return true;
    },
    async planMembers() { return opts.members ?? ['u1', 'u2', 'u3']; },
    async notify(to, note) { notes.push({ to, title: note.title, body: note.body }); },
  };
  return { store, calls, dnc, bookings, notes };
}

function fakeProvider(answer: Awaited<ReturnType<Provider['place']>> = { ok: true, providerCallId: 'call_abc' }) {
  const placed: PlaceArgs[] = [];
  const p: Provider = {
    name: 'retell',
    async place(args) { placed.push(args); return answer; },
    verify: () => true,
    parse: () => null,
  };
  return { p, placed };
}

function deps(env: Record<string, string>, store: Store, over: Partial<PlaceDeps> = {}, provider = fakeProvider()) {
  return { env, store, lookup: async () => 'landline' as const, provider: () => provider.p, ...over } satisfies PlaceDeps;
}

// ── the gate ────────────────────────────────────────────────────────────
test('the gate: anything but exactly test or live is off', () => {
  for (const v of [undefined, '', 'on', 'LIVE ', 'true', 'yes', 'tset']) {
    const mode = modeFrom({ RESERVATION_CALLS_MODE: v });
    if (v === 'LIVE ') assert.equal(mode, 'live', 'case and spaces aside');
    else assert.equal(mode, 'off', `"${v}" is off`);
  }
  assert.equal(gate({}).refusal, 'calls_off');
  assert.equal(gate({ ...TEST_ENV, RESERVATION_CALLS_MODE: 'off' }).ok, false);
});

test('the gate: live is refused unless the lawyer approval is the literal yes', () => {
  assert.equal(gate({ ...LIVE_ENV, RESERVATION_CALLS_LAWYER_APPROVED: undefined }).refusal, 'live_not_approved');
  for (const v of ['true', '1', 'approved', 'y', 'no', '']) {
    assert.equal(gate({ ...LIVE_ENV, RESERVATION_CALLS_LAWYER_APPROVED: v }).refusal, 'live_not_approved', `"${v}" is not a sign-off`);
  }
  assert.equal(gate(LIVE_ENV).ok, true);
});

test('the gate: test mode needs a real test number and a provider with every key', () => {
  assert.equal(gate({ ...TEST_ENV, RESERVATION_TEST_NUMBER: '' }).refusal, 'no_test_number');
  assert.equal(gate({ ...TEST_ENV, RESERVATION_TEST_NUMBER: '919-555-9999' }).refusal, 'no_test_number');
  assert.equal(gate({ ...TEST_ENV, RETELL_AGENT_ID: '' }).refusal, 'no_provider', 'absent key = disabled');
  assert.equal(gate(TEST_ENV).provider, 'retell');
  const vapiOnly = { RESERVATION_CALLS_MODE: 'test', RESERVATION_TEST_NUMBER: TEST_NUMBER, VAPI_API_KEY: 'k', VAPI_ASSISTANT_ID: 'a', VAPI_PHONE_NUMBER_ID: 'n' };
  assert.equal(gate(vapiOnly).refusal, 'no_provider', 'Vapi without its webhook secret could not be verified, so it is off');
  assert.equal(gate({ ...vapiOnly, VAPI_WEBHOOK_SECRET: 's' }).provider, 'vapi');
  assert.equal(gate({ ...TEST_ENV, ...vapiOnly, VAPI_WEBHOOK_SECRET: 's' }).provider, 'retell', 'Retell first');
});

test('the gate: test mode only ever dials the test number', () => {
  assert.equal(dialTarget(gate(TEST_ENV), VENUE_PHONE), TEST_NUMBER);
  assert.equal(dialTarget(gate(LIVE_ENV), VENUE_PHONE), VENUE_PHONE);
  assert.equal(dialTarget(gate({}), VENUE_PHONE), null);
  assert.equal(dialTarget(gate({ ...LIVE_ENV, RESERVATION_CALLS_LAWYER_APPROVED: 'no' }), VENUE_PHONE), null);
});

// ── facts and the script ────────────────────────────────────────────────
test('a call is built only from facts we hold: nothing defaulted', () => {
  assert.equal(checkFacts(FACTS).ok, true);
  const r = checkFacts({ ...FACTS, time: 'Day 3 · Evening', date: '', partySize: 0, firstName: '' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.ok === false && r.missing.sort(), ['date', 'first_name', 'party_size', 'time']);
  assert.equal(checkFacts({ ...FACTS, date: '2026-02-30' }).ok, false, 'not a real day');
  assert.equal(checkFacts({ ...FACTS, venuePhone: '919 555 0100' }).ok, false);
});

test('the opening discloses an automated AI assistant from Reach, for whom, and the recording', () => {
  const o = opening(FACTS);
  assert.equal(o, 'Hi, this is an automated AI assistant from Reach, calling for Maria. This call is recorded. Do you have a table for 4 on Friday, November 6 at 7:30 PM?');
  assert.match(instructions(FACTS), /Never say the table is booked or confirmed yourself/);
  assert.match(instructions(FACTS), /Never accept a different time/);
  assert.equal(clock('19:30'), '7:30');
  assert.equal(clock('12:00'), '12:00');
  assert.equal(spokenDate('2026-11-06'), 'Friday, November 6');
});

// ── numbers and hours ───────────────────────────────────────────────────
test('numbers: only one we can read, and only +1', () => {
  assert.equal(toE164('(919) 555-0100'), VENUE_PHONE);
  assert.equal(toE164('+1 919-555-0100'), VENUE_PHONE);
  assert.equal(toE164('1-919-555-0100'), VENUE_PHONE);
  assert.equal(toE164('919-555-0100; 919-555-0101'), null, 'two numbers: we cannot pick');
  assert.equal(toE164('555-0100'), null);
  assert.equal(dialable(VENUE_PHONE), true);
  assert.equal(dialable('+442071234567'), false);
  assert.equal(dialable('+19115550100'), false, 'no N11 area codes');
  assert.equal(lineTypeOf('landline'), 'landline');
  assert.equal(lineTypeOf('mobile'), 'mobile');
  assert.equal(lineTypeOf('fixedVoip'), 'voip');
  assert.equal(lineTypeOf(undefined), 'unknown');
  assert.equal(twilioLookup({}), null, 'no keys, no lookup — every number is handed off');
});

test('hours: plainly open across the margin, or no call', () => {
  const at = (iso: string) => openForCalls('Mo-Su 11:00-22:00', -78.64, new Date(iso));
  assert.equal(at('2026-11-04T18:00:00Z').ok, true, '13:00 local: open from 11 to 15');
  assert.equal(at('2026-11-04T15:30:00Z').why, 'closed', '10:30 local: it opened less than two hours ago… it has not');
  assert.equal(at('2026-11-05T01:30:00Z').why, 'closed', '20:30 local: it closes inside the margin');
  assert.equal(openForCalls(null, -78.64, NOW).why, 'no_hours');
  assert.equal(openForCalls('whenever', -78.64, NOW).why, 'unreadable');
  assert.equal(openForCalls('Mo-Su 11:00-22:00', null, NOW).why, 'no_place');
  assert.equal(openForCalls('Mo-Su 11:00-22:00 unknown', -78.64, NOW).ok, false, 'open-but-unknown is not open');
  assert.equal(openForCalls('We 08:00-12:00,12:00-23:00', -78.64, NOW).ok, true, 'touching stretches are one');
});

// ── placing a call: every gate ──────────────────────────────────────────
test('test mode rings the test number, never the venue, and changes no booking', async () => {
  const m = memoryStore();
  const prov = fakeProvider();
  const r = await placeCall(input(), deps(TEST_ENV, m.store, {}, prov));
  assert.equal(r.ok, true);
  assert.equal(prov.placed.length, 1);
  assert.equal(prov.placed[0].to, TEST_NUMBER);
  assert.notEqual(prov.placed[0].to, VENUE_PHONE);
  assert.equal(m.calls[0].mode, 'test');
  assert.equal(m.calls[0].venue_phone, VENUE_PHONE);
  assert.equal(m.bookings.size, 0, 'no booking moved by a test call');
  assert.deepEqual(m.notes[0].to, ['u1'], 'a test call speaks only to whoever ran it');
  assert.match(m.notes[0].title, /^Test call — Reach is calling Luigi's to ask for 7:30 for 4\.$/);
  assert.match(m.notes[0].body, /Nothing was booked/);
  assert.equal(prov.placed[0].variables.opening, opening(FACTS), 'the provider is handed our opening, word for word');
});

test('live mode, approved: rings the venue, the booking is pending (not booked), the group is told', async () => {
  const m = memoryStore();
  const prov = fakeProvider();
  const r = await placeCall(input(), deps(LIVE_ENV, m.store, {}, prov));
  assert.equal(r.ok, true);
  assert.equal(prov.placed[0].to, VENUE_PHONE);
  assert.equal(m.bookings.get(booking().id)?.status, 'pending');
  assert.deepEqual(m.notes[0].to, ['u1', 'u2', 'u3']);
  assert.equal(m.notes[0].title, "Reach is calling Luigi's to ask for 7:30 for 4.");
  assert.equal(m.notes[0].body, 'The group will see their answer here.');
  assert.doesNotMatch(m.notes[0].title + m.notes[0].body, /booked|confirmed/i);
});

test('every refusal hands off, and nothing rings', async () => {
  const cases: Array<[string, Partial<PlaceInput>, Record<string, string>, string]> = [
    ['off', {}, { ...TEST_ENV, RESERVATION_CALLS_MODE: 'off' }, 'calls_off'],
    ['live without the lawyer', {}, { ...LIVE_ENV, RESERVATION_CALLS_LAWYER_APPROVED: '' }, 'live_not_approved'],
    ['not a table', { booking: booking({ vertical: 'hotel' }) }, TEST_ENV, 'not_a_table'],
    ['Reach buys it', { booking: booking({ mode: 'native', provider: 'opentable' }) }, TEST_ENV, 'reach_buys'],
    ['already confirmed', { booking: booking({ status: 'confirmed' }) }, TEST_ENV, 'already_settled_booking'],
    ['no time chosen', { chosen: { date: '2026-11-06', partySize: 4 } }, TEST_ENV, 'missing_facts'],
    ['prose for a time', { chosen: { date: '2026-11-06', time: 'Day 3 · Evening', partySize: 4 } }, TEST_ENV, 'missing_facts'],
    ['no first name', { requester: { id: 'u1', firstName: null } }, TEST_ENV, 'missing_facts'],
    ['a date gone', { chosen: { date: '2026-11-03', time: '19:30', partySize: 4 } }, TEST_ENV, 'date_past'],
    ['a date off the trip', { chosen: { date: '2026-11-20', time: '19:30', partySize: 4 } }, TEST_ENV, 'date_outside_trip'],
    ['no number held', { venue: { ...input().venue!, phone: null } }, TEST_ENV, 'number_unreadable'],
    ['abroad', { venue: { ...input().venue!, phone: '+44 20 7123 4567' } }, TEST_ENV, 'not_north_american'],
    ['no hours', { venue: { ...input().venue!, opening_hours: null } }, TEST_ENV, 'hours_unknown'],
    ['shut', { now: new Date('2026-11-05T05:00:00Z') }, TEST_ENV, 'closed_now'],
  ];
  for (const [name, over, env, refusal] of cases) {
    const m = memoryStore();
    const prov = fakeProvider();
    const r = await placeCall(input(over), deps(env, m.store, {}, prov));
    assert.equal(r.ok, false, name);
    assert.equal(r.ok === false && r.refusal, refusal, name);
    assert.equal(prov.placed.length, 0, `${name}: nothing rang`);
    assert.equal(m.calls.length, 0, `${name}: nothing claimed`);
    assert.ok(r.ok === false && r.message, `${name}: something to say`);
    assert.deepEqual(r.ok === false && r.handoff.reserveUrl, 'https://www.opentable.com/luigis', `${name}: the next option is ready`);
  }
});

test('landlines only: no lookup, a failed lookup, a mobile, a VoIP line — handed off', async () => {
  for (const [lookup, refusal] of [
    [null, 'landline_unverified'],
    [async () => 'unknown' as const, 'landline_unverified'],
    [async () => 'mobile' as const, 'not_a_landline'],
    [async () => 'voip' as const, 'not_a_landline'],
    [async () => 'toll_free' as const, 'not_a_landline'],
  ] as const) {
    const m = memoryStore(); const prov = fakeProvider();
    const r = await placeCall(input(), deps(LIVE_ENV, m.store, { lookup: lookup as any }, prov));
    assert.equal(r.ok === false && r.refusal, refusal);
    assert.equal(prov.placed.length, 0);
  }
});

test('do-not-call is honoured, and an undisclosed call stops every call', async () => {
  const m = memoryStore();
  m.dnc.set(VENUE_PHONE, 'asked');
  assert.equal((await placeCall(input(), deps(LIVE_ENV, m.store))).ok === false, true);
  assert.equal(((await placeCall(input(), deps(LIVE_ENV, m.store))) as any).refusal, 'do_not_call');

  const k = memoryStore();
  k.calls.push({ id: 'old', disclosed: false, booking_id: 'other', mode: 'test' } as CallRow);
  const r = await placeCall(input(), deps(TEST_ENV, k.store));
  assert.equal(r.ok === false && r.refusal, 'disclosure_failed_before');
});

test('one call per reservation, and a test never uses up the live one', async () => {
  const m = memoryStore();
  assert.equal((await placeCall(input(), deps(TEST_ENV, m.store))).ok, true);
  const again = await placeCall(input(), deps(TEST_ENV, m.store));
  assert.equal(again.ok === false && again.refusal, 'already_called');
  assert.equal((await placeCall(input(), deps(LIVE_ENV, m.store))).ok, true);
  const liveAgain = await placeCall(input({ booking: booking({ status: 'pending' }) }), deps(LIVE_ENV, m.store));
  assert.equal(liveAgain.ok === false && liveAgain.refusal, 'already_called');
});

test('fifty calls a day, and the fifty-first is refused', async () => {
  const m = memoryStore();
  for (let i = 0; i < DAILY_CAP; i++) {
    const r = await placeCall(input({ booking: booking({ id: `b${i}` }) }), deps(TEST_ENV, m.store));
    assert.equal(r.ok, true, `call ${i + 1}`);
  }
  const r = await placeCall(input({ booking: booking({ id: 'b-last' }) }), deps(TEST_ENV, m.store));
  assert.equal(r.ok === false && r.refusal, 'daily_cap');
});

test('a refused placement frees the claim; an unreadable one keeps it, so nothing rings twice', async () => {
  const m = memoryStore();
  const refused = await placeCall(input(), deps(TEST_ENV, m.store, {}, fakeProvider({ ok: false, placed: false, detail: '400' })));
  assert.equal(refused.ok === false && refused.refusal, 'provider_refused');
  assert.equal(m.calls.length, 0);
  const unknown = await placeCall(input(), deps(TEST_ENV, m.store, {}, fakeProvider({ ok: false, placed: 'unknown', detail: 'timeout' })));
  assert.equal(unknown.ok === false && unknown.refusal, 'provider_unknown');
  assert.equal(m.calls[0].status, 'unknown');
  assert.equal((await placeCall(input(), deps(TEST_ENV, m.store))).ok === false, true, 'never retried');
});

test('before the migration runs, nothing is called', async () => {
  const m = memoryStore({ migrated: false });
  const prov = fakeProvider();
  const r = await placeCall(input(), deps(TEST_ENV, m.store, {}, prov));
  assert.equal(r.ok === false && r.refusal, 'not_migrated');
  assert.equal(prov.placed.length, 0);
});

// ── outcomes ────────────────────────────────────────────────────────────
const A = (text: string): Turn => ({ speaker: 'assistant', text });
const S = (text: string): Turn => ({ speaker: 'staff', text });
const OPEN = A(opening(FACTS));

test('confirmed only on the staff saying yes, never the assistant', () => {
  const yes = settle(FACTS, [OPEN, S('Yes, we can do 7:30 for four. Under Maria?'), A('Yes, thank you.')],
    { outcome: 'confirmed', staff_quote: 'Yes, we can do 7:30 for four.', held_time: '7:30', held_party: 4 });
  assert.equal(yes.outcome, 'confirmed');
  assert.deepEqual(yes.held, { time: '19:30', party: 4, name: 'Maria' });

  const assistantSaidIt = settle(FACTS, [OPEN, S('Hold on.'), A("Great, you're booked for 7:30.")],
    { outcome: 'confirmed', staff_quote: "Great, you're booked for 7:30." });
  assert.equal(assistantSaidIt.outcome, 'unclear', 'the assistant is never evidence');

  assert.equal(settle(FACTS, [OPEN, S('Yes we can do that')], { outcome: 'confirmed' }).outcome, 'unclear', 'no staff words given');
  assert.equal(settle(FACTS, [OPEN, S("Sorry, we're full at 7:30")], { outcome: 'confirmed', staff_quote: "Sorry, we're full at 7:30" }).outcome, 'unclear');
  assert.equal(settle(FACTS, [OPEN, S('Yes, no problem, see you then')], { outcome: 'confirmed', staff_quote: 'Yes, no problem, see you then', held_time: '19:30', held_party: 4 }).outcome, 'confirmed', '"no problem" is a yes');
  assert.equal(settle(FACTS, [OPEN, S('Sure, for two')], { outcome: 'confirmed', staff_quote: 'Sure, for two', held_party: 2 }).outcome, 'unclear', 'not the party asked for');
  assert.equal(settle(FACTS, [OPEN, S('Sure, at 9')], { outcome: 'confirmed', staff_quote: 'Sure, at 9', held_time: '21:00' }).outcome, 'unclear', 'not the time asked for');
});

test('a yes to holding, a yes followed by a no, or a yes to nothing said is not confirmed', () => {
  const held = { held_time: '19:30', held_party: 4 };
  // "Sure, one moment" then "fully booked": the LLM's quote is a real staff word, and still no table.
  const hold = settle(FACTS, [OPEN, S('Sure, one moment.'), S('Sorry, we are fully booked Friday night.')], { outcome: 'confirmed', staff_quote: 'Sure' });
  assert.equal(hold.outcome, 'unclear');
  assert.equal(hold.held, undefined);
  assert.equal(settle(FACTS, [OPEN, S('Sure, one moment.'), S('Sorry, we are fully booked Friday night.')], { outcome: 'confirmed', staff_quote: 'Sure', ...held }).outcome, 'unclear', 'a no after the yes');
  assert.equal(settle(FACTS, [OPEN, S('Sure, one moment please.')], { outcome: 'confirmed', staff_quote: 'Sure', ...held }).outcome, 'unclear', 'a yes to holding');
  // The no in the same turn as the quoted word.
  assert.equal(settle(FACTS, [OPEN, S('Okay, so unfortunately we have nothing at 7:30.')], { outcome: 'confirmed', staff_quote: 'Okay', ...held }).outcome, 'unclear');
  // Nothing defaults the time or party held to what was asked.
  assert.equal(settle(FACTS, [OPEN, S('Yes, we can do that.')], { outcome: 'confirmed', staff_quote: 'Yes, we can do that.' }).outcome, 'unclear', 'no held time or party given');
  assert.equal(settle(FACTS, [OPEN, S('Yes, we can do that.')], { outcome: 'confirmed', staff_quote: 'Yes, we can do that.', held_time: '19:30' }).outcome, 'unclear', 'no held party given');
  // The time and party have to have been said, by staff or in the question the yes answers.
  assert.equal(settle(FACTS, [OPEN, S('What can I do for you?'), A('Are you open on Friday?'), S('Yes we are.')], { outcome: 'confirmed', staff_quote: 'Yes we are.', ...held }).outcome, 'unclear', 'a yes to another question');
  assert.equal(settle(FACTS, [OPEN, S('Yes, we can do that.')], { outcome: 'confirmed', staff_quote: 'Yes, we can do that.', ...held }).outcome, 'confirmed', 'a yes straight to the question asked');
  assert.equal(settle(FACTS, [OPEN, S('Hold on.'), A('Thank you.'), S('Yes, 7:30 for four works.')], { outcome: 'confirmed', staff_quote: 'Yes, 7:30 for four works.', ...held }).outcome, 'confirmed', 'staff said the time and party themselves');
  assert.equal(settle(FACTS, [OPEN, S('Yes.'), S('Oh wait, sorry, we are fully booked.')], { outcome: 'confirmed', staff_quote: 'Yes.', ...held }).outcome, 'unclear', 'a plain yes, then a no');
  assert.equal(settle(FACTS, [OPEN, S('What can I do for you?'), A('Do you take parties of 4?'), S('Yes we do.')], { outcome: 'confirmed', staff_quote: 'Yes we do.', ...held }).outcome, 'unclear', 'the party was said, the time never');
  assert.equal(settle(FACTS, [OPEN, S('What can I do for you?'), A('Is 7:30 a busy time?'), S('Yes it is.')], { outcome: 'confirmed', staff_quote: 'Yes it is.', ...held }).outcome, 'unclear', 'the time was said, the party never');
  assert.equal(mentionsParty('a table for four', 4), true);
  assert.equal(mentionsParty('7:30 for 14', 4), false);
  assert.equal(mentionsParty('the 4th', 4), false);
});

test('an offered time counts only when the restaurant said it', () => {
  const offered = settle(FACTS, [OPEN, S("We don't have 7:30, but we could do 9:00.")], { outcome: 'alternative_offered', offered_time: '9:00' });
  assert.equal(offered.outcome, 'alternative_offered');
  assert.equal(offered.offeredTime, '21:00', '9 near 7:30 p.m. is 9 p.m.');
  assert.equal(settle(FACTS, [OPEN, S("We don't have 7:30.")], { outcome: 'alternative_offered', offered_time: '21:00' }).outcome, 'unclear');
  assert.equal(mentionsTime('how about half past eight', '20:30'), true);
  assert.equal(mentionsTime('we have 10:30 open', '20:30'), false);
  assert.equal(asClock('9:00 pm', '19:30'), '21:00');
  assert.equal(asClock('nonsense', '19:30'), null);
});

test('not booked: no availability, voicemail, no answer, needs the guest', () => {
  assert.equal(settle(FACTS, [OPEN, S("Sorry, we're fully booked tonight")], { outcome: 'no_availability' }).outcome, 'no_availability');
  assert.equal(settle(FACTS, [OPEN], null, { voicemail: true }).outcome, 'voicemail');
  assert.equal(settle(FACTS, [], null, { noAnswer: true }).outcome, 'no_answer');
  assert.equal(settle(FACTS, [OPEN], { outcome: 'confirmed', staff_quote: 'yes' }).outcome, 'no_answer', 'nobody spoke, so nobody said yes');
  assert.equal(settle(FACTS, [OPEN, S('We need a card number, have her call us')], { outcome: 'needs_guest' }).outcome, 'needs_guest');
  assert.equal(settle(FACTS, [OPEN, S('Hm?')], { outcome: 'banana' }).outcome, 'unclear');
});

test('refused and "stop calling" both stop calling, whatever the extraction says', () => {
  const refused = settle(FACTS, [OPEN, S("We don't talk to robots.")], { outcome: 'no_availability' });
  assert.equal(refused.outcome, 'refused');
  assert.equal(refused.stopCalling, true);
  const stop = settle(FACTS, [OPEN, S("No thanks, please don't call this number again.")], { outcome: 'no_availability' });
  assert.equal(stop.outcome, 'do_not_call');
  assert.equal(stop.stopCalling, true);
  const flagged = settle(FACTS, [OPEN, S('Not tonight.')], { outcome: 'no_availability', asked_not_to_call: 'true' });
  assert.equal(flagged.stopCalling, true);
  const yesButStop = settle(FACTS, [OPEN, S('Yes, 7:30 is fine. But stop calling us with these.')], { outcome: 'confirmed', staff_quote: 'Yes, 7:30 is fine.', held_time: '19:30', held_party: 4 });
  assert.equal(yesButStop.outcome, 'confirmed', 'a yes is still a yes');
  assert.equal(yesButStop.stopCalling, true, 'and the number is still never called again');
});

test('the disclosure is checked in what the assistant actually said first', () => {
  assert.equal(disclosedIn([OPEN, S('yes')]), true);
  assert.equal(disclosedIn([A('Hi, I would like a table for 4.'), S('yes')]), false);
  assert.equal(disclosedIn([S('Hello?'), A('Hi, this is an automated AI assistant from Reach. This call is recorded.')]), true);
  assert.equal(disclosedIn([S('Hello?')]), null, 'the assistant never spoke: not applicable, not a failure');
  assert.equal(disclosedIn([]), null);
});

// ── settling ────────────────────────────────────────────────────────────
async function placedLive(env = LIVE_ENV, over: Partial<PlaceInput> = {}) {
  const m = memoryStore();
  m.bookings.set(booking().id, { status: 'awaiting_approval' });
  const r = await placeCall(input(over), deps(env, m.store));
  assert.equal(r.ok, true);
  m.notes.length = 0;
  return m;
}
const ended = (turns: Turn[], extraction: any, signals = {}) =>
  ({ providerCallId: 'call_abc', callId: null, final: true, turns, extraction, signals });

test('a confirmed live call confirms the booking, says so exactly, once', async () => {
  const m = await placedLive();
  const ev = ended([OPEN, S('Yes, 7:30 for four is fine.')], { outcome: 'confirmed', staff_quote: 'Yes, 7:30 for four is fine.', held_time: '19:30', held_party: 4 });
  const first = await settleCall(ev, 'retell', m.store);
  assert.equal(first.ok, true);
  const b = m.bookings.get(booking().id)!;
  assert.equal(b.status, 'confirmed');
  assert.equal(b.provider_ref, 'reach-call:c1');
  assert.equal(m.notes[0].title, "Luigi's confirmed on the call: 7:30 for 4, under Maria.");
  assert.equal(m.notes[0].body, "The group's table on Friday, November 6 is on the plan.");
  const again = await settleCall(ev, 'retell', m.store);
  assert.equal(again.ok === false && again.why, 'already_settled');
  assert.equal(m.notes.length, 1, 'a retried webhook tells nobody twice');
});

test('two deliveries of the same event at the same moment settle it once', async () => {
  const m = await placedLive();
  const ev = ended([OPEN, S('Yes, 7:30 for four is fine.')], { outcome: 'confirmed', staff_quote: 'Yes, 7:30 for four is fine.', held_time: '19:30', held_party: 4 });
  const results = await Promise.all([settleCall(ev, 'retell', m.store), settleCall(ev, 'retell', m.store)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(m.notes.length, 1, 'one notification, not two');
});

test('a call that books nothing puts the booking back where the hand-off is still on screen', async () => {
  const m = await placedLive();
  await settleCall(ended([OPEN], null, { voicemail: true }), 'retell', m.store);
  assert.equal(m.bookings.get(booking().id)!.status, 'awaiting_approval');
  assert.equal(m.notes[0].title, "Not booked. We couldn't reach Luigi's.");
  assert.equal(m.notes[0].body, "Next: reserve online or call them on (919) 555-0100 — it's on the group's plan.");
});

test('somebody who marked it themselves while the call was out wins', async () => {
  const m = await placedLive();
  m.bookings.set(booking().id, { status: 'confirmed' });
  await settleCall(ended([OPEN, S('No, sorry, we are full')], { outcome: 'no_availability' }), 'retell', m.store);
  assert.equal(m.bookings.get(booking().id)!.status, 'confirmed');
});

test('"stop calling" on a live call is listed forever; on a test call nothing is listed or moved', async () => {
  const m = await placedLive();
  await settleCall(ended([OPEN, S("Don't call here again.")], { outcome: 'do_not_call' }), 'retell', m.store);
  assert.equal(m.dnc.get(VENUE_PHONE), 'asked');
  const again = await placeCall(input({ booking: booking({ id: 'b-new' }) }), deps(LIVE_ENV, m.store));
  assert.equal(again.ok === false && again.refusal, 'do_not_call');

  const t = memoryStore();
  await placeCall(input(), deps(TEST_ENV, t.store));
  t.notes.length = 0;
  await settleCall(ended([OPEN, S("Don't call here again.")], { outcome: 'do_not_call' }), 'retell', t.store);
  assert.equal(t.dnc.size, 0);
  assert.equal(t.bookings.size, 0);

  // Even a booking that happens to be pending is not a test call's to move,
  // and a yes on a test call confirms nothing.
  const y = memoryStore();
  y.bookings.set(booking().id, { status: 'pending' });
  await placeCall(input({ booking: booking({ status: 'pending' }) }), deps(TEST_ENV, y.store));
  await settleCall(ended([OPEN, S('Yes, 7:30 for four is fine.')], { outcome: 'confirmed', staff_quote: 'Yes, 7:30 for four is fine.', held_time: '19:30', held_party: 4 }), 'retell', y.store);
  assert.deepEqual(y.bookings.get(booking().id), { status: 'pending' });
  assert.deepEqual(t.notes[0].to, ['u1']);
  assert.match(t.notes[0].title, /^Test call — /);
});

test('an event that is not the end, or for a call we never made, changes nothing', async () => {
  const m = await placedLive();
  const notFinal = await settleCall({ ...ended([OPEN], null), final: false }, 'retell', m.store);
  assert.equal(notFinal.ok === false && notFinal.why, 'not_final');
  const stranger = await settleCall({ ...ended([OPEN], null), providerCallId: 'nope' }, 'retell', m.store);
  assert.equal(stranger.ok === false && stranger.why, 'unknown_call');
  assert.equal(m.notes.length, 0);
});

test('an undisclosed call is recorded as such, and the next call is refused', async () => {
  const m = await placedLive();
  await settleCall(ended([A('Hi, table for 4 at 7:30?'), S('Yes, sure, 7:30 is fine.')], { outcome: 'confirmed', staff_quote: 'Yes, sure, 7:30 is fine.' }), 'retell', m.store);
  assert.equal(m.calls[0].disclosed, false);
  const next = await placeCall(input({ booking: booking({ id: 'b-2' }) }), deps(LIVE_ENV, m.store));
  assert.equal(next.ok === false && next.refusal, 'disclosure_failed_before');
});

test('a call nobody answered, or the assistant never spoke on, is not an undisclosed call', async () => {
  for (const [name, turns, signals] of [
    ['no answer', [], { noAnswer: true }],
    ['busy, nothing said', [], {}],
    ['a voicemail the assistant never spoke to', [], { voicemail: true }],
    ['staff said hello and hung up', [S('Hello?')], {}],
  ] as Array<[string, Turn[], any]>) {
    const m = await placedLive();
    const r = await settleCall(ended(turns, null, signals), 'retell', m.store);
    assert.equal(r.ok, true, name);
    assert.equal(m.calls[0].disclosed, null, `${name}: not applicable, not false`);
    const next = await placeCall(input({ booking: booking({ id: 'b-2' }) }), deps(LIVE_ENV, m.store));
    assert.equal(next.ok, true, `${name}: the next call is still placed`);
  }
});

test('a clock time already gone where the venue is, or too close to tell, is refused', async () => {
  // 21:00 in Raleigh by the estimate (UTC-5), on the night itself, open till 23:00.
  const nine = new Date('2026-11-07T02:00:00Z');
  const venue = { ...input().venue!, opening_hours: 'Mo-Su 11:00-23:30' };
  for (const [time, want] of [['18:00', 'time_past'], ['21:00', 'time_past'], ['22:30', 'time_past']] as const) {
    const m = memoryStore();
    const prov = fakeProvider();
    const r = await placeCall(input({ now: nine, venue, chosen: { date: '2026-11-06', time, partySize: 4 } }), deps(LIVE_ENV, m.store, {}, prov));
    assert.equal(r.ok === false && r.refusal, want, time);
    assert.equal(prov.placed.length, 0, `${time}: nothing rang`);
    assert.ok(r.ok === false && r.handoff.phone, `${time}: their number is there instead`);
  }
  // Tomorrow's 18:00 is still to come.
  const m = memoryStore();
  const ok = await placeCall(input({ now: nine, venue, chosen: { date: '2026-11-07', time: '18:00', partySize: 4 } }), deps(LIVE_ENV, m.store));
  assert.equal(ok.ok, true);
});

// ── wording ─────────────────────────────────────────────────────────────
const W: WordingContext = { restaurant: "Luigi's", time: '19:30', date: '2026-11-06', partySize: 4, firstName: 'Maria', solo: true, reserveUrl: 'https://x', phone: VENUE_PHONE };

test('the exact state wording, solo and group', () => {
  assert.deepEqual(callWording({ state: 'calling' }, W), { title: "Reach is calling Luigi's to ask for 7:30 for 4.", body: "You'll see their answer here." });
  assert.equal(callWording({ state: 'settled', outcome: 'confirmed' }, W).title, "Luigi's confirmed on the call: 7:30 for 4, under Maria.");
  assert.equal(callWording({ state: 'settled', outcome: 'confirmed' }, W).body, 'Your table on Friday, November 6 is on your plan.');
  const offer = callWording({ state: 'settled', outcome: 'alternative_offered', offeredTime: '21:00' }, W);
  assert.equal(offer.title, 'No 7:30. They offered 9:00. Take it?');
  assert.equal(offer.body, "Reach only asked. To take 9:00, call Luigi's on (919) 555-0100 or reserve online.");
  assert.equal(callWording({ state: 'settled', outcome: 'alternative_offered', offeredTime: '21:00' }, { ...W, solo: false }).body,
    "Reach only asked. If the group wants 9:00, call Luigi's on (919) 555-0100 or reserve online.");
  assert.equal(callWording({ state: 'settled', outcome: 'no_answer' }, W).title, "Not booked. We couldn't reach Luigi's.");
  assert.equal(callWording({ state: 'settled', outcome: 'voicemail' }, W).title, "Not booked. We couldn't reach Luigi's.");
  assert.equal(callWording({ state: 'settled', outcome: 'no_availability' }, W).title, "Not booked. Luigi's has no table at 7:30.");
  assert.equal(callWording({ state: 'settled', outcome: 'refused' }, W).title, "Not booked. Luigi's didn't want to take the call.");
  assert.equal(callWording({ state: 'settled', outcome: 'needs_guest' }, W).title, "Not booked. Luigi's wants to hear from you to book it.");
  assert.equal(callWording({ state: 'settled', outcome: 'needs_guest' }, { ...W, solo: false }).title, "Not booked. Luigi's wants to hear from someone in the group to book it.");
  assert.match(callWording({ state: 'settled', outcome: 'unclear' }, W).body, /check before you go/);
});

test('no state but confirmed says booked or confirmed', () => {
  for (const outcome of ['alternative_offered', 'no_availability', 'voicemail', 'no_answer', 'refused', 'do_not_call', 'needs_guest', 'unclear', 'failed_to_place'] as const) {
    for (const solo of [true, false]) {
      const w = callWording({ state: 'settled', outcome, offeredTime: '21:00' }, { ...W, solo });
      assert.doesNotMatch(w.title.replace(/^Not booked\./, ''), /\b(booked|confirmed)\b/i, `${outcome}: ${w.title}`);
      if (solo) assert.doesNotMatch(`${w.title} ${w.body}`, /the group|everyone/i, `${outcome} solo`);
    }
  }
});

test('next options name only what we hold', () => {
  assert.equal(nextOptions({ ...W, reserveUrl: null }), "Next: call them on (919) 555-0100 — it's on your plan.");
  assert.equal(nextOptions({ ...W, phone: null }), "Next: reserve online — it's on your plan.");
  assert.equal(nextOptions({ ...W, phone: null, reserveUrl: null }), 'Pick another place on your plan.');
  assert.equal(nextOptions({ ...W, phone: null, reserveUrl: null, solo: false }), 'Pick another place on the plan.');
});

test('a test call says it was a test, and that nothing was booked, even when staff said yes', () => {
  const w = callWording({ state: 'settled', outcome: 'confirmed' }, { ...W, test: true });
  assert.equal(w.title, "Test call — Luigi's confirmed on the call: 7:30 for 4, under Maria.");
  assert.match(w.body, /^Nothing was booked/);
});

// ── the webhook ─────────────────────────────────────────────────────────
const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

test('Retell webhooks are verified by signature, and a stale or tampered one is refused', () => {
  const r = retell({ RETELL_API_KEY: 'key_retell' });
  const body = JSON.stringify({ event: 'call_analyzed', call: { call_id: 'call_abc' } });
  const ts = String(Date.now());
  const sig = `v=${ts},d=${createHmac('sha256', 'key_retell').update(body + ts).digest('hex')}`;
  assert.equal(r.verify(body, headers({ 'x-retell-signature': sig })), true);
  assert.equal(r.verify(body + ' ', headers({ 'x-retell-signature': sig })), false, 'tampered body');
  assert.equal(r.verify(body, headers({ 'x-retell-signature': sig })), true);
  assert.equal(r.verify(body, headers({ 'x-retell-signature': sig }), Date.now() + 10 * 60_000), false, 'stale');
  assert.equal(retell({ RETELL_API_KEY: 'other' }).verify(body, headers({ 'x-retell-signature': sig })), false, 'wrong key');
  assert.equal(r.verify(body, headers({})), false);
  assert.equal(senderOf(headers({ 'x-retell-signature': sig })), 'retell');
});

test('Vapi webhooks need the shared secret', () => {
  const v = vapi({ VAPI_WEBHOOK_SECRET: 's3cret' });
  assert.equal(v.verify('{}', headers({ 'x-vapi-secret': 's3cret' })), true);
  assert.equal(v.verify('{}', headers({ 'x-vapi-secret': 'nope' })), false);
  assert.equal(vapi({}).verify('{}', headers({ 'x-vapi-secret': '' })), false, 'no secret configured: nothing verifies');
});

test('provider payloads become turns, extraction and signals', () => {
  const r = retell({}).parse({ event: 'call_analyzed', call: {
    call_id: 'call_abc', metadata: { reach_call_id: 'c1' }, disconnection_reason: 'agent_hangup',
    transcript_object: [{ role: 'agent', content: 'Hi' }, { role: 'user', content: 'Yes' }],
    call_analysis: { in_voicemail: false, custom_analysis_data: { outcome: 'confirmed' } },
  } })!;
  assert.deepEqual(r.turns, [{ speaker: 'assistant', text: 'Hi' }, { speaker: 'staff', text: 'Yes' }]);
  assert.equal(r.final, true);
  assert.equal(r.extraction?.outcome, 'confirmed');
  assert.equal(retell({}).parse({ event: 'call_ended', call: { call_id: 'x', disconnection_reason: 'user_hangup' } })!.final, false, 'wait for the analysis');
  assert.equal(retell({}).parse({ event: 'call_ended', call: { call_id: 'x', disconnection_reason: 'dial_no_answer' } })!.signals.noAnswer, true);
  assert.equal(retell({}).parse({ event: 'call_started', call: {} }), null);
  const v = vapi({}).parse({ message: { type: 'end-of-call-report', endedReason: 'voicemail', call: { id: 'v1' },
    artifact: { messages: [{ role: 'system', message: 'rules' }, { role: 'bot', message: 'Hi' }, { role: 'user', message: 'Beep' }] } } })!;
  assert.equal(v.signals.voicemail, true);
  assert.equal(v.turns.length, 2, 'the system prompt is not a turn');
});

// ── the routes, read as source ──────────────────────────────────────────
test('the webhook verifies before it reads, and the call route takes its numbers only from the gate', () => {
  const hook = readFileSync('app/api/webhooks/reservation-call/route.ts', 'utf8');
  assert.ok(hook.indexOf('provider.verify(') > 0 && hook.indexOf('provider.verify(') < hook.indexOf('JSON.parse('), 'signature checked before the body is parsed');
  // Code only: the header comment explains the very defaults it refuses.
  const route = readFileSync('app/api/bookings/[id]/call/route.ts', 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(route, /RESERVATION_TEST_NUMBER|to_number|\.place\(/, 'the route never picks a number to dial');
  assert.doesNotMatch(route, /'19:00'|start_date \?\? ''/, 'no default time or first-night date');
});

// ── the Supabase store: the limits the database holds ───────────────────
/** Just enough of supabase-js for claim(): a count, and an insert the unique indexes can refuse. */
function claimDb(rows: Array<{ booking_id: string; mode: string; call_day: string; day_slot: number }>, opts: { stale?: number } = {}) {
  return {
    from() {
      let inserting: any = null;
      const b: any = {
        select() { return b; },
        eq(_c: string, v: string) { b.day = v; return b; },
        insert(row: any) { inserting = row; return b; },
        then(resolve: (v: unknown) => void) {
          // A count read before another request's insert landed is `stale` behind.
          const seen = rows.filter(r => r.call_day === b.day);
          const read = seen.slice(0, Math.max(0, seen.length - (opts.stale ?? 0)));
          resolve({ data: read.map(r => ({ day_slot: r.day_slot })), count: read.length, error: null });
        },
        async single() {
          if (rows.some(r => r.booking_id === inserting.booking_id && r.mode === inserting.mode)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "reservation_calls_one_per_booking"' } };
          }
          if (rows.some(r => r.call_day === inserting.call_day && r.day_slot === inserting.day_slot)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "reservation_calls_day_slot"' } };
          }
          rows.push(inserting);
          return { data: { ...inserting, id: `row${rows.length}` }, error: null };
        },
      };
      return b;
    },
  } as any;
}
const claimRow = (booking_id: string) => ({
  booking_id, plan_id: 'p1', requested_by: 'u1', mode: 'live' as const, provider: 'retell' as const,
  dialed_number: VENUE_PHONE, venue_phone: VENUE_PHONE, call_day: '2026-11-04', request: {} as any, opening: 'Hi',
});

test('the database holds the cap, the one call, and a slot two requests both wanted', async () => {
  const rows: any[] = [];
  const store = supabaseStore(claimDb(rows), null);
  assert.equal((await store.claim(claimRow('b1'))).ok, true);
  const dup = await store.claim(claimRow('b1'));
  assert.equal(dup.ok === false && dup.why, 'already');

  // Another request took slot 2 after this one counted: this one moves on to slot 3.
  rows.push({ booking_id: 'other', mode: 'live', call_day: '2026-11-04', day_slot: 2 });
  const r = await supabaseStore(claimDb(rows, { stale: 1 }), null).claim(claimRow('b3'));
  assert.equal(r.ok, true);
  assert.equal(rows.at(-1)!.day_slot, 3);

  const full = Array.from({ length: DAILY_CAP }, (_, i) => ({ booking_id: `x${i}`, mode: 'live', call_day: '2026-11-04', day_slot: i + 1 }));
  const capped = await supabaseStore(claimDb(full), null).claim(claimRow('late'));
  assert.equal(capped.ok === false && capped.why, 'cap');
});

test('a slot a refused placement released is taken again, so holes never cap the day early', async () => {
  // Slots 1-5 released after provider refusals; 6-15 in use: ten calls of fifty.
  const rows = Array.from({ length: 10 }, (_, i) => ({ booking_id: `x${i}`, mode: 'live', call_day: '2026-11-04', day_slot: i + 6 }));
  const r = await supabaseStore(claimDb(rows), null).claim(claimRow('after-holes'));
  assert.equal(r.ok, true);
  assert.equal(rows.at(-1)!.day_slot, 1, 'the lowest free slot');
  // And with six more holes taken one by one, the day still reaches fifty.
  const store = supabaseStore(claimDb(rows), null);
  for (let i = 0; i < DAILY_CAP - 11; i++) assert.equal((await store.claim(claimRow(`fill${i}`))).ok, true, `call ${i + 12}`);
  const full = await store.claim(claimRow('fifty-first'));
  assert.equal(full.ok === false && full.why, 'cap');
  assert.equal(new Set(rows.map(r => r.day_slot)).size, DAILY_CAP);
});
