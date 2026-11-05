// Forecasts: reading the sources, cutting them into days, and what may be
// said from them. The fixtures in fixtures/forecast are real answers,
// recorded 2026-11-05 at 16:18 UTC: MET Norway /complete for Moab (no rain
// chance outside the Nordic model) and Bergen (with one), and the NWS
// /points and hourly forecast for Seattle.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseMet, parseNwsHourly, parseNwsPoints, forecastDays, forecastPoint, nwsMayCover, sunTimes, setting,
  forecastPromptBlock, forecastTip, forecastUserAgent, skyFromNws, windFromNws, addDays, metMinIntervalMs,
  indoorSwaps, SOURCES, type Parsed, type Step,
} from '../../lib/forecast.ts';
import { weatherClashes, scrubWeatherTips, lineWeatherFrom, lineIsOutdoor, partFor, type GenerationForecast } from '../../lib/forecast-plan.ts';
import type { HeldDay } from '../../lib/forecast-store.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), 'utf8'));
const RECORDED = new Date('2026-11-05T16:20:00Z');
const MOAB = { lat: 38.57, lng: -109.55 };
const BERGEN = { lat: 60.39, lng: 5.32 };
const SEATTLE = { lat: 47.61, lng: -122.33 };

const met = (name: string) => parseMet(fixture(name)) as Parsed;
const nws = () => parseNwsHourly(fixture('nws-hourly-seattle.json'), 'America/Los_Angeles') as Parsed;

// ── reading the sources ──

test('MET Norway: hourly periods, then six-hourly, never two for one hour', () => {
  const p = met('met-moab.json');
  assert.equal(p.source, 'met_norway');
  assert.equal(p.updatedAt, '2026-11-05T13:17:57.000Z');
  let until = -Infinity;
  for (const s of p.steps) {
    const t = Date.parse(s.start);
    assert.ok(t >= until, `${s.start} overlaps the period before it`);
    until = t + s.hours * 3_600_000;
  }
  assert.ok(p.steps.some(s => s.hours === 1) && p.steps.some(s => s.hours === 6));
  // Outside the Nordic model MET Norway gives no chance of rain, and none is made up.
  assert.ok(p.steps.every(s => s.rainChance === null));
  assert.ok(met('met-bergen.json').steps.some(s => s.rainChance !== null));
});

test('MET Norway: an answer with nothing in it is refused, not stored as weather', () => {
  assert.ok('error' in parseMet({}));
  assert.ok('error' in parseMet({ properties: { timeseries: [{ time: '2026-11-05T16:00:00Z', data: { instant: { details: {} } } }] } }));
});

test('NWS: /points gives the hourly link and the zone, and only from their own host', () => {
  const p = parseNwsPoints(fixture('nws-points-seattle.json'));
  assert.ok(!('error' in p));
  assert.equal((p as any).hourlyUrl, 'https://api.weather.gov/gridpoints/SEW/125,68/forecast/hourly');
  assert.equal((p as any).tz, 'America/Los_Angeles');
  const evil = { properties: { forecastHourly: 'https://example.com/gridpoints/SEW/1,1/forecast/hourly' } };
  assert.ok('error' in parseNwsPoints(evil));
});

test('NWS: Celsius asked for, wind read from its words, no rain amount invented', () => {
  const p = nws();
  assert.equal(p.tz, 'America/Los_Angeles');
  assert.equal(p.steps[0].tempC, 10);
  assert.ok(p.steps.every(s => s.precipMm === null));
  assert.equal(windFromNws('10 to 15 km/h'), 4.2);
  assert.equal(windFromNws('5 mph'), 2.2);
  assert.equal(windFromNws(''), null);
  assert.equal(skyFromNws('Slight Chance Light Rain'), 'light_rain');
  assert.equal(skyFromNws('Chance Showers And Thunderstorms'), 'thunder');
  assert.equal(skyFromNws('Mostly Sunny'), 'partly_cloudy');
});

// ── days ──

