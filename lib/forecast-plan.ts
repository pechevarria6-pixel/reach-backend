// ─── The forecast, where a plan's days are written ──────────────────────
// app/api/trips/generate hands the model the forecast for the days it can
// see (forecastPromptBlock) and then reads what came back against it:
//
//   - an outdoor stop in a part of a day the forecast spoils is a clash, and
//     is logged and returned with the days, so the screen can say so and
//     offer Change — never silently passed off as fine;
//   - a tip that states a forecast the data does not hold ("rain is
//     forecast" on a day we hold no forecast for, or a dry one) loses the
//     tip. The slot stays; only the invented weather goes.
//
// Only a saved plan has a point on the map (plans.destination_lat/lng), so
// only a saved plan's days get a forecast. An idea's days are written from
// the climate normals alone, as before.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDays, forecastPoint, indoorSwaps, setting, unbackedWeatherTip, worryHeadline, rainFigure, SOURCES,
  type ForecastPart, type PartName, type PromptDay, type Worry,
} from './forecast.ts';
import { slotWindow, dateOfLine } from './itinerary-alternatives.ts';
import { forecastFor, type HeldDay, type StoreOpts } from './forecast-store.ts';
import { within } from './deadline.ts';

/** How long the generator waits for a forecast before writing without one. */
export const GENERATION_WAIT_MS = 7_000;

export interface GenerationForecast {
  /** Forecast days by date. */
  byDate: Map<string, HeldDay>;
  /** For the prompt, in trip order. */
  prompt: PromptDay[];
}

/**
 * The forecast for a saved plan's days, or null when there is none to give:
 * no pin, no dates inside a forecast's range, the table not there yet, the
 * sources not answering in time. Never throws, and never holds the
 * generator up past GENERATION_WAIT_MS.
 */
export async function generationForecast(
  db: SupabaseClient, planId: string | null, startDate: string | null, dayCount: number,
  opts: StoreOpts & { night?: boolean } = {},
): Promise<GenerationForecast | null> {
  if (!planId || !startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || dayCount < 1) return null;
  try {
    const { data: pin, error } = await db.from('plans')
      .select('destination_lat, destination_lng, destination_country').eq('id', planId).maybeSingle();
    if (error) {
      console.error('[forecast] could not read where the plan is', { plan: planId, code: error.code });
      return null;
    }
    const at = forecastPoint(pin?.destination_lat, pin?.destination_lng);
    if (!at) return null;
    const dates = Array.from({ length: Math.min(dayCount, 31) }, (_, i) => addDays(startDate, i));
    const got = await within(forecastFor(db, at, { dates, country: pin?.destination_country ?? null }, opts), GENERATION_WAIT_MS, 'the forecast');
    if (!got.days.length) return null;
    const byDate = new Map(got.days.map(d => [d.date, d]));
    const prompt: PromptDay[] = dates
      .map((date, i) => {
        const day = byDate.get(date);
        return day ? { label: opts.night ? `The evening (${date})` : `Day ${i + 1} (${date})`, day, fetchedAt: day.fetchedAt } as PromptDay : null;
      })
      .filter((d): d is PromptDay => !!d);
    return prompt.length ? { byDate, prompt } : null;
  } catch (e) {
    console.error('[forecast] none for the generator', { plan: planId, message: e instanceof Error ? e.message : 'failed' });
    return null;
  }
}

/** The indoor places on a menu, as the prompt lists them. */
export function indoorMenu<T extends { ref: string; name: string; kind: string }>(places: T[]) {
  return indoorSwaps(places).map(p => ({ ref: p.ref, name: p.name, kind: p.kind }));
}

interface SlotLike { plan?: string | null; kind?: string | null; tip?: string | null; venue?: string | null }
interface DayLike { day?: number; morning?: SlotLike | null; afternoon?: SlotLike | null; evening?: SlotLike | null }

export interface Clash {
  day: number;
  date: string;
  part: PartName;
  /** What the slot says it is, as written. */
  plan: string;
  worries: Worry[];
  source: string;
  fetchedAt: string;
}

/** The date of trip day `n` (day 1 is the start), or null for a day with no number. */
const dateOf = (start: string, n: unknown) => (Number.isInteger(n) && (n as number) >= 1 ? addDays(start, (n as number) - 1) : null);

/**
 * Outdoor stops in parts of days the forecast spoils. "Outdoor" from the
 * kind the read-back attached from the row, and only from the slot's own
 * words where it names no place (setting).
 */
