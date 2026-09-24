// ─── Quiz v3: the defects the review of 2026-09-24 confirmed ─────────────
// One test (or more) per confirmed finding, each written so it fails on the
// code as it was reviewed. Where the fault lives in the browser bundle and
// the logic cannot be lifted into lib/, the test reads the component source,
// the same way checkout-step.test.ts does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scoreQuiz, applyDialOverride, dialsSetBy, columnsFromAnswers, mixFromRows, mixSentence,
  publicProfile, generationHints, barLed, type QuizAnswers, type TravelerProfile,
} from '../../lib/traveler-profile.ts';
import { saveQuiz, refreshProfile } from '../../lib/quiz-store.ts';
import { dripAllowed, localKey, DRIP_IDS } from '../../lib/drip.ts';

const NOW = new Date('2026-09-24T12:00:00Z');
const app = readFileSync('components/reach-app.jsx', 'utf8');

/** The body of a function or arrow in the component source, by its opening text. */
function bodyOf(src: string, opening: string, span = 2500): string {
  const i = src.indexOf(opening);
  assert.ok(i >= 0, `could not find ${opening}`);
  return src.slice(i, i + span);
}

function fakeDb(row: Record<string, unknown> | null, opts: { missing?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  const missing = { code: '42703', message: 'column users.quiz_version does not exist' };
  return {
    writes,
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => (opts.missing && /quiz_|traveler_profile/.test(cols)
            ? { data: null, error: missing }
            : { data: row, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          if (opts.missing && Object.keys(patch).some(k => /quiz_|traveler_profile/.test(k))) {
            return { error: { code: 'PGRST204', message: "Could not find the 'quiz_answers' column" } };
          }
          writes.push(patch);
          return { error: null };
        },
      }),
    }),
  };
}

const FULL: QuizAnswers = { first_move: 'eat', interests: ['Markets & food halls'], plan: 'hourly', restaurant: 'new', late: 'next_spot' };
const withoutClock = (p: TravelerProfile) => ({ ...p, computed_at: '' });

// ─── 1. A nudge before the migration kept the result on screen ───────────

test('a nudge applied to a computed result is exactly what scoreQuiz does with the override', () => {
  const shown = scoreQuiz(FULL, NOW);
  const nudged = applyDialOverride(shown, 'energy', 20);
  assert.deepEqual(withoutClock(nudged), withoutClock(scoreQuiz({ ...FULL, dial_overrides: { energy: 20 } }, NOW)));
  assert.equal(nudged.primary, shown.primary, 'the headline stays');
  assert.equal(nudged.dials.pace, 100, 'the other dials stay');
  assert.deepEqual(nudged.unanswered, ['crowd']);
  assert.equal(applyDialOverride(shown, 'energy', 140).dials.energy, 100, 'clamped like scoreQuiz');
});

test('the reveal does not ask a server that keeps no answers to rescore a nudge', () => {
  const dial = bodyOf(app, 'const applyDial=(dial,raw)=>{', 1400);
  const local = dial.indexOf('if(!stored)');
  const post = dial.indexOf('postQuiz(');
  assert.ok(local > 0 && post > local, 'before the migration the nudge is applied locally, ahead of any POST');
  assert.match(dial, /applyDialOverride\(p,dial,v\)/);
});

test('before the migration the server really would have thrown the answers away (why the client must not ask)', async () => {
  const db = fakeDb({ favorite_activities: ['Markets & food halls'] }, { missing: true });
  const r = await saveQuiz(db as never, 'u1', { answers: { dial_overrides: { energy: 20 } } }, NOW);
  assert.equal(r.stored, false);
  assert.deepEqual(r.profile.unanswered.sort(), ['crowd', 'novelty', 'pace']);
});

// ─── 2. A nudge gives way to a newer answer ──────────────────────────────

test('answering a question again clears the nudge on the dial it sets', async () => {
  const db = fakeDb({
    favorite_activities: [], no_way_jose: [], quiz_version: 3, quiz_skipped_at: null, traveler_profile: null,
    quiz_answers: { ...FULL, dial_overrides: { pace: 80, energy: 10 } },
  });
  // "Change my answers" → Wing it.
  const r = await saveQuiz(db as never, 'u1', { answers: { ...FULL, plan: 'wing', late: undefined }, finish: true }, NOW);
  assert.equal(r.profile.dials.pace, 0, 'the new answer wins');
  assert.equal(r.profile.dials.energy, 10, 'a nudge on a dial that was not re-answered stands');
  const saved = db.writes[0].quiz_answers as QuizAnswers;
  assert.deepEqual(saved.dial_overrides, { energy: 10 });
});

