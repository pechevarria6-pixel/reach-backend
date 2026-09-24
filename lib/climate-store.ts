// ─── Reading the climate we hold ─────────────────────────────────────────
// One row per place in place_climate (sql/climate-2026-09-24.sql), written by
// scripts/ingest/climate.mjs from NASA POWER. Everything here answers "no
// climate held" rather than failing: before the migration has run the table
// is not there (PGRST205 / 42P01) or a column is missing (42703), and trip
// generation must not go down with it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { nameKey } from './discovery/regions.ts';
import { ideaClimate, type ClimateNormals, type IdeaClimate } from './climate.ts';

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
 *   - with a country, the one in that country;
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
    if (inIt.length) return inIt[0];
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
