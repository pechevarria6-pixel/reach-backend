// What the table screens show for each answer from the one booking path.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readTableAnswer, offeredTitle, feeSaid, holdLeft, leftSaid, callShown, callWords, MAY_BE_BOOKED,
  tableControls, answerShown, bookItCovers,
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
  assert.deepEqual(callWords({ path: 'call', state: 'confirmed', title: "Luigi's confirmed on the call: Sat, Nov 7 at 7:30 PM for 4.", body: '' }, { ...info, call: { ...info.call, outcome: 'confirmed' } }),
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

test('a call that got no table never speaks for a table booked another way', () => {
  const info = { available: true, call: { status: 'settled', outcome: 'no_availability', title: "Not booked. Luigi's had no table at 7:30", body: '' } };
  // Booked by the person afterwards: the row's words, not the call's.
  assert.deepEqual(callWords({ path: 'call', state: 'confirmed', title: 'You entered ABC123', body: 'b' }, info), { title: 'You entered ABC123', body: 'b' });
  assert.deepEqual(callWords({ path: 'call', state: null, title: 'You entered ABC123', body: 'b' }, info), { title: 'You entered ABC123', body: 'b' });
  // Still where the call left it: the call's words.
  assert.equal(callWords({ path: 'call', state: 'not_booked', title: 'row', body: '' }, info)?.title, info.call.title);
});

const OPEN_INSTANT = {
  open: true, path: 'instant', status: 'awaiting_approval', state: null, needs: [] as ('date' | 'time')[],
  alternatives: ALTS, ownAccount: { label: 'Book on your own OpenTable', href: 'https://www.opentable.com/r/luigis' },
};

test('a confirmed press leaves nothing else to book with, even before the row is read again', () => {
  const done = readTableAnswer(200, { outcome: 'confirmed', title: 'Confirmed by OpenTable · ref 4821', body: '' });
  const c = tableControls(OPEN_INSTANT, done, {});
  assert.equal(c.primary, null);
  assert.equal(c.ownAccount, false, 'their own OpenTable beside a confirmation is a second table');
  assert.deepEqual(c.alternatives, []);
  assert.deepEqual(c.pickers, []);
  // The row read again says it itself; the answer goes.
  assert.equal(answerShown(done, { ...OPEN_INSTANT, open: false, state: 'confirmed' }), null);
  assert.equal(answerShown(done, OPEN_INSTANT), done, 'a row not yet read again still shows it');
});

test('a table Book it handed over or left owing a card offers no Book it, from a list read before', () => {
  for (const outcome of ['handed_off', 'card_owed']) {
    const seed = readTableAnswer(200, { outcome, title: 'Not booked yet', body: '', href: 'https://www.opentable.com/booking/card/88', alternatives: ALTS.slice(0, 1) });
    // tables.list as read before Book it: open, instant, nothing on it yet.
    const c = tableControls(OPEN_INSTANT, seed, {});
    assert.equal(c.primary, null, `${outcome}: approval would only answer "already dealt with"`);
    assert.equal(c.ownAccount, false);
    assert.equal(c.showWhat, false, '"Reach books Luigi\'s on OpenTable" is not what happened');
    assert.deepEqual(c.alternatives, ALTS.slice(0, 1));
    // Once the row says the same thing, it is said once.
    assert.equal(answerShown(seed, { ...OPEN_INSTANT, path: 'handoff', state: outcome }), null);
  }
});

test('checkout\'s Book it covers only the tables its loop sends', () => {
  assert.equal(bookItCovers(OPEN_INSTANT, 'book'), true);
  assert.equal(bookItCovers(OPEN_INSTANT, 'pay'), false);
  assert.equal(bookItCovers({ ...OPEN_INSTANT, status: 'failed', state: 'not_booked' }, 'book'), false, 'approval refuses a failed row');
  assert.equal(bookItCovers({ ...OPEN_INSTANT, status: 'redirected' }, 'book'), false);
  assert.equal(bookItCovers({ ...OPEN_INSTANT, needs: ['time'] }, 'book'), false, 'Book it sends no time');
  assert.equal(bookItCovers({ ...OPEN_INSTANT, path: 'call' }, 'book'), false);
  // A failed instant row keeps its own Book it in checkout.
  const failed = { ...OPEN_INSTANT, status: 'failed', state: 'not_booked' };
  assert.equal(tableControls(failed, null, { noPrimary: bookItCovers(failed, 'book') }).primary, 'book');
  // The loop and the row read the same rule.
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /if\(!bookItCovers\(t,"book"\)\)continue;/);
  assert.match(app, /noPrimary=\{bookItCovers\(it\.table,checkout\.step\)\}/);
  assert.match(app, /forgetTables\(planId\);\s*await tables\.reload\(\);/, 'the problems screen reads the tables as they now stand');
});

test('a night or time is asked for only where a press sends it', () => {
  const handoff = { open: true, path: 'handoff', status: null, state: null, needs: ['time'] as ('date' | 'time')[], alternatives: ALTS, ownAccount: null };
  assert.deepEqual(tableControls(handoff, null, {}).pickers, [], 'a link and a number built without it');
  assert.deepEqual(tableControls({ ...OPEN_INSTANT, needs: ['time'] }, null, {}).pickers, ['time']);
  assert.deepEqual(tableControls({ ...OPEN_INSTANT, needs: ['time'] }, null, { noPrimary: true }).pickers, []);
  const call = { ...handoff, path: 'call' };
  assert.deepEqual(tableControls(call, null, { mayCall: true }).pickers, ['time']);
  assert.deepEqual(tableControls(call, null, { mayCall: false }).pickers, []);
});

test('a number typed on a line with no booking row is kept on a row, or said not kept', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  const got = app.slice(app.indexOf('const gotIt=async()=>{'), app.indexOf('const askCancel=async'));
  assert.match(got, /if\(!bid&&n&&makeRow\)/, 'a row is set up for the number');
  assert.match(got, /saySorted\(bid,n\)/);
  assert.match(got, /couldn't keep \$\{n\}/, 'never dropped in silence');
});
