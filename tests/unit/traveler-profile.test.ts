import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreQuiz, FIRST_MOVE, PLAN, RESTAURANT, LATE, NIGHT_OUT, FREE_AFTERNOON, ARCHETYPES, DIALS,
  INTEREST_ARCHETYPE, Q2_TILES, UPFRONT_SCREENS, answersFromV2, columnsFromAnswers, hasV2Answers,
  mixFromRows, mixSentence, publicProfile, generationHints, revealCards, profileBoost,
  shareCode, fromShareCode, headline, dialLabel, onlyNotDrinking,
  type QuizAnswers,
} from '../../lib/traveler-profile.ts';
import { QuizAnswers as QuizAnswersSchema, parseQuizSave, quizFromRow, quizFromMe, withinQuietPeriod } from '../../lib/contracts/traveler-profile.ts';
import { rank } from '../../lib/discovery/rank.ts';
import { saveQuiz, quizColumnsMissing } from '../../lib/quiz-store.ts';
import type { Finding } from '../../lib/discovery/types.ts';
import { dripAllowed, pickDrip, dripAnswered } from '../../lib/drip.ts';

const NOW = new Date('2026-09-24T12:00:00Z');

// ─── Scoring: every option ───────────────────────────────────────────────

test('the upfront quiz is exactly six screens', () => {
  assert.equal(UPFRONT_SCREENS.length, 6);
});

test('every first move scores what the spec says', () => {
  const want: Record<string, [string, number]> = {
    eat: ['taster', 3], wander: ['scout', 3], famous: ['storyteller', 2], slow: ['recharger', 3], group: ['spark', 3],
  };
  for (const k of Object.keys(FIRST_MOVE)) {
    const p = scoreQuiz({ first_move: k as never }, NOW);
    const [who, pts] = want[k];
    assert.equal(p.scores[who as never], pts, k);
    assert.equal(p.primary, who, k);
    // Q1 sets no dial.
    assert.deepEqual(p.unanswered, [...DIALS], k);
  }
});

test('every plan answer sets pace; only "wing it" adds anything else', () => {
  const pace: Record<string, number> = { wing: 0, loose: 25, daily: 50, full: 75, hourly: 100 };
  for (const k of Object.keys(PLAN)) {
    const p = scoreQuiz({ plan: k as never }, NOW);
    assert.equal(p.dials.pace, pace[k], k);
    assert.ok(!p.unanswered.includes('pace'), k);
    const total = Object.values(p.scores).reduce((s, n) => s + n, 0);
    assert.equal(total, k === 'wing' ? 1 : 0, `${k}: planning is not a type`);
  }
  assert.equal(scoreQuiz({ plan: 'wing' }, NOW).scores.scout, 1);
});

test('every restaurant answer sets novelty and its scout/taster points', () => {
  const want: Record<string, { n: number; scout: number; taster: number }> = {
    famous: { n: 15, scout: 0, taster: 0 }, locals: { n: 50, scout: 0, taster: 0 },
    new: { n: 80, scout: 2, taster: 0 }, truck: { n: 95, scout: 2, taster: 1 },
  };
  for (const k of Object.keys(RESTAURANT)) {
    const p = scoreQuiz({ restaurant: k as never }, NOW);
    assert.equal(p.dials.novelty, want[k].n, k);
    assert.equal(p.scores.scout, want[k].scout, k);
    assert.equal(p.scores.taster, want[k].taster, k);
  }
});

test('every 11pm answer sets energy and its points', () => {
  const want: Record<string, { e: number; recharger: number; spark: number; thrill: number }> = {
    asleep: { e: 15, recharger: 1, spark: 0, thrill: 0 }, one_more: { e: 45, recharger: 0, spark: 0, thrill: 0 },
    next_spot: { e: 75, recharger: 0, spark: 2, thrill: 0 }, sunrise: { e: 95, recharger: 0, spark: 2, thrill: 1 },
  };
  for (const k of Object.keys(LATE)) {
    const p = scoreQuiz({ late: k as never }, NOW);
    assert.equal(p.dials.energy, want[k].e, k);
    assert.equal(p.scores.recharger, want[k].recharger, k);
    assert.equal(p.scores.spark, want[k].spark, k);
    assert.equal(p.scores.thrill, want[k].thrill, k);
  }
});