test('an answer about something else keeps the nudge', async () => {
  const db = fakeDb({
    favorite_activities: [], no_way_jose: [], quiz_version: 3, quiz_skipped_at: null, traveler_profile: null,
    quiz_answers: { ...FULL, dial_overrides: { pace: 80 } },
  });
  const r = await saveQuiz(db as never, 'u1', { answers: { drinks: ['Wine'] } }, NOW);
  assert.equal(r.profile.dials.pace, 80);
});

test('dialsSetBy names the dial each question sets', () => {
  assert.deepEqual(dialsSetBy({ plan: 'wing' }), ['pace']);
  assert.deepEqual(dialsSetBy({ restaurant: 'new', late: 'asleep', night_out: 'six' }), ['novelty', 'energy', 'crowd']);
  assert.deepEqual(dialsSetBy({ free_afternoon: 'book' }), ['pace']);
  assert.deepEqual(dialsSetBy({ free_afternoon: 'outdoors', first_move: 'eat', interests: ['Outdoors'] }), []);
});

// ─── 3. "I eat everything" is about food ─────────────────────────────────

test('"Nothing — I eat everything" keeps the hard nos on the same screen', async () => {
  const db = fakeDb({ favorite_activities: [], no_way_jose: ['Clubs', 'Heights'], dietary_needs: 'Vegetarian' }, { missing: true });
  await saveQuiz(db as never, 'u1', { answers: { eat_everything: true, dietary: [], dislikes: ['Clubs', 'Heights'] }, finish: true }, NOW);
  assert.deepEqual(db.writes[0].no_way_jose, ['Clubs', 'Heights']);
  assert.equal(db.writes[0].dietary_needs, 'none');
  // And with nothing said about hard nos, the column is not touched at all.
  assert.ok(!('no_way_jose' in columnsFromAnswers({ eat_everything: true }, { no_way_jose: ['Clubs'] })));
});

test('the button sends the hard nos it is shown above', () => {
  const finish = bodyOf(app, 'if(final.eat_everything){', 400);
  assert.match(finish, /body\.dislikes=final\.dislikes\|\|\[\]/);
  assert.doesNotMatch(finish, /body\.dislikes=\[\];/);
  const eat = bodyOf(app, 'const eatEverything=()=>{', 300);
  assert.doesNotMatch(eat, /dislikes:\[\]/);
});

// ─── 4. v2 accounts are asked pace and late nights ───────────────────────

test('pace and late nights have drip questions, asked of anyone who has not answered them', () => {
  assert.ok(DRIP_IDS.includes('plan') && DRIP_IDS.includes('late'));
  const upgraded: QuizAnswers = { first_move: 'eat', restaurant: 'new', interests: ['Cooking'] };
  assert.equal(dripAllowed('plan', { answers: upgraded, screen: 'discover', now: NOW }), true);
  assert.equal(dripAllowed('late', { answers: upgraded, screen: 'discover', now: NOW }), true);
  assert.equal(dripAllowed('plan', { answers: { ...upgraded, plan: 'loose' }, screen: 'discover', now: NOW }), false);
  assert.equal(dripAllowed('late', { answers: { ...upgraded, skipped: ['late'] }, screen: 'discover', now: NOW }), false,
    'a screen skipped in the quiz is not asked again');
});

