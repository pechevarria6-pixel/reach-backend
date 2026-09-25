// ─── "Plan with who's answered" ──────────────────────────────────────────
// A group trip waits for everybody's answers, and one slow friend used to
// stall it for ever. The organiser may now go ahead with the answers that
// are in — once somebody besides them has answered, or the trip is 48 hours
// old — and nobody else may.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mayGoAhead, goAheadDecision, answeredCount, whoShapesIt, answersFrom, answersBlock,
  PLANNED_WITH_ANSWERED, GO_AHEAD_AFTER_MS,
} from '../../lib/group-answers.ts';
import { planReadiness } from '../../lib/plan-readiness.ts';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const org = { userId: 'u-org', answered: true };
const marco = { userId: 'u-marco', answered: false };
const sam = { userId: 'u-sam', answered: false };

test('the organiser can go ahead once one other member has answered', () => {
  const members = [org, { ...marco, answered: true }, sam];
  const allowed = mayGoAhead({ members, createdBy: 'u-org', createdAt: '2026-09-24T11:00:00Z', now: NOW });
  assert.equal(allowed, true);
  assert.deepEqual(goAheadDecision({ organiser: true, allowed }), { action: 'go' });
});

test('only the organiser having answered is not enough, until 48 hours have passed', () => {
  const members = [org, marco, sam];
  assert.equal(mayGoAhead({ members, createdBy: 'u-org', createdAt: '2026-09-24T11:00:00Z', now: NOW }), false);
  const twoDaysAgo = new Date(NOW - GO_AHEAD_AFTER_MS).toISOString();
  assert.equal(mayGoAhead({ members, createdBy: 'u-org', createdAt: twoDaysAgo, now: NOW }), true);
  const justUnder = new Date(NOW - GO_AHEAD_AFTER_MS + 60_000).toISOString();
  assert.equal(mayGoAhead({ members, createdBy: 'u-org', createdAt: justUnder, now: NOW }), false);
  // A missing time is not "long ago".
  assert.equal(mayGoAhead({ members, createdBy: 'u-org', createdAt: null, now: NOW }), false);
  const early = goAheadDecision({ organiser: true, allowed: false });
  assert.equal(early.action === 'refuse' && early.status, 409);
});

test('anybody but the organiser is refused with a 403, even when it would be allowed', () => {
  for (const allowed of [true, false]) {
    const d = goAheadDecision({ organiser: false, allowed });
    assert.equal(d.action, 'refuse');
    assert.equal(d.action === 'refuse' && d.status, 403);
  }
});

