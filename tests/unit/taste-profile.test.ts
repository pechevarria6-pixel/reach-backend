// The taste profile (lib/taste-profile.ts): distilled from the rows we hold,
// explainable, an explicit avoid beats a positive, nothing typed or sensitive
// in it, never shown to anybody, purged on deletion.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  distill, distillAll, profileFrom, purgeProfile, readProfile, tagOf, decay, NO_GOS, type TasteProfile,
} from '../../lib/taste-profile.ts';
import { pickTrips, inferredOf, type Candidate, type Holdings, type Person, type TripPick } from '../../lib/recommendations/trip-picks.ts';
import type { Signal } from '../../lib/signals.ts';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const sig = (kind: string, detail: Record<string, unknown> = {}, extra: Partial<Signal> = {}): Signal => ({
  user_id: 'u1', source: kind === 'profile' || kind === 'trip_input' ? 'declared' : 'behavioural',
  kind, ref: null, plan_id: null, group_id: null, detail, at: '2026-10-01T12:00:00Z', ...extra,
});
const declared = (over: Record<string, unknown> = {}) => sig('profile', {
  favorite_activities: ['Live music', 'Art & galleries', 'Wine tasting'],
  cuisines: ['Italian'],
  budget_range: '$100 – $200',
  traveler_profile: { primary: 'spark', secondary: 'scout', dials: { pace: 25, crowd: 50, energy: 85, novelty: 73 }, unanswered: ['crowd'] },
  ...over,
});

// ── What it learns ───────────────────────────────────────────────────────

test('declared answers become interests, in venue-table words, strongest first', () => {
  const { profile } = distill([declared()], NOW);
  const keys = Object.keys(profile.interests);
  assert.equal(keys[0], 'live music');
  assert.ok(keys.includes('art & galleries'));
  assert.ok(keys.includes('italian restaurants'));
  assert.equal(profile.interests['live music'], 1);
  assert.equal(profile.pace, 'relaxed');
  assert.equal(profile.budget_posture, 'mid');
  assert.deepEqual(profile.travel_style.archetype, { primary: 'spark', secondary: 'scout' });
});

test('what they did adds to what they said, and every facet says where it came from', () => {
  const { profile, signal_count, last_signal_at } = distill([
    declared(),
    sig('feedback_done', { vertical: 'Pottery & crafts' }, { at: '2026-10-20T10:00:00Z' }),
    sig('dates_offered', { weekday_start: 5 }),
    sig('dates_offered', { weekday_start: 1 }),
    sig('plan_created', { kind: 'trip', solo: true, nights: 3 }),
    sig('plan_created', { kind: 'trip', solo: false, nights: 5 }),
    sig('booked', { city: 'Raleigh', country: 'us', vertical: 'hotel' }, { plan_id: 'p1' }),
    sig('booked', { city: 'Raleigh', country: 'US', vertical: 'flight' }, { plan_id: 'p1' }),
  ], NOW);
  assert.ok(profile.interests['pottery & crafts'] > 0);
  assert.equal(profile.evidence.interests.feedback_done, 1);
  assert.equal(profile.time_prefs.weekend_start_share, 0.5);
  assert.equal(profile.time_prefs.typical_nights, 4);
  // Two booked rows on one trip are one trip there.
  assert.deepEqual(profile.places.been, [{ city: 'Raleigh', country: 'US', trips: 1 }]);
  assert.equal(profile.social.solo_plans, 1);
  assert.equal(profile.social.group_plans, 1);
  assert.equal(signal_count, 8);
  assert.equal(last_signal_at, '2026-10-20T10:00:00.000Z');
  for (const c of Object.values(profile.confidence)) assert.ok(c >= 0 && c <= 1);
});

test('older behaviour counts for less', () => {
  assert.equal(decay(new Date(NOW).toISOString(), NOW), 1);
  assert.ok(Math.abs(decay(new Date(NOW - 365 * 86_400_000).toISOString(), NOW) - 0.5) < 1e-9);
});

// ── An explicit avoid beats a positive ────────────────────────────────────

test('"not for me" takes a kind out of interests, whatever pointed at it', () => {
  const { profile } = distill([
    declared(),
    sig('feedback_done', { vertical: 'Live music' }),
    sig('trip_input', { answers: { nightKind: ['livemusic'] } }),
    sig('feedback_not_interested', { vertical: 'Live music' }),
  ], NOW);
  assert.equal(profile.interests['live music'], undefined);
  assert.equal(profile.avoid['live music'], 1);
});

