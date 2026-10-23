// Run with: npm run test:unit
//
// The plan screen's half of Stage 4 (the checkout spec's Tasks 6 and 7):
// the away lines come from the server, not from the client's own guess at
// them, and every line gets one "Change" whose sheet is the only place a
// hotel's or a flight's options live. reach-app.jsx is one JSX file with no
// test harness of its own, so — as elsewhere in this suite — what it must
// keep doing is held by its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { awayEstimate, awayLines, rowOf } from '../../lib/away-lines.ts';

const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
const between = (from: string, to: string) => {
  const a = app.indexOf(from);
  const b = app.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `${from} … ${to}`);
  return app.slice(a, b);
};

test('the days open with the server\'s away lines; the client no longer builds its own', () => {
  assert.doesNotMatch(app, /function fixedCostRows|fixedCostRows\(/, 'the cents>0 builder that dropped an unpriced flight is gone');
  const rows = between('function awayRows(', '\n}\n');
  assert.match(rows, /if\(Array\.isArray\(fixed\)\)return fixed;/, 'the server\'s fixed rows win whenever they came back');
  assert.match(rows, /awayLines\(est,/);
  assert.match(rows, /\.map\(rowOf\)/);
  // Both days-stage calls pass the server's `fixed` through.
  assert.equal((app.match(/awayRows\(trip,\{fixed:(d|data)\.fixed,/g) ?? []).length, 2);
});

test('a rebuild puts back only the away lines the plan lost', () => {
  const build = between('const fresh=itineraryRows(d.itinerary,oneEvening);', ':afterRebuild(plan.itinerary,fresh);');
  assert.match(build, /afterAwayRebuild\(plan\.itinerary,fresh,d\.restore\|\|null,/);
});

test('the days stage is told the tier and the estimate, so its lines carry them', () => {
  const data = between('function tripDataFor(', '\n}\n');
  for (const k of ['tier:', 'total_per_person:', 'away:', 'city:', 'country_code:']) assert.ok(data.includes(k), k);
});

test('the client fallback keeps an unpriced flight as a line, as the server does', () => {
  const est = awayEstimate({ destination: 'Lisbon', tier: 'on_budget', total_per_person: 900, costs: { accommodation: { per_person: 600 } } }, { nights: 5 });
  const rows = awayLines(est, { town: 'Lisbon', start: '2026-11-02', end: '2026-11-07', party: 2, solo: false }).map(rowOf);
  const flight = rows.find(r => r.type === 'flight');
  assert.ok(flight, 'no price is not no flight');
  assert.equal(flight!.cost_cents, null);
  assert.match(flight!.sub, /Not estimated yet/);
  assert.ok(rows.every(r => r.estimate === true));
});

test('the option card shows the away lines, labelled estimates, and says what is unpriced', () => {
  const card = between('function AwayLinesCard(', '\n}\n');
  assert.match(card, /away\.lodging/);
  assert.match(card, /away\.car/);
  assert.match(card, /t\.kind==="ground"/);
  assert.match(card, /No estimate yet for/);
  assert.match(card, /"Not estimated"/);
  // Only the flight and the stay are priced live; the road and the car never are.
  const live = between('function livePriced(', '\n}\n');
  assert.match(live, /away\?\.transport\?\.kind!=="ground"/);
  assert.doesNotMatch(live, /car/);
  const idea = between('function TripIdeaCard(', '\n// ─── ');
  assert.match(idea, /away\.per_person_if_driving/);
  assert.match(idea, /per person, est\./);
});

test('suggestions are never offered on a trip for one', () => {
  const sheet = between('function ChangeSheet(', '\nfunction ItemActions(');
  assert.match(sheet, /const maySuggest=!solo&&/);
  // And the plan screen does not ask for them on one.
  assert.match(app, /const loadSuggestions=async\(\)=>\{\n\s*if\(!planId\|\|isTempId\(planId\)\|\|\(group\?\.memberIds\|\|\[\]\)\.length<=1\)return;/);
});

test('after Lock it in, Change is the organiser\'s, and a priced swap asks first', () => {
  assert.match(app, /&&\(soloTrip\|\|!lockedNow\|\|organiserHere\)/);
  assert.match(app, /confirmFirst=\{locked\}/);
  const panel = between('function ChoicePanel(', '\nfunction ');
  assert.match(panel, /confirmFirst\?setAsking\(o\.key\):choose\(o\.key\)/);
  assert.match(panel, /— ok\?/);
});

test('ChoicePanel lives inside Change, not beside the line', () => {
  const uses = app.match(/<ChoicePanel /g) ?? [];
  // The Change sheet, and checkout's recovery when a provider refused one.
  assert.equal(uses.length, 2);
  assert.doesNotMatch(app, /See the hotel · change it|See the flights · change them|openChoice/);
});

test('the copy uses the words the owner chose', () => {
  const sheet = between('// ─── Change: one line of the plan', '\nfunction ItemActions(');
  assert.doesNotMatch(sheet, /re-propose|re-quote|fulfil|transfer|payout/i);
  assert.match(app, /"Skip this one"/, 'sitting a line out keeps its own words');
  assert.match(app, /"I'll drive \/ already have a flight"/);
});
