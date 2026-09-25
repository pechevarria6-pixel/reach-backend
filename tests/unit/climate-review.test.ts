// The climate review of 2026-09-24: each test is one defect found in the
// first version, planted back and watched fail before the fix went in.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePower, howIsIt, climateLine, climatePromptBlock, bestMonthsLine, bestMonths, monthSummary,
  climateBreach, ideaClimate, climateIsFor, coldness, CLIMATE_CREDIT, type ClimateNormals,
} from '../../lib/climate.ts';
import { ideaClimateNow, climateForScreen, ideasWithClimateNow, pickClimateRow } from '../../lib/climate-store.ts';
import { ideaClimateFrom } from '../../lib/contracts/idea-climate.ts';
import { vetoBreach, tripBreach } from '../../lib/vetoes.ts';

const raw = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/climate/${f}.json`, import.meta.url), 'utf8'));
function place(f: string, name: string, country: string): ClimateNormals {
  const r = parsePower(raw(f), { name, country, lat: 35.78, lng: -78.64 });
  if ('error' in r) throw new Error(r.error);
  return r.normals;
}
const RALEIGH = place('raleigh', 'Raleigh', 'US');
const ASPEN = place('aspen', 'Aspen', 'US');
const RINCON = place('rincon', 'Rincón', 'PR');
const MOAB = place('moab', 'Moab', 'US');

const twelve = (v: number) => Array.from({ length: 12 }, () => v);
function synthetic(over: Partial<ClimateNormals>): ClimateNormals {
  return {
    name: 'Testville', country: 'US', lat: 0, lng: 0,
    t2m: twelve(18), t2mRange: twelve(8), precipMmDay: twelve(1), rh2m: twelve(50),
    period: '1981–2020', source: 'NASA POWER', gridElevationM: 100, ...over,
  };
}

/** A stored row as place_climate holds it, for a fake database. */
function rowOf(n: ClimateNormals) {
  return {
    name: n.name, name_key: n.name.toLowerCase(), country: n.country, lat: n.lat, lng: n.lng,
    t2m: n.t2m, t2m_range: n.t2mRange, precip_mm_day: n.precipMmDay, rh2m: n.rh2m, cloud_pct: null, wind_ms: null,
    grid_elevation_m: n.gridElevationM, source: n.source, period: n.period, fetched_at: '2026-09-24T00:00:00Z',
  };
}
function fakeDb(rows: unknown[]) {
  let reads = 0;
  const b: any = {
    select() { return b; }, eq() { return b; }, limit() { return b; },
    then(resolve: (v: unknown) => void) { reads++; resolve({ data: rows, error: null }); },
  };
  return { db: { from: () => b } as any, reads: () => reads };
}

// ── A saved idea's weather follows the plan's dates ────────────────────

test('a saved idea made for October, on a plan moved to January, is judged on January — and flagged, not shown as October', async () => {
  const made = ideaClimate(RALEIGH, 'Raleigh', { start: '2026-10-10', end: '2026-10-17' }, ['coldWeather']);
  assert.equal(made.breach, null, 'October passes the cold no-go');
  const idea = { city: 'Raleigh', destination: 'Raleigh, NC', country_code: 'US', climate: made.climate };
  const { db, reads } = fakeDb([rowOf(RALEIGH)]);

  const jan = { start: '2027-01-15', end: '2027-01-22' };
  assert.equal(climateIsFor(made.climate!, jan), false);
  const now = await ideaClimateNow(db, idea, jan);
  assert.equal(now?.trip?.when, 'January');
  assert.equal(now?.breach, 'coldWeather', 'the cold no-go is checked again on the new dates');
  assert.equal(now?.checked, true);
  assert.ok(climateIsFor(now!, jan));

  // Unchanged dates: the saved climate as it was, and no read.
  const before = reads();
  assert.equal(await ideaClimateNow(db, idea, { start: '2026-10-10', end: '2026-10-17' }), made.climate);
  assert.equal(reads(), before);
});

test('flexible dates that become real ones: "No dates yet" gives way to a verdict on the dates', async () => {
  const made = ideaClimate(ASPEN, 'Aspen', { start: null, end: null }, ['coldWeather']);
  assert.equal(made.climate?.trip, null);
  assert.equal(made.climate?.checked, false);
  const { db } = fakeDb([rowOf(ASPEN)]);
  const now = await ideaClimateNow(db, { city: 'Aspen', country_code: 'US', climate: made.climate }, { start: '2027-01-15', end: '2027-01-22' });
  assert.equal(now?.breach, 'coldWeather');
  assert.equal(now?.trip?.when, 'January');
});

test('a screen is never sent which weather no-go somebody asked for, and the saved form round-trips', async () => {
  const made = ideaClimate(RALEIGH, 'Raleigh', { start: '2026-10-10', end: '2026-10-17' }, ['coldWeather']).climate!;
  assert.deepEqual(made.wants, { cold: true, heat: false });
  assert.deepEqual(ideaClimateFrom(JSON.parse(JSON.stringify(made))), made);
  assert.equal('wants' in (climateForScreen(made) as object), false);
  const { db } = fakeDb([rowOf(RALEIGH)]);
  const shown = await ideasWithClimateNow(db, [{ city: 'Raleigh', country_code: 'US', climate: made }, { destination: 'Nowhere' }], { start: '2027-01-15', end: '2027-01-22' });
  assert.equal(shown[0].climate?.breach, 'coldWeather');
  assert.equal('wants' in (shown[0].climate as object), false);
  assert.equal(shown[1].climate, undefined);
  assert.equal(ideaClimateFrom({ ...made, breach: 'coldWeather', held: false, trip: null, credit: '', checked: false }), null, 'a breach needs dates and climate');
});

test('every route that hands saved ideas to a screen works their weather out for the dates, and the card checks them', () => {
  const vote = readFileSync('app/api/plans/[planId]/vote/route.ts', 'utf8');
  assert.match(vote, /ideasWithClimateNow\(supabase, ideas\.options, dates\)/);
  assert.match(vote, /start: plan\.start_date \?\? null, end: plan\.end_date \?\? null/);
  assert.match(vote, /foundAt: ideas\.foundAt, options \}/);
  const gen = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  assert.equal((gen.match(/ideasWithClimateNow\(supabase, [\w.]+\.options, \{ start: startDate, end: endDate \}\)/g) ?? []).length, 3);
  assert.doesNotMatch(gen, /trips: (read|saved)\.ideas\.options/);
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /if\(!climateIsFor\(c,\{start:startDate\|\|null,end:endDate\|\|null\}\)\)return null;/);
  assert.match(app, /c\.breach==="coldWeather"/);
});

// ── The prompt does not say what the no-go check refuses to decide ─────

test('on high ground the prompt does not call it cold unless the check would', () => {
  const oct = howIsIt(ASPEN, '2026-10-10', '2026-10-17')!;
  assert.equal(coldness(oct), 'maybe');
  const block = climatePromptBlock(oct);
  assert.doesNotMatch(block, /It is cold/);
  assert.match(block, /Aspen itself is probably milder/);
  assert.match(block, /do not tell them it will be cold/);
  const jan = howIsIt(ASPEN, '2027-01-10', '2027-01-15')!;
  assert.equal(coldness(jan), 'cold');
  assert.match(climatePromptBlock(jan), /It is cold/);
  // Low ground is judged on its own figures, as before.
  assert.match(climatePromptBlock(howIsIt(RALEIGH, '2027-01-10', '2027-01-15')!), /It is cold/);
});

// ── Best months on high ground say whose figures they are ─────────────

test('the best months on high ground carry the same caveat as the card line', () => {
  for (const [n, name] of [[ASPEN, 'Aspen'], [MOAB, 'Moab']] as const) {
    const line = bestMonthsLine(n, name)!;
    assert.match(line, new RegExp(`^Best weather on the high ground around ${name} \\(`));
    assert.match(line, /itself is often warmer/);
  }
  assert.equal(bestMonthsLine(RALEIGH), 'Best weather in Raleigh: April–May, October–November');
});

// ── "Much the same all year" only when it is ───────────────────────────

test('twelve comfortable months that swing 9 °C are not "much the same all year"', () => {
  const t2m = [14, 15, 16, 18, 20, 22, 23, 23, 21, 19, 16, 14]; // highs 18 to 27
  const n = synthetic({ t2m });
  assert.equal(bestMonths(n).months.length, 12);
  assert.equal(bestMonths(n).allYear, false);
  assert.equal(bestMonthsLine(n), 'Weather in Testville is usually comfortable all year, though it changes with the seasons');
});

test('eleven months and one very wet one: the wet month is left out by name, never "much the same"', () => {
  const rain = twelve(1); rain[5] = 10; // June: ~300 mm
  const n = synthetic({ t2m: twelve(19), precipMmDay: rain });
  assert.equal(bestMonths(n).months.length, 11);
  assert.equal(bestMonths(n).allYear, false);
  assert.equal(bestMonthsLine(n), 'Best weather in Testville: July–May');
});

test('a place that really is the same all year says so', () => {
  const n = synthetic({ t2m: [19, 19, 20, 20, 21, 21, 22, 22, 21, 21, 20, 19] });
  assert.equal(bestMonths(n).allYear, true);
  assert.equal(bestMonthsLine(n), 'Weather in Testville is much the same all year');
});

// ── Lows from a cell that is mostly sea are not said ───────────────────

test('Rincón’s prompt gives no night-time low; Moab’s, whose days and nights differ, does', () => {
  const rincon = howIsIt(RINCON, '2026-10-10', '2026-10-17')!;
  assert.equal(rincon.lowsReliable, false);
  const block = climatePromptBlock(rincon);
  assert.doesNotMatch(block, /lows around/);
  assert.match(block, /No night-time low is given/);
  assert.match(climatePromptBlock(howIsIt(MOAB, '2026-10-10', '2026-10-17')!), /lows around/);
});

// ── The citation POWER asks for is on the screens ─────────────────────

test('POWER’s citation is shown wherever its averages are, once per screen', () => {
  assert.match(CLIMATE_CREDIT, /Langley Research Center/);
  assert.match(CLIMATE_CREDIT, /Earth Science Division/);
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /function ClimateCitation\([^)]*\)\{[\s\S]{0,300}CLIMATE_CREDIT/);
  assert.match(app, /\{climateCredit\(normals\.period\)\}[^\n]*\n\s*<ClimateCitation/, 'the When step and the plan overview');
  assert.match(app, /\{ideasShowClimate\(options\)&&<ClimateCitation/, 'the Vote tab');
  assert.match(app, /\{ideasShowClimate\(trips\)&&<ClimateCitation/, 'the ideas on the trip screen');
});

// ── Two towns of one name in one country ───────────────────────────────

test('Fayetteville, NC is not Fayetteville, AR: with a country and no coordinates, two towns is no answer', () => {
  const ar = { name: 'Fayetteville', country: 'US', lat: 36.06, lng: -94.16 };
  const nc = { name: 'Fayetteville', country: 'US', lat: 35.05, lng: -78.88 };
  assert.equal(pickClimateRow([ar, nc], { country: 'US' }), null);
  assert.equal(pickClimateRow([ar, nc], { country: 'US', lat: 35.05, lng: -78.88 }), nc, 'coordinates still choose');
  assert.equal(pickClimateRow([ar], { country: 'US' }), ar);
  // Cancun and Cancún, 0.01° apart: one place.
  const a = { name: 'Cancun', country: 'MX', lat: 21.16, lng: -86.85 }, b = { name: 'Cancún', country: 'MX', lat: 21.17, lng: -86.85 };
  assert.equal(pickClimateRow([a, b], { country: 'MX' }), a);
});

// ── The no-go is judged on the number the card is worked from ─────────

test('at the thresholds the verdict agrees with the °F the card shows', () => {
  // A high of 9.6 °C: 49 °F, under the 50 °F rule — cold, whatever it rounds to in °C.
  const cool = synthetic({ t2m: twelve(5.6), t2mRange: twelve(8) });
  const c = howIsIt(cool, '2027-01-10', '2027-01-15')!;
  assert.equal(c.highC, 10);
  assert.equal(c.highF, 49);
  assert.deepEqual(climateBreach(c, ['coldWeather']), { veto: 'coldWeather', checked: true, asked: true });
  // A high of 34.5 °C: 94 °F, under 95 — not extreme heat.
  const warm = synthetic({ t2m: twelve(30.5), t2mRange: twelve(8), rh2m: twelve(20) });
  const h = howIsIt(warm, '2027-07-10', '2027-07-15')!;
  assert.equal(h.highF, 94);
  assert.equal(h.hot, false);
  assert.equal(climateBreach(h, ['extremeHeat']).veto, null);
});

// ── One month's rain is one number ─────────────────────────────────────

test('a month’s rain is the same amount and the same class on the card, the label and the prompt', () => {
  // October: 75.95 mm over its 31 days. The rest close enough that no month
  // is ranked, so the card says the amount.
  const rain = twelve(2.3); rain[9] = 2.45;
  const n = synthetic({ precipMmDay: rain });
  const oct = monthSummary(n, 10);
  assert.equal(oct.rainMm, 76);
  assert.equal(oct.rainClass, 'wet');
  const t = howIsIt(n, '2026-10-10', '2026-10-17')!;
  assert.equal(t.rainMm, 76);
  assert.equal(t.label, oct.label);
  assert.match(climateLine(t), /about 76 mm/);
  assert.match(climatePromptBlock(t), /about 76 mm \(3 in\) of rain a month — warm and wet/);
  // February's own 28 days, not a flat 30.
  const feb = howIsIt(synthetic({ precipMmDay: twelve(3) }), '2027-02-10', '2027-02-15')!;
  assert.equal(feb.rainMm, 84);
});

// ── A typed no-go that is also a weather is still a word ───────────────

test('a typed "snow" still takes the snow tubing out of a mild March; "Cold weather" is still never read off words', () => {
  assert.equal(vetoBreach('Afternoon snow tubing at the lodge', ['custom:snow']), 'snow');
  assert.equal(vetoBreach('A heat lamp terrace... no, a sauna: heat therapy', ['heat']), 'heat');
  assert.equal(tripBreach({ tagline: 'Leave the cold weather behind' }, ['Cold weather', 'coldWeather', 'custom:Extreme heat']), null);
});
