// What the table screens show for each answer from the one booking path.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readTableAnswer, offeredTitle, feeSaid, holdLeft, leftSaid, callShown, callWords, MAY_BE_BOOKED,
} from '../../lib/reservations/table-screen.ts';

const HOLD = {
  holdId: 'tok_1', platform: 'opentable', platformLabel: 'OpenTable', date: '2026-11-07', time: '19:30', covers: 4,
  expiresAt: '2026-11-04T18:05:00Z', cancellationPolicy: 'Cancel by 5pm the day before.', policies: ['Tables are held for 15 minutes.'],
  terms: { text: 'By booking you agree to the OpenTable Terms.', links: [{ label: 'Terms', url: 'https://www.opentable.com/legal/terms' }], version: 'ot-terms-1' },
  fee: null, cancelBy: null, notes: null,
};
const ALTS = [{ kind: 'phone', label: "Call Luigi's", what: 'Ring them.', href: 'tel:+19195550100' }, { kind: 'confirm', label: "I've got it", what: 'Say so.' }];

test('press one: the hold, with the button exactly as returned', () => {
  const a = readTableAnswer(409, { code: 'terms_required', hold: HOLD, button: 'Complete reservation', title: 'Held for 5 minutes — not booked yet', body: 'OpenTable is holding…', changeNote: null, alternatives: ALTS });
  assert.equal(a.kind, 'hold');
  if (a.kind !== 'hold') return;
  assert.equal(a.button, 'Complete reservation');
  assert.equal(a.hold.terms?.version, 'ot-terms-1');
  assert.deepEqual(a.alternatives, ALTS);
});

test('every refusal keeps its own words and its next options', () => {
  const other = readTableAnswer(409, { code: 'other_time', offeredTimes: ['21:00'], error: 'Not at 7:30.', alternatives: ALTS }, { asked: '19:30' });
  assert.equal(other.kind, 'other_time');
  if (other.kind === 'other_time') {
    assert.equal(other.title, 'No 7:30 — they offered 9:00. Take it?');
    assert.deepEqual(other.offered, ['21:00']);
    assert.equal(other.error, 'Not at 7:30.');
  }
  const none = readTableAnswer(409, { code: 'unavailable', error: "Not booked. Luigi's has no table on OpenTable.", alternatives: ALTS });
  assert.equal(none.kind, 'refused');
  if (none.kind === 'refused') { assert.equal(none.error, "Not booked. Luigi's has no table on OpenTable."); assert.deepEqual(none.alternatives, ALTS); }
  const card = readTableAnswer(409, { code: 'pending_card', error: 'OpenTable still needs a card.', platformUrl: 'https://www.opentable.com/booking/x', alternatives: [] });
  assert.equal(card.kind === 'refused' && card.platformUrl, 'https://www.opentable.com/booking/x');
  for (const code of ['hold_expired', 'hold_missing', 'slot_gone']) {
    const h = readTableAnswer(409, { code, error: 'The hold ran out.', alternatives: ALTS });
    assert.equal(h.kind, 'hold_again', code);
  }
  assert.equal(readTableAnswer(409, { code: 'in_progress', error: 'Somebody is booking this.' }).kind, 'busy');
  assert.equal(readTableAnswer(409, { code: 'ask_first', error: 'Booked it yourself?' }).kind, 'ask_first');
  const needs = readTableAnswer(422, { code: 'missing_facts', missing: ['time'], error: 'Pick a time first.' });
  assert.equal(needs.kind === 'needs' && needs.missing[0], 'time');
  // Approval renames some codes and keeps reserve's own as reserveCode.
  assert.equal(readTableAnswer(409, { code: 'already_in_progress', reserveCode: 'calling', error: 'On the phone.' }).kind, 'busy');
});

test('it may already be booked: said as that, with nothing to press', () => {
  const u = readTableAnswer(502, { code: 'outcome_unknown', error: 'OpenTable did not answer.', alternatives: [] });
  assert.equal(u.kind, 'unknown');
  if (u.kind === 'unknown') assert.equal(u.title, MAY_BE_BOOKED);
  assert.ok(!('alternatives' in u), 'no next option is a second table');
  // No answer at all to a press that could have booked is the same.
  assert.equal(readTableAnswer(0, null, { pressTwo: true }).kind, 'unknown');
  assert.equal(readTableAnswer(0, null, { path: 'call' }).kind, 'unknown', 'a call may be ringing');
  // To press one on a platform it is not: a hold is not a booking.
  assert.equal(readTableAnswer(0, null, { path: 'instant' }).kind, 'refused');
});

