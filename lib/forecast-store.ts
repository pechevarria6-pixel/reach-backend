// ─── Fetching and keeping forecasts ──────────────────────────────────────
// The forecast for a place is fetched here, on the server, when somebody
// needs it — a plan's weather, a trip's days being written, the pings run —
// and kept in place_forecast (sql/forecast-2026-11-05.sql) until the source
// says it may be asked again. Never on a schedule: on Hobby a cron runs once a
// day, and nothing about a forecast survives a day.
//
// The sources' rules, as code (see lib/forecast.ts for where they come from):
//
//   - Identify ourselves on every request (forecastUserAgent). A 403 from
//     MET Norway is a refused User-Agent, and is logged as one.
//   - Never ask before next_ask_at: the source's Expires, and for MET Norway
//     outside the Nordic model at most every three hours. A 429 or a 5xx
//     pushes it out again (Retry-After where given).
//   - If-Modified-Since with the Last-Modified we hold; a 304 is "still the
//     same", and the forecast held stands.
//   - Two requests at the same instant must not both ask. A request takes
//     the row's lease (a conditional update, or the first insert, which the
//     unique index makes the only one) and only then fetches; a request that
//     loses the race serves what is held, which may be nothing.
//   - At most one call to a source every PACE_MS from one process, which
//     keeps a whole pings run far under MET Norway's 20 a second.
//
// Before the migration has run, nothing is fetched at all — there is nowhere
// to keep the answer, and fetching on every request would break the first
// rule — and every reader gets `available: false` and the climate normals.
//
// Every answer carries where it came from and when it was fetched, so each
// sentence about the weather can point at the row behind it.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SOURCES, forecastDays, forecastUserAgent, metMinIntervalMs, nwsMayCover, parseMet, parseNwsHourly,
  parseNwsPoints, placeClock, addDays, usualFor, forecastPoint,
  type ForecastDay, type ForecastSource, type Parsed, type Point, type Step,
} from './forecast.ts';
import { readClimate } from './climate-store.ts';
import { climateCredit, CLIMATE_SOURCE_URL } from './climate.ts';
import { within } from './deadline.ts';

export const FORECAST_SQL = 'sql/forecast-2026-11-05.sql';

/** How long a request holds the right to fetch. */
const LEASE_MS = 25_000;
/** How long one call to a source may take. */
const CALL_MS = 6_000;
/** A forecast older than this is not quoted, whatever else is true. */
export const MAX_AGE_MS = 18 * 3_600_000;
/** Backoff when a source refuses or fails. */
const BACKOFF_MS = 15 * 60_000;
/** The NWS grid for a point is re-checked this often. */
const GRID_RECHECK_MS = 7 * 86_400_000;
/** A point the NWS does not cover is asked about again after this. */
const NOT_COVERED_MS = 30 * 86_400_000;
const PACE_MS = 120;

const ROW = 'id,source,lat,lng,status,steps,tz,source_updated_at,fetched_at,expires_at,last_modified,next_ask_at,lease_until,meta';

/** Codes that mean the migration has not run yet. */
export function forecastNotReady(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return /^(PGRST205|42P01|42703|PGRST204)$/.test(String(e.code ?? '')) || /place_forecast/.test(String(e.message ?? ''));
}

export interface ForecastRow {
  id: string;
  source: ForecastSource;
  lat: number; lng: number;
  status: 'pending' | 'ok' | 'not_covered' | 'failed';
  steps: Step[] | null;
  tz: string | null;
  source_updated_at: string | null;
  fetched_at: string | null;
  expires_at: string | null;
  last_modified: string | null;
  next_ask_at: string | null;
  lease_until: string | null;
  meta: Record<string, unknown> | null;
}

export interface Held {
  source: ForecastSource;
  fetchedAt: string;
  expiresAt: string | null;
  parsed: Parsed;
}

export interface StoreOpts {
  now?: Date;
  fetch?: typeof fetch;
  /** Overrides the User-Agent (tests only). */
  userAgent?: string;
}

/** The forecast a row holds, if it holds one fresh enough to quote. */
export function heldFrom(row: ForecastRow | null | undefined, now: Date): Held | null {
  if (!row || !Array.isArray(row.steps) || !row.steps.length || !row.fetched_at) return null;
  if (row.status === 'not_covered' || row.status === 'pending') return null;
  const at = Date.parse(row.fetched_at);
  if (!Number.isFinite(at) || now.getTime() - at > MAX_AGE_MS) return null;
  return {
    source: row.source, fetchedAt: new Date(at).toISOString(), expiresAt: row.expires_at,
    parsed: { source: row.source, updatedAt: row.source_updated_at, steps: row.steps, tz: row.tz },
  };
}