test('days never run past the source\'s horizon, however far its periods go', () => {
  const days = forecastDays(met('met-moab.json'), MOAB, RECORDED);
  const today = '2026-11-05';
  assert.ok(days.length >= 8);
  assert.ok(days.every(d => d.date >= today && d.date <= addDays(today, SOURCES.met_norway.horizonDays)));
  // A model that ran forty days would still say nothing past day eight.
  const p = met('met-moab.json');
  const last = p.steps[p.steps.length - 1];
  const longer: Parsed = { ...p, steps: [...p.steps, ...Array.from({ length: 40 * 4 }, (_, i) => ({ ...last, start: new Date(Date.parse(last.start) + (i + 1) * 6 * 3_600_000).toISOString(), hours: 6 }))] };
  const far = forecastDays(longer, MOAB, RECORDED);
  assert.equal(far[far.length - 1].date, addDays(today, 8));
});

test('a day the periods do not cover is not a forecast day', () => {
  const p = met('met-moab.json');
  // Take out the afternoon of the 7th (Moab is UTC-7 by longitude).
  const holed: Parsed = { ...p, steps: p.steps.filter(s => !(s.start >= '2026-11-07T19:00:00' && s.start < '2026-11-07T22:00:00')) };
  const dates = forecastDays(holed, MOAB, RECORDED).map(d => d.date);
  assert.ok(!dates.includes('2026-11-07'));
  assert.ok(dates.includes('2026-11-06') && dates.includes('2026-11-08'));
});

test('today is what is left of it, and a part already under way is not described', () => {
  const [today] = forecastDays(met('met-moab.json'), MOAB, RECORDED);
  assert.equal(today.date, '2026-11-05');
  assert.equal(today.restOfDay, true);
  // It is 09:20 in Moab: the morning has begun, the afternoon has not.
  assert.equal(today.parts.morning, null);
  assert.ok(today.parts.afternoon);
  // Twenty past twelve: the afternoon's first hour is still to come in the
  // periods, and the afternoon is still not a whole one to describe.
  const [noon] = forecastDays(met('met-moab.json'), MOAB, new Date('2026-11-05T19:20:00Z'));
  assert.equal(noon.parts.afternoon, null);
  assert.ok(noon.parts.evening);
});

test('NWS days are cut on the place\'s own zone, and rain is said from its chance', () => {
  const days = forecastDays(nws(), SEATTLE, RECORDED);
  const fri = days.find(d => d.date === '2026-11-06');
  assert.ok(fri);
  assert.equal(fri.parts.afternoon?.rainChance, 80);
  assert.deepEqual(fri.parts.afternoon?.worries, ['rain']);
  // "Slight Chance Light Rain" at 20% is possible rain, not rain.
  assert.deepEqual(fri.parts.morning?.worries, []);
  assert.doesNotMatch(String(fri.parts.morning?.conditions), /^light rain$/);
  // With a zone, sunrise is a local clock; Seattle on 6 November, about 7:00 AM.
  assert.match(String(fri.sun.riseLocal), /^(6:5\d|7:0\d) AM$/);
  assert.equal(fri.sun.credit, 'Sunrise and sunset calculated from the date and place');
});

test('without a zone there is no sunrise clock, only the instant and the length of the day', () => {
  const [d] = forecastDays(met('met-moab.json'), MOAB, RECORDED);
  assert.equal(d.sun.riseLocal, null);
  assert.ok(d.sun.rise && d.sun.daylightHours && d.sun.daylightHours > 9 && d.sun.daylightHours < 12);
});

test('sunrise and sunset come out where the almanac has them', () => {
  // New York, 21 June 2026: sunrise 5:25 EDT, sunset 8:31 EDT.
  const s = sunTimes('2026-06-21', 40.71, -74.0);
  assert.ok(Math.abs((s.rise as number) - Date.parse('2026-06-21T09:25:00Z')) < 3 * 60_000);
  assert.ok(Math.abs((s.set as number) - Date.parse('2026-06-22T00:31:00Z')) < 3 * 60_000);
  assert.equal(sunTimes('2026-06-21', 78.2, 15.6).polar, 'day');
});

