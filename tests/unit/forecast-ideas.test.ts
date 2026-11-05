// The forecast on the three trip options: an option built around being out of
// doors, on days the forecast spoils, says so with its source — or goes, when
// every day it covers is forecast and spoiled and something else is left.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  outdoorsLed, ideaForecastFrom, washedOut, dropSpoiled, scrubIdeaWeather, optionsForecastBlock,
  optionDates, ideaForecasts, spoilers,
} from '../../lib/forecast-ideas.ts';
import { forgetPickForecasts } from '../../lib/recommendations/pick-weather.ts';
import { TripsSchema, TRIPS_JSON_SCHEMA } from '../../lib/trip-schema.ts';
import type { ForecastPart, Worry } from '../../lib/forecast.ts';
import type { HeldDay, PlaceForecast } from '../../lib/forecast-store.ts';

const part = (worries: Worry[] = [], over: Partial<ForecastPart> = {}): ForecastPart => ({
  highC: 18, lowC: 9, highF: 64, lowF: 48, rainChance: worries.includes('rain') ? 70 : 10, precipMm: null,
  windMs: 3, gustMs: 6, sky: worries.includes('rain') ? 'rain' : 'clear', conditions: null, worries, ...over,
});
const day = (date: string, worries: Worry[] = [], evening: Worry[] | null = [], source: 'met_norway' | 'nws' = 'nws', over: Partial<ForecastPart> = {}): HeldDay => ({
  ...part(worries, over), date, source, restOfDay: false, verdictHours: [8, 20],
  parts: { morning: part(), afternoon: part(), evening: evening === null ? null : part(evening) },
  sun: { rise: null, set: null, riseLocal: null, setLocal: null, daylightHours: null, polar: null, credit: 'x' },
  fetchedAt: '2026-11-05T16:18:00Z',
});

const BEACH = { destination: 'Gulf Shores, AL', city: 'Gulf Shores', country_code: 'US', setting: 'outdoors', costs: { activities: { details: 'Beach days and a dolphin cruise' } } };
const MUSEUMS = { destination: 'Chicago, IL', city: 'Chicago', country_code: 'US', setting: 'indoors', costs: { activities: { details: 'Art Institute and a comedy show' } } };
const WEEKEND = ['2026-11-07', '2026-11-08'];

test('outdoors-led from what the plan says it is built around, else from its own words — never a meal', () => {
  assert.equal(outdoorsLed(BEACH), true);
  assert.equal(outdoorsLed(MUSEUMS), false);
  assert.equal(outdoorsLed({ ...BEACH, setting: 'mixed' }), false);
  assert.equal(outdoorsLed({ costs: { activities: { details: 'Hike the canyon trails' } } }), true);
  assert.equal(outdoorsLed({ costs: { activities: { details: 'Dinner at Olive Garden' } } }), false);
  assert.equal(outdoorsLed({ vibe: 'Beach and sun' }), true);
});

test('a rainy Saturday on a beach weekend: said, with the day, the figure and the source', () => {
  const f = ideaForecastFrom(BEACH, [day('2026-11-07', ['rain']), day('2026-11-08')], WEEKEND, { today: '2026-11-05' });
  assert.ok(f);
  assert.equal(f.line, 'Rain likely Sat 7 Nov (70%) — this option is built around being outdoors.');
  assert.equal(f.label, 'Forecast');
  assert.match(f.sources[0].credit, /National Weather Service/);
  assert.equal(f.fetchedAt, '2026-11-05T16:18:00Z');
  assert.equal(washedOut(f), false, 'Sunday is clear: flagged, not dropped');
});

test('an indoor option, a fine forecast, a day not held, snow on a ski trip: nothing', () => {
  assert.equal(ideaForecastFrom(MUSEUMS, [day('2026-11-07', ['rain'])], WEEKEND), null);
  assert.equal(ideaForecastFrom(BEACH, [day('2026-11-07'), day('2026-11-08')], WEEKEND), null);
  assert.equal(ideaForecastFrom(BEACH, [day('2026-11-20', ['rain'])], WEEKEND), null);
  assert.equal(ideaForecastFrom({ ...BEACH, setting: 'outdoors' }, [day('2026-11-07', ['snow'])], WEEKEND), null);
});

test('heat counts only past the extremely-hot line: 33 °C is a beach day, 36 °C is not', () => {
  assert.deepEqual(spoilers(part(['heat'], { highC: 33, highF: 91 })), []);
  assert.deepEqual(spoilers(part(['heat'], { highC: 36, highF: 97 })), ['heat']);
  const f = ideaForecastFrom(BEACH, [day('2026-11-07', ['heat'], [], 'nws', { highC: 36, highF: 97 })], ['2026-11-07']);
  assert.match(String(f?.line), /^Very hot Sat 7 Nov \(97°F \/ 36°C\)/);
});

test('a night out reads the evening, not the day', () => {
  const night = { ...BEACH, setting: 'outdoors' };
  assert.equal(ideaForecastFrom(night, [day('2026-11-05', ['rain'], [])], ['2026-11-05'], { night: true, today: '2026-11-05' }), null);
  const f = ideaForecastFrom(night, [day('2026-11-05', [], ['storms'])], ['2026-11-05'], { night: true, today: '2026-11-05' });
  assert.equal(f?.line, 'Thunderstorms possible this evening — this evening is built around being outdoors.');
});

