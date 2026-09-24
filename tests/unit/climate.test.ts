// What the weather is usually like, from NASA POWER normals.
// Run with: npm run test:unit
//
// The fixtures are real POWER climatology answers (1981–2020, fetched
// 2026-09-24) for a desert (Moab), a tropical wet season (Agra, and Rincón's
// wet autumn), a cold winter town (Aspen, and Raleigh's cool January) and
// the southern hemisphere (Cusco, whose wet season is December to February).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePower, periodFrom, monthSummary, bestMonths, bestMonthsLine, wettestMonths, monthRanges,
  nightsByMonth, howIsIt, climateLine, climatePromptBlock, fahrenheitFirst, climateVetoes,
  climateBreach, comfortScore, ideaClimate, isWeatherVeto, COLD_HIGH_C, type ClimateNormals,
} from '../../lib/climate.ts';
import { ideaClimateFrom } from '../../lib/contracts/idea-climate.ts';
import { vetoBreach, tripBreach } from '../../lib/vetoes.ts';

const raw = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/climate/${f}.json`, import.meta.url), 'utf8'));
function place(f: string, name: string, country: string): ClimateNormals {
  const r = parsePower(raw(f), { name, country, lat: 0, lng: 0 });
  if ('error' in r) throw new Error(r.error);
  return r.normals;
}
const MOAB = place('moab', 'Moab', 'US');
const AGRA = place('agra', 'Agra', 'IN');
const RINCON = place('rincon', 'Rincón', 'PR');
const ASPEN = place('aspen', 'Aspen', 'US');
const RALEIGH = place('raleigh', 'Raleigh', 'US');
const CUSCO = place('cusco', 'Cusco', 'PE');

// ── Reading POWER ──────────────────────────────────────────────────────

test('a POWER answer becomes twelve months of each value, with the period it says it used', () => {
  assert.equal(MOAB.t2m.length, 12);
  assert.equal(MOAB.precipMmDay.length, 12);
  assert.equal(MOAB.period, '1981–2020');
  assert.equal(MOAB.source, 'NASA POWER');
  assert.equal(MOAB.gridElevationM, 1819);
  assert.equal(periodFrom('20-year … (January 2001 - December 2020)'), '2001–2020');
});

test('a fill value or a missing month is refused whole, never stored as weather', () => {
  const body = raw('moab');
  body.properties.parameter.T2M.MAR = -999;
  assert.ok('error' in parsePower(body, { name: 'Moab', country: 'US', lat: 0, lng: 0 }));
  const gone = raw('moab');
  delete gone.properties.parameter.PRECTOTCORR;
  assert.ok('error' in parsePower(gone, { name: 'Moab', country: 'US', lat: 0, lng: 0 }));
  const refused = { header: 'The POWER Climatology API failed', messages: ['One of your parameters is incorrect'] };
  const r = parsePower(refused, { name: 'Moab', country: 'US', lat: 0, lng: 0 });
  assert.ok('error' in r && /parameters is incorrect/.test(r.error));
});

test('an optional value at the fill value is null, not -999', () => {
  const body = raw('agra');
  body.properties.parameter.RH2M.JUL = -999;
  const r = parsePower(body, { name: 'Agra', country: 'IN', lat: 0, lng: 0 });
  assert.ok('normals' in r);
  assert.equal(r.normals.rh2m?.[6], null);
  assert.equal(monthSummary(r.normals, 7).humidity, null);
});

// ── A month ────────────────────────────────────────────────────────────

test('a month says highs and lows in both units and rain in mm and inches', () => {
  const oct = monthSummary(RALEIGH, 10);
  assert.equal(oct.monthName, 'October');
  assert.equal(oct.highC, 22);
  assert.equal(oct.highF, 71);
  assert.ok(oct.lowC < oct.highC);
  assert.ok(oct.rainMm > 70 && oct.rainMm < 100);
  assert.equal(oct.rainIn, Math.round(oct.rainMm / 25.4 * 10) / 10);
  assert.equal(oct.label, 'mild and wet');
});

test('a desert’s wettest month is not called wet: Moab in October has some rain, not "the wettest month"', () => {
  const oct = monthSummary(MOAB, 10);
  assert.ok(oct.rainMm < 75);
  assert.equal(oct.rainPlace, null);
  assert.equal(monthSummary(MOAB, 6).rainPlace, 'the driest month');
  assert.deepEqual(wettestMonths(MOAB), []);
});

test('where the rain barely changes all year no month is called drier or wetter', () => {
  for (let m = 1; m <= 12; m++) assert.equal(monthSummary(RALEIGH, m).rainPlace, null, `month ${m}`);
});

test('the comfort rule is the one written down', () => {
  assert.equal(comfortScore({ highC: 22, lowC: 10, rainMm: 30, humidity: 50 }), 100);
  assert.equal(comfortScore({ highC: 13, lowC: 2, rainMm: 30, humidity: 50 }), 80); // 5 degrees under 18
  assert.equal(comfortScore({ highC: 30, lowC: 20, rainMm: 30, humidity: 50 }), 85); // 3 over 27
  assert.equal(comfortScore({ highC: 20, lowC: -5, rainMm: 30, humidity: 50 }), 90); // frost
  assert.equal(comfortScore({ highC: 22, lowC: 12, rainMm: 150, humidity: 50 }), 80); // 100 mm over 50
  assert.equal(comfortScore({ highC: 22, lowC: 12, rainMm: 500, humidity: 50 }), 60); // capped at 40
  assert.equal(comfortScore({ highC: 28, lowC: 22, rainMm: 30, humidity: 85 }), 80); // sticky heat
});

// ── The year ───────────────────────────────────────────────────────────

test('the desert: best weather in spring and autumn, not in its summer or winter', () => {
  assert.equal(bestMonthsLine(MOAB), 'Best weather in Moab: April–May, September–October');
});

test('the tropical wet season: Agra is best in winter and wettest July to September', () => {
  assert.equal(bestMonthsLine(AGRA), 'Best weather in Agra: November–February');
  assert.deepEqual(wettestMonths(AGRA), [7, 8, 9]);
});

test('the cold winter town: Aspen’s best weather is its summer', () => {
  assert.equal(bestMonthsLine(ASPEN), 'Best weather in Aspen: June–August');
  assert.deepEqual(bestMonths(ASPEN).scores.slice(0, 3), [0, 0, 0]);
});

test('the southern hemisphere: Cusco’s dry season is the northern summer and its wet season wraps the year', () => {
  assert.equal(bestMonthsLine(CUSCO), 'Best weather in Cusco: April–November');
  assert.deepEqual(wettestMonths(CUSCO), [1, 2, 12]);
  assert.equal(monthRanges(wettestMonths(CUSCO)), 'December–February');
});

test('months read as ranges, joined across the new year', () => {
  assert.equal(monthRanges([4, 5, 9, 10]), 'April–May, September–October');
  assert.equal(monthRanges([11, 12, 1, 2]), 'November–February');
  assert.equal(monthRanges([6, 11, 12, 1]), 'June, November–January');
  assert.equal(monthRanges([7]), 'July');
  assert.equal(monthRanges([]), '');
});

// ── A trip's dates ─────────────────────────────────────────────────────

test('nights are counted in the month of the evening they start', () => {
  assert.deepEqual(nightsByMonth('2026-09-30', '2026-10-03'), [{ month: 9, nights: 1 }, { month: 10, nights: 2 }]);
  assert.deepEqual(nightsByMonth('2026-12-30', '2027-01-02'), [{ month: 12, nights: 2 }, { month: 1, nights: 1 }]);
  assert.deepEqual(nightsByMonth('2026-10-10', '2026-10-10'), [{ month: 10, nights: 1 }]);
  assert.deepEqual(nightsByMonth('2026-10-10', null), [{ month: 10, nights: 1 }]);
  assert.deepEqual(nightsByMonth(null, '2026-10-10'), []);
  assert.deepEqual(nightsByMonth('flexible', 'flexible'), []);
});

test('a trip across two months is weighted by its nights', () => {
  const t = howIsIt(AGRA, '2026-10-28', '2026-11-04')!; // 4 October nights, 3 November
  const hi = (i: number) => AGRA.t2m[i] + AGRA.t2mRange[i] / 2;
  assert.equal(t.highC, Math.round((hi(9) * 4 + hi(10) * 3) / 7));
  assert.equal(t.when, 'October–November');
  assert.equal(t.lead.month, 10);
});

test('the card line: the reader’s unit first, and a rank only where the data backs one', () => {
  const oct = howIsIt(RINCON, '2026-10-10', '2026-10-17')!;
  assert.equal(climateLine(oct, { fahrenheitFirst: true }), 'Usually in October: highs around 84°F / 29°C, one of the wetter months');
  const jan = howIsIt(AGRA, '2027-01-10', '2027-01-15')!;
  assert.match(climateLine(jan), /^Usually in January: highs around 23°C \/ 74°F, about 12 mm \/ 0\.5 in of rain a month$/);
  const dry = howIsIt(CUSCO, '2027-07-28', '2027-08-04')!;
  assert.match(climateLine(dry), /among the drier months$/);
});

test('on high ground the line says whose averages they are', () => {
  const t = howIsIt(ASPEN, '2027-07-10', '2027-07-15')!;
  assert.ok(t.highGround);
  assert.match(climateLine(t, { fahrenheitFirst: true }), /^Usually in July on the high ground around Aspen \(3,268 m; the town is often warmer\): highs around 6\d°F/);
});

test('°F first for the US and its territories, and for an American locale; °C everywhere else', () => {
  assert.equal(fahrenheitFirst('US'), true);
  assert.equal(fahrenheitFirst('PR'), true);
  assert.equal(fahrenheitFirst('GB'), false);
  assert.equal(fahrenheitFirst(null, 'en-US'), true);
  assert.equal(fahrenheitFirst(null, 'es-MX'), false);
  assert.equal(fahrenheitFirst(null, 'en'), false);
  assert.equal(fahrenheitFirst('MX', 'en-US'), false, 'the country, when held, beats the locale');
});

test('the prompt block is data with its source, and never claims storms', () => {
  const block = climatePromptBlock(howIsIt(AGRA, '2027-08-01', '2027-08-06')!);
  assert.match(block, /NASA POWER 1981–2020 averages/);
  assert.match(block, /not a forecast/);
  assert.match(block, /among the wettest months|is one of the wettest months/);
  assert.match(block, /every day needs an indoor option/);
  assert.doesNotMatch(block.replace(/never mention storms, hurricanes, cyclones or monsoons/, ''), /storm|hurricane|cyclone|monsoon/i);
  const cold = climatePromptBlock(howIsIt(RALEIGH, '2027-01-10', '2027-01-15')!);
  assert.match(cold, /No beach, swimming or open-water day/);
  assert.match(cold, /It is cold/);
});

// ── The no-gos ─────────────────────────────────────────────────────────

test('the weather no-gos are recognised however they were stored', () => {
  assert.deepEqual(climateVetoes(['coldWeather']), { cold: true, heat: false });
  assert.deepEqual(climateVetoes(['Cold weather']), { cold: true, heat: false });
  assert.deepEqual(climateVetoes(['custom:Extreme heat']), { cold: false, heat: true });
  assert.deepEqual(climateVetoes(['hiking', 'custom:seafood']), { cold: false, heat: false });
  assert.equal(isWeatherVeto('coldWeather'), true);
  assert.equal(isWeatherVeto('Camping'), false);
});

test('a cold trip breaks the cold no-go; a mild one passes it, checked', () => {
  const jan = howIsIt(RALEIGH, '2027-01-10', '2027-01-15')!;
  assert.ok(jan.highC < COLD_HIGH_C);
  assert.deepEqual(climateBreach(jan, ['coldWeather']), { veto: 'coldWeather', checked: true, asked: true });
  const oct = howIsIt(RALEIGH, '2026-10-10', '2026-10-15')!;
  assert.deepEqual(climateBreach(oct, ['coldWeather']), { veto: null, checked: true, asked: true });
  assert.deepEqual(climateBreach(jan, ['hiking']), { veto: null, checked: false, asked: false });
});

test('extreme heat is its own no-go: Agra in May is out for somebody who hates heat, and fine for somebody who hates cold', () => {
  const may = howIsIt(AGRA, '2027-05-10', '2027-05-15')!;
  assert.equal(climateBreach(may, ['custom:Extreme heat']).veto, 'extremeHeat');
  assert.equal(climateBreach(may, ['coldWeather']).veto, null);
});

test('on high ground a cold verdict has to survive the town being warmer', () => {
  // Aspen's cell in January is -7°C: cold whatever the valley is like.
  assert.equal(climateBreach(howIsIt(ASPEN, '2027-01-10', '2027-01-15'), ['coldWeather']).veto, 'coldWeather');
  // In October the cell is 6°C and Aspen itself is milder: kept, and not claimed to pass.
  assert.deepEqual(climateBreach(howIsIt(ASPEN, '2026-10-10', '2026-10-15'), ['coldWeather']), { veto: null, checked: false, asked: true });
});

test('no climate held: kept, and never said to have passed', () => {
  const r = ideaClimate(null, 'Nowhere', { start: '2027-01-10', end: '2027-01-15' }, ['coldWeather']);
  assert.equal(r.breach, null);
  assert.deepEqual(r.climate, { place: 'Nowhere', held: false, trip: null, best: null, credit: '', asked: true, checked: false });
  assert.equal(ideaClimate(null, 'Nowhere', { start: '2027-01-10' }, []).climate, null);
});

test('no dates: the best months instead, and a weather no-go is not checked', () => {
  const r = ideaClimate(MOAB, 'Moab', { start: null, end: null }, ['coldWeather']);
  assert.equal(r.breach, null);
  assert.equal(r.climate?.trip, null);
  assert.equal(r.climate?.best, 'Best weather in Moab: April–May, September–October');
  assert.equal(r.climate?.checked, false);
});

test('a veto on the weather is never read off the words: "escape the cold weather" is not a cold trip', () => {
  assert.equal(vetoBreach('Escape the cold weather for a week of sun', ['Cold weather']), null);
  assert.equal(vetoBreach('Beat the extreme heat in the hills', ['custom:Extreme heat']), null);
  assert.equal(tripBreach({ tagline: 'Leave the cold weather behind' }, ['coldWeather', 'Cold weather']), null);
  // Everything else still is.
  assert.equal(vetoBreach('A sunrise hike', ['hiking']), 'hiking');
});

// ── The contract ───────────────────────────────────────────────────────

test('the idea’s climate survives the round trip through saved JSON, and a malformed one is dropped', () => {
  const made = ideaClimate(RINCON, 'Rincón', { start: '2026-10-10', end: '2026-10-17' }, ['coldWeather']).climate!;
  const back = ideaClimateFrom(JSON.parse(JSON.stringify(made)));
  assert.deepEqual(back, made);
  assert.equal(ideaClimateFrom({ ...made, credit: '' }), null, 'held climate without its source');
  assert.equal(ideaClimateFrom({ ...made, held: false, checked: true }), null, 'checked against nothing');
  assert.equal(ideaClimateFrom({ ...made, trip: { ...made.trip, months: [] } }), null);
  assert.equal(ideaClimateFrom(undefined), null);
});

// ── Wired where it is used ─────────────────────────────────────────────
// Each of these is a fact the app holds that must reach the next layer: the
// prompt, the idea, the saved idea, the card, the When step. Read from the
// source because the route needs a database and a model to run.

test('the trips route gives both prompts the weather and judges every idea by it', () => {
  const route = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  assert.equal((route.match(/\$\{whenLine\}\$\{climateBlock\}/g) ?? []).length, 2, 'the evening and the days both get the averages');
  assert.match(route, /DATES: .*\$\{ideasClimateBlock\}/);
  assert.match(route, /climateFor\(supabase, \{ name: t\.city \|\| t\.destination, country: t\.country_code \?\? null \}, \{ start: startDate, end: endDate \}, allVetoes\)/);
  assert.match(route, /return !j\.breach;/);
  assert.match(route, /\.climate = j\.climate;/);
});

test('the screens carry the weather: the card, the When step, the plan, and the city the days are written for', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /<IdeaClimateNote raw=\{trip\.climate\}\/>/);
  assert.match(app, /<PlaceClimate hint city=\{where\.city\}/);
  assert.match(app, /<PlaceClimate city=\{plan\.destinationCity\}/);
  assert.match(app, /tripData:\{destination:trip\.destination,vibe:trip\.vibe,costs:trip\.costs,city:trip\.city,country_code:trip\.country_code\}/);
  // "Extreme heat" is not filed as a cold no-go.
  assert.doesNotMatch(app, /"extreme heat":"coldWeather"/);
});
