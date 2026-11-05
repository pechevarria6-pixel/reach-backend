// The forecast on Home's recommended trips: a pick out of doors on a spoiled
// evening or weekend says so, with its source; nothing else says anything.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowFor, pickForecastLine, forecastPicks, forgetPickForecasts } from '../../lib/recommendations/pick-weather.ts';
import { weatherBasis, interestSetting, tally, scoreOf, type Holdings, type WeatherBasis } from '../../lib/recommendations/trip-picks.ts';
import { picksFrom } from '../../lib/contracts/trip-pick.ts';
import type { ForecastPart, Worry } from '../../lib/forecast.ts';
import type { HeldDay } from '../../lib/forecast-store.ts';

const part = (worries: Worry[] = [], over: Partial<ForecastPart> = {}): ForecastPart => ({
  highC: 18, lowC: 9, highF: 64, lowF: 48, rainChance: worries.includes('rain') ? 70 : 10, precipMm: null,
  windMs: 3, gustMs: 6, sky: worries.includes('rain') ? 'rain' : 'clear', conditions: null, worries, ...over,
});
const day = (date: string, worries: Worry[] = [], evening: Worry[] | null = [], source: 'met_norway' | 'nws' = 'nws'): HeldDay => ({
  ...part(worries), date, source, restOfDay: false, verdictHours: [8, 20],
  parts: { morning: part(), afternoon: part(), evening: evening === null ? null : part(evening) },
  sun: { rise: null, set: null, riseLocal: null, setLocal: null, daylightHours: null, polar: null, credit: 'x' },
  fetchedAt: '2026-11-05T16:18:00Z',
});

const OUTDOOR: WeatherBasis = { name: 'Asheville', at: { lat: 35.6, lng: -82.55 }, outdoor: 'outdoors', outdoorWords: 'the outdoors', indoor: ['breweries', 'museums'] };
// Thursday 5 November 2026: the weekend is the 7th and 8th.
const THU = '2026-11-05';

test('the dates a card means: tonight, or the coming Saturday and Sunday', () => {
  assert.deepEqual(windowFor('night', THU), [THU]);
  assert.deepEqual(windowFor('weekend', THU), ['2026-11-07', '2026-11-08']);
  assert.deepEqual(windowFor('weekend', '2026-11-07'), ['2026-11-07', '2026-11-08']);
  assert.deepEqual(windowFor('weekend', '2026-11-08'), ['2026-11-08']);
  assert.deepEqual(windowFor('away', THU), []);
});

test('a rainy Saturday on an outdoor weekend: said, with the day, the figure, the indoor things held and the source', () => {
  const f = pickForecastLine('weekend', OUTDOOR, [day('2026-11-07', ['rain']), day('2026-11-08')], THU, { country: 'US' });
  assert.ok(f);
  assert.equal(f.line, "Rain likely Saturday (70%) — Asheville's breweries and museums instead?");
  assert.equal(f.label, 'Forecast');
  assert.match(f.sources[0].credit, /National Weather Service/);
  assert.equal(f.fetchedAt, '2026-11-05T16:18:00Z');
});

test('both days, and two sources, are each said and each credited', () => {
  const f = pickForecastLine('weekend', OUTDOOR, [day('2026-11-07', ['rain']), day('2026-11-08', ['storms'], [], 'met_norway')], THU);
  assert.ok(f);
  assert.match(f.line, /^Rain likely Saturday \(70%\), thunderstorms possible Sunday — /);
  assert.deepEqual(f.sources.map(s => s.name).sort(), ['MET Norway', 'weather.gov']);
});

test('a fine weekend, an indoor pick, a day not held, a trip further away: no line', () => {
  assert.equal(pickForecastLine('weekend', OUTDOOR, [day('2026-11-07'), day('2026-11-08')], THU), null);
  assert.equal(pickForecastLine('weekend', { ...OUTDOOR, outdoor: null }, [day('2026-11-07', ['rain'])], THU), null);
  assert.equal(pickForecastLine('weekend', OUTDOOR, [day('2026-11-09', ['rain'])], THU), null);
  assert.equal(pickForecastLine('away', OUTDOOR, [day(THU, ['rain'])], THU), null);
});

