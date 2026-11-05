// ─── The forecast, on a recommended trip ────────────────────────────────
// The owner, 2026-11-05: "weather needs to be taken into account in order
// to make reccomendations ex: this weekend is supposed to rainy, probably not
// a great weeekend for the beach".
//
// A card on Home has no dates — the person picks those — but two of its
// shapes say when without saying it: a night out is tonight, and a weekend
// is the coming Saturday and Sunday. Both are inside every forecast's range,
// so for those two the forecast for the town is read, and a pick that is out
// of doors (decided from the rows that made it: see weatherBasis in
// trip-picks.ts) on a spoiled evening or weekend says so in one line:
//
//   "Rain likely Saturday (70%) — Asheville's breweries and museums instead?"
//
// The line carries its source, its credit and when the forecast was fetched,
// because the forecast's terms ask for the credit and a forecast without a
// time is a fact with no date on it. Nothing else is said: a pick that is
// not a weather pick, a fine forecast and a forecast we do not hold all give
// no line. A trip further away has no dates at all, so it gets no forecast —
// only the best months it already carries, which are averages.
//
// Reads the forecast cache (lib/forecast-store.ts forecastFor), which asks a
// source only when the source says it may be asked again; on top of that the
// answer is kept per server instance for a few minutes, so Home opening
// twice is not two reads, and a slow answer costs the card its line, never
// Home its cards.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDays, forecastPoint, rainFigure, SOURCES,
  type ForecastPart, type Point, type Worry,
} from '../forecast.ts';
import { fahrenheitFirst } from '../climate.ts';
import { forecastFor, placeToday, type HeldDay, type PlaceForecast } from '../forecast-store.ts';
import type { Band, WeatherBasis } from './trip-picks.ts';