test('every interest counts one point to its archetype; the twelve tiles cover all six', () => {
  for (const [label, who] of Object.entries(INTEREST_ARCHETYPE)) {
    assert.equal(scoreQuiz({ interests: [label] }, NOW).scores[who], 1, label);
  }
  const covered = new Set(Q2_TILES.map(t => INTEREST_ARCHETYPE[t]));
  for (const a of ARCHETYPES) assert.ok(covered.has(a), `${a} reachable from the Q2 screen`);
  assert.ok(Q2_TILES.length <= 12, 'capped at twelve tiles on one screen');
});

test('the crowd drip sets crowd 20/50/80/95', () => {
  const want: Record<string, number> = { six: 20, buzzy: 50, live: 80, stadium: 95 };
  for (const k of Object.keys(NIGHT_OUT)) assert.equal(scoreQuiz({ night_out: k as never }, NOW).dials.crowd, want[k], k);
});

test('free afternoon fine-tunes pace, and outdoors is +3 thrill', () => {
  assert.equal(scoreQuiz({ free_afternoon: 'outdoors' }, NOW).scores.thrill, 3);
  assert.equal(scoreQuiz({ plan: 'daily', free_afternoon: 'wander' }, NOW).dials.pace, 35);
  assert.equal(scoreQuiz({ plan: 'hourly', free_afternoon: 'book' }, NOW).dials.pace, 100, 'clamped');
  assert.ok(Object.keys(FREE_AFTERNOON).length >= 2);
});

// ─── Ties, secondary, all-skipped, only Q2 ───────────────────────────────

test('all skipped: a profile with every dial at 50, unanswered, and no primary', () => {
  const p = scoreQuiz({ skipped: [...UPFRONT_SCREENS] }, NOW);
  assert.equal(p.primary, null);
  assert.equal(p.secondary, null);
  assert.deepEqual(p.dials, { pace: 50, novelty: 50, energy: 50, crowd: 50 });
  assert.deepEqual(p.unanswered, ['pace', 'novelty', 'energy', 'crowd']);
  assert.equal(p.version, 3);
  assert.equal(headline(p), "You're a bit of everything");
  assert.deepEqual(scoreQuiz(null, NOW), scoreQuiz({}, NOW));
});

test('only Q2 answered: a primary from interests alone, dials all unanswered', () => {
  const p = scoreQuiz({ interests: ['Outdoors', 'Sport', 'Wellness'] }, NOW);
  assert.equal(p.primary, 'thrill');
  // recharger has 1 of thrill's 2: 50%, under the 60% line.
  assert.equal(p.secondary, null);
  assert.equal(p.unanswered.length, 4);
});

test('a tie on primary goes to the archetype with more matching interests', () => {
  // Q1 eat = taster 3; three storyteller interests = storyteller 3.
  const tie = scoreQuiz({ first_move: 'eat', interests: ['Art & galleries', 'Museums & history', 'Film & theatre'] }, NOW);
  assert.equal(tie.scores.taster, 3);
  assert.equal(tie.scores.storyteller, 3);
  assert.equal(tie.primary, 'storyteller', 'three matching interests beat none');
  assert.equal(tie.secondary, 'taster');
});

test('once the camera roll is answered it breaks the tie instead', () => {
  // storyteller 2 (famous) and scout 2 (the camera roll's own +2): tied, and
  // neither has an interest behind it — the camera roll decides.
  const p = scoreQuiz({ first_move: 'famous', camera_roll: 'scout' }, NOW);
  assert.equal(p.scores.storyteller, 2);
  assert.equal(p.scores.scout, 2);
  assert.equal(p.primary, 'scout');
  // It is asked before the interest count: storyteller 3 (famous + Art) and
  // spark 3 (Live music + the roll's 2), one interest each — the roll picks.
  const q = scoreQuiz({ first_move: 'famous', interests: ['Art & galleries', 'Live music'], camera_roll: 'spark' }, NOW);
  assert.equal(q.scores.storyteller, 3);
  assert.equal(q.scores.spark, 3);
  assert.equal(q.primary, 'spark');
  // A roll never overturns a lead: recharger 4 vs spark 2.
  assert.equal(scoreQuiz({ first_move: 'slow', camera_roll: 'spark', late: 'asleep' }, NOW).primary, 'recharger');
});

test('secondary only when it is at least 60% of the primary', () => {
  // taster 3 + 1 (truck) = 4; scout 2 (truck) = 50% → pure.
  assert.equal(scoreQuiz({ first_move: 'eat', restaurant: 'truck' }, NOW).secondary, null);
  // taster 3 (eat) + 1 (truck) = 4; scout 2 + 1 (wing) = 3 → 75%.
  const p = scoreQuiz({ first_move: 'eat', restaurant: 'truck', plan: 'wing' }, NOW);
  assert.equal(p.primary, 'taster');
  assert.equal(p.secondary, 'scout');
  assert.equal(headline(p), "You're The Taster — with a side of Scout");
});