// ── Asking the sources ───────────────────────────────────────────────────

const lastCall = new Map<string, number>();
async function paced(host: string): Promise<void> {
  const wait = (lastCall.get(host) ?? 0) + PACE_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall.set(host, Date.now());
}

type Outcome =
  | { kind: 'ok'; parsed: Parsed; expires: number | null; lastModified: string | null; meta?: Record<string, unknown> }
  | { kind: 'not_modified'; expires: number | null }
  | { kind: 'not_covered' }
  | { kind: 'failed'; why: string; retryAfterMs: number | null; meta?: Record<string, unknown> | null };

const dateHeader = (res: Response, name: string): number | null => {
  const t = Date.parse(res.headers.get(name) ?? '');
  return Number.isFinite(t) ? t : null;
};
const retryAfter = (res: Response): number | null => {
  const v = res.headers.get('retry-after');
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, s) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
};

async function call(url: string, headers: Record<string, string>, opts: StoreOpts, what: string): Promise<Response> {
  await paced(new URL(url).host);
  const f = opts.fetch ?? fetch;
  return within(f(url, { headers, signal: AbortSignal.timeout(CALL_MS + 1000) }), CALL_MS, what);
}

/** MET Norway's /complete for a point. */
export async function askMet(at: Point, lastModified: string | null, opts: StoreOpts = {}): Promise<Outcome> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${at.lat.toFixed(2)}&lon=${at.lng.toFixed(2)}`;
  const headers: Record<string, string> = { 'User-Agent': opts.userAgent ?? forecastUserAgent(), Accept: 'application/json' };
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  let res: Response;
  try {
    res = await call(url, headers, opts, 'MET Norway');
  } catch (e) {
    return { kind: 'failed', why: e instanceof Error ? e.message : 'no answer', retryAfterMs: null };
  }
  if (res.status === 304) return { kind: 'not_modified', expires: dateHeader(res, 'expires') };
  if (res.status === 403) {
    console.error('[forecast] MET Norway refused the request — check the User-Agent (lib/forecast.ts forecastUserAgent)');
    return { kind: 'failed', why: 'refused (403)', retryAfterMs: 3_600_000 };
  }
  if (res.status === 429) return { kind: 'failed', why: 'throttled (429)', retryAfterMs: retryAfter(res) };
  // 203 is "this version is deprecated" with a valid body: used, and said.
  if (res.status === 203) console.error('[forecast] MET Norway says this API version is deprecated (203)');
  if (res.status !== 200 && res.status !== 203) return { kind: 'failed', why: `answered ${res.status}`, retryAfterMs: retryAfter(res) };
  const body = await res.json().catch(() => null);
  const parsed = parseMet(body);
  if ('error' in parsed) return { kind: 'failed', why: parsed.error, retryAfterMs: null };
  return { kind: 'ok', parsed, expires: dateHeader(res, 'expires'), lastModified: res.headers.get('last-modified') };
}

/** The NWS: /points (cached in meta), then the grid's hourly forecast. */
export async function askNws(at: Point, meta: Record<string, unknown> | null, opts: StoreOpts = {}): Promise<Outcome> {
  const now = (opts.now ?? new Date()).getTime();
  const headers = { 'User-Agent': opts.userAgent ?? forecastUserAgent(), Accept: 'application/geo+json' };
  let grid = meta && typeof meta.hourlyUrl === 'string' && now - Date.parse(String(meta.checkedAt ?? '')) < GRID_RECHECK_MS
    ? { hourlyUrl: meta.hourlyUrl as string, tz: (meta.tz as string | null) ?? null, grid: String(meta.grid ?? '') }
    : null;
  if (!grid) {
    let res: Response;
    try {
      res = await call(`https://api.weather.gov/points/${at.lat.toFixed(2)},${at.lng.toFixed(2)}`, headers, opts, 'the NWS');
    } catch (e) {
      return { kind: 'failed', why: e instanceof Error ? e.message : 'no answer', retryAfterMs: null };
    }
    if (res.status === 404) return { kind: 'not_covered' };
    if (res.status !== 200) return { kind: 'failed', why: `points answered ${res.status}`, retryAfterMs: retryAfter(res) };
    const p = parseNwsPoints(await res.json().catch(() => null));
    if ('error' in p) return { kind: 'not_covered' };
    grid = p;
  }
  const gridMeta = { hourlyUrl: grid.hourlyUrl, tz: grid.tz, grid: grid.grid, checkedAt: meta?.hourlyUrl === grid.hourlyUrl && meta?.checkedAt ? meta.checkedAt : new Date(now).toISOString() };
  let res: Response;
  try {
    res = await call(`${grid.hourlyUrl}?units=si`, headers, opts, 'the NWS');
  } catch (e) {
    return { kind: 'failed', why: e instanceof Error ? e.message : 'no answer', retryAfterMs: null, meta: gridMeta };
  }
  // A grid that moved: forget it, and ask /points again next time.
  if (res.status === 404) return { kind: 'failed', why: 'grid not found (404)', retryAfterMs: 60_000, meta: null };
  if (res.status !== 200) return { kind: 'failed', why: `hourly answered ${res.status}`, retryAfterMs: retryAfter(res) ?? (res.status === 429 ? 5_000 : null), meta: gridMeta };
  const parsed = parseNwsHourly(await res.json().catch(() => null), grid.tz);
  if ('error' in parsed) return { kind: 'failed', why: parsed.error, retryAfterMs: null, meta: gridMeta };
  return { kind: 'ok', parsed, expires: dateHeader(res, 'expires'), lastModified: null, meta: gridMeta };
}