test('a night out reads the evening, not the day — and an evening not described says nothing', () => {
  const wetDay = pickForecastLine('night', OUTDOOR, [day(THU, ['rain'], [])], THU);
  assert.equal(wetDay, null);
  const wetNight = pickForecastLine('night', OUTDOOR, [day(THU, [], ['rain'])], THU);
  assert.match(String(wetNight?.line), /^Rain likely this evening \(70%\)/);
  assert.equal(pickForecastLine('night', OUTDOOR, [day(THU, ['rain'], null)], THU), null);
});

test('nothing indoors held: the line says what the pick is, and suggests nothing it cannot back', () => {
  const f = pickForecastLine('weekend', { ...OUTDOOR, indoor: [] }, [day('2026-11-07', ['rain'])], THU);
  assert.equal(f?.line, 'Rain likely Saturday (70%) — and this one is mostly the outdoors.');
});

test('heat is said in the units of the place', () => {
  const hot = { ...day('2026-11-07', ['heat']), highC: 34, highF: 93 };
  assert.match(String(pickForecastLine('weekend', OUTDOOR, [hot], THU, { country: 'US' })?.line), /Very hot Saturday \(93°F \/ 34°C\)/);
  assert.match(String(pickForecastLine('weekend', OUTDOOR, [hot], THU, { country: 'FR' })?.line), /Very hot Saturday \(34°C \/ 93°F\)/);
});

// ── what makes a pick a weather pick: the rows ──

const H = (counts: Record<string, number>): Holdings => ({ counts, floor: false });
const shown = { name: 'Asheville', label: 'Asheville, North Carolina', lat: 35.6, lng: -82.55 };

test('an interest is outdoors by its rows\' kinds; one with no kinds is outdoors only if it is the outdoors', () => {
  assert.equal(interestSetting(H({ 'outdoors|park': 30, 'outdoors|museum': 2 }), 'outdoors'), 'outdoor');
  assert.equal(interestSetting(H({ 'outdoors|': 12 }), 'outdoors'), 'outdoor');
  assert.equal(interestSetting(H({ 'breweries|brewery': 9, 'breweries|biergarten': 2 }), 'breweries'), 'indoor');
  assert.equal(interestSetting(H({ 'breweries|biergarten': 9, 'breweries|brewery': 2 }), 'breweries'), 'outdoor');
  assert.equal(interestSetting(H({ 'live music|': 9 }), 'live music'), null);
});

test('a pick led by the outdoors is a weather pick; one led by museums, or by nothing they said, is not', () => {
  const h = H({ 'places to eat|restaurant': 40, 'outdoors|park': 30, 'breweries|brewery': 12, 'museums & history|museum': 8, 'live music|music venue': 5 });
  const t = tally(h, [], false);
  const out = weatherBasis({ band: 'weekend', h, t, asked: ['places to eat', 'outdoors', 'breweries'], shown }, []);
  assert.equal(out.outdoor, 'outdoors');
  assert.deepEqual(out.indoor, ['breweries', 'museums']);
  assert.equal(weatherBasis({ band: 'weekend', h, t, asked: ['museums & history', 'outdoors'], shown }, []).outdoor, null);
  assert.equal(weatherBasis({ band: 'weekend', h, t, asked: [], shown }, []).outdoor, null);
});

test('what the pick is for is the order they said it, not how many parks the map holds', () => {
  // Parks outnumber everything almost everywhere, so how much is held puts
  // the outdoors first in `matched` for anybody who ticked it at all. A night
  // out for somebody who said live music and cocktail bars first is not a
  // night in the parks, and its rain line must not offer its own contents
  // back as the alternative.
  const h = H({ 'live music|music venue': 12, 'cocktail bars|bar': 8, 'outdoors|park': 400 });
  const t = tally(h, [], false);
  const durham = { key: 'durham|us', name: 'Durham', country: 'US', label: 'Durham, North Carolina', lat: 35.99, lng: -78.9 };
  const lean = { primary: null, secondary: null, dials: {} };
  const night = scoreOf(t, durham, 'night', 20, ['live music', 'cocktail bars', 'outdoors'], [], lean);
  assert.equal(night.matched[0], 'outdoors');
  assert.deepEqual(night.asked, ['live music', 'cocktail bars', 'outdoors']);
  const at = { name: 'Durham', label: durham.label, lat: durham.lat, lng: durham.lng };
  assert.equal(weatherBasis({ band: 'night', h, t, asked: night.asked, shown: at }, []).outdoor, null);
  // A weekend for somebody who said museums first and the outdoors last.
  const hw = H({ 'museums & history|museum': 9, 'breweries|brewery': 6, 'outdoors|park': 400 });
  const tw = tally(hw, [], false);
  const weekend = scoreOf(tw, durham, 'weekend', 120, ['museums & history', 'breweries', 'outdoors'], [], lean);
  assert.equal(weatherBasis({ band: 'weekend', h: hw, t: tw, asked: weekend.asked, shown: at }, []).outdoor, null);
  // Somebody who said the outdoors first is still read as an outdoor pick,
  // and offered what else they said before what the town merely holds.
  const keen = scoreOf(tw, durham, 'weekend', 120, ['outdoors', 'breweries'], [], lean);
  const b = weatherBasis({ band: 'weekend', h: hw, t: tw, asked: keen.asked, shown: at }, []);
  assert.equal(b.outdoor, 'outdoors');
  assert.deepEqual(b.indoor, ['breweries', 'museums']);
  // A member's interest comes after every one of the reader's own.
  assert.deepEqual(scoreOf(tw, durham, 'weekend', 120, ['breweries'], ['outdoors'], lean).asked, ['breweries', 'outdoors']);
});