test("a trip's no clubs is an avoid of nightclubs and a no-go", () => {
  const { profile } = distill([
    sig('profile', { nightlife_style: 'Dancing' }),
    sig('trip_input', { answers: { noWayJose: ['clubs', 'earlyMornings', 'spicy'] } }),
  ], NOW);
  assert.equal(profile.interests.nightclubs, undefined);
  assert.ok(profile.avoid.nightclubs > 0);
  assert.deepEqual([...profile.no_go].sort(), ['clubs', 'earlyMornings']);
  for (const n of profile.no_go) assert.ok((NO_GOS as readonly string[]).includes(n));
});

test('an avoid of a drink is never written down, though it still leaves interests', () => {
  const { profile } = distill([declared(), sig('feedback_not_interested', { vertical: 'Wine tasting' })], NOW);
  assert.equal(profile.interests['wine tasting'], undefined);
  assert.equal(profile.avoid['wine tasting'], undefined);
});

// ── Nothing typed, nothing sensitive ──────────────────────────────────────

test('no sentence anybody typed reaches the profile', () => {
  const typed = ["I'm coeliac and sober", 'Nothing before 9am', 'Watch the sunset', 'gluten free bakery', 'my sister turns forty'];
  const { profile } = distill([
    declared({ favorite_activities: ['Live music', typed[4]] }),
    sig('trip_input', { answers: {
      goalBlurb: typed[0], noWay: typed[1], mustDo: typed[2],
      nightFood: [`custom:${typed[3]}`, 'custom:Thai'], tripType: ['beach', typed[4]], accommodation: [typed[0]],
      noWayJose: [typed[1]], pace: typed[1], nightEnergy: typed[0],
    } }),
  ], NOW);
  const json = JSON.stringify(profile).toLowerCase();
  for (const t of typed) assert.ok(!json.includes(t.toLowerCase()), t);
  // A custom answer that is a cuisine the quiz offers is still a cuisine.
  assert.ok(profile.interests['thai restaurants'] > 0);
});

test('every string in a profile is a word this file chose, or a booked city', () => {
  const { profile } = distill([
    declared(),
    sig('trip_input', { answers: { tripType: ['beach', 'party'], accommodation: ['airbnb'], pace: 'packed', nightEnergy: 'big', nightKind: ['dinner', 'show'] } }),
    sig('booked', { city: 'Lisbon', country: 'PT' }, { plan_id: 'p2' }),
  ], NOW);
  const strings: string[] = [];
  const walk = (v: unknown, key = '') => {
    if (typeof v === 'string') strings.push(`${key}=${v}`);
    else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { strings.push(`key:${k}`); walk(x, k); }
  };
  walk(profile);
  for (const s of strings) {
    if (s.startsWith('key:')) {
      const k = s.slice(4);
      // Object keys are facet names, signal kinds, quiz ids or venue words.
      assert.match(k, /^[a-z_& ]+$/i, k);
      continue;
    }
    const [k, v] = s.split('=');
    if (k === 'city') { assert.equal(v, 'Lisbon'); continue; }
    if (k === 'country') { assert.equal(v, 'PT'); continue; }
    assert.match(v, /^[a-z_]+$/i, s);
  }
});

test('nothing dietary: a vegetarian cuisine is not a taste we keep', () => {
  assert.equal(tagOf('Veggie'), null);
  assert.equal(tagOf('custom:vegan'), null);
  const { profile } = distill([declared({ cuisines: ['Veggie', 'Thai'] })], NOW);
  assert.equal(profile.interests['veggie restaurants'], undefined);
  assert.ok(profile.interests['thai restaurants'] > 0);
  assert.equal(tagOf('places to stay'), null);
  assert.equal(tagOf('something nobody offered'), null);
});

test('a stored profile is checked before the ranking reads it', () => {
  assert.equal(profileFrom(null), null);
  assert.equal(profileFrom({ version: 2 }), null);
  const p = profileFrom({ version: 1, interests: { 'live music': 1, 'made up': 1, outdoors: 'lots' }, avoid: { 'live music': 1 } })!;
  // The avoid wins even in a row written by some other version of the distill.
  assert.deepEqual(p.interests, {});
  assert.deepEqual(p.avoid, { 'live music': 1 });
});

// ── It reorders; it never speaks ──────────────────────────────────────────

const RALEIGH = { lat: 35.7804, lng: -78.6391 };
const town = (name: string, lat: number, lng: number): Candidate =>
  ({ key: `${name.toLowerCase()}|US`, name, country: 'US', label: name, lat, lng });
