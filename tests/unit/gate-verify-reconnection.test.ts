// Run with: npm run test:unit
// Business-model M3: "When did you last see this group in person?" — one
// screen, one tap, skippable, once per person per group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RECONNECTION_ANSWERS, RECONNECTION_SKIPPED, parseReconnection } from '../../components/pilot/rules.ts';
import { scrubProps, EVENT_NAMES } from '../../lib/track.ts';

const ROUTE = readFileSync('app/api/groups/[id]/reconnection/route.ts', 'utf8');
const SCREEN = readFileSync('components/pilot/ReconnectionQuestion.jsx', 'utf8');

test('the fixed set of answers, as the readout names them', () => {
  assert.deepEqual(RECONNECTION_ANSWERS.map(a => a.id),
    ['this_month', '1_3_months', '3_6_months', '6_12_months', 'over_a_year', 'never']);
  for (const a of RECONNECTION_ANSWERS) {
    const p = parseReconnection({ answer: a.id });
    assert.ok(p.ok && p.value === a.id);
  }
});

test('a skip is recorded as such; anything else is refused', () => {
  const s = parseReconnection({ answer: RECONNECTION_SKIPPED });
  assert.ok(s.ok && s.value === 'skipped');
  for (const bad of [{}, null, { answer: 'last week' }, { answer: 3 }, { answer: 'THIS_MONTH' }]) {
    assert.equal(parseReconnection(bad).ok, false, JSON.stringify(bad));
  }
});

test('every answer survives the tracker, and the event name is a known one', () => {
  assert.ok((EVENT_NAMES as readonly string[]).includes('reconnection_answered'));
  for (const a of [...RECONNECTION_ANSWERS.map(x => x.id), RECONNECTION_SKIPPED]) {
    assert.deepEqual(scrubProps({ answer: a, role: 'member' }), { answer: a, role: 'member' });
  }
});

test('the route checks membership and reads an earlier answer before recording one', () => {
  assert.match(ROUTE, /requireGroupMember\(params\.id\)/);
  const post = ROUTE.slice(ROUTE.indexOf('export async function POST'));
  const read = post.indexOf('await earlier(ctx)');
  const write = post.indexOf('await track(');
  assert.ok(read > 0 && write > read);
  assert.match(post, /prior\.answer !== null\) return NextResponse\.json\(\{ answer: prior\.answer, already: true \}\)/);
  // Validated before anything is read or written.
  assert.ok(post.indexOf('parseReconnection(') < read);
});

test('the screen is skippable, never shown to a group of one, and never traps anybody', () => {
  assert.match(SCREEN, /answer\(RECONNECTION_SKIPPED\)/);
  assert.match(SCREEN, />\s*Skip\s*</);
  assert.match(SCREEN, /if \(solo \|\| !groupId[^\n]*\{ finish\(\); return; \}/);
  // A failed save still gets out of the way.
  const answer = SCREEN.slice(SCREEN.indexOf('const answer = async'), SCREEN.indexOf('useEffect(() => {\n    if (!ask) return;'));
  assert.match(answer, /\}\s*finish\(\);\s*\};/);
  // The only early way out is a tap already in flight — a failure never returns before finish().
  assert.equal([...answer.matchAll(/\breturn\b/g)].length, 1, 'no return between the save and finish()');
  // Tap targets: every option at least 44px.
  for (const m of SCREEN.matchAll(/minHeight: (\d+)/g)) assert.ok(Number(m[1]) >= 44);
  assert.match(SCREEN, /When did you last see this group in person\?/);
});