test('a night out is offered only what is open at night, and nothing a no-go rules out', () => {
  const h = H({ 'outdoors|park': 30, 'museums & history|museum': 20, 'live music|music venue': 5, 'breweries|brewery': 12 });
  const t = tally(h, [], false);
  const night = weatherBasis({ band: 'night', h, t, asked: ['outdoors'], shown }, []);
  assert.ok(!night.indoor.includes('museums'));
  assert.deepEqual(night.indoor, ['breweries', 'live music']);
  const vetoed = weatherBasis({ band: 'weekend', h, t, asked: ['outdoors'], shown }, ['breweries']);
  assert.ok(!vetoed.indoor.includes('breweries'));
});

// ── reading it ──

test('only an outdoor night or weekend is read; a slow read costs the card its line, never Home its cards', async () => {
  forgetPickForecasts();
  let reads = 0;
  const picks = [
    { band: 'weekend' as const, basis: OUTDOOR, destination: { country: 'US' } },
    { band: 'weekend' as const, basis: { ...OUTDOOR, outdoor: null }, destination: { country: 'US' } },
    { band: 'away' as const, basis: OUTDOOR, destination: { country: 'US' } },
  ];
  const now = new Date('2026-11-05T16:20:00Z');
  const out = await forecastPicks({} as never, picks, {
    now, read: async () => { reads++; return { available: true, days: [day('2026-11-07', ['rain'])] }; },
  });
  assert.equal(reads, 1);
  assert.match(String(out[0].forecast?.line), /Rain likely Saturday/);
  assert.equal(out[1].forecast, null);
  assert.equal(out[2].forecast, null);
  // Kept: Home opening again is not a second read.
  await forecastPicks({} as never, picks.slice(0, 1), { now, read: async () => { reads++; return { available: true, days: [] }; } });
  assert.equal(reads, 1);

  forgetPickForecasts();
  const started = Date.now();
  const slow = await forecastPicks({} as never, picks.slice(0, 1), { now, deadlineMs: 50, read: () => new Promise(() => {}) });
  assert.equal(slow[0].forecast, null);
  assert.ok(Date.now() - started < 1000);
  forgetPickForecasts();
});

test('the forecast line reaches the card through the contract, and a line with no credit does not', () => {
  const f = pickForecastLine('weekend', OUTDOOR, [day('2026-11-07', ['rain'])], THU)!;
  const card = {
    ref: 'trip:asheville|US', band: 'weekend', planType: 'weekend', destination: { city: 'Asheville, North Carolina', country: 'US', label: 'Asheville, North Carolina' },
    site: null, nights: 2, miles: 220, title: 'A weekend in Asheville', who: 'For you', held: "209 places to eat we've checked",
    matched: null, leftOut: null, unchecked: null, howFar: '220 miles', cost: { low: 1, high: 2, each: false, label: 'Estimate' },
    cta: 'Plan the weekend →', groupId: null, score: 1,
  };
  assert.deepEqual(picksFrom({ picks: [{ ...card, forecast: f }], reason: null }).picks[0].forecast, f);
  assert.equal(picksFrom({ picks: [{ ...card, forecast: { ...f, sources: [] } }], reason: null }).picks.length, 0);
});
