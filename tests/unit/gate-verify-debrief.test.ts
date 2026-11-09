// Run with: npm run test:unit
// Pilot gate A7 / business-model M2: the organiser's post-trip debrief.
// The rules (components/pilot/rules.ts), the route that stores it, the
// migration that keeps the note, and the readouts written against both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALMOST_QUIT_MAX, HOURS_CHOICES, MESSAGE_CHOICES,
  debriefEventProps, debriefGate, debriefReady, parseDebrief,
} from '../../components/pilot/rules.ts';
import { scrubProps } from '../../lib/track.ts';

const ROUTE = readFileSync('app/api/plans/[planId]/debrief/route.ts', 'utf8');
const FORM = readFileSync('components/pilot/DebriefForm.jsx', 'utf8');
const SQL = readFileSync('sql/pilot-debrief-2026-11-08.sql', 'utf8');
const READOUTS = readFileSync('docs/pilot/READOUTS.md', 'utf8');

const minimal = { hours: '3_6', nps: 9, would_run_again: true };

test('the three required answers are enough, and become the stored numbers', () => {
  const p = parseDebrief(minimal);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(p.value, { hours: 4.5, messages: null, nps: 9, would_run_again: true, almost_quit: null });
});

test('only the choices offered are accepted — never a free number', () => {
  assert.equal(parseDebrief({ ...minimal, hours: 19 }).ok, false, 'a typed number is not a choice');
  assert.equal(parseDebrief({ ...minimal, hours: undefined }).ok, false);
  assert.equal(parseDebrief({ ...minimal, nps: 11 }).ok, false);
  assert.equal(parseDebrief({ ...minimal, nps: -1 }).ok, false);
  assert.equal(parseDebrief({ ...minimal, nps: 7.5 }).ok, false);
  assert.equal(parseDebrief({ ...minimal, nps: '9' }).ok, false);
  assert.equal(parseDebrief({ ...minimal, would_run_again: 'yes' }).ok, false);
  assert.equal(parseDebrief({ hours: '3_6', nps: 9 }).ok, false, '"would you run the next one?" is required');
  assert.equal(parseDebrief({ ...minimal, messages: 83 }).ok, false);
  assert.equal(parseDebrief(null).ok, false);
  const m = parseDebrief({ ...minimal, messages: '60_100' });
  assert.ok(m.ok && m.value.messages === 80);
  const zero = parseDebrief({ ...minimal, nps: 0, would_run_again: false });
  assert.ok(zero.ok && zero.value.nps === 0 && zero.value.would_run_again === false, '0 and false are answers, not blanks');
});

test('the note is optional, trimmed, and capped at 280', () => {
  const blank = parseDebrief({ ...minimal, almost_quit: '   ' });
  assert.ok(blank.ok && blank.value.almost_quit === null);
  const at = parseDebrief({ ...minimal, almost_quit: 'x'.repeat(ALMOST_QUIT_MAX) });
  assert.ok(at.ok);
  assert.equal(parseDebrief({ ...minimal, almost_quit: 'x'.repeat(ALMOST_QUIT_MAX + 1) }).ok, false);
  assert.equal(parseDebrief({ ...minimal, almost_quit: 42 }).ok, false);
});

test('the event carries numbers and booleans only, and survives scrubProps whole', () => {
  const p = parseDebrief({ ...minimal, messages: 'over_100', almost_quit: 'Chasing three people for their share' });
  assert.ok(p.ok);
  if (!p.ok) return;
  const props = debriefEventProps(p.value, { solo: false });
  for (const v of Object.values(props)) assert.ok(typeof v === 'number' || typeof v === 'boolean');
  assert.equal(JSON.stringify(props).includes('Chasing'), false, 'the note never reaches events');
  // Every key it sends is one the tracker keeps. `messages` would not be:
  // scrubProps drops anything matching /message/, which is why it is `msgs`.
  assert.deepEqual(scrubProps(props), props);
  assert.equal(props.msgs, 130);
  assert.deepEqual(scrubProps({ messages: 130 }), {}, 'the reason the key is msgs');
});

