// Discover on a spoiled evening or weekend: a place the map says is out in
// the open goes down, one under a roof goes up its ring, each saying why with
// the forecast's source. A fine or unknown forecast changes nothing.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingSetting, weatherRanked, discoverDates, discoverForecast } from '../../lib/discovery/weather.ts';
import { forgetPickForecasts } from '../../lib/recommendations/pick-weather.ts';
import { visitTagsOf } from '../../lib/discovery/osm.ts';
import type { Finding } from '../../lib/discovery/types.ts';
import type { ForecastPart, Worry } from '../../lib/forecast.ts';
import type { HeldDay } from '../../lib/forecast-store.ts';

const part = (worries: Worry[] = []): ForecastPart => ({
  highC: 18, lowC: 9, highF: 64, lowF: 48, rainChance: worries.includes('rain') ? 70 : 10, precipMm: null,
  windMs: 3, gustMs: 6, sky: worries.includes('rain') ? 'rain' : 'clear', conditions: null, worries,
});
const day = (date: string, worries: Worry[] = [], evening: Worry[] | null = []): HeldDay => ({
  ...part(worries), date, source: 'met_norway', restOfDay: false, verdictHours: [8, 20],
  parts: { morning: part(), afternoon: part(), evening: evening === null ? null : part(evening) },
  sun: { rise: null, set: null, riseLocal: null, setLocal: null, daylightHours: null, polar: null, credit: 'x' },
  fetchedAt: '2026-11-05T16:18:00Z',
});

const HERE = { lat: 35.6, lng: -82.55 };
const f = (id: string, kind: string | null, over: Partial<Finding> = {}): Finding => ({
  id, title: id, meta: '', emoji: '', price: null, dist: '1 mi', category: 'x', url: 'https://x', date: null,
  venue: null, source: 'osm', because: null, kind, ...over,
});
// Thursday 5 November 2026.
const THU = '2026-11-05';

test('out in the open or under a roof, from the map — never from the name', () => {
  assert.equal(findingSetting(f('Bavarian Biergarten', 'biergarten')), 'open');
  assert.equal(findingSetting(f('Riverside', 'park')), 'open');
  assert.equal(findingSetting(f('Sunset Beach', 'beach')), 'open');
  assert.equal(findingSetting(f('The Museum', 'museum')), 'roof');
  assert.equal(findingSetting(f('Sunset Beach Park', null)), null, 'a name says nothing');
  assert.equal(findingSetting(f('Park Tavern', 'hairdresser')), null, 'a kind that says neither');
  // Seating outside as well as in is still somewhere dry; outside only is not.
  assert.equal(findingSetting(f('Taco stand', null, { osm: { tags: { outdoor_seating: 'yes' } } })), null);
  assert.equal(findingSetting(f('Taco stand', null, { osm: { tags: { outdoor_seating: 'yes', indoor_seating: 'no' } } })), 'open');
  assert.equal(visitTagsOf({ indoor_seating: 'no', name: 'x' }).indoor_seating, 'no', 'the sweep keeps the tag');
});

test('a wet evening: the beer garden goes to the bottom, the museum to the top of its ring, each says why', () => {
  const list = [f('garden', 'biergarten'), f('gig', null, { source: 'ticketmaster' }), f('museum', 'museum'), f('far bar', 'bar', { dist: '25 mi' })];
  const out = weatherRanked(list, [day(THU, [], ['rain'])], THU, HERE);
  assert.deepEqual(out.map(x => x.id), ['museum', 'gig', 'far bar', 'garden']);
  const museum = out.find(x => x.id === 'museum')!;
  assert.equal(museum.weather?.line, 'Rain likely this evening (70%) — this one is under a roof.');
  assert.equal(museum.weather?.tone, 'roof');
  assert.equal(out.find(x => x.id === 'garden')!.weather?.line, 'Rain likely this evening (70%) — this one is out in the open.');
  assert.equal(museum.weather?.source.credit, 'Data from MET Norway');
  assert.equal(museum.weather?.fetchedAt, '2026-11-05T16:18:00Z');
  assert.equal(out.find(x => x.id === 'gig')!.weather, undefined, 'a source with no kind says nothing');
});

test('a fine evening, a forecast not held, an evening already under way: the list as it was, with no line', () => {
  const list = [f('garden', 'biergarten'), f('museum', 'museum')];
  assert.equal(weatherRanked(list, [day(THU)], THU, HERE), list);
  assert.equal(weatherRanked(list, [], THU, HERE), list);
  assert.equal(weatherRanked(list, [day(THU, ['rain'], null)], THU, HERE), list, 'a wet afternoon is not the evening');
});

test('a thing on Saturday is judged by Saturday; one next week is not judged', () => {
  const sat = f('park day', 'park', { date: '2026-11-07' });
  const later = f('park later', 'park', { date: '2026-11-12' });
  const tonight = f('museum', 'museum');
  const out = weatherRanked([sat, later, tonight], [day(THU), day('2026-11-07', ['storms']), day('2026-11-12', ['rain'])], THU, HERE);
  assert.deepEqual(out.map(x => x.id), ['park later', 'museum', 'park day']);
  assert.equal(out[2].weather?.line, 'Thunderstorms possible Saturday — this one is out in the open.');
  assert.equal(out[0].weather, undefined);
});

test('the dates read: tonight and the coming weekend', () => {
  assert.deepEqual(discoverDates(THU), [THU, '2026-11-07', '2026-11-08']);
  assert.deepEqual(discoverDates('2026-11-07'), ['2026-11-07', '2026-11-08']);
});

test('a slow forecast is no forecast: Discover is never held up for it', async () => {
  forgetPickForecasts();
  const now = new Date('2026-11-05T15:00:00Z');
  const t0 = Date.now();
  const got = await discoverForecast({} as never, HERE.lat, HERE.lng, {
    now, deadlineMs: 30, read: () => new Promise(r => setTimeout(() => r({ available: true, days: [day(THU, [], ['rain'])] }), 300)),
  });
  assert.deepEqual(got.days, []);
  assert.ok(Date.now() - t0 < 250);
  forgetPickForecasts();
  const ok = await discoverForecast({} as never, HERE.lat, HERE.lng, { now, read: async () => ({ available: true, days: [day(THU, [], ['rain'])] }) });
  assert.equal(ok.days.length, 1);
  assert.equal(ok.today, THU);
  assert.deepEqual((await discoverForecast({} as never, 0, 0, { now })).days, [], 'Null Island is nowhere');
});