export function weatherClashes(days: DayLike[], startDate: string, fc: GenerationForecast | null, night = false): Clash[] {
  if (!fc) return [];
  const out: Clash[] = [];
  for (const d of days) {
    const date = night ? startDate : dateOf(startDate, d.day);
    const f = date ? fc.byDate.get(date) : null;
    if (!date || !f) continue;
    for (const part of ['morning', 'afternoon', 'evening'] as PartName[]) {
      const slot = d[part];
      const p = f.parts[part];
      if (!slot?.plan || !p?.worries.length) continue;
      if (setting(slot.kind, slot.plan) !== 'outdoor') continue;
      out.push({ day: Number(d.day), date, part, plan: String(slot.plan).slice(0, 120), worries: p.worries, source: SOURCES[f.source].name, fetchedAt: f.fetchedAt });
    }
  }
  return out;
}

/**
 * Takes out every tip that states a forecast the data does not hold. Returns
 * how many went, so the route can log it.
 */
export function scrubWeatherTips(days: DayLike[], startDate: string | null, fc: GenerationForecast | null, night = false): number {
  let n = 0;
  for (const d of days) {
    const date = startDate ? (night ? startDate : dateOf(startDate, d.day)) : null;
    const f = date ? fc?.byDate.get(date) ?? null : null;
    for (const part of ['morning', 'afternoon', 'evening'] as PartName[]) {
      const slot = d[part];
      if (!slot?.tip) continue;
      const p: ForecastPart | null = f ? f.parts[part] ?? f : null;
      if (unbackedWeatherTip(slot.tip, p)) { slot.tip = ''; n++; }
    }
  }
  return n;
}

/** What the generator's answer says about the forecast it was written with. */
export function forecastSummary(fc: GenerationForecast, clashes: Clash[]) {
  const days = fc.prompt.map(p => ({ date: p.day.date, source: p.day.source, fetchedAt: p.fetchedAt }));
  const credits = [...new Set(fc.prompt.map(p => p.day.source))].map(s => ({ text: SOURCES[s].credit, link: SOURCES[s].link }));
  return { days, credits, clashes };
}

// ── One line of a saved plan ─────────────────────────────────────────────

export interface LineWeather {
  date: string;
  part: PartName | 'day';
  worries: Worry[];
  /** "Rain likely (70%)". */
  headline: string;
  source: { id: string; name: string; credit: string; link: string };
  fetchedAt: string;
}

/** Which part of the forecast day a line's time sits in. */
export function partOfLine(time: unknown, nightOut: boolean): PartName | 'day' {
  const w = slotWindow(time, nightOut);
  return w === 'night' ? 'evening' : w;
}

/** The forecast part a line falls in, or the daytime for a line that only says which day. */
export function partFor(day: HeldDay, part: PartName | 'day'): ForecastPart | null {
  return part === 'day' ? day : day.parts[part];
}

/**
 * The forecast's verdict on one line, when it is out of doors and the
 * forecast spoils its part of the day — else null. What the Change sheet and
 * the weather ping both stand on.
 */
export function lineWeatherFrom(
  line: { time?: unknown; title?: unknown; kind?: string | null }, day: HeldDay | null | undefined, nightOut: boolean,
): LineWeather | null {
  if (!day) return null;
  if (setting(line.kind ?? null, String(line.title ?? '')) !== 'outdoor') return null;
  const part = partOfLine(line.time, nightOut);
  const p = partFor(day, part);
  const said = p ? worryHeadline(p) : null;
  if (!p || !said) return null;
  const s = SOURCES[day.source];
  const wet = p.worries[0] === 'rain' || p.worries[0] === 'storms' || p.worries[0] === 'snow';
  return {
    date: day.date, part, worries: p.worries,
    headline: `${said}${wet ? rainFigure(p) : ''}`,
    source: { id: s.id, name: s.name, credit: s.credit, link: s.link }, fetchedAt: day.fetchedAt,
  };
}

/** The forecast for one line of a saved plan, read through the cache. Never throws. */
export async function lineWeather(
  db: SupabaseClient,
  plan: { start_date?: string | null; destination_lat?: unknown; destination_lng?: unknown; destination_country?: string | null },
  line: { time?: unknown; title?: unknown; kind?: string | null }, nightOut: boolean, opts: StoreOpts = {},
): Promise<LineWeather | null> {
  const date = dateOfLine(line.time, plan.start_date ?? null, nightOut);
  const at = forecastPoint(plan.destination_lat, plan.destination_lng);
  if (!date || !at) return null;
  if (setting(line.kind ?? null, String(line.title ?? '')) !== 'outdoor') return null;
  try {
    const got = await within(forecastFor(db, at, { dates: [date], country: plan.destination_country ?? null }, opts), GENERATION_WAIT_MS, 'the forecast');
    return lineWeatherFrom(line, got.days.find(d => d.date === date), nightOut);
  } catch (e) {
    console.error('[forecast] none for this line', { message: e instanceof Error ? e.message : 'failed' });
    return null;
  }
}
