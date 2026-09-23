import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answersFrom, wantedBlock, readGroupAnswers, optionsGate, notYetAnswered,
  isUndecided, UNDECIDED, answersBlock, standingWishesBlock, groupFraming,
  attributes, PRIVATE_ANSWERS_RULE,
} from '../../lib/group-answers.ts';
import { answersSentence, planReadiness } from '../../lib/plan-readiness.ts';

// ─── The reader: everybody's answers reach the prompt ────────────────────

const organiser = {
  user_id: 'u-org', submitted_at: '2026-09-22T10:00:00Z',
  summary_text: "Ski week for Kyle's fortieth",
  answers: { tripType: ['nature', 'custom:skiing'], pace: 'balanced', budget: '3500', noWayJose: ['camping'] },
  users: { name: 'Peter Echevarria' },
};
const marco = {
  user_id: 'u-marco', submitted_at: '2026-09-22T11:00:00Z',
  summary_text: null,
  answers: { goalBlurb: 'Somewhere I can actually rest', accommodation: ['hotel'], budget: '2000', noWayJose: ['longFlights', 'custom:hostels'] },
  users: [{ name: 'Marco Diaz' }],
};
const sam = {
  user_id: 'u-sam', submitted_at: '2026-09-22T12:00:00Z',
  summary_text: 'One big night out', answers: { mustDo: 'see the sunrise', noWay: 'nothing before 9am' },
  users: { name: 'Sam' },
};