test('a 200 is booked only when it says so: a card owed, a call ringing or a hand-off are not', () => {
  assert.equal(readTableAnswer(200, { outcome: 'confirmed', title: 'Confirmed', body: '' }).kind, 'done');
  assert.equal(readTableAnswer(200, { outcome: 'confirmed', already: true, title: 'x' }).kind, 'done');
  for (const outcome of ['card_owed', 'calling', 'handed_off']) {
    const a = readTableAnswer(200, { outcome, title: 'Not booked yet', alternatives: ALTS });
    assert.equal(a.kind, 'not_yet', outcome);
  }
});

test('the fee exactly as the platform gave it, and nothing when there is none', () => {
  assert.equal(feeSaid(null), null);
  assert.equal(feeSaid({ label: 'OpenTable Service Fee (2%)', amountCents: 250, taxCents: 0, currency: 'USD' }), 'OpenTable Service Fee (2%): $2.50');
  assert.equal(feeSaid({ label: 'Booking fee', amountCents: 1000, taxCents: 80, currency: 'USD' }), 'Booking fee: $10.00 + $0.80 tax');
});

test('the countdown runs to the hold\'s own time', () => {
  const now = Date.parse('2026-11-04T18:00:01Z');
  assert.equal(holdLeft(HOLD.expiresAt, now), 299);
  assert.equal(leftSaid(299), '4:59');
  assert.equal(holdLeft(HOLD.expiresAt, Date.parse('2026-11-04T18:06:00Z')), 0);
  assert.equal(holdLeft(undefined, now), null);
  assert.equal(offeredTitle(null, '21:00'), 'They offered 9:00. Take it?');
});

test('"Have Reach call" only when the server offered a call and the call route says it is available', () => {
  const offered = { open: true, path: 'instant', alternatives: [{ kind: 'call', label: 'Ask Reach to call', what: '' }] };
  const live = { available: true, test: false, call: null };
  assert.equal(callShown(offered, live), true);
  assert.equal(callShown({ open: true, path: 'call', alternatives: [] }, live), true);
  assert.equal(callShown(offered, { ...live, available: false }), false, 'calls off');
  assert.equal(callShown(offered, { ...live, test: true }), false, 'a test call books nothing, so it is never offered');
  assert.equal(callShown(offered, { ...live, call: { status: 'calling' } }), false, 'one call per table');
  assert.equal(callShown({ open: true, path: 'handoff', alternatives: [] }, live), false, 'the server did not offer one');
  assert.equal(callShown({ ...offered, open: false }, live), false);
  assert.equal(callShown(offered, null), false, 'unread is not available');
});

test('a call is told in the research\'s words, from the call itself', () => {
  const info = { available: true, call: { status: 'settled', title: "Luigi's confirmed on the call: 7:30 for 4, under Maria.", body: "The group's table on Saturday, November 7 is on the plan." } };
  assert.deepEqual(callWords({ path: 'call', title: "Luigi's confirmed on the call: Sat, Nov 7 at 7:30 PM for 4.", body: '' }, info),
    { title: "Luigi's confirmed on the call: 7:30 for 4, under Maria.", body: "The group's table on Saturday, November 7 is on the plan." });
  assert.deepEqual(callWords({ path: 'instant', title: 'Confirmed by OpenTable · ref 4821', body: 'x' }, info), { title: 'Confirmed by OpenTable · ref 4821', body: 'x' });
});

test('the screen books a table only through the one path, and shows what it was told', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /\/api\/plans\/\$\{planId\}\/reservations/, 'reads how each table will go');
  assert.match(app, /\/api\/bookings\/\$\{[^}]+\}\/reserve/, 'books through reserve');
  assert.match(app, /readTableAnswer\(/, 'reads every answer through the one reader');
  assert.match(app, /callShown\(/, 'calls offered only when the call route says so');
  // Press two sends the hold and what was accepted — nothing else.
  assert.match(app, /holdId:hold\.holdId,accept:\{terms:hold\.terms\?\.version\?\?null,policy:true\}/);
  // The button's words are the server's.
  assert.match(app, /busy\?"Booking…":answer\.button/);
});