test('every day held and spoiled is washed out, and dropped — unless every option is', () => {
  const wet = ideaForecastFrom(BEACH, [day('2026-11-07', ['rain']), day('2026-11-08', ['storms'])], WEEKEND);
  assert.ok(washedOut(wet));
  const partly = ideaForecastFrom(BEACH, [day('2026-11-07', ['rain'])], WEEKEND);
  assert.equal(washedOut(partly), false, 'Sunday not held: not known to be spoiled');
  const r = dropSpoiled(['beach', 'museums'], [wet, null]);
  assert.deepEqual(r.kept, ['museums']);
  assert.deepEqual(r.dropped, ['beach']);
  const all = dropSpoiled(['a', 'b'], [wet, wet]);
  assert.deepEqual(all.kept, ['a', 'b'], 'never an empty list');
});

test('more than two spoiled days are counted, not listed', () => {
  const dates = ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'];
  const f = ideaForecastFrom(BEACH, [day(dates[0], ['rain']), day(dates[1], ['storms']), day(dates[2], ['rain']), day(dates[3])], dates);
  assert.equal(f?.line, 'Rain or thunderstorms forecast on 3 of the 4 days the forecast reaches — this option is built around being outdoors.');
});

test('a line stating the weather is taken out of an option; the option stays', () => {
  const t: Record<string, unknown> = { tagline: 'Sunny skies — it will be dry all weekend', why_this_group: 'Your love of tacos', used_suggestions: ['Rain is expected Sunday, so museums', 'The beach you asked for'] };
  assert.equal(scrubIdeaWeather(t), 2);
  assert.equal(t.tagline, '');
  assert.equal(t.why_this_group, 'Your love of tacos');
  assert.deepEqual(t.used_suggestions, ['The beach you asked for']);
});

test('the prompt gets only the days held, with source and time, and the rule only when something is spoiled', () => {
  const fine = optionsForecastBlock('Gulf Shores', [day('2026-11-07')]);
  assert.match(fine, /FORECAST FOR GULF SHORES \(weather\.gov, fetched 5 Nov, 16:18 UTC/);
  assert.match(fine, /Sat 7 Nov \(2026-11-07\)/);
  assert.doesNotMatch(fine, /do not build an option/);
  assert.match(fine, /Never mention the weather/);
  const wet = optionsForecastBlock('Gulf Shores', [day('2026-11-07', ['rain'])]);
  assert.match(wet, /RAIN LIKELY/);
  assert.match(wet, /do not build an option around being out of doors/);
  assert.equal(optionsForecastBlock('Gulf Shores', []), '');
  const night = optionsForecastBlock('Charlotte', [day('2026-11-05', [], ['rain'])], { night: true });
  assert.match(night, /evening: .*RAIN LIKELY/);
  assert.match(night, /rooftop, beer garden/);
});

test('an option\'s dates: a trip start to end, an evening its one date', () => {
  assert.deepEqual(optionDates('2026-11-07', '2026-11-09', false), ['2026-11-07', '2026-11-08', '2026-11-09']);
  assert.deepEqual(optionDates('2026-11-07', '2026-11-09', true), ['2026-11-07']);
  assert.deepEqual(optionDates(null, null, false), []);
});

test('reading: dates past the horizon look nothing up; a slow or failed source costs the line, never the options', async () => {
  forgetPickForecasts();
  const now = new Date('2026-11-05T15:00:00Z');
  let looked = 0;
  const locate = async () => { looked++; return { lat: 30.25, lng: -87.7 }; };
  const far = await ideaForecasts({} as never, [BEACH], { start: '2026-12-20', end: '2026-12-22' }, { now, locate, read: async () => ({ available: true, days: [] }) });
  assert.deepEqual(far, [null]);
  assert.equal(looked, 0, 'no geocoding for a trip the forecast cannot see');

  const read = async (): Promise<PlaceForecast> => ({ available: true, days: [day('2026-11-07', ['rain']), day('2026-11-08', ['rain'])] });
  const got = await ideaForecasts({} as never, [BEACH, MUSEUMS], { start: '2026-11-07', end: '2026-11-08' }, { now, locate, read });
  assert.ok(washedOut(got[0]));
  assert.equal(got[1], null, 'an indoor option is not even looked up');
  assert.equal(looked, 1);

  forgetPickForecasts();
  const slow = await ideaForecasts({} as never, [BEACH], { start: '2026-11-07', end: '2026-11-08' },
    { now, locate, deadlineMs: 20, read: () => new Promise(r => setTimeout(() => r({ available: true, days: [day('2026-11-07', ['rain'])] }), 200)) });
  assert.deepEqual(slow, [null]);
  forgetPickForecasts();
  const broken = await ideaForecasts({} as never, [BEACH], { start: '2026-11-07', end: '2026-11-08' },
    { now, locate: async () => { throw new Error('nominatim down'); }, read });
  assert.deepEqual(broken, [null]);
});

test('the model is asked what each option is built around, and an answer without it still parses', () => {
  const item = (TRIPS_JSON_SCHEMA as any).properties.trips.items;
  assert.deepEqual(item.properties.setting.enum, ['outdoors', 'indoors', 'mixed']);
  assert.ok(item.required.includes('setting'));
  const shape = (TripsSchema.shape.trips.element as any).shape;
  assert.ok(shape.setting.safeParse(null).success);
  assert.ok(!shape.setting.safeParse('beach').success);
});