test('the route checks the organiser on the server before building anything', () => {
  const route = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  const gate = route.indexOf('if (withAnswered === true && !detailTripId)');
  assert.ok(gate > 0, 'the route reads withAnswered, for the ideas only');
  const decide = route.indexOf('goAheadDecision({', gate);
  const refuse = route.indexOf("if (go.action === 'refuse') return NextResponse.json({ error: go.error }, { status: go.status });", gate);
  const firstModelCall = route.indexOf('await withSchemaFallback(');
  assert.ok(decide > gate && refuse > decide, 'the decision is taken and a refusal returned');
  assert.ok(firstModelCall === -1 || refuse < firstModelCall, 'before any model call');
  assert.match(route.slice(gate, refuse), /isOrganiser\(|organiser,/);
});

// The row used to be written before the rate limit and the model call, so a
// go-ahead that got a 429 or a failed generation still marked the trip as
// gone ahead for good — and "Everyone's in" was then never sent, though
// nothing had been built without anybody.
test('the go-ahead is recorded only once the ideas are built, and undone when they are not kept', () => {
  const route = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  const insert = route.indexOf("action: PLANNED_WITH_ANSWERED");
  assert.ok(insert > 0, 'the go-ahead is recorded');
  assert.equal(route.indexOf("action: PLANNED_WITH_ANSWERED", insert + 1), -1, 'in one place');
  const rateLimit = route.indexOf('const rate = await allowance(');
  const lastModelCall = route.lastIndexOf('await withSchemaFallback(');
  const save = route.indexOf('saveIdeas(supabase, groupPlan.id, ideas, replacing)');
  assert.ok(rateLimit > 0 && lastModelCall > 0 && save > 0);
  assert.ok(insert > rateLimit, 'after the rate limit');
  assert.ok(insert > lastModelCall, 'after every model call');
  assert.ok(insert < save, 'before the ideas are saved');
  // The go-ahead branch itself writes nothing.
  const gate = route.indexOf('if (withAnswered === true');
  const gateEnd = route.indexOf('if (!gate.open) {\n        return NextResponse.json({', gate);
  assert.doesNotMatch(route.slice(gate, gateEnd), /from\('audit_logs'\)/);
  // Somebody else's ideas landed first: this go-ahead built nothing kept.
  const taken = route.indexOf("if (saved.outcome === 'taken')", save);
  assert.match(route.slice(taken, taken + 800), /from\('audit_logs'\)\.delete\(\)\.eq\('id', goAheadRow\)/);
});

test('party size comes from every member, whoever has answered', () => {
  const route = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  assert.match(route, /const groupSize = Math\.max\(everyone\.length \|\| 2,/);
  assert.match(route, /const notOnReach = Math\.max\(0, groupSize - \(everyone\.length/);
  const everyone = [{ id: 'u-org' }, { id: 'u-marco' }, { id: 'u-sam' }];
  const shaping = whoShapesIt(everyone, new Set(['u-org', 'u-marco']));
  assert.equal(shaping.length, 2);
  assert.equal(everyone.length, 3, 'the list party size is counted from is untouched');
  // Without a go-ahead, everybody shapes it, as before.
  assert.equal(whoShapesIt(everyone, null), everyone);
});

test('members who have not answered add no preferences to the prompt', () => {
  const everyone = [
    { id: 'u-org', cuisines: ['thai'], trip_summary: 'Ski week' },
    { id: 'u-sam', cuisines: ['bbq-only-sam'], trip_summary: 'Sam wants a casino' },
  ];
  const shaping = whoShapesIt(everyone, new Set(['u-org']));
  const cuisines = shaping.flatMap(p => p.cuisines);
  assert.deepEqual(cuisines, ['thai']);
  assert.ok(!shaping.some(p => p.trip_summary.includes('casino')));
  // Their trip answers are absent too: only submitted rows are read.
  const read = answersFrom([
    { user_id: 'u-org', submitted_at: '2026-09-24T10:00:00Z', summary_text: 'Ski week', answers: {}, users: { name: 'Peter' } },
    { user_id: 'u-sam', submitted_at: null, summary_text: 'a casino', answers: { tripType: ['city'] }, users: { name: 'Sam' } },
  ]);
  const block = answersBlock(read, { group: true });
  assert.doesNotMatch(block, /casino|city/);
  // Every taste line in the route reads the answered list, never everyone.
  const route = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  for (const field of ['cuisines', 'music_genres', 'activity_vibe', 'budget_range', 'trip_summary']) {
    assert.doesNotMatch(route, new RegExp(`everyone\\.(flatMap|map)\\(\\(p: any\\) => [^)]*${field}`), `${field} must come from prefs`);
  }
  assert.match(route, /readProfiles\(supabase, prefs\.map/);
});

test('"3 of 4 have answered."', () => {
  assert.equal(answeredCount([org, { ...marco, answered: true }, { ...sam, answered: true }, { userId: 'x', answered: false }]), '3 of 4 have answered.');
  assert.equal(answeredCount([org, marco]), '1 of 2 has answered.');
});

// A db that answers the readiness reads, and the go-ahead row if there is one.
function db(opts: { wentAhead: boolean }) {
  const members = [
    { user_id: 'u-org', users: { id: 'u-org', name: 'Peter' } },
    { user_id: 'u-marco', users: { id: 'u-marco', name: 'Marco' } },
    { user_id: 'u-sam', users: { id: 'u-sam', name: 'Sam' } },
  ];
  const prefs = [
    { user_id: 'u-org', submitted_at: '2026-09-24T10:00:00Z' },
    { user_id: 'u-marco', submitted_at: '2026-09-24T11:00:00Z' },
  ];
  return {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        limit: () => q,
        then: (res: (v: unknown) => unknown) => {
          if (table === 'group_members') return Promise.resolve({ data: members, error: null }).then(res);
          if (table === 'plan_preferences') return Promise.resolve({ data: prefs, error: null }).then(res);
          const hit = opts.wentAhead && filters.action === PLANNED_WITH_ANSWERED && filters.resource_id === 'plan-1';
          return Promise.resolve({ data: hit ? [{ id: 'a1' }] : [], error: null }).then(res);
        },
      };
      return q;
    },
  };
}

test('once the organiser went ahead, nobody is waited on — but answered stays strict', async () => {
  const before = await planReadiness(db({ wentAhead: false }) as never, 'plan-1', 'g', false);
  assert.equal(before.allReady, false);
  assert.deepEqual(before.waitingOn, ['Sam']);

  const after = await planReadiness(db({ wentAhead: true }) as never, 'plan-1', 'g', false);
  assert.equal(after.allReady, true, 'the vote and the days go ahead');
  assert.equal(after.wentAhead, true);
  assert.deepEqual(after.waitingOn, []);
  const sam = after.members.find(m => m.userId === 'u-sam')!;
  assert.equal(sam.answered, false, 'still not somebody whose wishes we have');
});

test('the wait screen offers the go-ahead to the organiser only, with the count', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /const mayGoAhead=iOrganise&&!allAnswered/);
  assert.match(app, /Plan with who's answered/);
  assert.match(app, /withAnswered:opts\.withAnswered===true/);
  assert.match(app, /\{iOrganise&&\(\s*<div[^>]*>\{haveAnswered\.length\} of \{members\.length\}/);
});