test('asked of the organiser, once, after a trip that happened', () => {
  const base = { organiser: true, status: 'booked', closeWhy: null, held: true, submitted: false };
  assert.deepEqual(debriefGate(base), { ask: true, why: null });
  assert.equal(debriefGate({ ...base, organiser: false }).why, 'not_organiser');
  assert.equal(debriefGate({ ...base, status: 'cancelled' }).why, 'cancelled');
  assert.equal(debriefGate({ ...base, held: false }).why, 'nothing_held');
  assert.equal(debriefGate({ ...base, closeWhy: 'not_over' }).why, 'not_over');
  assert.equal(debriefGate({ ...base, closeWhy: 'no_dates' }).why, 'no_dates');
  assert.equal(debriefGate({ ...base, submitted: true }).why, 'submitted');
  // Closed as completed counts as over, whatever the dates say.
  assert.equal(debriefGate({ ...base, status: 'completed', closeWhy: 'not_over' }).ask, true);
  // Completed with nothing held is still not a trip that happened.
  assert.equal(debriefGate({ ...base, status: 'completed', held: false }).ask, false);
});

test('three taps: hours and a score make it ready, and the last answer sends it', () => {
  assert.equal(debriefReady({ hours: null, nps: null }), false);
  assert.equal(debriefReady({ hours: '1_3', nps: null }), false);
  assert.equal(debriefReady({ hours: null, nps: 0 }), false);
  assert.equal(debriefReady({ hours: '1_3', nps: 0 }), true);
  assert.equal(debriefReady({ hours: 'nineteen', nps: 5 }), false);
  // The two "would you run the next one?" buttons are the send.
  assert.match(FORM, /onClick=\{\(\) => send\(o\.v\)\}/);
  // And they look alike: neither is dressed as the primary action.
  assert.equal(/className="bp"/.test(FORM), false, 'a bright Yes beside a quiet No leads the answer');
});

test('the route checks membership, reads earlier answers before writing, and keeps prose out of events', () => {
  assert.match(ROUTE, /requirePlanMember\(params\.planId\)/);
  const post = ROUTE.slice(ROUTE.indexOf('export async function POST'));
  const read = post.indexOf('priorAnswer(ctx');
  const insert = post.indexOf('.insert(');
  const tracked = post.indexOf('await track(');
  assert.ok(read > 0 && insert > read && tracked > read, 'events are checked first, then written');
  assert.match(post, /prior\.submitted[\s\S]{0,200}status: 409/);
  assert.match(post, /'23505'/, 'a double tap that loses the race is answered, not failed');
  const trackCall = post.slice(tracked, post.indexOf('});', tracked));
  assert.match(trackCall, /props: debriefEventProps\(/);
  assert.equal(/almost_quit/.test(trackCall), false);
  assert.match(ROUTE, /from\('events'\)\.select\('id'\)\.eq\('name', EVENT\)/);
});

test('the migration holds exactly the values the choices store', () => {
  const list = (re: RegExp) => (SQL.match(re)?.[1] ?? '').split(',').map(s => Number(s.trim()));
  assert.deepEqual(list(/hours in \(([^)]*)\)/), HOURS_CHOICES.map(c => c.hours));
  assert.deepEqual(list(/messages in \(([^)]*)\)/), MESSAGE_CHOICES.map(c => c.count));
  assert.match(SQL, /char_length\(almost_quit\) <= 280/);
  assert.match(SQL, /unique index if not exists pilot_debriefs_one_per_person[\s\S]*\(plan_id, user_id\)/);
  assert.match(SQL, /enable row level security/);
});

test('READOUTS.md pre-registers the four baselines and reads the stored values', () => {
  for (const b of ['24%', '30%', '19', '83', '50']) assert.ok(READOUTS.includes(b), `baseline ${b}`);
  assert.match(READOUTS, /props->>'msgs'/, 'the messages readout reads the key that survives scrubProps');
  assert.equal(/props->>'messages'/.test(READOUTS), false);
  assert.match(READOUTS, /two consecutive (pilot )?trips/i, 'the stop rule');
});