const held = (counts: Record<string, number>): Holdings => ({ counts, floor: false });
const raleigh = town('Raleigh', 35.7804, -78.6391);
const potterton = town('Potterton', 35.0, -80.0);
const plainfield = town('Plainfield', 35.3, -80.2);
const cands = [raleigh, potterton, plainfield];
const hs = new Map<string, Holdings>([
  [raleigh.key, held({ 'places to eat|restaurant': 200, 'live music|music venue': 20 })],
  [potterton.key, held({ 'places to eat|restaurant': 30, 'pottery & crafts|': 60 })],
  [plainfield.key, held({ 'places to eat|restaurant': 30, 'photography|': 60 })],
]);
const person = (profile: TasteProfile | null): Person => ({
  home: RALEIGH, homeCountry: 'US', homeAirport: 'RDU',
  me: { favorite_activities: ['Live music'], cuisines: [], no_way_jose: [], budget_range: '$100 – $200' },
  group: null, planned: { trips: new Map(), nights: new Map() }, dismissed: new Set(), profile,
});
const learned = (interests: Record<string, number>, avoid: Record<string, number> = {}) =>
  ({ ...distill([], NOW).profile, interests, avoid });

test('what the profile learned moves a town up', () => {
  const without = pickTrips(cands, hs, person(null)).picks.filter(p => p.band === 'weekend');
  const withIt = pickTrips(cands, hs, person(learned({ 'pottery & crafts': 1 }))).picks.filter(p => p.band === 'weekend');
  // Level on everything they said, so the name settles it without a profile.
  assert.equal(without[0].destination.city, 'Plainfield');
  assert.equal(withIt[0].destination.city, 'Potterton');
});

test('the profile changes which card, never a word on one', () => {
  const plain = pickTrips(cands, hs, person(null)).picks;
  const shaped = pickTrips(cands, hs, person(learned({ 'pottery & crafts': 1 }))).picks;
  // `score` is the ordering itself (contract: "for tests and logs, not
  // shown"); everything a card can say must be the same with or without it.
  const words = ({ score: _s, ...rest }: TripPick) => JSON.stringify(rest);
  const byRef = new Map(plain.map(p => [p.ref, words(p)]));
  assert.ok(shaped.length > 0);
  for (const p of shaped) assert.equal(words(p), byRef.get(p.ref), p.ref);
});

test('an inferred interest is never one they said, an avoided one or a vetoed one', () => {
  const inf = inferredOf(learned({ 'live music': 1, outdoors: 0.8, breweries: 0.6, comedy: 0.5 }, { comedy: 1 }), ['live music'], [], ['breweries'])!;
  assert.deepEqual([...inf.boost.keys()], ['outdoors']);
  assert.ok(inf.damp.has('comedy'));
  assert.equal(inferredOf(null, [], [], []), null);
});

// ── Never shown; purged; no new cron ──────────────────────────────────────

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir))) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

// The only files that may touch the stored profile. Each is server-side and
// none returns a profile to a person.
const MAY_TOUCH = new Set([
  'lib/taste-profile.ts', 'lib/signals.ts',
  'app/api/ops/taste-profile/route.ts',
]);

test('nothing but the distill, the ops read and the purge touches a stored profile', () => {
  const files = [...walk('app'), ...walk('components'), ...walk('lib'), ...walk('public')];
  const offenders = files.filter(f => !MAY_TOUCH.has(f)
    && /user_taste_profile|taste_profile_ids|v_taste_profile_ops|v_taste_signals/.test(read(f)));
  assert.deepEqual(offenders, []);
});

