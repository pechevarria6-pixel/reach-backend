// ─── Who a group trip waits on, and whose say counts ────────────────────
// Each test here failed on the code it was written against. They are about
// the people a group trip counts: the members it waits on, the answers it is
// built from, the votes that decide it — and that each of those is the
// group as it is now, not as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planReadiness } from '../../lib/plan-readiness.ts';
import { readGroupAnswers } from '../../lib/group-answers.ts';
import { getNextAction, type NextActionInput } from '../../lib/next-action.ts';
import { detailTally } from '../../lib/trip-vote.ts';

type Row = Record<string, unknown>;

/**
 * A db that answers group_members, plan_preferences and audit_logs, filtering
 * plan_preferences rows by the filters the code applies, so a read that does
 * not narrow to the group gets every row the table holds.
 */
function db(tables: { members: Row[]; prefs: Row[]; audit?: Row[] }) {
  return {
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      const nots: string[] = [];
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { eqs.push([k, v]); return q; },
        in: (k: string, v: unknown[]) => { ins.push([k, v]); return q; },
        not: (k: string) => { nots.push(k); return q; },
        limit: () => q,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          let rows: Row[] = table === 'group_members' ? tables.members
            : table === 'plan_preferences' ? tables.prefs
              : table === 'audit_logs' ? (tables.audit ?? []) : [];
          rows = rows.filter(r => eqs.every(([k, v]) => !(k in r) || r[k] === v)
            && ins.every(([k, v]) => v.includes(r[k])));
          if (nots.includes('submitted_at')) rows = rows.filter(r => r.submitted_at);
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return q;
    },
  } as never;
}

const PLAN = 'plan-1';
const member = (id: string, name: string) => ({ group_id: 'g', user_id: id, users: { id, name } });
const said = (id: string, name: string, answers: Row = {}) => ({
  plan_id: PLAN, user_id: id, submitted_at: '2026-11-01T10:00:00Z', summary_text: null, answers, users: { name },
});

// Jo answered for the trip and then left the group. Her answer kept the
// trip "asked" for nobody still in it, and her budget and her hard no went
// into a prompt for people she is no longer travelling with — the vote has
// always counted only people still in the group (tallyVotes); the answers
// did not.
test('somebody who left the group no longer shapes the trip', async () => {
  const d = db({
    members: [member('u-org', 'Peter'), member('u-sam', 'Sam')],
    prefs: [
      said('u-org', 'Peter', { budgetPerPerson: 900, tripType: ['beach'] }),
      said('u-jo', 'Jo', { budgetPerPerson: 200, noWayJose: ['camping'], tripType: ['city'] }),
    ],
  });
  const read = await readGroupAnswers(d, PLAN, 'g');
  assert.equal(read.error, null);
  assert.deepEqual(read.userIds, ['u-org'], 'only people still in the group');
  assert.equal(read.lowestBudget, 900, "a departed member's budget does not cap the trip");
  assert.deepEqual(read.vetoes, []);
  assert.equal(read.privateLines.length, 1);
});

test("a departed member's answer does not make the trip count as asked", async () => {
  // A decided trip from before answers were asked, which Jo answered for and
  // then left: the grace for old trips still holds for the people in it.
  const d = db({
    members: [member('u-org', 'Peter'), member('u-sam', 'Sam')],
    prefs: [said('u-jo', 'Jo')],
  });
  const r = await planReadiness(d, PLAN, 'g', false);
  assert.equal(r.allReady, true);
  assert.deepEqual(r.waitingOn, []);
});