export interface PickForecast {
  line: string;
  label: 'Forecast';
  /** Every source a figure in the line came from, each with its credit. */
  sources: Array<{ name: string; credit: string; link: string }>;
  /** When the forecast behind the line was fetched (the earliest, if two). */
  fetchedAt: string;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * The dates a card means without saying them, on the town's own clock:
 * tonight for a night out, the coming Saturday and Sunday for a weekend
 * (today and tomorrow on a Saturday, today alone on a Sunday). A trip
 * further away means no dates.
 */
export function windowFor(band: Band, today: string): string[] {
  if (band === 'night') return [today];
  if (band !== 'weekend') return [];
  const d = weekday(today);
  if (d === 0) return [today];
  const sat = addDays(today, (6 - d + 7) % 7);
  return [sat, addDays(sat, 1)];
}

const deg = (p: ForecastPart, fFirst: boolean) => (fFirst ? `${p.highF}°F / ${p.highC}°C` : `${p.highC}°C / ${p.highF}°F`);

/** The worst thing forecast, said with when: "Rain likely Saturday (70%)". Also the trip options' and Discover's. */
export function worryPhrase(w: Worry, when: string, p: ForecastPart, fFirst: boolean): string {
  switch (w) {
    case 'storms': return `Thunderstorms possible ${when}`;
    case 'snow': return `Snow likely ${when}${rainFigure(p)}`;
    case 'rain': return `Rain likely ${when}${rainFigure(p)}`;
    case 'heat': return `Very hot ${when} (${deg(p, fFirst)})`;
    case 'wind': return `Strong wind ${when}`;
  }
}
const ORDER: Worry[] = ['storms', 'snow', 'rain', 'heat', 'wind'];
/** The worry said first, of those a part carries (or of `only`). */
export const worst = (p: ForecastPart, only?: Worry[]): Worry | null =>
  ORDER.find(w => p.worries.includes(w) && (!only || only.includes(w))) ?? null;

const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The line for one card, or null. Pure: the card's shape, what it is built
 * on, the forecast days held for its town, and today on the town's clock.
 */
export function pickForecastLine(
  band: Band, basis: WeatherBasis | null | undefined, days: HeldDay[], today: string,
  opts: { country?: string | null } = {},
): PickForecast | null {
  if (!basis?.outdoor) return null;
  const dates = windowFor(band, today);
  if (!dates.length) return null;
  const fFirst = fahrenheitFirst(opts.country ?? null);
  const spoiled: Array<{ day: HeldDay; text: string }> = [];
  for (const date of dates) {
    const day = days.find(d => d.date === date);
    if (!day) continue;
    // A night out is the evening; a weekend day is its daytime verdict.
    // An evening already under way is not described (forecastDays leaves it
    // null), and is not guessed at from the afternoon.
    const p: ForecastPart | null = band === 'night' ? day.parts.evening : day;
    const w = p ? worst(p) : null;
    if (!p || !w) continue;
    const when = band === 'night' ? 'this evening' : date === today ? 'today' : WEEKDAY[weekday(date)];
    spoiled.push({ day, text: worryPhrase(w, when, p, fFirst) });
  }
  if (!spoiled.length) return null;
  const said = spoiled.map((s, i) => (i ? s.text.charAt(0).toLowerCase() + s.text.slice(1) : s.text)).join(', ');
  const tail = basis.indoor.length
    ? ` — ${basis.name}'s ${listOf(basis.indoor)} instead?`
    : ` — and this one is mostly ${basis.outdoorWords ?? 'outdoors'}.`;
  const sources = [...new Set(spoiled.map(s => s.day.source))].map(id => {
    const s = SOURCES[id];
    return { name: s.name, credit: s.credit, link: s.link };
  });
  const fetchedAt = spoiled.map(s => s.day.fetchedAt).sort()[0];
  return { line: `${said}${tail}`, label: 'Forecast', sources, fetchedAt };
}

// ── Reading it ───────────────────────────────────────────────────────────

const DEADLINE_MS = 3500;
const MEMO_MS = 10 * 60_000;
const memo = new Map<string, { at: number; value: Promise<PlaceForecast> }>();

export type Read = (db: SupabaseClient, at: Point, want: { dates: string[]; country?: string | null }) => Promise<PlaceForecast>;

/**
 * forecastFor, kept per instance for a few minutes. A failed read is not
 * kept. Shared by every recommendation that reads the forecast (Home's
 * picks, the trip options, Discover), so one screen's read serves the next.
 */
export function remembered(read: Read, db: SupabaseClient, at: Point, want: { dates: string[]; country?: string | null }, now: number): Promise<PlaceForecast> {
  const key = `${at.lat},${at.lng}|${want.dates.join(',')}`;
  const hit = memo.get(key);
  if (hit && now - hit.at < MEMO_MS) return hit.value;
  const value = read(db, at, want);
  memo.set(key, { at: now, value });
  value.then(v => { if (!v.available || !v.days.length) memo.delete(key); }, () => memo.delete(key));
  if (memo.size > 500) for (const [k, v] of memo) if (now - v.at >= MEMO_MS) memo.delete(k);
  return value;
}

/** Tests only. */
export function forgetPickForecasts(): void { memo.clear(); }

type Deps = { read?: Read; now?: Date; deadlineMs?: number };

/** The answer, or null once `ms` has passed or it failed: a slow forecast costs its line, never the screen. */
export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  // The clock is stopped once the answer is in: a timer left running keeps
  // a test process (and an idle instance) alive for the whole deadline.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<null>(r => { timer = setTimeout(() => r(null), ms); });
  return Promise.race([p.catch(() => null), clock]).finally(() => clearTimeout(timer));
}

/**
 * Each pick with its forecast line (or null). Only a night out or a weekend
 * that is out of doors is read at all; every other card costs nothing.
 * Never throws.
 */
export async function forecastPicks<P extends { band: Band; basis?: WeatherBasis; destination: { country: string | null } }>(
  db: SupabaseClient, picks: P[], deps: Deps = {},
): Promise<Array<P & { forecast: PickForecast | null }>> {
  const now = deps.now ?? new Date();
  const read: Read = deps.read ?? ((d, at, want) => forecastFor(d, at, want, { now }));
  const ms = deps.deadlineMs ?? DEADLINE_MS;
  return Promise.all(picks.map(async p => {
    const at = p.basis?.outdoor ? forecastPoint(p.basis.at.lat, p.basis.at.lng) : null;
    if (!at) return { ...p, forecast: null };
    const today = placeToday(at, now);
    const dates = windowFor(p.band, today);
    if (!dates.length) return { ...p, forecast: null };
    const got = await within(remembered(read, db, at, { dates, country: p.destination.country }, now.getTime()), ms);
    if (!got?.days.length) return { ...p, forecast: null };
    return { ...p, forecast: pickForecastLine(p.band, p.basis, got.days, today, { country: p.destination.country }) };
  }));
}