test('a nudge on a bar wins and counts as answered', () => {
  const p = scoreQuiz({ plan: 'daily', dial_overrides: { pace: 62, crowd: 140 } }, NOW);
  assert.equal(p.dials.pace, 62);
  assert.equal(p.dials.crowd, 100, 'clamped');
  assert.ok(!p.unanswered.includes('crowd'));
  assert.equal(dialLabel('pace', 70), 'Morning to night');
  assert.equal(dialLabel('pace', 62), 'Daily plan', 'nearest stop, ties to the lower');
});

test('the same answers give the same profile, byte for byte', () => {
  const a: QuizAnswers = { first_move: 'group', interests: ['Live music', 'Comedy'], plan: 'loose', restaurant: 'new', late: 'sunrise' };
  assert.deepEqual(scoreQuiz(a, NOW), scoreQuiz(JSON.parse(JSON.stringify(a)), NOW));
});

// ─── The server never trusts the client's profile ────────────────────────

function fakeDb(row: Record<string, unknown> | null, opts: { missing?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  const missing = { code: '42703', message: 'column users.quiz_version does not exist' };
  const db = {
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
          if (opts.missing && Object.keys(patch).some(k => /quiz_|traveler_profile/.test(k))) return { error: { code: 'PGRST204', message: "Could not find the 'quiz_answers' column" } };
          writes.push(patch);
          return { error: null };
        },
      }),
    }),
  };
  return db;
}

test('the save recomputes the profile and ignores one the browser sent', async () => {
  const parsed = parseQuizSave({
    answers: { first_move: 'eat', traveler_profile: { primary: 'spark' } },
    finish: true,
    profile: { primary: 'spark', scores: { spark: 999 } },
  });
  assert.equal(parsed.ok, true);
  const body = (parsed as { ok: true; data: Parameters<typeof saveQuiz>[2] }).data;
  const db = fakeDb({ favorite_activities: [], no_way_jose: [] });
  const r = await saveQuiz(db as never, 'u1', body, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.stored, true);
  assert.equal(r.profile.primary, 'taster');
  const written = db.writes[0];
  assert.equal((written.traveler_profile as { primary: string }).primary, 'taster');
  assert.equal(written.quiz_version, 3);
  assert.ok(!('traveler_profile' in (written.quiz_answers as object)), 'unknown answer keys are stripped');
});

test('before the migration the v2 columns still save and the profile still comes back', async () => {
  assert.equal(quizColumnsMissing({ code: '42703' }), true);
  assert.equal(quizColumnsMissing({ code: 'PGRST204' }), true);
  assert.equal(quizColumnsMissing({ code: '42P01' }), true);
  assert.equal(quizColumnsMissing({ code: '23505' }), false);
  const db = fakeDb({ favorite_activities: ['Cooking'], no_way_jose: ['Karaoke'] }, { missing: true });
  const r = await saveQuiz(db as never, 'u1', { answers: { interests: ['Outdoors'], dislikes: ['Heights'] }, finish: true }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.stored, false);
  // Cooking is not a Q2 tile, so it is kept; Karaoke was replaced by the screen's own answer.
  assert.deepEqual(db.writes[0], {
    favorite_activities: ['Cooking', 'Outdoors'], activity_vibe: ['Cooking', 'Outdoors'], no_way_jose: ['Heights'],
  });
  // The v2 Cooking interest still counts towards the profile.
  assert.equal(r.profile.scores.taster, 1);
  assert.equal(r.profile.scores.thrill, 1);
});

test('a hard no removed in Profile does not come back from the quiz copy', async () => {
  // Profile's full list writes the v2 columns directly. quiz_answers still
  // says Heights; the column no longer does, and the column wins.
  const db = fakeDb({
    favorite_activities: ['Outdoors'], no_way_jose: [], dietary_needs: 'none', drink_style: 'Wine',
    quiz_answers: { dislikes: ['Heights'], interests: ['Outdoors', 'Sport'], drinks: ['Wine', 'Beer'] },
    traveler_profile: null, quiz_version: 3, quiz_skipped_at: null,
  });
  await saveQuiz(db as never, 'u1', { answers: { late: 'asleep' } }, NOW);
  const saved = db.writes[0].quiz_answers as QuizAnswers;
  assert.deepEqual(saved.dislikes, []);
  assert.deepEqual(saved.interests, ['Outdoors']);
  // Wine and Beer still imply "Wine" in the single column, so both are kept.
  assert.deepEqual(saved.drinks, ['Wine', 'Beer']);
  // A drip answer writes only what it spoke to.
  assert.deepEqual(Object.keys(db.writes[0]).sort(), ['quiz_answers', 'traveler_profile']);
});