const step = (start: string, over: Partial<Step> = {}): Step => ({
  start, hours: 1, tempC: 15, maxC: null, minC: null, precipMm: 0, rainChance: null, thunderChance: null,
  windMs: 2, gustMs: null, sky: 'clear', said: 'clearsky_day', ...over,
});
/** A whole UTC day of hourly periods at longitude 0, with `over` from `from` to `to` o'clock. */
const dayOf = (day: string, from: number, to: number, over: Partial<Step>): Parsed => ({
  source: 'met_norway', updatedAt: null, tz: null,
  steps: Array.from({ length: 24 }, (_, h) => step(`${day}T${String(h).padStart(2, '0')}:00:00.000Z`, h >= from && h < to ? over : {})),
});
const AT0 = { lat: 51.5, lng: 0 };
const EARLY = new Date('2026-11-05T01:00:00Z');

test('rain with no chance given is judged on its amount', () => {
  const [d] = forecastDays(dayOf('2026-11-06', 12, 18, { precipMm: 0.6, sky: 'rain' }), AT0, EARLY);
  assert.equal(d.parts.afternoon?.precipMm, 3.6);
  assert.deepEqual(d.parts.afternoon?.worries, ['rain']);
  assert.deepEqual(d.parts.morning?.worries, []);
  const [light] = forecastDays(dayOf('2026-11-06', 12, 18, { precipMm: 0.1, sky: 'light_rain' }), AT0, EARLY);
  assert.deepEqual(light.parts.afternoon?.worries, []);
});

test('heat, wind and thunder are each their own worry', () => {
  const [hot] = forecastDays(dayOf('2026-11-06', 12, 18, { tempC: 33 }), AT0, EARLY);
  assert.deepEqual(hot.parts.afternoon?.worries, ['heat']);
  const [windy] = forecastDays(dayOf('2026-11-06', 12, 18, { gustMs: 20 }), AT0, EARLY);
  assert.deepEqual(windy.parts.afternoon?.worries, ['wind']);
  const [storm] = forecastDays(dayOf('2026-11-06', 12, 18, { sky: 'thunder', precipMm: 0.3 }), AT0, EARLY);
  assert.ok(storm.parts.afternoon?.worries.includes('storms'));
});

// ── where ──

test('a point: rounded, and never Null Island', () => {
  assert.deepEqual(forecastPoint('38.5733', '-109.5498'), { lat: 38.57, lng: -109.55 });
  assert.equal(forecastPoint(null, null), null);
  assert.equal(forecastPoint('', ''), null);
  assert.equal(forecastPoint(0, 0), null);
  assert.equal(forecastPoint(91, 0), null);
});

test('the NWS only for the US: the plan\'s country decides, the boxes only without one', () => {
  const vancouver = { lat: 49.28, lng: -123.12 };
  assert.equal(nwsMayCover(vancouver, 'CA'), false);
  assert.equal(nwsMayCover(SEATTLE, 'US'), true);
  assert.equal(nwsMayCover({ lat: 18.4, lng: -66.1 }, 'PR'), true);
  assert.equal(nwsMayCover(BERGEN, null), false);
  assert.equal(nwsMayCover(MOAB, null), true);
});

test('MET Norway outside the Nordic model is asked at most every three hours', () => {
  assert.equal(metMinIntervalMs(MOAB), 3 * 3_600_000);
  assert.ok(metMinIntervalMs(BERGEN) < 3 * 3_600_000);
});

test('the User-Agent names the app and its site, never a person', () => {
  assert.equal(forecastUserAgent({}), 'Reach/1.0 (+https://alcanzar.io)');
  assert.equal(forecastUserAgent({ FORECAST_CONTACT: 'ops@alcanzar.io' }), 'Reach/1.0 (+https://alcanzar.io; ops@alcanzar.io)');
  assert.equal(forecastUserAgent({ FORECAST_CONTACT: 'x"; DROP' }), 'Reach/1.0 (+https://alcanzar.io)');
  assert.doesNotMatch(forecastUserAgent({}), /okhttp|Dalvik|Java/);
});

