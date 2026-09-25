// ─── Reading the climate we hold ─────────────────────────────────────────
// One row per place in place_climate (sql/climate-2026-09-24.sql), written by
// scripts/ingest/climate.mjs from NASA POWER. Everything here answers "no
// climate held" rather than failing: before the migration has run the table
// is not there (PGRST205 / 42P01) or a column is missing (42703), and trip
// generation must not go down with it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { nameKey } from './discovery/regions.ts';
import { ideaClimate, climateIsFor, vetoesFromWants, type ClimateNormals, type IdeaClimate } from './climate.ts';

/**
 * The rows held under one folded name. Written out whole, and on its own,
 * so scripts/check-queries.mjs can read the table and every column against
 * the live schema (it reads a query up to the next blank line).
 */
function heldUnder(db: SupabaseClient, key: string) {
  return db.from('place_climate')
    .select('name,name_key,country,lat,lng,t2m,t2m_range,precip_mm_day,rh2m,cloud_pct,wind_ms,grid_elevation_m,source,period,fetched_at')
    .eq('name_key', key).limit(20);
}

/** Codes that mean the migration has not run yet. */
export function climateNotReady(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return /^(PGRST205|42P01|42703)$/.test(String(error.code ?? '')) || /place_climate/.test(String(error.message ?? ''));
}

/** US territories are filed under US regions; a plan says PR. They are the same country for matching. */
const US_FAMILY = new Set(['US', 'PR', 'VI', 'GU', 'AS', 'MP', 'UM']);
export function sameCountry(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? '').toUpperCase(), y = String(b ?? '').toUpperCase();
  if (!x || !y) return false;
  return x === y || (US_FAMILY.has(x) && US_FAMILY.has(y));
}

const nums = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length === 12 && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? v as number[] : null;
const maybeNums = (v: unknown): Array<number | null> | null =>
  Array.isArray(v) && v.length === 12 ? v.map(x => (typeof x === 'number' && Number.isFinite(x) ? x : null)) : null;

/** A stored row as normals, or null when it is not twelve real months of each required value. */
export function normalsFromRow(r: Record<string, any> | null | undefined): ClimateNormals | null {
  if (!r) return null;
  const t2m = nums(r.t2m), range = nums(r.t2m_range), rain = nums(r.precip_mm_day);
  if (!t2m || !range || !rain) return null;
  return {
    name: String(r.name ?? ''), country: r.country ? String(r.country) : null,
    lat: Number(r.lat), lng: Number(r.lng),
    t2m, t2mRange: range, precipMmDay: rain,
    rh2m: maybeNums(r.rh2m), cloudPct: maybeNums(r.cloud_pct), windMs: maybeNums(r.wind_ms),
    period: String(r.period ?? ''), source: String(r.source ?? 'NASA POWER'),
    gridElevationM: Number.isFinite(Number(r.grid_elevation_m)) && r.grid_elevation_m != null ? Number(r.grid_elevation_m) : null,
  };
}

/**
 * Which held row is this place. By name first (case and accents folded, the
 * part before any comma); then, of the rows with that name:
 *   - with coordinates, the nearest within 0.75° (a POWER cell is 0.5°);
 *   - with a country, the one in that country — and none when that country
 *     holds two towns of the name in different places;
 *   - with neither, only a name held once. Paris, France is not Paris, Texas,
 *     and a guess between them is worse than no weather at all.
 */
export function pickClimateRow<R extends { country?: string | null; lat: number; lng: number }>(
  rows: R[], want: { country?: string | null; lat?: number | null; lng?: number | null },
): R | null {
  if (!rows.length) return null;
  const lat = Number(want.lat), lng = Number(want.lng);
  if (want.lat != null && want.lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const near = rows
      .map(r => ({ r, d: Math.hypot(Number(r.lat) - lat, Number(r.lng) - lng) }))
      .filter(x => x.d <= 0.75).sort((a, b) => a.d - b.d);
    return near[0]?.r ?? null;
  }
  if (want.country) {
    const inIt = rows.filter(r => sameCountry(r.country, want.country));
    // Two towns of one name in one country (Fayetteville, AR and NC;
    // Portland, OR and ME) are two rows, and the country cannot tell them
    // apart — nor can the state, which is not held. The first row back is
    // whichever PostgREST found first, so choosing it would quote one town's
    // weather for the other. Only rows that are the same place (within one
    // cell, as Cancun and Cancún are) count as one answer.
    if (inIt.length) return inIt.every(r => Math.hypot(Number(r.lat) - Number(inIt[0].lat), Number(r.lng) - Number(inIt[0].lng)) <= 0.75) ? inIt[0] : null;
    // Rows whose country we never learned: only when that name is held once.
    return rows.length === 1 && !rows[0].country ? rows[0] : null;
  }
  return rows.length === 1 ? rows[0] : null;
}