// ── The cache ────────────────────────────────────────────────────────────

/** Read the row for one source at one point. Written whole for check-queries. */
function rowFor(db: SupabaseClient, source: ForecastSource, at: Point) {
  return db.from('place_forecast')
    .select('id,source,lat,lng,status,steps,tz,source_updated_at,fetched_at,expires_at,last_modified,next_ask_at,lease_until,meta')
    .eq('source', source).eq('lat', at.lat).eq('lng', at.lng).maybeSingle();
}

export interface HeldRead { held: Held | null; available: boolean; row: ForecastRow | null }

/**
 * The forecast one source holds for a point: from the row while the source
 * may not be asked again, fetched (by whichever request takes the lease)
 * when it may. Never throws.
 */
export async function heldForecast(db: SupabaseClient, source: ForecastSource, at: Point, opts: StoreOpts = {}): Promise<HeldRead> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  try {
    const read = await rowFor(db, source, at);
    if (read.error) {
      if (forecastNotReady(read.error)) return { held: null, available: false, row: null };
      console.error('[forecast] could not read the forecast held', { source, code: read.error.code });
      return { held: null, available: true, row: null };
    }
    let row = (read.data ?? null) as ForecastRow | null;
    const due = !row || !row.next_ask_at || Date.parse(row.next_ask_at) <= nowMs;
    if (!due) return { held: heldFrom(row, now), available: true, row };

    // ── The claim ──
    const leaseUntil = new Date(nowMs + LEASE_MS).toISOString();
    if (!row) {
      const { data: made, error: makeErr } = await db.from('place_forecast')
        .insert({ source, lat: at.lat, lng: at.lng, status: 'pending', lease_until: leaseUntil, next_ask_at: now.toISOString() })
        .select(ROW).single();
      if (makeErr) {
        // Somebody else made it first, and is fetching: nothing held yet.
        if (makeErr.code === '23505') return { held: null, available: true, row: null };
        if (forecastNotReady(makeErr)) return { held: null, available: false, row: null };
        console.error('[forecast] could not claim a fetch', { source, code: makeErr.code });
        return { held: null, available: true, row: null };
      }
      row = made as unknown as ForecastRow;
    } else {
      const { data: took, error: takeErr } = await db.from('place_forecast')
        .update({ lease_until: leaseUntil })
        .eq('id', row.id)
        .or(`lease_until.is.null,lease_until.lt."${now.toISOString()}"`)
        .select('id');
      if (takeErr) {
        console.error('[forecast] could not claim a fetch', { source, code: takeErr.code });
        return { held: heldFrom(row, now), available: true, row };
      }
      // Another request holds it and is fetching: serve what is held.
      if (!took?.length) return { held: heldFrom(row, now), available: true, row };
    }

    // ── The fetch ──
    const got = source === 'met_norway'
      ? await askMet(at, row.last_modified, opts)
      : await askNws(at, row.meta, opts);
    const stamp = now.toISOString();
    let patch: Record<string, unknown>;
    if (got.kind === 'ok') {
      const floor = source === 'met_norway' ? metMinIntervalMs(at) : 30 * 60_000;
      patch = {
        status: 'ok', steps: got.parsed.steps, tz: got.parsed.tz, source_updated_at: got.parsed.updatedAt,
        fetched_at: stamp, expires_at: got.expires ? new Date(got.expires).toISOString() : null,
        last_modified: got.lastModified, next_ask_at: new Date(Math.max(got.expires ?? 0, nowMs + floor)).toISOString(),
        lease_until: null, last_error: null, updated_at: stamp,
        ...(got.meta !== undefined ? { meta: got.meta } : {}),
      };
    } else if (got.kind === 'not_modified') {
      const floor = source === 'met_norway' ? metMinIntervalMs(at) : 30 * 60_000;
      patch = {
        expires_at: got.expires ? new Date(got.expires).toISOString() : row.expires_at,
        next_ask_at: new Date(Math.max(got.expires ?? 0, nowMs + floor)).toISOString(),
        lease_until: null, last_error: null, updated_at: stamp,
      };
    } else if (got.kind === 'not_covered') {
      patch = { status: 'not_covered', steps: null, next_ask_at: new Date(nowMs + NOT_COVERED_MS).toISOString(), lease_until: null, updated_at: stamp };
    } else {
      console.error('[forecast] fetch failed', { source, why: got.why });
      patch = {
        // A forecast already held stays held (it is still quotable until
        // MAX_AGE); only a row with nothing in it is marked failed.
        status: row.steps?.length && row.status === 'ok' ? 'ok' : 'failed',
        next_ask_at: new Date(nowMs + Math.max(got.retryAfterMs ?? 0, BACKOFF_MS)).toISOString(),
        lease_until: null, last_error: got.why.slice(0, 200), updated_at: stamp,
        ...(got.meta !== undefined ? { meta: got.meta } : {}),
      };
    }
    const { data: wrote, error: writeErr } = await db.from('place_forecast').update(patch).eq('id', row.id).select(ROW).single();
    if (writeErr) console.error('[forecast] fetched, and could not keep it', { source, code: writeErr.code });
    const after = (wrote as unknown as ForecastRow | null) ?? { ...row, ...patch } as ForecastRow;
    return { held: heldFrom(after, now), available: true, row: after };
  } catch (e) {
    console.error('[forecast] read failed', { source, message: e instanceof Error ? e.message : 'failed' });
    return { held: null, available: true, row: null };
  }
}

