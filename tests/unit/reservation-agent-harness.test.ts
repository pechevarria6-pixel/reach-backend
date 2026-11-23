// Run with: npm run test:unit
// The calling agent against a mocked restaurant (design §8). No call is
// placed and no model is asked: a script plays the restaurant, and a
// scripted "model" plays the agent's side, so each scenario checks the rules
// (machine.ts), the words (prompt.ts), the driver (session.ts) and the
// proof (outcome.ts via settle-window.ts) together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession, type Model } from '../../lib/reservations/agent/session.ts';
import { settleWithin, windowFor } from '../../lib/reservations/agent/settle-window.ts';
import { step, start, inWindow } from '../../lib/reservations/agent/machine.ts';
import { redact, speakable, readReply, systemPrompt, asMessages } from '../../lib/reservations/agent/prompt.ts';
import { disclosedIn } from '../../lib/reservations/outcome.ts';
import type { CallFacts } from '../../lib/reservations/script.ts';

const FACTS: CallFacts = { restaurant: 'Husk', venuePhone: '+18435551234', date: '2026-12-04', time: '19:30', partySize: 4, firstName: 'Sam', notes: null };
const WINDOW = windowFor(FACTS, '18:30', '20:00');

/** A scripted agent: each reply in order, as the model would return it. */
const scripted = (...replies: object[]): Model & { prompts: string[] } => {
  const prompts: string[] = [];
  let i = 0;
  const m = (async (system: string) => {
    prompts.push(system);
    const r = replies[i++];
    if (!r) throw new Error('script ran out');
    return JSON.stringify(r);
  }) as unknown as Model & { prompts: string[] };
  m.prompts = prompts;
  return m;
};
const R = (say: string, move: string, heard: object = {}) => ({ say, move, heard });

async function run(staff: string[], model: Model) {
  const s = createSession(FACTS, WINDOW, model);
  s.greeting();
  const out = [];
  for (const line of staff) {
    const r = await s.heard(line);
    out.push(r);
    if (r.ended) break;
  }
  if (!out.at(-1)?.ended) s.hungUp();
  const sum = s.summary();
  return { out, sum, settled: settleWithin(FACTS, WINDOW, sum.turns, sum.extraction) };
}

const NO_LONG_DIGITS = (t: string) => assert.ok(!/(?:\d[ -]?){12,19}/.test(t), `a long digit run in: ${t}`);

test('accepts the asked time: confirmed, and settle proves it from the staff yes', async () => {
  const { sum, settled } = await run(
    ['Yes, we can do 7:30 for four.', 'Yes, that is right.'],
    scripted(R('Great, so that is four people on Friday, December 4 at 7:30 PM under Sam. Is that right?', 'offered', { time: '19:30' }), R('', 'staff_yes')),
  );
  assert.equal(sum.ending, 'confirmed');
  assert.equal(settled.outcome, 'confirmed');
  assert.equal(settled.held?.time, '19:30');
  assert.equal(disclosedIn(sum.turns), true, 'the opening said who is calling and that it is recorded');
});

test('a counter-offer inside the window is confirmed at the new time', async () => {
  const { sum, settled } = await run(
    ['We are full at 7:30, but we have 8:00.', 'Yes, eight o\'clock for four under Sam.'],
    scripted(R('Eight works. So four people on Friday, December 4 at 8:00 PM under Sam, is that right?', 'offered', { time: '20:00' }), R('', 'staff_yes')),
  );
  assert.equal(sum.ending, 'confirmed');
  assert.equal(settled.outcome, 'confirmed');
  assert.equal(settled.held?.time, '20:00');
});

test('a counter-offer outside the window is declined, never accepted, and the offer is kept', async () => {
  const { sum, settled } = await run(
    ['We only have 9:15.'],
    scripted(R('Let me check with Sam and call back.', 'offered', { time: '21:15' })),
  );
  assert.equal(sum.ending, 'declined');
  assert.equal(sum.offeredOutside, '21:15');
  assert.equal(settled.outcome, 'alternative_offered');
  assert.notEqual(settled.outcome, 'confirmed');
});

test('a card required to hold it ends as needs_card, and no card detail is ever said', async () => {
  const { out, sum, settled } = await run(
    ['We need a card to hold parties of four, 25 dollars a head.'],
    scripted(R('Could you hold it under Sam? They will call with a card.', 'card', { depositDollars: 25 })),
  );
  assert.equal(sum.ending, 'needs_card');
  assert.equal(sum.depositDollars, 25);
  assert.equal(settled.outcome, 'needs_guest');
  for (const r of out) assert.doesNotMatch(r.say, /card number|\d{12,}/i);
});

test('voicemail: no message is left, and it settles as not booked', async () => {
  const { out, sum, settled } = await run(
    ['You have reached Husk. Please leave a message after the tone.'],
    scripted(R('', 'voicemail')),
  );
  assert.equal(sum.ending, 'no_answer');
  assert.equal(out.at(-1)?.say, '', 'nothing is said to a voicemail');
  assert.equal(settled.outcome, 'voicemail');
});

test('a phone menu is pressed through, but a menu with no person ends after three presses', async () => {
  const menu = 'For hours press 1, for reservations press 2.';
  const { out, sum } = await run(
    [menu, menu, menu, menu],
    scripted(R('', 'press', { digits: '2' }), R('', 'press', { digits: '2' }), R('', 'press', { digits: '2' }), R('', 'press', { digits: '2' })),
  );
  assert.deepEqual(out.slice(0, 3).map(r => r.press), ['2', '2', '2']);
  assert.equal(sum.ending, 'no_answer');
});