export type ClimateRead = { normals: ClimateNormals | null; available: boolean };

/** The climate held for a place, or null. Never throws. */
export async function readClimate(
  db: SupabaseClient,
  place: { name: string | null | undefined; country?: string | null; lat?: number | null; lng?: number | null },
): Promise<ClimateRead> {
  const town = String(place.name ?? '').split(',')[0].trim();
  if (!town) return { normals: null, available: true };
  try {
    const { data, error } = await heldUnder(db, nameKey(town));
    if (error) {
      if (climateNotReady(error)) return { normals: null, available: false };
      console.error('[climate] could not read the climate held', { place: town, code: error.code });
      return { normals: null, available: true };
    }
    const row = pickClimateRow((data ?? []) as any[], place);
    return { normals: normalsFromRow(row), available: true };
  } catch (e) {
    console.error('[climate] read failed', { place: town, message: e instanceof Error ? e.message : 'failed' });
    return { normals: null, available: true };
  }
}

/**
 * Everything a suggestion needs about the weather, in one call: what it is
 * usually like on the dates (or the best months, with no dates), whether a
 * weather no-go rules it out, and whether that could be checked. The trips
 * route uses this for every idea; anything else that suggests a place —
 * Home's recommended trips — should call it the same way and drop a
 * suggestion whose `breach` is set, and show `climate` with
 * climateLine(climate.trip, { fahrenheitFirst }) or climate.best, and
 * climate.credit under it.
 */
export async function climateFor(
  db: SupabaseClient,
  place: { name: string | null | undefined; country?: string | null; lat?: number | null; lng?: number | null },
  dates: { start?: unknown; end?: unknown } = {},
  vetoes: unknown[] = [],
): Promise<{ climate: IdeaClimate | null; breach: 'coldWeather' | 'extremeHeat' | null; available: boolean }> {
  const town = String(place.name ?? '').split(',')[0].trim();
  const read = await readClimate(db, place);
  return { ...ideaClimate(read.normals, town, dates, vetoes), available: read.available };
}

/**
 * A saved idea's climate, as it is for the dates the plan holds now. A
 * group's ideas are saved with the weather for the dates they were made for,
 * and the dates can move while the vote is open (the plan overview's "Use
 * these dates"); a card that said "Usually in October" under January dates,
 * or kept an idea the cold no-go now rules out, would be stating what is no
 * longer so. Worked out again, with the same weather no-gos, whenever the
 * dates differ; returned as saved when they do not. An idea whose new dates
 * break a no-go comes back with `breach` set — flagged, not dropped, because
 * people may already have voted for it.
 */
export async function ideaClimateNow(
  db: SupabaseClient,
  idea: { city?: unknown; destination?: unknown; country_code?: unknown; climate?: IdeaClimate | null },
  dates: { start?: unknown; end?: unknown },
): Promise<IdeaClimate | null | undefined> {
  const saved = idea.climate;
  if (!saved || typeof saved !== 'object') return saved;
  if (climateIsFor(saved, dates)) return saved;
  const name = String(idea.city || idea.destination || saved.place || '');
  const country = typeof idea.country_code === 'string' ? idea.country_code : null;
  const got = await climateFor(db, { name, country }, dates, vetoesFromWants(saved.wants));
  // Nothing held any more (or the read failed): nothing is said rather than
  // the old dates' weather — unless a no-go was asked for, which is then
  // said to be unchecked.
  if (!got.climate) return saved.asked ? { place: saved.place, held: false, trip: null, best: null, credit: '', asked: true, checked: false, dates: null, wants: saved.wants ?? null, breach: null } : null;
  // An old save with no record of which no-go was asked: still asked, and
  // not claimed to have been checked against the new dates.
  if (saved.asked && !saved.wants) return { ...got.climate, asked: true, checked: false, breach: null };
  return got.climate;
}

/** What a screen is sent: the climate without the record of which no-go somebody asked for. */
export function climateForScreen(c: IdeaClimate | null | undefined): IdeaClimate | null | undefined {
  if (!c || typeof c !== 'object') return c;
  const { wants: _wants, ...shown } = c;
  return shown;
}

/**
 * A set of saved ideas as a screen gets them: each one's climate as it is for
 * these dates (ideaClimateNow), without the record of which no-go was asked.
 * Every route that hands saved ideas to a screen goes through this.
 */
export async function ideasWithClimateNow<T extends { city?: unknown; destination?: unknown; country_code?: unknown; climate?: IdeaClimate | null }>(
  db: SupabaseClient, options: T[], dates: { start?: unknown; end?: unknown },
): Promise<T[]> {
  return Promise.all(options.map(async o => (o.climate
    ? { ...o, climate: climateForScreen(await ideaClimateNow(db, o, dates)) }
    : o)));
}