test('no screen calls the ops route, and its secret is never public', () => {
  const client = [...walk('components'), ...walk('public'), ...walk('app').filter(f => !f.startsWith('app/api/'))];
  assert.deepEqual(client.filter(f => /\/api\/ops\//.test(read(f))), []);
  const everything = [...walk('app'), ...walk('components'), ...walk('lib'), ...walk('scripts')];
  assert.deepEqual(everything.filter(f => /NEXT_PUBLIC_\w*OPS/.test(read(f))), []);
  const ops = read('app/api/ops/taste-profile/route.ts');
  assert.match(ops, /process\.env\.REACH_OPS_SECRET/);
  assert.match(ops, /if \(!secret\)[\s\S]{0,200}return false/);
  assert.match(ops, /timingSafeEqual/);
  // By profile_id: the answer is read from the view with no user id in it.
  assert.match(ops, /from\('v_taste_profile_ops'\)/);
  assert.doesNotMatch(ops.slice(ops.indexOf("from('v_taste_profile_ops')")), /user_id/);
});

test('both deletion paths purge the profile', () => {
  const data = read('app/api/user/data/route.ts');
  const del = data.slice(data.indexOf('export async function DELETE'), data.indexOf('export async function PATCH'));
  assert.match(del, /await purgeProfile\(/);
  const clerk = read('app/api/webhooks/clerk/route.ts');
  assert.match(clerk.slice(clerk.indexOf("type === 'user.deleted'")), /await purgeProfile\(/);
  const lib = read('lib/taste-profile.ts');
  const purge = lib.slice(lib.indexOf('export async function purgeProfile'), lib.indexOf('export async function readProfile'));
  assert.match(purge, /from\('user_taste_profile'\)\.delete\(\)/);
  assert.match(purge, /from\('taste_profile_ids'\)\.delete\(\)/);
});

// ── A failure never breaks anything ───────────────────────────────────────

/** A client every call of which answers `result`, or throws when told to. */
function fakeDb(result: { data: unknown; error: unknown; count?: number } | 'throw'): any {
  const chain: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return result === 'throw' ? undefined : (ok: (v: unknown) => void) => ok(result);
      }
      return () => { if (result === 'throw') throw new Error('network down'); return chain; };
    },
  });
  return chain;
}

test('the ranking reads no profile, rather than failing, when anything goes wrong', async () => {
  assert.equal(await readProfile(fakeDb('throw'), 'u1'), null);
  assert.equal(await readProfile(fakeDb({ data: null, error: { code: 'PGRST205', message: 'missing' } }), 'u1'), null);
  assert.equal(await readProfile(fakeDb({ data: { profile: { version: 9 } }, error: null }), 'u1'), null);
  const p = await readProfile(fakeDb({ data: { profile: { version: 1, interests: { outdoors: 1 }, avoid: {} } }, error: null }), 'u1');
  assert.deepEqual(p?.interests, { outdoors: 1 });
});

test('the distill reports a failure and never throws', async () => {
  const thrown = await distillAll(fakeDb('throw'), { budgetMs: 1000 });
  assert.equal(thrown.distilled, 0);
  assert.ok(thrown.errors.length > 0);
  const refused = await distillAll(fakeDb({ data: null, error: { code: '42501', message: 'denied' } }), { budgetMs: 1000 });
  assert.equal(refused.distilled, 0);
  assert.ok(refused.errors.some(e => /v_taste_signals/.test(e)));
  assert.equal(await purgeProfile(fakeDb('throw'), 'u1', 'test'), false);
  assert.equal(await purgeProfile(fakeDb({ data: null, error: { code: '42501', message: 'denied' } }), 'u1', 'test'), false);
  assert.equal(await purgeProfile(fakeDb({ data: null, error: { code: 'PGRST205', message: 'not there' } }), 'u1', 'test'), true);
  assert.equal(await purgeProfile(fakeDb({ data: null, error: null }), 'u1', 'test'), true);
});