test('"we don\'t talk to bots" ends at once, apologising; "don\'t call again" also stops future calls', async () => {
  const a = await run(['We don\'t take calls from robots.'], scripted(R('Sorry', 'no_bots')));
  assert.equal(a.sum.ending, 'declined_bot');
  assert.match(a.out[0].say, /sorry/i);
  assert.equal(a.settled.outcome, 'refused');
  assert.equal(a.settled.stopCalling, true);
  const b = await run(['Please take us off your list and don\'t call again.'], scripted(R('Sorry', 'do_not_call')));
  assert.equal(b.sum.askedNotToCall, true);
  assert.equal(b.settled.stopCalling, true);
});

test('a hang-up mid-call is failed, and settles as not booked', async () => {
  const { sum, settled } = await run(
    ['Hold on one second.'],
    scripted(R('Of course.', 'answer')),
  );
  assert.equal(sum.ending, 'failed');
  assert.notEqual(settled.outcome, 'confirmed');
});

test('the model saying "staff_yes" when staff said no is caught by the proof', async () => {
  const { sum, settled } = await run(
    ['We could maybe do 7:30 for four.', 'No, actually we cannot, sorry.'],
    scripted(R('So four people on Friday, December 4 at 7:30 PM under Sam, is that right?', 'offered', { time: '19:30' }), R('', 'staff_yes')),
  );
  assert.equal(sum.ending, 'confirmed', 'the agent believed it');
  assert.notEqual(settled.outcome, 'confirmed', 'the proof did not');
});

test('a move the step does not allow ends the call politely as failed', async () => {
  const { sum } = await run(['Hello?'], scripted(R('Booked!', 'staff_yes')));
  assert.equal(sum.ending, 'failed');
  const { sum: s2 } = await run(['Hello?'], scripted(R('Hi', 'make_it_up')));
  assert.equal(s2.ending, 'failed');
});

test('a reply that is not the agreed JSON, or a model error, ends as failed', async () => {
  const s = createSession(FACTS, WINDOW, async () => 'not json');
  s.greeting();
  assert.equal((await s.heard('Hello?')).ended, 'failed');
  const t = createSession(FACTS, WINDOW, async () => { throw new Error('timeout'); });
  t.greeting();
  assert.equal((await t.heard('Hello?')).ended, 'failed');
});

test('the agent never claims a booking, and no long digit run is said, stored or sent to the model', async () => {
  assert.equal(speakable("Great, you're booked for 7:30!"), 'Thank you.');
  assert.equal(speakable('I have reserved it.'), 'Thank you.');
  assert.match(speakable('Is 7:30 OK?'), /7:30/);
  NO_LONG_DIGITS(redact('my card is 4242 4242 4242 4242'));
  const m = scripted(R('Thanks.', 'answer'), R('', 'full'));
  const { sum } = await run(['Sure, the card on file is 4111111111111111, what name?', 'Sorry, we are full.'], m);
  for (const t of sum.turns) NO_LONG_DIGITS(t.text);
  for (const p of m.prompts) NO_LONG_DIGITS(p);
});

test('the opening is ours, word for word, and the prompt carries no phone number and no payment detail', () => {
  const p = systemPrompt({ ...FACTS, notes: 'one guest has a nut allergy' }, WINDOW, 'REQUEST');
  assert.doesNotMatch(p, /\+1843|5551234/);
  assert.match(p, /nut allergy/);
  assert.match(p, /6:30 PM to 8:00 PM/);
  const msgs = asMessages([{ speaker: 'assistant', text: 'Hi' }, { speaker: 'staff', text: 'Hello' }]);
  assert.equal(msgs[0].role, 'user', 'the list starts with the pick-up');
});

test('the rules on their own: window edges, a yes with nothing read back, one correction only', () => {
  assert.ok(inWindow('18:30', WINDOW) && inWindow('20:00', WINDOW) && !inWindow('20:01', WINDOW));
  assert.equal(step(start(), 'staff_yes', {}, WINDOW).kind, 'end', 'staff_yes is not a REQUEST move');
  let s = step(start(), 'offered', { time: '19:00' }, WINDOW);
  assert.equal(s.kind, 'continue');
  s = step(s.state, 'corrected', {}, WINDOW);
  assert.equal(s.kind === 'continue' && s.state.step, 'REQUEST');
  s = step(step(s.state, 'offered', { time: '19:00' }, WINDOW).state, 'corrected', {}, WINDOW);
  assert.equal(s.kind === 'end' && s.ending, 'declined');
  assert.deepEqual(windowFor(FACTS, '20:00', '21:00'), { start: '19:30', end: '19:30' }, 'a window that leaves out the time chosen is not used');
  assert.deepEqual(windowFor(FACTS, null, null), { start: '19:30', end: '19:30' });
  assert.equal(readReply('```json\n{"say":"hi","move":"answer","heard":{}}\n```')?.move, 'answer');
});

test('the agent touches no money path', () => {
  for (const f of ['machine', 'prompt', 'session', 'settle-window']) {
    const src = readFileSync(`lib/reservations/agent/${f}.ts`, 'utf8');
    assert.doesNotMatch(src, /funding|stripe|payment-intent|contributions/i, f);
  }
});