test('the app has cards for them, and Discover offers them', () => {
  const drips = bodyOf(app, 'const DRIPS={', 3500);
  assert.match(drips, /\bplan:\{title:"How much plan do you like\?",needsStore:true/);
  assert.match(drips, /\blate:\{title:"It's 11pm on the trip\. You're…",needsStore:true/);
  assert.match(app, /quiz\?\.version===3\?\["late","plan"\]:\[\]/);
});

// ─── 5. The mix counts only people who finished ──────────────────────────

test('a profile written by a drip or a ✕ is not a finished quiz', () => {
  const p = scoreQuiz({ interests: ['Books & talks'] }, NOW);
  const rows = [
    { users: { id: 'a', name: 'Ana', traveler_profile: p, quiz_version: null } },
    { users: { id: 'b', name: 'Ben', traveler_profile: p } },
  ];
  assert.equal(mixFromRows(rows), null);
  const done = rows.map(r => ({ users: { ...r.users, quiz_version: 3 } }));
  assert.equal(mixFromRows(done)!.members.length, 2);
  const route = readFileSync('app/api/groups/[id]/mix/route.ts', 'utf8');
  assert.match(route, /users\(id, name, traveler_profile, quiz_version\)/);
});

// ─── 6 / 10. "See {group}'s mix" only when there is one ──────────────────

test('the reveal offers the mix only once the route has returned one', () => {
  const reveal = bodyOf(app, 'function QuizReveal(', 12000);
  assert.match(reveal, /const crewMix=useGroupMix\(stored\?crew\?\.id:null\)/);
  assert.match(reveal, /\{crew&&crewMix&&\(/);
  assert.doesNotMatch(reveal, /\{crew&&\(/);
});

// ─── 7. A retake is a run of the quiz of its own ─────────────────────────

test('"Change my answers" starts the clock and says the quiz started', () => {
  const screen = bodyOf(app, 'function TravelerQuizScreen(', 9000);
  assert.match(screen, /const startRun=\(\)=>\{started\.current=Date\.now\(\);trackEvent\("quiz_started"\);\};/);
  assert.match(screen, /onRetake=\{\(\)=>\{[^}]*startRun\(\);\}\}/);
});

// ─── 8. "About a minute" on screen one, however the quiz was opened ──────

test('screen one says "About a minute" when the header slot is ✕ Close', () => {
  const screen = bodyOf(app, 'function TravelerQuizScreen(', 14000);
  assert.match(screen, /\{\(step>0\|\|!required\)&&<div[^>]*>About a minute<\/div>\}/);
});

// ─── 9. A night out is told about an evening ─────────────────────────────

test('evening hints never speak of days, afternoons or the last night', () => {
  const pp = (a: QuizAnswers) => publicProfile(scoreQuiz(a, NOW))!;
  const groups = [
    [pp({ plan: 'hourly' })],
    [pp({ plan: 'wing' })],
    [pp({ plan: 'hourly', late: 'asleep' }), pp({ plan: 'wing', late: 'sunrise' })],
    [pp({ first_move: 'eat' }), pp({ first_move: 'eat' }), pp({ first_move: 'slow' })],
  ];
  for (const g of groups) {
    const trip = generationHints(g).join(' ');
    const evening = generationHints(g, { evening: true });
    assert.equal(evening.length, generationHints(g).length, 'the same facts, in evening words');
    assert.doesNotMatch(evening.join(' '), /\b(day|days|afternoon|last night|morning to night)\b/i, trip);
  }
  const route = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  const night = route.slice(route.indexOf('Generate exactly 3 options for ONE NIGHT OUT'));
  // Up to where the trip prompt's own fields begin.
  const nightPrompt = night.slice(0, night.indexOf('WHAT THIS TRIP IS FOR'));
  assert.match(nightPrompt, /\$\{eveningTravelBlock\}/);
  assert.doesNotMatch(nightPrompt, /\$\{travelBlock\}/);
});

// ─── 11. "Not drinking" leaves bars out, from every source ───────────────

test('barLed knows a bar by what it calls itself, and a sushi bar is dinner', () => {
  for (const title of ['Trivia at The Crown Pub', 'Live jazz at the Blue Note Bar', 'Hoppy Brewery tap takeover', 'Rooftop cocktails', 'Friday at Club Nine Nightclub']) {
    assert.equal(barLed({ title, category: 'Events' }), true, title);
  }
  assert.equal(barLed({ title: 'Anything', category: 'Bar' }), true);
  for (const title of ['Omakase at the sushi bar', 'Barcelona tapas night', 'Salad bar lunch', 'Pottery class']) {
    assert.equal(barLed({ title, category: 'Food' }), false, title);
  }
});

test('Discover drops bar-led findings for somebody not drinking, after merging every source', () => {
  const nearby = readFileSync('app/api/nearby/route.ts', 'utf8');
  assert.match(nearby, /rank\(sober \? merged\.filter\(f => !barLed\(f\)\) : merged/);
  assert.doesNotMatch(app, /nothing built around a bar/);
});

// ─── 12. Half is not a common thread ─────────────────────────────────────

test('one Taster in a pair does not make the group food-led', () => {
  const pair = [publicProfile(scoreQuiz({ first_move: 'eat' }, NOW))!, publicProfile(scoreQuiz({ interests: ['Outdoors', 'Sport'] }, NOW))!];
  assert.equal(pair[1].primary, 'thrill');
  assert.equal(mixSentence(pair), null);
  assert.ok(!generationHints(pair).some(h => /Food matters most/.test(h)));
  const both = [pair[0], publicProfile(scoreQuiz({ first_move: 'eat' }, NOW))!];
  assert.match(mixSentence(both)!, /travels by stomach/);
});

// ─── 13. No promise of places we may not hold ────────────────────────────

test('neither the Home card nor the share page promises real places near the reader', () => {
  const share = readFileSync('app/quiz/[code]/page.tsx', 'utf8');
  for (const src of [app, share]) assert.doesNotMatch(src, /Then real places near you/i);
  assert.match(readFileSync('scripts/check-vocabulary.mjs', 'utf8'), /'then real places near you'/);
});

// ─── 15. A v2 answer is an answer ────────────────────────────────────────

test('a v2 account is not asked its drink or its seat again', () => {
  const ctx = { answers: {}, screen: 'discover', now: NOW };
  assert.equal(dripAllowed('drinks', { ...ctx, v2: { drink_style: 'Wine' } }), false);
  assert.equal(dripAllowed('seating', { ...ctx, v2: { dining_vibe: 'Somewhere buzzy' } }), false);
  assert.equal(dripAllowed('drinks', { ...ctx, v2: { drink_style: null } }), true);
  const hook = bodyOf(app, 'function useDripChoice(', 1500);
  assert.match(hook, /v2:v2FromUser\(user\)/);
});

// ─── 16. Profile's full list rescores the result ─────────────────────────

test('editing interests outside the quiz rescores a stored result', async () => {
  const spark = scoreQuiz({ interests: ['Live music', 'Comedy'] }, NOW);
  const db = fakeDb({
    favorite_activities: ['Cooking', 'Markets & food halls', 'Wine tasting'], no_way_jose: [],
    quiz_version: 3, quiz_skipped_at: null, traveler_profile: spark,
    quiz_answers: { interests: ['Live music', 'Comedy'] },
  });
  assert.equal(await refreshProfile(db as never, 'u1', NOW), true);
  assert.equal((db.writes[0].traveler_profile as TravelerProfile).primary, 'taster');
  assert.deepEqual(Object.keys(db.writes[0]).sort(), ['quiz_answers', 'traveler_profile'], 'the v2 columns it read are not rewritten');
});

test('editing a list does not make a profile for somebody who has none, or before the migration', async () => {
  const none = fakeDb({ favorite_activities: ['Cooking'], quiz_version: null, quiz_answers: null, traveler_profile: null, quiz_skipped_at: null });
  assert.equal(await refreshProfile(none as never, 'u1', NOW), false);
  assert.equal(none.writes.length, 0);
  const early = fakeDb({ favorite_activities: ['Cooking'] }, { missing: true });
  assert.equal(await refreshProfile(early as never, 'u1', NOW), false);
  assert.equal(early.writes.length, 0);
  const route = readFileSync('app/api/user/data/route.ts', 'utf8');
  assert.match(route, /await refreshProfile\(supabase, ctx\.user\.id\)/);
});

// ─── 17. What a browser remembers belongs to one account ─────────────────

test('browser storage for the quiz is keyed by account', () => {
  assert.equal(localKey('reach_traveler_profile', 'u_1'), 'reach_traveler_profile:u_1');
  assert.equal(localKey('reach_traveler_profile', null), null);
  assert.equal(localKey('reach_traveler_profile', ' '), null);
  for (const k of ['LOCAL_PROFILE', 'DRIP_DISMISSED', 'DRIP_ANSWERED']) {
    assert.doesNotMatch(app, new RegExp(`(read|write)Local\\(${k}\\b`), `${k} is read or written without an account`);
  }
  assert.doesNotMatch(app, /sessionStorage\.(get|set)Item\(DRIP_SESSION\b/);
});