// ── indoors and out ──

test('out of doors from the map\'s kind first, the line\'s words only without one', () => {
  assert.equal(setting('park'), 'outdoor');
  assert.equal(setting('nature reserve'), 'outdoor');
  assert.equal(setting('museum', 'a walk round the museum garden'), 'indoor');
  assert.equal(setting(null, 'Hike the Delicate Arch trail'), 'outdoor');
  assert.equal(setting(null, 'Walk through the museum'), null);
  assert.equal(setting('pharmacy', 'hike'), null);
  assert.deepEqual(indoorSwaps([{ kind: 'museum' }, { kind: 'restaurant' }, { kind: 'park' }, { kind: 'cinema' }]).map(p => p.kind), ['museum', 'cinema']);
});

// ── the prompt and the read-back ──

const held = (p: Parsed, at: { lat: number; lng: number }, now: Date): HeldDay[] =>
  forecastDays(p, at, now).map(d => ({ ...d, fetchedAt: '2026-11-05T16:18:00.000Z' }));
const genFc = (days: HeldDay[]): GenerationForecast => ({
  byDate: new Map(days.map(d => [d.date, d])),
  prompt: days.map((day, i) => ({ label: `Day ${i + 1} (${day.date})`, day, fetchedAt: day.fetchedAt })),
});