test('every member who answered is in the prompt, by first name', () => {
  const read = answersFrom([organiser, marco, sam]);
  assert.equal(read.lines.length, 3);
  assert.match(read.lines[0], /^- Peter: /);
  assert.match(read.lines[1], /^- Marco: /);
  assert.match(read.lines[2], /^- Sam: /);
  assert.deepEqual(read.userIds, ['u-org', 'u-marco', 'u-sam']);
  // What they said, not only that they said something.
  assert.match(read.lines[0], /Ski week for Kyle's fortieth/);
  assert.match(read.lines[1], /Somewhere I can actually rest/);
  assert.match(read.lines[1], /would stay in: hotel/);
  assert.match(read.lines[2], /must do: see the sunrise/);
  // The block carries all of them.
  const block = wantedBlock(read.lines);
  for (const who of ['Peter', 'Marco', 'Sam']) assert.match(block, new RegExp(`- ${who}:`));
});

test("everybody's hard nos are collected as constraints, typed ones included", () => {
  const read = answersFrom([organiser, marco, sam]);
  assert.deepEqual(
    [...read.vetoes].sort(),
    ['camping', 'hostels', 'longFlights', 'nothing before 9am'].sort(),
  );
  // "custom:" is how the quiz stores a typed answer, never part of it.
  assert.ok(!read.vetoes.some(v => v.startsWith('custom:')));
});

test('answers in the shape the trip quiz now stores them are read for everyone', () => {
  // What GroupTripScreen (organiser) and PlanPreferencesScreen (everyone
  // else) both POST: the quiz's own fields, plus the resolved budget.
  const org = {
    user_id: 'u-org', submitted_at: '2026-09-23T09:00:00Z', summary_text: 'Dinner for Tim',
    answers: { goalBlurb: 'Dinner for Tim', nightKind: ['dinner'], nightFood: ['custom:thai'],
      nightEnergy: 'chill', budget: '120', budgetPerPerson: 80, noWayJose: ['clubs'] },
    users: { name: 'Peter' },
  };
  const member = {
    user_id: 'u-tim', submitted_at: '2026-09-23T10:00:00Z', summary_text: null,
    answers: { goalBlurb: '', nightKind: ['live music'], budgetPerPerson: 45, noWayJose: ['custom:loud rooms'] },
    users: { name: 'Tim' },
  };
  const read = answersFrom([org, member]);
  assert.deepEqual(read.userIds, ['u-org', 'u-tim']);
  assert.match(read.lines[0], /hungry for: thai/);
  assert.match(read.lines[1], /kind of night: live music/);
  // The typed figure wins over the ticked one, and the lowest is the budget.
  assert.match(read.lines[0], /budget: about \$80 each/);
  assert.equal(read.lowestBudget, 45);
  assert.deepEqual([...read.vetoes].sort(), ['clubs', 'loud rooms']);
});

test('an answer that was never submitted is not somebody having had their say', () => {
  const draft = { ...marco, user_id: 'u-draft', submitted_at: null, users: { name: 'Priya' } };
  const read = answersFrom([organiser, draft]);
  assert.equal(read.lines.length, 1);
  assert.deepEqual(read.userIds, ['u-org']);
  assert.ok(!read.vetoes.includes('hostels'));
});

test('the trip is priced for whoever has least to spend', () => {
  assert.equal(answersFrom([organiser, marco, sam]).lowestBudget, 2000);
  assert.equal(answersFrom([sam]).lowestBudget, null);
});

test('the organiser framing is kept server-side by id', () => {
  const read = answersFrom([organiser, marco]);
  assert.equal(read.byUser['u-org'].summary, "Ski week for Kyle's fortieth");
  assert.equal(read.byUser['u-marco'].summary, 'Somewhere I can actually rest');
});

test('nobody said anything usable means no block, not "no preference"', () => {
  assert.equal(wantedBlock([]), '');
  assert.equal(answersFrom([]).lines.length, 0);
  assert.equal(answersFrom(null).lines.length, 0);
});

test('a failed read says so rather than reading as nobody having answered', async () => {
  const failing = {
    from: () => ({ select: () => ({ eq: () => ({ not: async () => ({ data: null, error: { code: '42P01' } }) }) }) }),
  };
  const read = await readGroupAnswers(failing as never, 'plan-1');
  assert.equal(read.error, '42P01');
  assert.equal(read.lines.length, 0);

  const working = {
    from: () => ({ select: () => ({ eq: () => ({ not: async () => ({ data: [organiser, marco, sam], error: null }) }) }) }),
  };
  const ok = await readGroupAnswers(working as never, 'plan-1');
  assert.equal(ok.error, null);
  assert.equal(ok.lines.length, 3);
});

// ─── The gate: options wait for everybody ────────────────────────────────

test('the options wait until every member has answered', () => {
  const gate = optionsGate([
    { userId: 'u-org', name: 'Peter Echevarria', answered: true },
    { userId: 'u-marco', name: 'Marco Diaz', answered: false },
    { userId: 'u-sam', name: 'Sam', answered: false },
  ], false);
  assert.equal(gate.open, false);
  assert.deepEqual(gate.waitingOn, ['Marco', 'Sam']);
});

test('the gate opens when the last person answers', () => {
  const gate = optionsGate([
    { userId: 'u-org', name: 'Peter', answered: true },
    { userId: 'u-marco', name: 'Marco', answered: true },
  ], false);
  assert.equal(gate.open, true);
  assert.deepEqual(gate.waitingOn, []);
});

test('nobody having answered is closed, not the old grace', () => {
  const gate = optionsGate([
    { userId: 'a', name: 'Ana', answered: false },
    { userId: 'b', name: 'Ben', answered: false },
  ], false);
  assert.equal(gate.open, false);
  assert.deepEqual(gate.waitingOn, ['Ana', 'Ben']);
});

test('a group we could not read is closed, never open', () => {
  assert.equal(optionsGate([], false).open, false);
});

test('a solo trip waits for nobody', () => {
  assert.equal(optionsGate([{ userId: 'a', name: 'Ana', answered: false }], true).open, true);
});

test('the refusal names who it is waiting on, the same way at both stages', () => {
  assert.equal(
    notYetAnswered(['Marco'], 'Reach finds your trips once everyone has.'),
    "Marco hasn't said what they want from this trip yet. Reach finds your trips once everyone has.",
  );
  assert.equal(
    notYetAnswered(['Marco', 'Sam', 'Priya'], 'The plan gets written once everyone has.'),
    "Marco, Sam and Priya haven't said what they want from this trip yet. The plan gets written once everyone has.",
  );
});

test('a trip with nothing to vote on does not promise a vote', () => {
  const s = answersSentence(['Marco', 'Sam']);
  assert.equal(s, 'Waiting on Marco and Sam to say what they want from this trip.');
  assert.ok(!/vote/i.test(String(s)));
  assert.equal(answersSentence([]), null);
});

test('a trip waiting for its destination is known as one', () => {
  assert.equal(isUndecided({ destination_style: UNDECIDED }), true);
  assert.equal(isUndecided({ destStyle: UNDECIDED }), true);
  assert.equal(isUndecided({ destination_style: 'beach' }), false);
  assert.equal(isUndecided(null), false);
});

// ─── Readiness reports who has actually answered ─────────────────────────

function fakeDb(members: unknown[], prefs: unknown[]) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: async () => table === 'group_members'
          ? { data: members, error: null }
          : { data: prefs, error: null },
      }),
    }),
  };
}

