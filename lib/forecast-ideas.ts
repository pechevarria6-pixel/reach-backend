// ─── The forecast, on the three trip options ────────────────────────────
// The owner, 2026-11-05: "weather needs to be taken into account in order
// to make reccomendations ex: this weekend is supposed to rainy, probably not
// a great weeekend for the beach".
//
// Home's picks read the forecast already (lib/recommendations/pick-weather.ts).
// This is the same for the three options app/api/trips/generate offers:
//
//   - Before generation, where the place is already known — a fixed place,
//     or the town of a night out — and its dates are inside a forecast's
//     range, the forecast goes to the model as data (optionsForecastBlock),
//     so three options are not built around a beach in a washout.
//   - After generation, every option's town is read against the forecast for
//     the option's own dates. One whose plan is led by being out of doors,
//     on days the forecast spoils with rain, storms or extreme heat, says so
//     on its card (ideaForecastFrom), with the source, its credit and when
//     it was fetched. One that is out of doors on EVERY day it covers, all
//     of them forecast, is dropped — unless that would leave nothing, when
//     each stays up flagged (dropSpoiled).
//   - Past the forecast's range nothing is said here at all: the card's
//     climate line already says what the month is usually like, labelled
//     "usually" (lib/climate.ts), and that is all anybody can know.
//   - The model's own words are never a forecast: a tagline or a reason that
//     states what the weather will do is taken out (scrubIdeaWeather). It
//     would be saved with a group's ideas and read days later with no source
//     and no date — and for a town picked by the model, nobody had read its
//     forecast at all.
//
// The forecast is read through the cache (lib/forecast-store.ts forecastFor
// via pick-weather's remembered()), which asks a source only when its rules
// allow; a slow answer costs the card its line, never the options.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDays, forecastPoint, partLine, fetchedWords, forecastTip, setting, SOURCES,
  type ForecastPart, type Point, type Worry,
} from './forecast.ts';
import { fahrenheitFirst, HOT_HIGH_C } from './climate.ts';
import { forecastFor, placeToday, type HeldDay } from './forecast-store.ts';
import { remembered, within, worryPhrase, worst, type Read } from './recommendations/pick-weather.ts';
import { locate } from './discovery/geocode.ts';

/**
 * What spoils an outdoor plan, for a recommendation: rain, storms, and heat
 * past the climate's own "extremely hot" line (35 °C). Not snow — a ski
 * trip wants it — and not the 32 °C "too hot for a hike", which is a beach
 * day. Wind spoils a terrace and a boat, not a trip, so only Discover's
 * evening reads it (lib/discovery/weather.ts).
 */
export const TRIP_WORRIES: Worry[] = ['storms', 'rain', 'heat'];

/** The worries of a part that count against an outdoor recommendation. */
export function spoilers(p: ForecastPart | null | undefined, counted: Worry[] = TRIP_WORRIES): Worry[] {
  if (!p) return [];
  return p.worries.filter(w => counted.includes(w) && (w !== 'heat' || p.highC >= HOT_HIGH_C));
}

// ── Is the option out of doors? ──────────────────────────────────────────

export interface IdeaLike {
  destination?: unknown; city?: unknown; country_code?: unknown;
  tagline?: unknown; vibe?: unknown; why_this_group?: unknown;
  used_suggestions?: unknown;
  /** The model's own account of what its plan is built around. */
  setting?: unknown;
  costs?: { activities?: { details?: unknown } | null } | null;
}

/**
 * Whether an option's plan is led by being out of doors. The model says what
 * its own plan is built around (`setting`), which is a fact about the plan it
 * wrote, not about the world. An older answer without it is read from the
 * plan's own words — its activities, then its vibe — and only where they
 * point one way (forecast.ts setting(), which never reads a meal as outdoors).
 */
