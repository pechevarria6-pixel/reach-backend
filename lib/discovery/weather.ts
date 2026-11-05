// ─── Discover, on a spoiled evening or weekend ──────────────────────────
// The owner, 2026-11-05: "this weekend is supposed to rainy, probably not a
// great weeekend for the beach".
//
// Discover lists what is near you, mostly places that are simply open. Two
// of the times it is read for are inside every forecast's range: tonight
// (a place with no date is somewhere to go now) and the coming weekend (a
// dated thing on Saturday or Sunday). When the forecast for that evening or
// day is bad, a place out in the open goes to the bottom of the list and a
// place under a roof goes up its ring, each with one labelled line and the
// forecast's source, credit and fetch time:
//
//   Forecast · Rain likely this evening (70%) — this one is out in the open.
//   Forecast · Rain likely this evening (70%) — this one is under a roof.
//
// Out in the open or under a roof is decided from the map, never from a
// name: the kind the map gives the place (forecast.ts setting(): a beer
// garden, a beach, a park, a viewpoint; a museum, a cinema, a bar), or its
// own tags saying it seats people outside and not inside. A place the map
// says nothing about either way, and everything from a source that carries
// no kind (a ticketed gig, a class at a studio), is left where it was and
// says nothing. Seating outside as well as in is not out in the open: a
// restaurant with a patio is still somewhere dry to eat. A rooftop is not
// told apart — the venue rows keep no tag that says one — and is left alone
// rather than guessed at from "Rooftop" in its name.
//
// A fine forecast, or one we do not hold, changes nothing at all: the same
// list in the same order, and no line.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Finding } from './types.ts';
import { bandOf, milesOf, type Point as MapPoint } from './distance.ts';
import { forecastPoint, setting, SOURCES, type ForecastPart, type Worry } from '../forecast.ts';
import { placeToday, type HeldDay } from '../forecast-store.ts';
import { windowFor, worryPhrase, worst, type Read } from '../recommendations/pick-weather.ts';
import { heldFor, spoilers } from '../forecast-ideas.ts';
import { fahrenheitFirst } from '../climate.ts';

/** What spoils an evening out of doors: rain, storms, snow, wind, and extreme heat. */
export const EVENING_WORRIES: Worry[] = ['storms', 'snow', 'rain', 'heat', 'wind'];

export interface FindingWeather {
  label: 'Forecast';
  /** 'open' went down the list; 'roof' went up its ring. */
  tone: 'open' | 'roof';
  line: string;
  source: { name: string; credit: string; link: string };
  fetchedAt: string;
}

/**
 * Whether a finding is out in the open or under a roof, from the map alone:
 * its kind, then its own seating tags. Null when nothing on the map says.
 */
export function findingSetting(f: Pick<Finding, 'kind' | 'osm'>): 'open' | 'roof' | null {
  // The place's own seating tags come first: a bar or a kiosk mapped as
  // seating people outside and nobody inside is out in the open, whatever
  // its kind usually means. Its kind never overrules what its row says.
  const t = f.osm?.tags ?? {};
  const outsideOnly = t.outdoor_seating === 'yes' && t.indoor_seating === 'no';
  if (outsideOnly) return 'open';
  const k = setting(f.kind ?? null, null);
  // setting() with no kind falls back to words, and words are not asked for:
  // with no kind there is nothing on the map to read.
  if (f.kind && k === 'outdoor') return 'open';
  // Under a roof only when nothing on the row says otherwise: a place mapped
  // as having no indoor seating is not called dry on its kind alone.
  if (f.kind && k === 'indoor' && t.indoor_seating !== 'no') return 'roof';
  return null;
}

/** The dates Discover is read for: tonight, and the coming weekend. */
export function discoverDates(today: string): string[] {
  return [...new Set([today, ...windowFor('weekend', today)])];
}

/**
 * Which part of which forecast day a finding is judged by, or null: a place
 * with no date, or a thing tonight, by this evening; a thing on the coming
 * Saturday or Sunday by that day's daytime. Anything else is not judged.
 */
function judgedBy(f: Pick<Finding, 'date'>, days: HeldDay[], today: string): { day: HeldDay; p: ForecastPart; when: string } | null {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(String(f.date ?? ''))?.[0] ?? today;
  const day = days.find(d => d.date === date);
  if (!day) return null;
  if (date === today) return day.parts.evening ? { day, p: day.parts.evening, when: 'this evening' } : null;
  if (!windowFor('weekend', today).includes(date)) return null;
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { day, p: day, when: wd === 6 ? 'Saturday' : 'Sunday' };
}

/**
 * The list, reordered for the forecast, each moved card with its line. Pure.
 * Outdoor findings on a spoiled evening or day go below everything else;
 * indoor ones on one go to the top of their distance ring; the rest keep
 * their place. With nothing spoiled, the list comes back as it was.
 */
export function weatherRanked<F extends Finding>(
  findings: F[], days: HeldDay[], today: string, origin: MapPoint | null, opts: { country?: string | null } = {},
): Array<F & { weather?: FindingWeather }> {
  if (!days.length || !findings.length) return findings;
  const fFirst = fahrenheitFirst(opts.country ?? null);
  const said = new Map<F, FindingWeather>();
  for (const f of findings) {
    const where = findingSetting(f);
    if (!where) continue;
    const j = judgedBy(f, days, today);
    const worries = j ? spoilers(j.p, EVENING_WORRIES) : [];
    if (!j || !worries.length) continue;
    const s = SOURCES[j.day.source];
    said.set(f, {
      label: 'Forecast', tone: where,
      line: `${worryPhrase(worst(j.p, worries) as Worry, j.when, j.p, fFirst)} — this one is ${where === 'open' ? 'out in the open' : 'under a roof'}.`,
      source: { name: s.name, credit: s.credit, link: s.link },
      fetchedAt: j.day.fetchedAt,
    });
  }
  if (!said.size) return findings;
  const at = new Map(findings.map((f, i) => [f, i]));
  const ring = new Map(findings.map(f => [f, bandOf(milesOf(f, origin))]));
  const open = (f: F) => (said.get(f)?.tone === 'open' ? 1 : 0);
  const roof = (f: F) => (said.get(f)?.tone === 'roof' ? 0 : 1);
  return [...findings]
    .sort((a, b) => open(a) - open(b)
      || (ring.get(a) as number) - (ring.get(b) as number)
      || roof(a) - roof(b)
      || (at.get(a) as number) - (at.get(b) as number))
    .map(f => (said.has(f) ? { ...f, weather: said.get(f) } : f));
}

/**
 * The forecast days Discover reads for a point, or an empty list: tonight
 * and the coming weekend, through the cache and the per-instance memo,
 * capped so a slow source never holds the screen up. Never throws.
 */
export async function discoverForecast(
  db: SupabaseClient, lat: number, lng: number, deps: { now?: Date; deadlineMs?: number; read?: Read } = {},
): Promise<{ days: HeldDay[]; today: string }> {
  const now = deps.now ?? new Date();
  const at = forecastPoint(lat, lng);
  if (!at) return { days: [], today: now.toISOString().slice(0, 10) };
  const today = placeToday(at, now);
  try {
    const days = await heldFor(db, at, discoverDates(today), null, { now, deadlineMs: deps.deadlineMs ?? 2500, read: deps.read });
    return { days: days ?? [], today };
  } catch {
    return { days: [], today };
  }
}