// The generator reads the answers through the group, at both stages.
test('the generator reads answers for the group it is building for', () => {
  const route = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  const calls = [...route.matchAll(/readGroupAnswers\([^\n]*/g)].map(m => m[0]);
  assert.ok(calls.length >= 2);
  for (const call of calls) assert.match(call, /readGroupAnswers\([^,]+,[^,]+,\s*String\(groupId\)\)/, `${call} names the group`);
});

// A group trip still waiting on its destination whose organiser's answers
// failed to save at creation: nobody had answered, so readiness counted
// everybody ready and said nothing, next-action offered "Find the trips",
// and the server refused it — while nobody was ever asked to answer.
test('a trip waiting on its destination has no "nobody asked yet" grace', async () => {
  const d = db({ members: [member('u-org', 'Peter'), member('u-sam', 'Sam')], prefs: [] });
  const r = await planReadiness(d, PLAN, 'g', false, { undecided: true });
  assert.equal(r.allReady, false);
  assert.deepEqual(r.waitingOn, ['Peter', 'Sam']);
  assert.ok(r.members.every(m => !m.ready));
  const route = readFileSync('app/api/plans/[planId]/readiness/route.ts', 'utf8');
  assert.match(route, /planReadiness\([\s\S]{0,300}undecided: isUndecided\(/);
  const vote = readFileSync('app/api/plans/[planId]/vote/route.ts', 'utf8');
  assert.match(vote, /planReadiness\([\s\S]{0,300}undecided: isUndecided\(/);
});

// The plan's flag is written once; a group can shrink to one. Nobody on
// their own waits on anybody, themselves included.
test('one person in the group never waits, whatever the plan was saved as', async () => {
  const d = db({ members: [member('u-org', 'Peter')], prefs: [] });
  const r = await planReadiness(d, PLAN, 'g', false, { undecided: true });
  assert.equal(r.solo, true);
  assert.equal(r.allReady, true);
  assert.deepEqual(r.waitingOn, []);
  // An empty read is still not "everyone is ready" for a group plan.
  const none = await planReadiness(db({ members: [], prefs: [] }), PLAN, 'g', false);
  assert.equal(none.allReady, false);
});

// The vote route refuses every vote while anybody has not answered (a late
// joiner, or an ordinary vote opened at creation). Next-action still told
// whoever had answered "Pick the one you want — Vote →", straight into a 403.
test('the vote is not offered while the server is still waiting on answers', () => {
  const ME = 'u-me', SAM = 'u-sam';
  const input: NextActionInput = {
    plan: { id: 'p1', groupId: 'g1', status: 'voting', type: 'trip', title: 'Where next?', destStyle: 'undecided',
      hasOptions: true, createdBy: ME, itinerary: [] },
    bookings: [], funding: null, essentials: null, memberCount: 2, me: ME,
    readiness: {
      members: [
        { userId: ME, name: 'Pat Me', ready: true, answered: true },
        { userId: SAM, name: 'Sam Lee', ready: false, answered: false },
      ],
      waitingOn: ['Sam'], solo: false,
    },
    vote: { myVote: null, everyoneVoted: false, stillToVote: ['you', 'Sam'], mayPick: true, decided: false,
      organiser: { name: 'Pat', isYou: true } } as never,
    now: new Date('2026-11-05T15:00:00Z'),
  };
  const a = getNextAction(input)!;
  assert.equal(a.state, 'waiting_on_others');
  assert.deepEqual(a.waitingOn, ['Sam']);
  assert.match(a.title, /Sam/);
  assert.equal(a.cta && a.cta.kind === 'nudge' ? a.cta.nudge : null, 'prefs');
});

// GET /api/plans/[id] counted every row in votes: somebody who had left, and
// a vote on an option no longer on the list. A two-person group with one
// leaver's vote read "Everyone's voted — The group picked Lisbon, 2 of 2"
// while the one person left had not voted.
test("the plan's own tally counts only current members' votes on options on the list", () => {
  const t = detailTally({
    plan: { vote_options: ['Lisbon', 'Porto'] },
    votes: [
      { user_id: 'u-jo', option: 'Lisbon' },
      { user_id: 'u-sam', option: 'Madrid' },
      { user_id: 'u-me', option: 'Porto' },
    ],
    memberIds: ['u-me', 'u-sam'],
    me: 'u-me',
  });
  assert.deepEqual(t.votes, { Lisbon: 0, Porto: 1 });
  assert.equal(t.totalVotes, 1);
  assert.equal(t.myVote, 'Porto');
  const route = readFileSync('app/api/plans/[planId]/route.ts', 'utf8');
  assert.match(route, /(planTally|detailTally)\(/);
});