export function outdoorsLed(t: IdeaLike): boolean {
  if (t.setting === 'outdoors') return true;
  if (t.setting === 'indoors' || t.setting === 'mixed') return false;
  return setting(null, String(t.costs?.activities?.details ?? '')) === 'outdoor'
    || setting(null, String(t.vibe ?? '')) === 'outdoor';
}

// ── What the card says ───────────────────────────────────────────────────

export interface IdeaForecast {
  label: 'Forecast';
  /** "Rain likely Sat 7 Nov (70%) — this option is built around being outdoors." */
  line: string;
  /** The spoiled days, each with what spoils it. */
  spoiled: Array<{ date: string; worries: Worry[] }>;
  /** How many of the option's dates the forecast reaches. */
  held: number;
  /** How many dates the option has. */
  dates: number;
  sources: Array<{ name: string; credit: string; link: string }>;
  /** When the forecast behind it was fetched (the earliest, if two). */
  fetchedAt: string;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
};

/** The dates an option covers: an evening is its one date, a trip start to end. At most 31. */
export function optionDates(start: unknown, end: unknown, night: boolean): string[] {
  const a = /^\d{4}-\d{2}-\d{2}/.exec(String(start ?? ''))?.[0];
  if (!a) return [];
  if (night) return [a];
  const z = /^\d{4}-\d{2}-\d{2}/.exec(String(end ?? ''))?.[0];
  const last = z && z >= a ? z : a;
  const out: string[] = [];
  for (let d = a; d <= last && out.length < 31; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The card's forecast for one option, or null. Pure: the option, the days
 * held for its town, its dates. A trip's day is judged by its daytime
 * verdict (08:00-20:00); a night out by the evening. Nothing when the option
 * is not out of doors, when no date is held, or when every held one is fine.
 */
export function ideaForecastFrom(
  t: IdeaLike, days: HeldDay[], dates: string[], opts: { night?: boolean; today?: string | null } = {},
): IdeaForecast | null {
  if (!dates.length || !outdoorsLed(t)) return null;
  const fFirst = fahrenheitFirst(typeof t.country_code === 'string' ? t.country_code : null);
  const held = dates.map(date => days.find(d => d.date === date)).filter((d): d is HeldDay => !!d);
  const spoiled: Array<{ day: HeldDay; p: ForecastPart; worries: Worry[] }> = [];
  for (const day of held) {
    const p = opts.night ? day.parts.evening : day;
    const worries = spoilers(p);
    if (p && worries.length) spoiled.push({ day, p, worries });
  }
  if (!spoiled.length) return null;
  let said: string;
  if (spoiled.length <= 2) {
    said = spoiled.map((s, i) => {
      const when = opts.night
        ? (s.day.date === opts.today ? 'this evening' : `the evening of ${dayWords(s.day.date)}`)
        : (s.day.date === opts.today ? 'today' : dayWords(s.day.date));
      const text = worryPhrase(worst(s.p, s.worries) as Worry, when, s.p, fFirst);
      return i ? text.charAt(0).toLowerCase() + text.slice(1) : text;
    }).join(', ');
  } else {
    const kinds = [...new Set(spoiled.flatMap(s => s.worries))];
    const what = kinds.map(w => (w === 'rain' ? 'rain' : w === 'storms' ? 'thunderstorms' : 'extreme heat'));
    const words = what.length === 1 ? what[0] : `${what.slice(0, -1).join(', ')} or ${what[what.length - 1]}`;
    said = `${words.charAt(0).toUpperCase()}${words.slice(1)} forecast on ${spoiled.length} of the ${held.length} days the forecast reaches`;
  }
  const sources = [...new Set(spoiled.map(s => s.day.source))].map(id => {
    const s = SOURCES[id];
    return { name: s.name, credit: s.credit, link: s.link };
  });
  return {
    label: 'Forecast',
    line: `${said} — ${opts.night ? 'this evening is' : 'this option is'} built around being outdoors.`,
    spoiled: spoiled.map(s => ({ date: s.day.date, worries: s.worries })),
    held: held.length, dates: dates.length,
    sources,
    fetchedAt: spoiled.map(s => s.day.fetchedAt).sort()[0],
  };
}

/**
 * Whether an option is out of doors on every day it covers, each of them
 * forecast and spoiled — the one case worth taking it off the list rather
 * than saying so on it.
 */
export function washedOut(f: IdeaForecast | null | undefined): boolean {
  return !!f && f.held === f.dates && f.spoiled.length === f.dates;
}

/**
 * The options without the washed-out ones — unless every one is, when all
 * stay up, each flagged: three cards saying it will rain is a truer answer
 * than none, and the person may know a covered beach we do not.
 */
export function dropSpoiled<T>(options: T[], forecasts: Array<IdeaForecast | null>): { kept: T[]; dropped: T[] } {
  const keep = options.filter((_, i) => !washedOut(forecasts[i]));
  if (!keep.length) return { kept: options, dropped: [] };
  return { kept: keep, dropped: options.filter((_, i) => washedOut(forecasts[i])) };
}

// ── The model's words are never a forecast ───────────────────────────────

/**
 * Takes out of an option every line that states what the weather will do.
 * Returns how many went. The option stays; only the sentence goes.
 */
export function scrubIdeaWeather(t: IdeaLike & Record<string, unknown>): number {
  let n = 0;
  for (const k of ['tagline', 'why_this_group'] as const) {
    if (typeof t[k] === 'string' && forecastTip(t[k])) { t[k] = ''; n++; }
  }
  if (Array.isArray(t.used_suggestions)) {
    const kept = (t.used_suggestions as unknown[]).filter(l => !forecastTip(l));
    n += t.used_suggestions.length - kept.length;
    t.used_suggestions = kept;
  }
  return n;
}

// ── The prompt, where the place is known first ───────────────────────────

/**
 * What the options prompt is told about the forecast for a place known
 * before generation. Only the days held are listed, and the model is told
 * the rest are not. Empty when nothing is held.
 */
export function optionsForecastBlock(place: string, days: HeldDay[], opts: { night?: boolean } = {}): string {
  if (!days.length) return '';
  const said = [...new Set(days.map(d => `${SOURCES[d.source].name}, ${fetchedWords(d.fetchedAt)}`))];
  const lines = [`FORECAST FOR ${place.toUpperCase()} (${said.join('; ')} — a forecast, which can change; it covers only the days listed):`];
  for (const d of days) {
    const bits = opts.night
      ? [d.parts.evening ? partLine('evening', d.parts.evening) : null]
      : [d.verdictHours ? partLine('daytime', d) : partLine('the day', d)];
    const shown = bits.filter(Boolean);
    if (!shown.length) continue;
    lines.push(`- ${dayWords(d.date)} (${d.date}): high ${d.highC}°C / ${d.highF}°F; ${shown.join('; ')}.`);
  }
  if (lines.length === 1) return '';
  const spoiled = days.some(d => spoilers(opts.night ? d.parts.evening : d).length);
  if (spoiled) {
    lines.push(opts.night
      ? 'Where the evening above is marked RAIN LIKELY, THUNDERSTORMS POSSIBLE or VERY HOT, do not build an option around being out of doors — no rooftop, beer garden, patio, park or waterfront crawl. Lead with somewhere under a roof.'
      : 'Where a day above is marked RAIN LIKELY, THUNDERSTORMS POSSIBLE or VERY HOT, do not build an option around being out of doors on it — no beach, hike, trail, park or boat day. Lead at least two of the three with things under a roof; an outdoor option may stand only where the forecast leaves it clear days.');
  }
  lines.push('Use the forecast to choose. Never mention the weather or the forecast in any field of your answer: the card shows the forecast itself, with its source.');
  return lines.join('\n');
}

// ── Reading it ───────────────────────────────────────────────────────────

const DEADLINE_MS = 3500;

type Locate = (city: string, country?: string | null) => Promise<{ lat: number; lng: number } | null>;
type Deps = { read?: Read; locate?: Locate; now?: Date; deadlineMs?: number };

/**
 * Whether any of these dates is inside a forecast's range for somebody,
 * somewhere on earth: from the earliest today anywhere to the furthest day
 * any source covers. False means nothing should be looked up at all — not
 * the place, not the forecast. Pure.
 */
export function inForecastRange(dates: string[], now: Date = new Date()): boolean {
  const soonest = placeToday({ lat: 0, lng: -180 }, now);
  const furthest = addDays(placeToday({ lat: 0, lng: 180 }, now), SOURCES.met_norway.horizonDays);
  return dates.some(d => d >= soonest && d <= furthest);
}

/**
 * The forecast days held for a place and these dates, or null. Through the
 * cache and the per-instance memo, never past the deadline, never throws.
 * Asks nothing when none of the dates is inside a forecast's range.
 */
export async function heldFor(
  db: SupabaseClient, at: Point, dates: string[], country: string | null, deps: Deps = {},
): Promise<HeldDay[] | null> {
  const now = deps.now ?? new Date();
  const read: Read = deps.read ?? ((d, p, want) => forecastFor(d, p, want, { now }));
  const got = await within(remembered(read, db, at, { dates, country }, now.getTime()), deps.deadlineMs ?? DEADLINE_MS);
  return got?.days.length ? got.days : null;
}

/** Where an option is, as a forecast point, or null. A failed or slow lookup is null. */
async function pointOf(t: IdeaLike, deps: Deps, ms: number, nightCity?: string | null): Promise<Point | null> {
  const name = String(nightCity || t.city || t.destination || '').trim();
  if (!name) return null;
  const find: Locate = deps.locate ?? ((c, cc) => locate(c, cc ?? null));
  const hit = await within(find(name, typeof t.country_code === 'string' ? t.country_code : null), ms);
  return hit ? forecastPoint(hit.lat, hit.lng) : null;
}

/**
 * Each option's forecast for the card, or null. `nightCity` places all three
 * of a night out's options in the town they are in — a neighbourhood's name
 * is not a place a geocoder can be trusted with. Nothing is looked up when
 * no date is inside a forecast's range. Never throws.
 */
export async function ideaForecasts(
  db: SupabaseClient, options: IdeaLike[],
  when: { start?: unknown; end?: unknown; night?: boolean; nightCity?: string | null },
  deps: Deps = {},
): Promise<Array<IdeaForecast | null>> {
  const now = deps.now ?? new Date();
  const ms = deps.deadlineMs ?? DEADLINE_MS;
  const dates = optionDates(when.start, when.end, !!when.night);
  if (!dates.length) return options.map(() => null);
  if (!inForecastRange(dates, now)) return options.map(() => null);
  try {
    return await Promise.all(options.map(async t => {
      if (!outdoorsLed(t)) return null;
      const at = await pointOf(t, deps, ms, when.night ? when.nightCity : null);
      if (!at) return null;
      const days = await heldFor(db, at, dates, typeof t.country_code === 'string' ? t.country_code : null, { ...deps, now });
      return days ? ideaForecastFrom(t, days, dates, { night: when.night, today: placeToday(at, now) }) : null;
    }));
  } catch (e) {
    console.error('[forecast] none for the trip options', { message: e instanceof Error ? e.message : 'failed' });
    return options.map(() => null);
  }
}

/**
 * The options as a screen gets them: each with its forecast for the dates
 * the trip holds now (a group's saved ideas can outlive the dates they were
 * made for), worked out on every read and never saved.
 */
export async function ideasWithForecast<T extends IdeaLike>(
  db: SupabaseClient, options: T[],
  when: { start?: unknown; end?: unknown; night?: boolean; nightCity?: string | null },
  deps: Deps = {},
): Promise<Array<T & { forecast: IdeaForecast | null }>> {
  const fc = await ideaForecasts(db, options, when, deps);
  return options.map((o, i) => ({ ...o, forecast: fc[i] ?? null }));
}