test('an answer the scorer does not know is refused at the door', () => {
  assert.equal(QuizAnswersSchema.safeParse({ first_move: 'teleport' }).success, false);
  assert.equal(QuizAnswersSchema.safeParse({ dial_overrides: { pace: 101 } }).success, false);
  assert.equal(QuizAnswersSchema.safeParse({ camera_roll: 'taster' }).success, true);
});

// ─── v2 carries over ─────────────────────────────────────────────────────

const V2_ROW = {
  favorite_activities: ['Cooking', 'Pottery & crafts', 'Live music', 'Sea swimming'],
  no_way_jose: ['Karaoke', 'custom:Line dancing'],
  dietary_needs: 'Vegetarian, no shellfish',
  drink_style: 'Not drinking',
  dining_vibe: 'Outside, always',
  trip_summary: 'Hot dogs, honestly',
};

test('a v2 account never redoes the quiz: everything it said carries over', () => {
  const a = answersFromV2(V2_ROW);
  assert.deepEqual(a.interests, V2_ROW.favorite_activities);
  assert.deepEqual(a.dislikes, ['Karaoke', 'Line dancing']);
  assert.deepEqual(a.dietary, ['Vegetarian', 'no shellfish']);
  assert.deepEqual(a.drinks, ['Not drinking']);
  assert.deepEqual(a.seating, ['Outside, always']);
  assert.equal(a.free_interests, 'Hot dogs, honestly');
  assert.equal(hasV2Answers(V2_ROW), true);
  assert.equal(hasV2Answers({ dietary_needs: 'none' }), false);
  // Profile computes from what exists; the missing dials stay 50.
  const p = scoreQuiz(a, NOW);
  // Cooking, Pottery and Live music: one point each, settled by the fixed order.
  assert.equal(p.primary, 'storyteller');
  assert.deepEqual(p.unanswered, ['pace', 'novelty', 'energy', 'crowd']);
  assert.equal(onlyNotDrinking(a), true);
});

test('saving the twelve tiles never deletes the interests that are not on them', () => {
  const cols = columnsFromAnswers({ interests: ['Outdoors'] }, V2_ROW);
  assert.deepEqual(cols.favorite_activities, ['Cooking', 'Pottery & crafts', 'Sea swimming', 'Outdoors']);
  assert.equal(cols.no_way_jose, undefined, 'a screen that was not answered writes nothing');
});

test('"I eat everything" clears restrictions and nos in one tap', () => {
  assert.deepEqual(columnsFromAnswers({ eat_everything: true }, V2_ROW), { dietary_needs: 'none', no_way_jose: [] });
});

test('not drinking wins the single drink column, whatever sits beside it', () => {
  assert.equal(columnsFromAnswers({ drinks: ['Coffee, honestly', 'Not drinking'] }, null).drink_style, 'Not drinking');
  assert.equal(columnsFromAnswers({ drinks: ['Wine', 'Beer'] }, null).drink_style, 'Wine');
});

// ─── Privacy: the group mix never carries anything private ───────────────

const PRIVATE_ROWS = [
  {
    user_id: 'a',
    users: {
      id: 'a', name: 'Ana Ruiz',
      traveler_profile: { ...scoreQuiz({ first_move: 'eat', plan: 'hourly', late: 'asleep' }, NOW), dietary: ['Coeliac'] },
      // Everything a careless select('*') would drag along.
      quiz_answers: { dietary: ['Coeliac'], dislikes: ['Heights'], free_interests: 'my ex lives there', drinks: ['Not drinking'] },
      dietary_needs: 'Coeliac', no_way_jose: ['Heights'], trip_summary: 'my ex lives there', drink_style: 'Not drinking',
      email: 'ana@example.com',
    },
  },
  {
    user_id: 'b',
    users: {
      id: 'b', name: 'Ben',
      traveler_profile: scoreQuiz({ first_move: 'eat', plan: 'wing', late: 'sunrise' }, NOW),
      quiz_answers: { no_way_text: 'shellfish allergy' }, dietary_needs: 'Shellfish allergy',
    },
  },
  { user_id: 'c', users: { id: 'c', name: 'Cal', traveler_profile: null } },
];

