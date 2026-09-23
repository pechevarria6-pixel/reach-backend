import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answersFrom, wantedBlock, readGroupAnswers, optionsGate, notYetAnswered,
  isUndecided, UNDECIDED,
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