test('readiness says who has answered, strictly, beside the lenient ready', async () => {
  const db = fakeDb(
    [
      { user_id: 'u-org', users: { id: 'u-org', name: 'Peter' } },
      { user_id: 'u-marco', users: { id: 'u-marco', name: 'Marco' } },
    ],
    [{ user_id: 'u-org', submitted_at: '2026-09-22T10:00:00Z' }],
  );
  const r = await planReadiness(db as never, 'plan-1', 'group-1', false);
  const byId = Object.fromEntries(r.members.map(m => [m.userId, m]));
  assert.equal(byId['u-org'].answered, true);
  assert.equal(byId['u-marco'].answered, false);
  assert.equal(r.allReady, false);
  assert.deepEqual(r.waitingOn, ['Marco']);
  assert.equal(optionsGate(r.members, false).open, false);
});

// ─── Answers are private within a group ──────────────────────────────────
// Everything the model writes for a group trip is shown to all of them, and
// each was told the others see that they answered, never what they said.

test("a group's prompt carries everybody's answers with nobody's name and nothing quoted", () => {
  const read = answersFrom([organiser, marco, sam]);
  const block = answersBlock(read, { group: true });
  // Every wish is still there to plan around…
  assert.match(block, /Ski week for Kyle's fortieth/);
  assert.match(block, /Somewhere I can actually rest/);
  assert.match(block, /must do: see the sunrise/);
  assert.match(block, /will not: longFlights, hostels/);
  // …but not whose it is, and not as a quotation to repeat.
  for (const name of ['Peter', 'Marco', 'Sam']) assert.doesNotMatch(block, new RegExp(`\\b${name}\\b`));
  assert.doesNotMatch(block, /"Ski week/);
  assert.equal((block.match(/^- One of them: /gm) || []).length, 3);
});

test("a group's prompt tells the model never to name who asked for what, or quote anyone", () => {
  const block = answersBlock(answersFrom([organiser, marco]), { group: true });
  assert.ok(block.includes(PRIVATE_ANSWERS_RULE));
  assert.match(PRIVATE_ANSWERS_RULE, /never name who asked for something/);
  assert.match(PRIVATE_ANSWERS_RULE, /never quote anyone/);
  assert.match(PRIVATE_ANSWERS_RULE, /used_suggestions/);
  // Asked for in general terms, with the example the owner gave.
  assert.match(PRIVATE_ANSWERS_RULE, /a beach within a short\s+flight/);
  // And the instruction that broke the promise is gone.
  assert.doesNotMatch(block, /by name/i);
});

test("one person travelling alone still has their own words to plan around", () => {
  const read = answersFrom([organiser]);
  const block = answersBlock(read, { group: false });
  assert.match(block, /- Peter: "Ski week for Kyle's fortieth"/);
  assert.ok(!block.includes(PRIVATE_ANSWERS_RULE));
});

test("standing wishes are unnamed for a group and never asked to be attributed", () => {
  const said = [{ name: 'Priya', text: 'Somewhere my sister can see snow' }, { name: 'Sam', text: '' }];
  const group = standingWishesBlock(said, { group: true });
  assert.doesNotMatch(group, /Priya|Sam/);
  assert.doesNotMatch(group, /naming the person/);
  assert.ok(group.includes(PRIVATE_ANSWERS_RULE));
  const solo = standingWishesBlock(said.slice(0, 1), { group: false });
  assert.match(solo, /Priya said: "Somewhere my sister can see snow"/);
  assert.equal(standingWishesBlock([{ name: 'Sam', text: ' ' }], { group: true }), '');
});

test('what comes back naming somebody, or repeating their words, is caught', () => {
  const who = {
    names: ['Sam', 'Marco', 'Peter'],
    said: ["I won't fly more than four hours on any plane"],
    title: "Ski week for Kyle's fortieth",
  };
  assert.equal(attributes("Sam won't fly more than 4 hours — this is a short hop", who), true);
  assert.equal(attributes('A quiet stay, which marco asked for', who), true);
  assert.equal(attributes("Nobody fly more than four hours on any plane here", who), true);
  assert.equal(attributes('A beach within a short flight', who), false);
  // "Samuel" is not "Sam", and a word inside another word is not a name.
  assert.equal(attributes('Samuel Beckett country', who), false);
  // The title is shown to everyone, so a name in it is not a secret.
  assert.equal(attributes("A ski town for Kyle's fortieth", { ...who, names: [...who.names, 'Kyle'] }), false);
});

test("a group trip leads with everybody's kinds of trip and stay, and the group's pace", () => {
  const read = answersFrom([
    { ...organiser, answers: { tripType: ['nature'], accommodation: ['rental'], pace: 'packed' } },
    { ...marco, answers: { tripType: ['beach', 'custom:spa'], accommodation: ['hotel'], pace: 'relaxed' } },
    { ...sam, answers: { tripType: ['nature'], pace: 'packed' } },
  ]);
  const f = groupFraming(read);
  assert.deepEqual(f.tripTypes.sort(), ['beach', 'nature', 'spa']);
  assert.deepEqual(f.accommodation.sort(), ['hotel', 'rental']);
  // The most common pace.
  assert.equal(f.pace, 'packed');
});

test("a tie on pace goes to the slower one", () => {
  const tie = answersFrom([
    { ...organiser, answers: { pace: 'packed' } },
    { ...marco, answers: { pace: 'balanced' } },
  ]);
  assert.equal(groupFraming(tie).pace, 'balanced');
  const three = answersFrom([
    { ...organiser, answers: { pace: 'packed' } },
    { ...marco, answers: { pace: 'relaxed' } },
    { ...sam, answers: { pace: 'balanced' } },
  ]);
  assert.equal(groupFraming(three).pace, 'relaxed');
  assert.equal(groupFraming(answersFrom([])).pace, null);
});

import { attributes as saysWho } from '../../lib/group-answers.ts';
test('a typed hard no, said back word for word, is caught', () => {
  const who = { names: ['Sam'], said: ['no flights over four hours please, I get sick'], title: 'Where next?' };
  assert.equal(saysWho('Keeps to no flights over four hours please, as asked', who), true);
});
test('"will" and "may" are words, not Will and May', () => {
  const who = { names: ['Will', 'May'], said: [], title: 'Where next?' };
  assert.equal(saysWho('We will hike the ridge in May weather', who), true);   // "May" capitalised reads as the name
  assert.equal(saysWho('We will hike the ridge and may swim', who), false);
  assert.equal(saysWho('Will wanted the beach', who), true);
});