test('the group mix never renders restrictions, dislikes, free text or drinking', () => {
  const mix = mixFromRows(PRIVATE_ROWS);
  assert.ok(mix);
  const out = JSON.stringify(mix);
  for (const secret of ['Coeliac', 'Heights', 'my ex', 'Not drinking', 'shellfish', 'Shellfish', 'ana@example.com', 'Ruiz', 'dietary', 'drink']) {
    assert.ok(!out.includes(secret), `leaked ${secret}`);
  }
  assert.deepEqual(Object.keys(mix!.members[0].profile).sort(), ['dials', 'primary', 'secondary', 'unanswered']);
  assert.deepEqual(mix!.members.map(m => m.name), ['Ana', 'Ben'], 'first names only; a member with no profile is left out');
  // Pace 100 vs 0: planners and wing-it types.
  assert.match(mix!.sentence!, /Planners and wing-it types/);
});

test('fewer than two finished members is no card at all', () => {
  assert.equal(mixFromRows(PRIVATE_ROWS.slice(1)), null);
});

test('group rules ignore dials nobody answered', () => {
  const a = publicProfile(scoreQuiz({ first_move: 'wander' }, NOW))!;       // pace unanswered, reads 50
  const b = publicProfile(scoreQuiz({ first_move: 'group', plan: 'hourly' }, NOW))!;
  assert.equal(mixSentence([a, b]), null);
  const tasters = [scoreQuiz({ first_move: 'eat' }, NOW), scoreQuiz({ first_move: 'eat' }, NOW), scoreQuiz({ first_move: 'slow' }, NOW)]
    .map(p => publicProfile(p)!);
  assert.match(mixSentence(tasters)!, /travels by stomach/);
  // No sentence promises what the itinerary will do.
  for (const s of [mixSentence(tasters), mixFromRows(PRIVATE_ROWS)!.sentence]) assert.ok(!/we'll|we will/i.test(s!));
});

test('generation hears the spreads, never a name or a restriction', () => {
  const hints = generationHints(mixFromRows(PRIVATE_ROWS)!.members.map(m => m.profile)).join(' ');
  assert.match(hints, /leave one afternoon unscheduled/);
  assert.match(hints, /end one night early/);
  assert.ok(!/Ana|Ben|Coeliac|drink/i.test(hints));
});

// ─── The reveal's cards come only from venues we hold ────────────────────

const f = (id: string, source: Finding['source'], title: string, category: string, extra: Partial<Finding> = {}): Finding => ({
  id, title, meta: '', emoji: '📍', price: null, dist: null, category, url: `https://example.com/${id}`,
  date: null, venue: null, source, because: null, ...extra,
});

test('reveal cards: held venues only, and nothing when the city holds none', () => {
  const findings = [
    f('tm', 'ticketmaster', 'Stadium Tour', 'concerts'),
    f('yp', 'yelp-places', 'Famous Diner', 'restaurant'),
    f('o1', 'osm', 'Ridge Trail', 'outdoors'),
    f('h1', 'harvest', 'Wheel throwing, Thursday', 'pottery & crafts'),
    f('o2', 'osm', 'No Link Cafe', 'places to eat', { url: '' }),
  ];
  const thrill = scoreQuiz({ interests: ['Outdoors', 'Sport'] }, NOW);
  const cards = revealCards(findings, thrill);
  assert.deepEqual(cards.map(c => c.id), ['o1', 'h1']);
  assert.deepEqual(revealCards(findings.filter(x => x.source !== 'osm' && x.source !== 'harvest'), thrill), []);
});

// ─── A saved profile changes what Discover shows first ───────────────────

test('Discover order changes when a profile is saved (real Finding fixtures)', () => {
  const findings = [
    f('bar', 'osm', 'The Lantern Pub', 'pubs'),
    f('spa', 'osm', 'Riverside Spa & Sauna', 'wellness'),
    f('museum', 'osm', 'City History Museum', 'museums & history'),
    f('trail', 'osm', 'Eno River Trail', 'outdoors'),
  ];
  const before = rank(findings, []).map(x => x.id);
  const recharger = scoreQuiz({ first_move: 'slow', interests: ['Wellness', 'Gardens & parks'], late: 'asleep' }, NOW);
  const after = rank(findings, [], recharger).map(x => x.id);
  assert.deepEqual(before, ['bar', 'spa', 'museum', 'trail'], 'no profile: the old order');
  assert.equal(after[0], 'spa');
  assert.notDeepEqual(after, before);
  // Never enough to outrank something they said they are into.
  const said = rank(findings, ['museums & history'], recharger).map(x => x.id);
  assert.equal(said[0], 'museum');
  assert.ok(profileBoost(findings[1], recharger) < 40);
});

// ─── The share card carries nothing but the result ───────────────────────

test('a share code round-trips the public result and nothing else', () => {
  const p = publicProfile(scoreQuiz({ first_move: 'eat', restaurant: 'truck', plan: 'wing', dietary: ['Vegan'] }, NOW))!;
  const code = shareCode(p);
  assert.equal(code, 'taster-scout-0-95-x-x');
  assert.deepEqual(fromShareCode(code), p);
  assert.equal(fromShareCode('taster-scout-0-95-x'), null);
  assert.equal(fromShareCode('<script>-none-1-2-3-4'), null);
  assert.equal(fromShareCode('none-none-x-x-x-x')?.primary, null);
});

// ─── The contract: traveler_profile cannot be dropped on the way ─────────

test('traveler_profile survives row → /api/me → the app', () => {
  const profile = scoreQuiz({ first_move: 'group', late: 'next_spot' }, NOW);
  const row = {
    id: 'u1', quiz_version: 3, traveler_profile: profile,
    quiz_answers: { first_move: 'group', late: 'next_spot', drip_dismissed: { drinks: NOW.toISOString() } },
    quiz_skipped_at: null,
  };
  const me = JSON.parse(JSON.stringify({ quiz: quizFromRow(row) }));
  const back = quizFromMe(me);
  assert.deepEqual(back.profile, profile);
  assert.equal(back.version, 3);
  assert.equal(back.stored, true);
  assert.equal(back.answers.drip_dismissed?.drinks, NOW.toISOString());
  // Before the migration: nothing to read, and it says so.
  const pre = quizFromMe(JSON.parse(JSON.stringify({ quiz: quizFromRow({ id: 'u1' }) })));
  assert.equal(pre.stored, false);
  assert.equal(pre.profile, null);
});

test('skipping is not asked again for sixty days', () => {
  assert.equal(withinQuietPeriod('2026-08-01T00:00:00Z', NOW), true);
  assert.equal(withinQuietPeriod('2026-07-01T00:00:00Z', NOW), false);
  assert.equal(withinQuietPeriod(null, NOW), false);
});

// ─── Drip questions ──────────────────────────────────────────────────────

test('never more than one drip question per session', () => {
  assert.equal(dripAllowed('drinks', { answers: {}, screen: 'discover', now: NOW }), true);
  assert.equal(dripAllowed('drinks', { answers: {}, screen: 'discover', shownThisSession: 'drinks', now: NOW }), true, 'the same card re-rendering');
  assert.equal(dripAllowed('seating', { answers: {}, screen: 'expDetail', shownThisSession: 'drinks', now: NOW }), false);
});

test('never on checkout, voting or trip creation', () => {
  for (const screen of ['checkout', 'vote', 'createPlan', 'groupTrip', 'planPrefs']) {
    assert.equal(dripAllowed('camera_roll', { answers: {}, screen, now: NOW }), false, screen);
  }
});

test('dismissing starts the sixty-day clock; answering ends it', () => {
  const dismissed = { drip_dismissed: { drinks: '2026-09-01T00:00:00Z' } };
  assert.equal(dripAllowed('drinks', { answers: dismissed, screen: 'discover', now: NOW }), false);
  assert.equal(dripAllowed('drinks', { answers: dismissed, screen: 'discover', now: new Date('2026-11-15T00:00:00Z') }), true);
  assert.equal(dripAllowed('drinks', { answers: {}, local: { drinks: '2026-09-20T00:00:00Z' }, screen: 'discover', now: NOW }), false, 'remembered locally before the migration');
  assert.equal(dripAllowed('drinks', { answers: { drinks: ['Wine'] }, screen: 'discover', now: NOW }), false);
  assert.equal(dripAllowed('night_out', { answers: {}, answeredLocally: ['night_out'], screen: 'expDetail', now: NOW }), false);
  assert.equal(pickDrip(['drinks', 'camera_roll'], { answers: { drinks: ['Beer'] }, screen: 'discover', now: NOW }), 'camera_roll');
  assert.equal(dripAnswered('upgrade', { first_move: 'eat' }), false);
  assert.equal(dripAnswered('upgrade', { first_move: 'eat', restaurant: 'new' }), true);
});