test('the distill rides the daily knowledge cron, with no vercel.json entry of its own', () => {
  assert.match(read('app/api/cron/knowledge/route.ts'), /await distillAll\(/);
  const crons = JSON.parse(read('vercel.json')).crons as Array<{ path: string; schedule: string }>;
  assert.ok(!crons.some(c => /taste/.test(c.path)));
  assert.ok(crons.some(c => c.path === '/api/cron/knowledge'));
});

// ── Review fixes ──────────────────────────────────────────────────────────

test("every spelling a No Way José screen saves is read, and a night's loud rooms rules out clubs", () => {
  const { profile } = distill([
    sig('trip_input', { answers: { tripType: ['party'] } }),
    // The trip quiz's ids and the night-out quiz's phrases, as CreatePlanFlow saves them.
    sig('trip_input', { answers: { noWayJose: ['crowded', 'longFlights', 'hiking', 'earlyMornings', 'camping', 'coldWeather'] } }),
    sig('trip_input', { answers: { noWayJose: ['big crowds', 'loud rooms', 'long queues', 'standing all night', 'dressing up'] } }),
  ], NOW);
  assert.equal(profile.interests.nightclubs, undefined);
  assert.ok(profile.avoid.nightclubs > 0);
  assert.deepEqual([...profile.no_go].sort(), [
    'camping', 'coldWeather', 'crowds', 'dressingUp', 'earlyMornings', 'hiking', 'longFlights', 'longQueues', 'loud', 'standingAllNight',
  ]);
  // "Touristy traps" and "big crowds" are one no-go, counted twice.
  assert.equal(profile.no_go[0], 'crowds');
  for (const n of profile.no_go) assert.ok((NO_GOS as readonly string[]).includes(n));
});

test('a trip with no length yet says nothing about budget', () => {
  // The create flow sends nights 0 until the date poll settles the dates.
  const undated = distill([sig('trip_input', { answers: { budget: '1000', nights: 0 } })], NOW).profile;
  assert.equal(undated.budget_posture, null);
  const week = distill([sig('trip_input', { answers: { budget: '1000', nights: 7 } })], NOW).profile;
  assert.equal(week.budget_posture, 'mid');
});

test('an avoid in the profile changes no word on a card either', () => {
  const town2 = town('Cityton', 35.1, -79.9);
  const counts = { 'live music|music venue': 30, 'comedy|comedy club': 25, 'museums & history|museum': 20, 'art & galleries|gallery': 18, 'places to eat|restaurant': 40 };
  const hs2 = new Map<string, Holdings>([[town2.key, held(counts)]]);
  const p = (profile: TasteProfile | null): Person => ({
    ...person(profile),
    me: { favorite_activities: ['Live music', 'Comedy', 'Museums & history', 'Art & galleries'], cuisines: [], no_way_jose: [], budget_range: '$100 – $200' },
  });
  const plain = pickTrips([town2], hs2, p(null)).picks;
  const shaped = pickTrips([town2], hs2, p(learned({}, { comedy: 1 }))).picks;
  assert.ok(plain.length > 0);
  assert.ok(plain.some(x => /comedy/i.test(x.matched ?? '')), 'the quiz-named comedy is on the card without a profile');
  const words = ({ score: _s, ...rest }: TripPick) => JSON.stringify(rest);
  const byRef = new Map(plain.map(x => [x.ref, words(x)]));
  for (const x of shaped) assert.equal(words(x), byRef.get(x.ref), x.ref);
  // It still reorders: the avoid costs the town score.
  assert.ok(shaped[0].score < plain[0].score);
});

test('a page that fails mid-read drops the person it cut off, as a row cap does', async () => {
  const { readSignals } = await import('../../lib/signals.ts');
  const page1 = Array.from({ length: 1000 }, (_, i) => ({
    user_id: i < 600 ? 'a' : 'b', source: 'behavioural', kind: 'vote', ref: null, plan_id: null, group_id: null, detail: {}, at: null,
  }));
  let call = 0;
  const db: any = { from: () => {
    const q: any = { select: () => q, order: () => q, range: () => {
      call++;
      return Promise.resolve(call === 1 ? { data: page1, error: null } : { data: null, error: { code: '57014', message: 'timeout' } });
    } };
    return q;
  } };
  const read = await readSignals(db, { maxRows: 50_000, deadline: Date.now() + 10_000 });
  assert.ok(read.error);
  assert.equal(read.truncated, true);
  assert.deepEqual([...read.byUser.keys()], ['a']);
});

test('retention deletes the pseudonym along with the profile', async () => {
  const calls: Array<{ table: string; op: string; ids?: unknown }> = [];
  const db: any = { from: (table: string) => {
    let op = 'select';
    let ids: unknown;
    const q: any = {
      select: () => q, not: () => q, eq: () => q, order: () => q,
      delete: () => { op = 'delete'; return q; },
      upsert: () => { op = 'upsert'; return q; },
      in: (_c: string, v: unknown) => { ids = v; return q; },
      lt: () => q,
      range: () => Promise.resolve({ data: [], error: null }),
      then: (ok: (v: unknown) => void) => {
        calls.push({ table, op, ids });
        if (table === 'user_taste_profile' && op === 'delete') return ok({ data: [{ user_id: 'old1' }], error: null });
        return ok({ data: [], error: null });
      },
    };
    return q;
  } };
  const report = await distillAll(db, { budgetMs: 5000, now: NOW });
  assert.equal(report.purged_stale, 1);
  assert.ok(calls.some(c => c.table === 'taste_profile_ids' && c.op === 'delete' && Array.isArray(c.ids) && (c.ids as string[]).includes('old1')));
});

test('the privacy line promises about the summary, never about the activity group members already see', () => {
  const page = read('app/(legal)/privacy/page.tsx');
  const line = page.slice(page.indexOf('What we learn from what you do'), page.indexOf('</li>', page.indexOf('What we learn from what you do')));
  assert.ok(line.length > 0);
  // Members see each other's offered dates and the group's bookings, and the
  // rows behind them wait the 30 days the Deletion paragraph states.
  assert.doesNotMatch(line, /It is never shown|it is deleted as soon as/);
  assert.match(line, /summary is never shown/);
  assert.match(line, /as described there/);
});