test('the prompt lists only the days held, says whose forecast and when, and offers only menu indoor places', () => {
  const days = held(nws(), SEATTLE, RECORDED).filter(d => d.date === '2026-11-06');
  const block = forecastPromptBlock(genFc(days).prompt, [{ ref: 'p3', name: 'Seattle Art Museum', kind: 'museum' }]);
  assert.match(block, /^FORECAST \(weather\.gov, fetched 5 Nov, 16:18 UTC/);
  assert.match(block, /Day 1 \(2026-11-06\)/);
  assert.doesNotMatch(block, /2026-11-07/);
  assert.match(block, /afternoon: [^;]*RAIN LIKELY/);
  assert.match(block, /\[p3\] Seattle Art Museum \(museum\)/);
  assert.equal(forecastPromptBlock([]), '');
});

test('a tip stating a forecast loses the tip, held or not: saved, it would carry no source and go stale', () => {
  assert.equal(forecastTip('Rain is forecast this afternoon, bring a jacket'), true);
  assert.equal(forecastTip('It will be hot by noon'), true);
  assert.equal(forecastTip('Rain is likely after lunch, so the gallery first'), true);
  assert.equal(forecastTip('Bring water and go early'), false);
  assert.equal(forecastTip('Arrive before the lunch rush'), false);
  // Friday's afternoon really is rain likely — the tip still goes: written on
  // the 5th, it is the line's subtitle on the 8th, with nothing behind it.
  const days = [{
    day: 1, afternoon: { plan: 'Pike Place', tip: 'Showers are forecast after lunch' }, morning: { plan: 'x', tip: 'Rain is forecast' },
    evening: { plan: 'Dinner', tip: 'Book the window table' },
    daytime: [{ plan: 'Hike the Rattlesnake Ledge trail', tip: 'Rain is forecast, so go early' }],
  }];
  assert.equal(scrubWeatherTips(days), 3);
  assert.equal(days[0].afternoon.tip, '');
  assert.equal(days[0].morning.tip, '');
  assert.equal(days[0].daytime[0].tip, '');
  assert.equal(days[0].evening.tip, 'Book the window table');
});

test('the prompt asks for no forecast in the answer, and tells a night out which parts its stops are', () => {
  const days = held(nws(), SEATTLE, RECORDED).filter(d => d.date === '2026-11-06');
  const block = forecastPromptBlock(genFc(days).prompt);
  assert.match(block, /Never mention the weather forecast in a tip/);
  assert.doesNotMatch(block, /You may say in a tip/);
  assert.match(block, /daytime 8:00-20:00 overall: [^;]*RAIN LIKELY/);
  assert.doesNotMatch(block, /one evening out/);
  assert.match(forecastPromptBlock(genFc(days).prompt, [], { night: true }), /judge every one of them by the forecast evening/);
});

test('an outdoor stop in a spoiled part of a day is a clash; an indoor one is not', () => {
  const [fri] = held(nws(), SEATTLE, RECORDED).filter(d => d.date === '2026-11-06');
  const days = [{ day: 1, morning: { plan: 'Coffee', kind: 'cafe' }, afternoon: { plan: 'Discovery Park loop', kind: 'park' }, evening: { plan: 'Dinner', kind: 'restaurant' } }];
  const c = weatherClashes(days, '2026-11-06', genFc([fri]));
  assert.equal(c.length, 1);
  assert.equal(c[0].part, 'afternoon');
  assert.deepEqual(c[0].worries, ['rain']);
  assert.equal(weatherClashes([{ ...days[0], afternoon: { plan: 'Seattle Art Museum', kind: 'museum' } }], '2026-11-06', genFc([fri])).length, 0);
  assert.equal(weatherClashes(days, '2026-11-06', null).length, 0);
});

test('a line\'s verdict: outdoors, in a spoiled part, with the source behind it', () => {
  const [fri] = held(nws(), SEATTLE, RECORDED).filter(d => d.date === '2026-11-06');
  const v = lineWeatherFrom({ time: 'Day 2 · Afternoon', title: 'Discovery Park loop', kind: 'park' }, fri, false);
  assert.equal(v?.headline, 'Rain likely (80%)');
  assert.equal(v?.source.name, 'weather.gov');
  assert.equal(lineWeatherFrom({ time: 'Day 2 · Afternoon', title: 'Seattle Art Museum', kind: 'museum' }, fri, false), null);
  assert.equal(lineWeatherFrom({ time: 'Day 2 · Morning', title: 'Discovery Park loop', kind: 'park' }, fri, false), null);
});

// ── review fixes, 2026-11-05 ──

test('a night out\'s stops are judged by the forecast evening, its daytime ideas by the day', () => {
  // Synthetic day at longitude 0: a wet morning, a dry evening.
  const wetMorning = held(dayOf('2026-11-06', 6, 12, { precipMm: 1, sky: 'rain' }), AT0, EARLY);
  const evening = [{ day: 1, morning: { plan: 'Pints at the Biergarten', kind: 'biergarten' }, afternoon: { plan: 'The gig', kind: 'music venue' }, evening: { plan: 'Dessert', kind: 'cafe' } }];
  // "To start" is a 6pm drink: the wet morning is nothing to it.
  assert.deepEqual(weatherClashes(evening, '2026-11-06', genFc(wetMorning), true), []);
  // A wet evening is — and it is said as the evening, the slot as "morning".
  const wetEvening = held(dayOf('2026-11-06', 18, 24, { precipMm: 1, sky: 'rain' }), AT0, EARLY);
  const c = weatherClashes(evening, '2026-11-06', genFc(wetEvening), true);
  assert.equal(c.length, 1);
  assert.equal(c[0].slot, 'morning');
  assert.equal(c[0].part, 'evening');
  // The daytime ideas are checked, against the day's own verdict.
  const wetAfternoon = held(dayOf('2026-11-06', 12, 18, { precipMm: 1, sky: 'rain' }), AT0, EARLY);
  const withDay = [{ ...evening[0], daytime: [{ plan: 'Museum first', kind: 'museum' }, { plan: 'Hike the ridge trail', kind: null }] }];
  const d = weatherClashes(withDay, '2026-11-06', genFc(wetAfternoon), true);
  assert.deepEqual(d.map(x => [x.slot, x.index, x.part]), [['daytime', 1, 'day']]);
  // A trip's slots are still their own parts.
  const trip = weatherClashes([{ day: 1, afternoon: { plan: 'Park loop', kind: 'park' } }], '2026-11-06', genFc(wetAfternoon));
  assert.deepEqual(trip.map(x => [x.slot, x.part]), [['afternoon', 'afternoon']]);
});

test('a meal is never outdoors because of its name; only the venue\'s kind says so', () => {
  for (const name of ['Dinner at Olive Garden', 'Lunch at Park Tavern', 'Drinks at The Beach House', 'Coffee at Trailhead Coffee']) {
    assert.equal(setting(null, name), null, name);
    assert.equal(lineIsOutdoor({ title: name, type: 'restaurant', kind: null }), false, name);
  }
  // A meal line whose title is the bare name: its type says it is a meal.
  assert.equal(setting(null, 'Olive Garden'), 'outdoor');
  assert.equal(lineIsOutdoor({ title: 'Olive Garden', type: 'restaurant', kind: null }), false);
  assert.equal(lineIsOutdoor({ title: 'Lunch at the biergarten', type: 'restaurant', kind: 'biergarten' }), true);
  assert.equal(lineIsOutdoor({ title: 'Hike the Delicate Arch trail', type: 'activity', kind: null }), true);
  // A restaurant line with no kind, in a forecast downpour: no verdict, no ping.
  const [fri] = held(nws(), SEATTLE, RECORDED).filter(x => x.date === '2026-11-06');
  assert.equal(lineWeatherFrom({ time: 'Day 2 · Afternoon', title: 'Lunch at Park Tavern', type: 'restaurant' }, fri, false), null);
});

test('a line that only names its day is said with the figure from the hours that raised the worry', () => {
  // Seattle, 7 November: 61% through the daytime, 96% only from 10pm.
  const sat = held(nws(), SEATTLE, RECORDED).find(x => x.date === '2026-11-07') as HeldDay;
  const v = lineWeatherFrom({ time: 'Day 3', title: 'Hike Discovery Park trail' }, sat, false);
  assert.equal(v?.headline, 'Rain likely (61%)');
  assert.equal(partFor(sat, 'day')?.rainChance, 61);
  assert.deepEqual(sat.verdictHours, [8, 20]);
  // The day's figures and its verdict agree everywhere: no rain likely beside a dry verdict.
  for (const d of held(nws(), SEATTLE, RECORDED)) {
    if (d.verdictHours && d.rainChance !== null) assert.equal(d.worries.includes('rain'), d.rainChance >= 60, d.date);
  }
});

test('a six-hour max or min counts only for a part that holds most of its hours', () => {
  // Moab, recorded: from the 8th the periods are six-hourly. The step that
  // covers the morning peaks at 12.2; the 11:00-17:00 step\'s 14.9 is the afternoon\'s.
  const days = forecastDays(met('met-moab.json'), MOAB, RECORDED);
  const sun = days.find(d => d.date === '2026-11-08');
  assert.equal(sun?.parts.morning?.highC, 12);
  assert.equal(sun?.parts.afternoon?.highC, 15);
  // A July afternoon step of 38: the morning that touches one hour of it is not VERY HOT.
  const hot: Parsed = {
    source: 'met_norway', updatedAt: null, tz: null,
    steps: ['00', '06', '12', '18'].flatMap(h => [
      step(`2026-07-10T${h}:00:00.000Z`, { hours: 6, tempC: h === '12' ? 30 : 20, maxC: h === '12' ? 38 : h === '06' ? 26 : 22, minC: h === '00' ? 18 : 21 }),
    ]).concat(['00', '06', '12', '18'].map(h => step(`2026-07-11T${h}:00:00.000Z`, { hours: 6, tempC: 20, maxC: 22, minC: 18 }))),
  };
  // Longitude -15: an hour behind, so the hot 12Z step is 11:00-17:00 local
  // and touches one hour of the morning; the 06Z one is 05:00-11:00.
  const [d] = forecastDays(hot, { lat: 38, lng: -15 }, new Date('2026-07-09T12:00:00Z'));
  assert.equal(d.date, '2026-07-10');
  // 30 is the hot step's own reading at 11:00, inside the morning; its 38 is not.
  assert.equal(d.parts.morning?.highC, 30);
  assert.ok(!d.parts.morning?.worries.includes('heat'));
  assert.ok(d.parts.afternoon?.worries.includes('heat'));
});