export type HeldDay = ForecastDay & { fetchedAt: string };

export interface PlaceForecast {
  /** False before the migration: nothing could be fetched or kept. */
  available: boolean;
  /** One per date the sources cover, the NWS first where it has the day. */
  days: HeldDay[];
}

/** Today on the place's clock, by longitude. */
export const placeToday = (at: Point, now: Date) => placeClock(null, at.lng)(now.getTime()).day;

/** Whether any of these dates is close enough for a forecast to say anything. */
export function anyInHorizon(dates: string[], at: Point, now: Date): boolean {
  const today = placeToday(at, now);
  const last = addDays(today, SOURCES.met_norway.horizonDays);
  return dates.some(d => d >= today && d <= last);
}

/**
 * The forecast for a place, for the dates wanted. Nothing is fetched unless
 * one of them is inside a forecast's range. In the US the NWS is asked
 * first; MET Norway fills the days it does not reach, and stands in when it
 * fails — one failed source is not the end of the forecast.
 */
export async function forecastFor(
  db: SupabaseClient, at: Point, want: { dates: string[]; country?: string | null }, opts: StoreOpts = {},
): Promise<PlaceForecast> {
  const now = opts.now ?? new Date();
  if (!want.dates.length || !anyInHorizon(want.dates, at, now)) return { available: true, days: [] };
  const byDate = new Map<string, HeldDay>();
  let available = true;
  let tz: string | null = null;
  if (nwsMayCover(at, want.country)) {
    const nws = await heldForecast(db, 'nws', at, opts);
    available = nws.available;
    if (!available) return { available, days: [] };
    tz = nws.row?.tz ?? (nws.row?.meta?.tz as string | undefined) ?? null;
    if (nws.held) for (const d of forecastDays(nws.held.parsed, at, now)) byDate.set(d.date, { ...d, fetchedAt: nws.held.fetchedAt });
  }
  const missing = want.dates.filter(d => !byDate.has(d) && anyInHorizon([d], at, now));
  if (missing.length) {
    const met = await heldForecast(db, 'met_norway', at, opts);
    if (!met.available) return { available: false, days: [] };
    if (met.held) {
      // The NWS named the zone; MET Norway's days are cut on it too.
      const parsed = { ...met.held.parsed, tz: met.held.parsed.tz ?? tz };
      for (const d of forecastDays(parsed, at, now)) if (!byDate.has(d.date)) byDate.set(d.date, { ...d, fetchedAt: met.held.fetchedAt });
    }
  }
  return { available, days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

// ── A plan's days ────────────────────────────────────────────────────────

export interface WeatherPlan {
  id: string;
  type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  destination_lat?: number | string | null;
  destination_lng?: number | string | null;
  destination_city?: string | null;
  destination_country?: string | null;
  destination_label?: string | null;
}

export type WeatherDay =
  | { date: string; day: number; kind: 'forecast'; label: 'Forecast'; source: { id: ForecastSource; name: string; credit: string; link: string }; fetchedAt: string; forecast: ForecastDay }
  | { date: string; day: number; kind: 'usually'; label: 'Usually'; usually: ReturnType<typeof usualFor>; credit: string; link: string }
  | { date: string; day: number; kind: 'none'; label: null; why: string };

export interface PlanWeather {
  /** False until sql/forecast-2026-11-05.sql has run: normals only. */
  forecastAvailable: boolean;
  place: { name: string | null; lat: number; lng: number } | null;
  days: WeatherDay[];
  /** Every credit the days above need, once each. */
  credits: Array<{ text: string; link: string | null }>;
  /** Said when there are no days at all. */
  reason: string | null;
}

/** The calendar dates of a plan: an evening is its one date; a trip runs start to end. At most 31. */
export function planDates(plan: Pick<WeatherPlan, 'type' | 'start_date' | 'end_date'>): string[] {
  const start = /^\d{4}-\d{2}-\d{2}/.exec(String(plan.start_date ?? ''))?.[0];
  if (!start) return [];
  if (plan.type === 'restaurant') return [start];
  const end = /^\d{4}-\d{2}-\d{2}/.exec(String(plan.end_date ?? ''))?.[0];
  const last = end && end >= start ? end : start;
  const out: string[] = [];
  for (let d = start; d <= last && out.length < 31; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Every day of a plan, each as a forecast (with its source and when it was
 * fetched) where one covers it, else as the usual weather for the month
 * (labelled "Usually"), else as nothing — and why.
 */
export async function planWeather(db: SupabaseClient, plan: WeatherPlan, opts: StoreOpts & { fahrenheitFirst?: boolean } = {}): Promise<PlanWeather> {
  const dates = planDates(plan);
  const at = forecastPoint(plan.destination_lat, plan.destination_lng);
  const name = plan.destination_city ?? null;
  const base = { place: at ? { name, lat: at.lat, lng: at.lng } : null };
  if (!dates.length) return { forecastAvailable: true, ...base, days: [], credits: [], reason: 'This plan has no dates yet, so there is no weather to show.' };

  const fc = at ? await forecastFor(db, at, { dates, country: plan.destination_country ?? null }, opts) : { available: true, days: [] };
  const needUsual = dates.some(d => !fc.days.some(f => f.date === d));
  const climate = needUsual && (name || at)
    ? (await readClimate(db, { name, country: plan.destination_country ?? null, lat: at?.lat ?? null, lng: at?.lng ?? null })).normals
    : null;

  const days: WeatherDay[] = dates.map((date, i) => {
    const f = fc.days.find(x => x.date === date);
    if (f) {
      const s = SOURCES[f.source];
      const { fetchedAt, ...forecast } = f;
      return { date, day: i + 1, kind: 'forecast', label: 'Forecast', source: { id: s.id, name: s.name, credit: s.credit, link: s.link }, fetchedAt, forecast };
    }
    if (climate) {
      return { date, day: i + 1, kind: 'usually', label: 'Usually', usually: usualFor(climate, date, opts.fahrenheitFirst), credit: climateCredit(climate.period), link: CLIMATE_SOURCE_URL };
    }
    return {
      date, day: i + 1, kind: 'none', label: null,
      why: at ? "We don't hold a forecast or the usual weather for this place on this date." : "This plan isn't on the map yet, so we can't look up its weather.",
    };
  });

  const credits = new Map<string, string | null>();
  for (const d of days) {
    if (d.kind === 'forecast') { credits.set(d.source.credit, d.source.link); credits.set(d.forecast.sun.credit, null); }
    if (d.kind === 'usually') credits.set(d.credit, d.link);
  }
  return {
    forecastAvailable: fc.available, ...base, days,
    credits: [...credits].map(([text, link]) => ({ text, link })),
    reason: null,
  };
}
