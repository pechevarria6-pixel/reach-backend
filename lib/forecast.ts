// ─── What the weather is forecast to do, for days close enough to know ──
// The owner, 2026-11-05: "reach also needs to account for weather data in
// planning". lib/climate.ts already says what a month is USUALLY like (NASA
// POWER normals). This file is the other half: a real forecast, for trip
// days inside a forecast's range, and nothing past it.
//
// ── The sources, and their rules (research of 2026-11-05) ──
//
//   MET Norway Locationforecast 2.0 — global, about nine days ahead, free,
//     NLOD 2.0 / CC BY 4.0, commercial use allowed. Must be credited ("Data
//     from MET Norway", with a link). Every request carries a User-Agent that
//     identifies the app and how to reach it, or it is refused (403). Never
//     ask again before the response's Expires; send If-Modified-Since. No
//     more than four decimals in a coordinate. Under 20 requests a second
//     for the whole app. Apps must not call it from the device: it is fetched
//     here, on the server, and cached (lib/forecast-store.ts). Outside the
//     Nordic countries its model updates every six hours, so a place there is
//     asked at most every three hours.
//
//   US National Weather Service, api.weather.gov — US only, public domain,
//     free. Also wants a User-Agent with contact details. Two steps: /points
//     gives the grid's hourly-forecast link and its time zone, then the
//     hourly forecast itself. Reach must not imply NWS or NOAA endorses it,
//     must not use their logo, and must not present data it has changed as
//     official — the daily figures here are Reach's summary of the hourly
//     periods, and the credit says exactly that.
//
//   Open-Meteo's free tier is non-commercial only and is not used.
//
// ── What may be said ──
//
//   - A day is forecast only when the source's own periods cover it (06:00
//     to 22:00 local, or what is left of today), and only inside the
//     source's range. Past that, the climate normals — "usually", never
//     "forecast" (lib/forecast-store.ts planWeather).
//   - Every figure is the source's, summarised: highs are the warmest hourly
//     reading (or the source's own six-hour max), rain chance is the highest
//     chance the source gives for any period of that part of the day, rain
//     amount is the sum of the source's amounts. NWS gives no amount, and
//     none is said.
//   - Nothing here knows about storms beyond what the source's own symbol or
//     wording says. Thunder is said only where the source says thunder.
//   - Sunrise and sunset are calculated (the standard solar equations), not
//     fetched, and are labelled so. A clock time for them is given only where
//     the place's time zone is known (an NWS point names it); elsewhere the
//     instant and the length of the day, which need no zone.
//
// Pure: no database, no network. The reader and the cache are
// lib/forecast-store.ts.

import { monthSummary, type ClimateNormals } from './climate.ts';

export type ForecastSource = 'met_norway' | 'nws';

export interface SourceInfo {
  id: ForecastSource;
  name: string;
  /** What goes under every figure from it. */
  credit: string;
  link: string;
  /** The furthest day ahead it is ever used for, counting today as 0. */
  horizonDays: number;
}

export const SOURCES: Record<ForecastSource, SourceInfo> = {
  met_norway: {
    id: 'met_norway', name: 'MET Norway',
    credit: 'Data from MET Norway',
    link: 'https://www.met.no/en/free-meteorological-data',
    // "Next 9 days": today and the eight after it.
    horizonDays: 8,
  },
  nws: {
    id: 'nws', name: 'weather.gov',
    // Their data, our summary of it, and not presented as theirs.
    credit: 'Forecast data from the US National Weather Service (weather.gov), summarised by Reach — not an official NWS product',
    link: 'https://www.weather.gov',
    // The hourly forecast runs about six and a half days; coverage decides
    // the last day, this only caps it.
    horizonDays: 7,
  },
};

export const SUN_CREDIT = 'Sunrise and sunset calculated from the date and place';

// ── Identifying ourselves ────────────────────────────────────────────────

/** The app's own site: a contact both services accept. Never a person's address. */
export const APP_SITE = 'https://alcanzar.io';

/**
 * The User-Agent both services require. FORECAST_CONTACT may add an ops
 * address or a contact page (e.g. "ops@alcanzar.io") — a generic one, set by
 * the owner; anything that is not plainly an address or a URL is ignored
 * rather than sent.
 */
export function forecastUserAgent(env: Record<string, string | undefined> = process.env): string {
  const raw = String(env.FORECAST_CONTACT ?? '').trim();
  const ok = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(raw) || /^https:\/\/[\w.-]+(\/[\w./-]*)?$/.test(raw);
  return `Reach/1.0 (+${APP_SITE}${ok ? `; ${raw}` : ''})`;
}

// ── Where ────────────────────────────────────────────────────────────────

export interface Point { lat: number; lng: number }

const coord = (v: unknown): number | null => {
  // Number(null) is 0 and 0 is finite: a plan nobody placed is not at Null Island.
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The point a forecast is asked for and cached under: two decimal places
 * (about a kilometre — finer than either model's grid, and inside MET
 * Norway's four-decimal limit). Null for a missing, impossible or 0,0 point.
 */
export function forecastPoint(lat: unknown, lng: unknown): Point | null {
  const a = coord(lat), b = coord(lng);
  if (a === null || b === null || a < -90 || a > 90 || b < -180 || b > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: Math.round(a * 100) / 100, lng: Math.round(b * 100) / 100 };
}

/** US states and territories, which is where api.weather.gov answers. */
const US_FAMILY = new Set(['US', 'PR', 'VI', 'GU', 'AS', 'MP', 'UM']);
const US_BOXES: Array<[number, number, number, number]> = [
  [24.4, 49.4, -125.0, -66.9], // the lower 48
  [51.0, 71.5, -180.0, -129.9], // Alaska
  [18.8, 22.4, -160.5, -154.6], // Hawaii
  [17.6, 18.6, -67.4, -64.5], // Puerto Rico and the Virgin Islands
  [13.2, 15.3, 144.6, 146.1], // Guam and the Northern Marianas
];

/**
 * Whether to ask the NWS. With the plan's country, that decides it — a point
 * near Vancouver is inside the lower-48 box and is not ours to ask the NWS
 * about. Without one, the boxes; a 404 from /points is then the answer.
 */
export function nwsMayCover(p: Point, country?: string | null): boolean {
  const cc = String(country ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) return US_FAMILY.has(cc);
  return US_BOXES.some(([s, n, w, e]) => p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e);
}

/** MET Norway's Nordic model area, roughly: there it updates hourly. */
export function inNordicModel(p: Point): boolean {
  return p.lat >= 53 && p.lat <= 72 && p.lng >= -2 && p.lng <= 32;
}

/** How soon MET Norway may be asked again for a place, at the least. */
export function metMinIntervalMs(p: Point): number {
  return inNordicModel(p) ? 30 * 60_000 : 3 * 3_600_000;
}

// ── The source's periods, in one shape ───────────────────────────────────

export type Sky =
  | 'clear' | 'partly_cloudy' | 'cloudy' | 'fog' | 'haze'
  | 'light_rain' | 'showers' | 'rain' | 'heavy_rain' | 'sleet' | 'snow' | 'thunder';

/** Worst first. A part of the day is described by the worst sky that lasts two hours or more. */
const SEVERITY: Sky[] = ['thunder', 'heavy_rain', 'snow', 'sleet', 'rain', 'showers', 'light_rain', 'fog', 'haze', 'cloudy', 'partly_cloudy', 'clear'];
const WET = new Set<Sky>(['thunder', 'heavy_rain', 'snow', 'sleet', 'rain', 'showers', 'light_rain']);

export const SKY_WORDS: Record<Sky, string> = {
  clear: 'clear', partly_cloudy: 'partly cloudy', cloudy: 'cloudy', fog: 'fog', haze: 'haze',
  light_rain: 'light rain', showers: 'showers', rain: 'rain', heavy_rain: 'heavy rain',
  sleet: 'sleet', snow: 'snow', thunder: 'thunderstorms',
};

/** One period of a forecast, as either source gives it. Instants are UTC. */
export interface Step {
  start: string;
  hours: number;
  /** The temperature at the start of the period. */
  tempC: number | null;
  /** MET Norway's six-hour max and min, where the period is six hours. */
  maxC: number | null;
  minC: number | null;
  /** The period's total, mm. Null where the source gives no amount (NWS). */
  precipMm: number | null;
  /** Chance of precipitation in the period, %. Null where the source gives none. */
  rainChance: number | null;
  thunderChance: number | null;
  windMs: number | null;
  gustMs: number | null;
  sky: Sky | null;
  /** The source's own word for it: a MET symbol code, or NWS's shortForecast. */
  said: string | null;
}

export interface Parsed {
  source: ForecastSource;
  /** When the source last ran its model, as it says. */
  updatedAt: string | null;
  steps: Step[];
  /** The place's IANA zone, where the source names it (NWS). */
  tz: string | null;
}

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const iso = (v: unknown): string | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** A MET Norway symbol code ("lightrainshowers_day") as a sky. */
export function skyFromMet(code: unknown): Sky | null {
  const c = String(code ?? '').toLowerCase().replace(/_(day|night|polartwilight)$/, '');
  if (!c) return null;
  if (c.includes('thunder')) return 'thunder';
  if (c.includes('snow')) return 'snow';
  if (c.includes('sleet')) return 'sleet';
  if (c.startsWith('heavyrain')) return 'heavy_rain';
  if (c.includes('rainshowers')) return 'showers';
  if (c.startsWith('lightrain')) return 'light_rain';
  if (c.startsWith('rain')) return 'rain';
  if (c === 'fog') return 'fog';
  if (c === 'cloudy') return 'cloudy';
  if (c === 'partlycloudy' || c === 'fair') return 'partly_cloudy';
  if (c === 'clearsky') return 'clear';
  return null;
}

/** NWS's shortForecast ("Chance Light Rain", "Mostly Sunny") as a sky. */
export function skyFromNws(text: unknown): Sky | null {
  const t = String(text ?? '').toLowerCase();
  if (!t) return null;
  if (/thunder|t-storm/.test(t)) return 'thunder';
  if (/snow|blizzard|flurr/.test(t)) return 'snow';
  if (/sleet|freezing|ice pellets|wintry/.test(t)) return 'sleet';
  if (/heavy rain/.test(t)) return 'heavy_rain';
  if (/showers/.test(t)) return 'showers';
  if (/drizzle|light rain/.test(t)) return 'light_rain';
  if (/rain/.test(t)) return 'rain';
  if (/fog/.test(t)) return 'fog';
  if (/haze|smoke|dust/.test(t)) return 'haze';
  if (/mostly cloudy|cloudy|overcast/.test(t)) return 'cloudy';
  if (/partly|mostly sunny|mostly clear/.test(t)) return 'partly_cloudy';
  if (/sunny|clear|fair/.test(t)) return 'clear';
  return null;
}

/**
 * MET Norway's /complete answer as periods. Hourly where it gives the next
 * hour, six-hourly after; never both for the same hour, so nothing is
 * counted twice.
 */
export function parseMet(body: unknown): Parsed | { error: string } {
  const b = body as any;
  const series = b?.properties?.timeseries;
  if (!Array.isArray(series) || !series.length) return { error: 'no timeseries in the response' };
  const rows = series
    .map((e: any) => ({ t: Date.parse(String(e?.time ?? '')), d: e?.data }))
    .filter((e: { t: number; d: unknown }) => Number.isFinite(e.t) && e.d && typeof e.d === 'object')
    .sort((x: { t: number }, y: { t: number }) => x.t - y.t);
  const steps: Step[] = [];
  let coveredUntil = -Infinity;
  for (const { t, d } of rows) {
    if (t < coveredUntil) continue;
    const now = d.instant?.details ?? {};
    const one = d.next_1_hours, six = d.next_6_hours;
    const next = one?.details ? { p: one, hours: 1 } : six?.details ? { p: six, hours: 6 } : null;
    if (!next) continue;
    const det = next.p.details ?? {};
    steps.push({
      start: new Date(t).toISOString(), hours: next.hours,
      tempC: num(now.air_temperature, -90, 60),
      maxC: next.hours === 6 ? num(det.air_temperature_max, -90, 60) : null,
      minC: next.hours === 6 ? num(det.air_temperature_min, -90, 60) : null,
      precipMm: num(det.precipitation_amount, 0, 500),
      rainChance: num(det.probability_of_precipitation, 0, 100),
      thunderChance: num(det.probability_of_thunder, 0, 100),
      windMs: num(now.wind_speed, 0, 120),
      gustMs: num(now.wind_speed_of_gust, 0, 150),
      sky: skyFromMet(next.p.summary?.symbol_code),
      said: typeof next.p.summary?.symbol_code === 'string' ? next.p.summary.symbol_code : null,
    });
    coveredUntil = t + next.hours * 3_600_000;
  }
  if (!steps.length) return { error: 'no period in the response carries a forecast' };
  return { source: 'met_norway', updatedAt: iso(b?.properties?.meta?.updated_at), steps, tz: null };
}

/** NWS /points: where the hourly forecast is, and the place's time zone. */
export function parseNwsPoints(body: unknown): { hourlyUrl: string; tz: string | null; grid: string } | { error: string } {
  const p = (body as any)?.properties;
  const url = typeof p?.forecastHourly === 'string' ? p.forecastHourly : '';
  // Only ever their own host: this URL is fetched with our User-Agent.
  if (!/^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast\/hourly$/.test(url)) {
    return { error: 'no hourly forecast link for this point' };
  }
  const tz = typeof p?.timeZone === 'string' && /^[A-Za-z_]+\/[A-Za-z_/+-]+$/.test(p.timeZone) ? p.timeZone : null;
  return { hourlyUrl: url, tz, grid: `${p.gridId}/${p.gridX},${p.gridY}` };
}

/** "10 to 15 km/h", "9 km/h", "5 mph" → m/s, from the larger figure. */
export function windFromNws(text: unknown): number | null {
  const s = String(text ?? '').toLowerCase();
  const figures = (s.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  if (!figures.length) return null;
  const top = Math.max(...figures);
  if (/km\/h/.test(s)) return Math.round(top / 3.6 * 10) / 10;
  if (/mph/.test(s)) return Math.round(top * 0.44704 * 10) / 10;
  if (/kt|knot/.test(s)) return Math.round(top * 0.514444 * 10) / 10;
  return null;
}

/** NWS's hourly forecast as periods. No amount of rain: NWS's hourly forecast gives none. */
export function parseNwsHourly(body: unknown, tz: string | null): Parsed | { error: string } {
  const p = (body as any)?.properties;
  const periods = Array.isArray(p?.periods) ? p.periods : null;
  if (!periods?.length) return { error: 'no periods in the response' };
  const steps: Step[] = [];
  for (const x of periods) {
    const a = Date.parse(String(x?.startTime ?? '')), z = Date.parse(String(x?.endTime ?? ''));
    if (!Number.isFinite(a) || !Number.isFinite(z) || z <= a) continue;
    const t = typeof x.temperature === 'number' ? x.temperature
      : typeof x.temperature?.value === 'number' ? x.temperature.value : NaN;
    const unit = String(x.temperatureUnit ?? x.temperature?.unitCode ?? '').toUpperCase();
    const c = !Number.isFinite(t) ? null : /F/.test(unit) ? (t - 32) * 5 / 9 : t;
    steps.push({
      start: new Date(a).toISOString(), hours: Math.round((z - a) / 3_600_000),
      tempC: c === null ? null : num(Math.round(c * 10) / 10, -90, 60),
      maxC: null, minC: null, precipMm: null,
      rainChance: num(x.probabilityOfPrecipitation?.value ?? null, 0, 100),
      thunderChance: null,
      windMs: windFromNws(x.windSpeed),
      gustMs: windFromNws(x.windGust),
      sky: skyFromNws(x.shortForecast),
      said: typeof x.shortForecast === 'string' ? x.shortForecast : null,
    });
  }
  if (!steps.length) return { error: 'no usable period in the response' };
  return { source: 'nws', updatedAt: iso(p?.updateTime) ?? iso(p?.generatedAt), steps, tz };
}

// ── The place's clock ────────────────────────────────────────────────────

/**
 * Which local day and hour an instant is at the place. With a named zone,
 * exactly; without one, by longitude, the same approximation lib/calendar.ts
 * dayWhere and the pings make (a few hours out at a zone's edge).
 */
export type PlaceClock = (ms: number) => { day: string; hour: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
export function placeClock(tz: string | null, lng: number): PlaceClock {
  if (tz) {
    try {
      const f = formatters.get(tz) ?? new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
      });
      formatters.set(tz, f);
      return (ms: number) => {
        const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
        return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
      };
    } catch {
      // A zone Intl does not know falls back to the longitude.
    }
  }
  const offset = Math.max(-12, Math.min(14, Math.round(lng / 15))) * 3_600_000;
  return (ms: number) => {
    const d = new Date(ms + offset);
    return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
  };
}

/** A calendar date `n` days after `day`. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// ── Sunrise and sunset, calculated ───────────────────────────────────────

const rad = Math.PI / 180;

/**
 * Sunrise and sunset on a date at a place, as instants, from the standard
 * sunrise equation (solar transit, declination, a −0.833° horizon for
 * refraction and the sun's disc). Good to a minute or two away from the
 * poles. Null on a day the sun does not rise or does not set.
 */
export function sunTimes(day: string, lat: number, lng: number): { rise: number | null; set: number | null; polar: 'day' | 'night' | null } {
  const noonJd = Date.parse(`${day}T12:00:00Z`) / 86_400_000 + 2440587.5;
  const n = Math.round(noonJd - 2451545.0);
  const jStar = n - lng / 360;
  const M = ((357.5291 + 0.98560028 * jStar) % 360 + 360) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = ((M + C + 180 + 102.9372) % 360 + 360) % 360;
  const transit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
  if (cosW < -1) return { rise: null, set: null, polar: 'day' };
  if (cosW > 1) return { rise: null, set: null, polar: 'night' };
  const w = Math.acos(cosW) / rad;
  const ms = (j: number) => Math.round((j - 2440587.5) * 86_400_000);
  return { rise: ms(transit - w / 360), set: ms(transit + w / 360), polar: null };
}

function clockWords(ms: number, tz: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));
  } catch {
    return null;
  }
}

// ── Days ─────────────────────────────────────────────────────────────────

export type PartName = 'morning' | 'afternoon' | 'evening';
export const PARTS: Record<PartName, [number, number]> = { morning: [6, 12], afternoon: [12, 18], evening: [18, 24] };

export interface ForecastPart {
  highC: number; lowC: number; highF: number; lowF: number;
  /** The highest chance of rain the source gives for any period in it, %. */
  rainChance: number | null;
  /** The source's amounts, summed, mm. Null where the source gives none. */
  precipMm: number | null;
  windMs: number | null;
  gustMs: number | null;
  sky: Sky | null;
  /** "light rain", in words. */
  conditions: string | null;
  worries: Worry[];
}

export interface ForecastDay extends ForecastPart {
  date: string;
  source: ForecastSource;
  /** Today, from now on: the figures are for the hours still to come, not the whole day. */
  restOfDay: boolean;
  /**
   * The local hours the day's rain, wind, conditions and worries describe
   * ([8, 20]); the high and low are the whole day's. Null where the daytime
   * held nothing to summarise and the whole day's figures stand.
   */
  verdictHours: [number, number] | null;
  parts: Record<PartName, ForecastPart | null>;
  sun: {
    /** ISO instants. Null on a polar day or night. */
    rise: string | null; set: string | null;
    /** "6:42 AM" in the place's own zone — only where the zone is known. */
    riseLocal: string | null; setLocal: string | null;
    daylightHours: number | null;
    polar: 'day' | 'night' | null;
    credit: string;
  };
}

/** Hours of the day that must be in the forecast for it to describe the day. */
const DAY_FROM = 6, DAY_TO = 22;
/** The hours a day's own verdict — rain, wind, conditions, worries — is read from. */
export const DAYTIME: [number, number] = [8, 20];

const cToF = (c: number) => Math.round(c * 9 / 5 + 32);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** One hour of a step; `first` when it is the hour the step starts, the instant its tempC is for. */
type Hour = { step: Step; local: { day: string; hour: number }; first: boolean };

/**
 * The highs and lows a set of hours can stand behind. An instant reading
 * counts where its instant is among the hours. A six-hour max or min counts
 * only where most of its six hours are — it may fall anywhere in the step,
 * so a morning that overlaps one hour of an 11:00–17:00 step does not take
 * that step's afternoon peak (Moab, recorded 2026-11-05: the morning of the
 * 8th read 15 °C, the steps covering the morning peak at 12.2 °C; in July
 * the same step would have called the morning VERY HOT).
 */
function extremes(hours: Hour[]): { highs: number[]; lows: number[] } {
  const highs: number[] = [], lows: number[] = [];
  const count = new Map<Step, number>();
  for (const h of hours) count.set(h.step, (count.get(h.step) ?? 0) + 1);
  for (const [s, n] of count) {
    const most = n * 2 >= s.hours;
    if (most && s.maxC !== null) highs.push(s.maxC);
    if (most && s.minC !== null) lows.push(s.minC);
    if (s.tempC !== null && hours.some(h => h.step === s && h.first)) { highs.push(s.tempC); lows.push(s.tempC); }
  }
  return { highs, lows };
}

function summarise(hours: Hour[]): ForecastPart | null {
  if (!hours.length) return null;
  const { highs, lows } = extremes(hours);
  if (!highs.length || !lows.length) return null;
  const steps = [...new Set(hours.map(h => h.step))];
  const chances = steps.map(s => s.rainChance).filter((v): v is number => v !== null);
  // An amount for the part only when every hour of it has one.
  const amounts = hours.map(h => (h.step.precipMm === null ? null : h.step.precipMm / h.step.hours));
  const precip = amounts.every(a => a !== null) ? r1((amounts as number[]).reduce((a, b) => a + b, 0)) : null;
  const winds = steps.map(s => s.windMs).filter((v): v is number => v !== null);
  const gusts = steps.map(s => s.gustMs).filter((v): v is number => v !== null);
  // NWS calls an hour "Slight Chance Light Rain" at 20%: its sky is rain and
  // its chance says it probably will not. Such an hour is "possible", and a
  // part is only described as wet when the wet hours are likelier than not.
  const sure = new Map<Sky, number>(), maybe = new Map<Sky, number>();
  for (const h of hours) {
    const s = h.step.sky;
    if (!s) continue;
    const doubtful = WET.has(s) && h.step.rainChance !== null && h.step.rainChance < 50;
    const into = doubtful ? maybe : sure;
    into.set(s, (into.get(s) ?? 0) + 1);
  }
  const lasting = SEVERITY.find(s => WET.has(s) && (sure.get(s) ?? 0) >= 2);
  const ranked = (m: Map<Sky, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || SEVERITY.indexOf(a[0]) - SEVERITY.indexOf(b[0]))[0]?.[0] ?? null;
  const dry = new Map([...sure].filter(([s]) => !WET.has(s)));
  const sky = lasting ?? ranked(dry) ?? ranked(maybe) ?? ranked(sure);
  const possible = !!sky && !lasting && !dry.size && maybe.has(sky);
  const highC = Math.max(...highs), lowC = Math.min(...lows);
  const part: ForecastPart = {
    highC: Math.round(highC), lowC: Math.round(lowC), highF: cToF(highC), lowF: cToF(lowC),
    rainChance: chances.length ? Math.round(Math.max(...chances)) : null,
    precipMm: precip,
    windMs: winds.length ? r1(Math.max(...winds)) : null,
    gustMs: gusts.length ? r1(Math.max(...gusts)) : null,
    sky, conditions: sky ? `${SKY_WORDS[sky]}${possible ? ' possible' : ''}` : null,
    worries: [],
  };
  const thunder = steps.some(s => (s.thunderChance ?? 0) >= THUNDER_CHANCE_PCT);
  part.worries = worriesOf(part, thunder, Math.max(...highs));
  return part;
}

/**
 * The days a forecast describes, each only where its periods cover the day
 * (from 06:00, or from now on today, to 22:00, every hour) and never past the
 * source's horizon. `now` decides today on the place's clock.
 */
export function forecastDays(parsed: Parsed, at: Point, now: Date = new Date()): ForecastDay[] {
  const clock = placeClock(parsed.tz, at.lng);
  const today = clock(now.getTime());
  const last = addDays(today.day, SOURCES[parsed.source].horizonDays);
  const byDay = new Map<string, Hour[]>();
  for (const step of parsed.steps) {
    const a = Date.parse(step.start);
    for (let i = 0; i < step.hours; i++) {
      const ms = a + i * 3_600_000;
      // Hours already gone describe nothing still to come.
      if (ms + 3_600_000 <= now.getTime()) continue;
      const local = clock(ms);
      if (local.day < today.day || local.day > last) continue;
      const list = byDay.get(local.day) ?? [];
      list.push({ step, local, first: i === 0 });
      byDay.set(local.day, list);
    }
  }
  const out: ForecastDay[] = [];
  for (const [day, hours] of [...byDay.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const have = new Set(hours.map(h => h.local.hour));
    const from = day === today.day ? Math.max(DAY_FROM, today.hour + 1) : DAY_FROM;
    let covered = true;
    for (let h = from; h < DAY_TO; h++) if (!have.has(h)) { covered = false; break; }
    // Today after nine in the evening has nothing left worth calling a day.
    if (!covered || (day === today.day && from >= DAY_TO)) continue;
    const all = summarise(hours);
    if (!all) continue;
    const parts = {} as Record<PartName, ForecastPart | null>;
    for (const [name, [a, z]] of Object.entries(PARTS) as Array<[PartName, [number, number]]>) {
      // A part is only described whole: what is left of today's afternoon at
      // five o'clock is one hour, not the afternoon; an evening the forecast
      // stops in the middle of is not the evening.
      const started = day === today.day && today.hour >= a;
      let whole = !started;
      for (let h = a; whole && h < z; h++) if (!have.has(h)) whole = false;
      parts[name] = whole ? summarise(hours.filter(h => h.local.hour >= a && h.local.hour < z)) : null;
    }
    // The day's own verdict is its daytime: a shower at four in the morning
    // does not spoil a day out. Its rain, wind, conditions and worries are
    // all that window's, so a figure said beside the verdict is the figure
    // that raised it — Seattle, 7 November: 61% in the daytime, 96% only
    // from ten at night, and "Rain likely (96%)" was said of the day. The
    // high and low stay the whole day's.
    const daytime = summarise(hours.filter(h => h.local.hour >= DAYTIME[0] && h.local.hour < DAYTIME[1]));
    const sun = sunTimes(day, at.lat, at.lng);
    out.push({
      ...all,
      ...(daytime ? {
        rainChance: daytime.rainChance, precipMm: daytime.precipMm, windMs: daytime.windMs, gustMs: daytime.gustMs,
        sky: daytime.sky, conditions: daytime.conditions, worries: daytime.worries,
      } : {}),
      verdictHours: daytime ? DAYTIME : null,
      date: day, source: parsed.source, restOfDay: day === today.day, parts,
      sun: {
        rise: sun.rise === null ? null : new Date(sun.rise).toISOString(),
        set: sun.set === null ? null : new Date(sun.set).toISOString(),
        riseLocal: sun.rise !== null && parsed.tz ? clockWords(sun.rise, parsed.tz) : null,
        setLocal: sun.set !== null && parsed.tz ? clockWords(sun.set, parsed.tz) : null,
        daylightHours: sun.rise !== null && sun.set !== null ? r1((sun.set - sun.rise) / 3_600_000) : sun.polar === 'day' ? 24 : sun.polar === 'night' ? 0 : null,
        polar: sun.polar, credit: SUN_CREDIT,
      },
    });
  }
  return out;
}

// ── What spoils a part of the day out of doors ───────────────────────────

export type Worry = 'rain' | 'storms' | 'snow' | 'heat' | 'wind';

/** Rain is "likely" from this chance on. */
export const RAIN_LIKELY_PCT = 60;
/** …or, where the source gives no chance, from this much in a part of the day. */
export const RAIN_MM = 2;
export const THUNDER_CHANCE_PCT = 30;
/** Too hot for a hike in the middle of the day. Not the heat no-go (35 °C, unenforced). */
export const HEAT_C = 32;
/** About 45 km/h / 28 mph sustained, or 65 km/h / 40 mph gusts. */
export const WIND_MS = 12.5;
export const GUST_MS = 18;

function worriesOf(p: Omit<ForecastPart, 'worries'>, thunder: boolean, exactHigh: number): Worry[] {
  const out: Worry[] = [];
  // A chance where the source gives one; its amount where it does not
  // (MET Norway gives no chance outside the Nordic model).
  const likely = p.rainChance !== null ? p.rainChance >= RAIN_LIKELY_PCT : (p.precipMm ?? 0) >= RAIN_MM;
  if ((p.sky === 'thunder' && (p.rainChance === null || p.rainChance >= THUNDER_CHANCE_PCT)) || thunder) out.push('storms');
  if ((p.sky === 'snow' || p.sky === 'sleet') && (likely || (p.precipMm ?? 0) >= 1)) out.push('snow');
  else if (likely || p.sky === 'heavy_rain') out.push('rain');
  if (exactHigh >= HEAT_C) out.push('heat');
  if ((p.windMs ?? 0) >= WIND_MS || (p.gustMs ?? 0) >= GUST_MS) out.push('wind');
  return out;
}

// ── Saying it ────────────────────────────────────────────────────────────

const deg = (c: number, f: number, fFirst: boolean) => fFirst ? `${f}°F / ${c}°C` : `${c}°C / ${f}°F`;
const kmh = (ms: number) => Math.round(ms * 3.6);
const mph = (ms: number) => Math.round(ms * 2.23694);

/**
 * The headline for the worst thing forecast in a part: "Rain likely",
 * "Thunderstorms possible". Null when nothing spoils it.
 */
export function worryHeadline(p: ForecastPart, fFirst = false): string | null {
  if (p.worries.includes('storms')) return 'Thunderstorms possible';
  if (p.worries.includes('snow')) return 'Snow likely';
  if (p.worries.includes('rain')) return 'Rain likely';
  if (p.worries.includes('heat')) return `Very hot (${deg(p.highC, p.highF, fFirst)})`;
  if (p.worries.includes('wind')) return 'Strong wind';
  return null;
}

/** "(70%)", "(about 4 mm)", or nothing — the figure that backs a rain headline. */
export function rainFigure(p: ForecastPart): string {
  if (p.rainChance !== null) return ` (${p.rainChance}%)`;
  if (p.precipMm !== null && p.precipMm > 0) return ` (about ${p.precipMm < 1 ? 'under 1' : Math.round(p.precipMm)} mm)`;
  return '';
}

/** One part, for a prompt or a screen: "afternoon: light rain, rain likely (80%), 14°C / 57°F". */
export function partLine(name: string, p: ForecastPart, fFirst = false): string {
  const bits = [
    p.conditions,
    p.rainChance !== null ? `${p.rainChance}% chance of rain` : null,
    p.precipMm !== null && p.precipMm >= 0.5 ? `about ${p.precipMm < 1 ? 'under 1' : Math.round(p.precipMm)} mm` : null,
    `up to ${deg(p.highC, p.highF, fFirst)}`,
    (p.gustMs ?? 0) >= GUST_MS ? `gusts to ${kmh(p.gustMs as number)} km/h / ${mph(p.gustMs as number)} mph`
      : (p.windMs ?? 0) >= WIND_MS ? `wind ${kmh(p.windMs as number)} km/h / ${mph(p.windMs as number)} mph` : null,
  ].filter(Boolean);
  const worry = p.worries.length ? ` — ${p.worries.map(w => WORRY_WORDS[w]).join(', ')}` : '';
  return `${name}: ${bits.join(', ')}${worry}`;
}

export const WORRY_WORDS: Record<Worry, string> = {
  rain: 'RAIN LIKELY', storms: 'THUNDERSTORMS POSSIBLE', snow: 'SNOW LIKELY', heat: `VERY HOT (${HEAT_C}°C+)`, wind: 'STRONG WIND',
};

/** "fetched 5 Nov, 16:18 UTC" — when, said plainly, in UTC because nothing else is certain. */
export function fetchedWords(at: string | null | undefined): string {
  const t = Date.parse(String(at ?? ''));
  if (!Number.isFinite(t)) return 'fetched recently';
  const d = new Date(t);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `fetched ${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

// ── Indoors and out ──────────────────────────────────────────────────────

/** The map's kinds (lib/discovery/osm.ts whatOf) that are out in the open. */
const OUTDOOR_KINDS = new Set([
  'park', 'nature reserve', 'garden', 'zoo', 'viewpoint', 'wilderness hut', 'playground', 'beach',
  'beach resort', 'water park', 'pitch', 'picnic site', 'camp site', 'biergarten', 'golf course',
  'marina', 'theme park', 'trail', 'national park', 'farm', 'dog park', 'shelter',
]);
/** …and the ones with a roof, which are where a wet afternoon goes. */
const INDOOR_KINDS = new Set([
  'museum', 'library', 'theatre', 'cinema', 'arts centre', 'gallery', 'sports centre', 'fitness centre',
  'books', 'games', 'pottery', 'planetarium', 'aquarium', 'bowling alley', 'escape game', 'spa', 'sauna',
  'mall', 'music venue', 'nightclub', 'brewery', 'pub', 'bar', 'cafe', 'restaurant', 'community centre',
  'dance', 'dancing school', 'cooking school', 'public bath', 'events venue', 'ice rink', 'arts centre',
  'public art gallery', 'social centre', 'winery', 'distillery', 'concert hall', 'casino', 'amusement arcade',
]);
const OUTDOOR_WORDS = /\b(hik(e|es|ed|ing)|trails?|trailhead|walk(s|ing)?|stroll|beach|picnic|kayak\w*|canoe\w*|paddle\w*|snorkel\w*|surf\w*|swim(ming)?(?! pool)|bike ride|cycl(e|ing)|park|gardens?|viewpoint|overlook|lookout|zoo|boat tour|sail\w*|climb\w*|outdoors?|national park|canyon|waterfall|summit|scenic drive)\b/i;
/**
 * A meal or a drink. A place to eat called Olive Garden, Park Tavern or The
 * Beach House is not out of doors because of its name: whether it has a
 * terrace is a fact about the venue, and only its row can say it.
 */
const DINING_WORDS = /\b(dinner|lunch|breakfast|brunch|supper|dine|dining|drinks?|cocktails?|coffee|caf[eé]s?|restaurant|tavern|bistro|brasserie|trattoria|osteria|diner|grill|kitchen|eatery|steakhouse|pizzeria|pizza|tacos?|sushi|ramen|bbq|barbecue|bakery|pub|bar|wine|brewery|brewpub|taproom|house)\b/i;
const INDOOR_WORDS = /\b(museum|gallery|cinema|movie|theat(re|er)|spa|aquarium|bowling|escape room|library|indoors?|concert hall|cooking class|workshop|planetarium)\b/i;

/**
 * Whether a line or a place is out of doors: from the map's kind when there
 * is one, which is a fact about the place; from the line's own words only
 * when there is no kind, and only when the words point one way. Null when
 * nothing says.
 */
export function setting(kind?: string | null, words?: string | null): 'outdoor' | 'indoor' | null {
  const k = String(kind ?? '').replace(/_/g, ' ').trim().toLowerCase();
  if (OUTDOOR_KINDS.has(k)) return 'outdoor';
  if (INDOOR_KINDS.has(k)) return 'indoor';
  if (k) return null;
  const w = String(words ?? '');
  if (DINING_WORDS.test(w)) return null;
  const out = OUTDOOR_WORDS.test(w), inn = INDOOR_WORDS.test(w);
  return out && !inn ? 'outdoor' : inn && !out ? 'indoor' : null;
}

/** The menu places with a roof that are somewhere to go, not somewhere to eat. */
const NOT_A_SWAP = new Set(['restaurant', 'cafe', 'bar', 'pub', 'nightclub', 'brewery', 'winery', 'distillery']);
export function indoorSwaps<T extends { kind?: string | null }>(places: T[]): T[] {
  return places.filter(p => setting(p.kind) === 'indoor' && !NOT_A_SWAP.has(String(p.kind ?? '').toLowerCase()));
}

// ── The prompt ───────────────────────────────────────────────────────────

export interface PromptDay { label: string; day: ForecastDay; fetchedAt: string | null }

/**
 * What the generator is told about the forecast, as data. Only days we hold
 * a forecast for are listed, and the model is told the others are not.
 */
export function forecastPromptBlock(
  days: PromptDay[],
  indoor: Array<{ ref: string; name: string; kind: string }> = [],
  opts: { night?: boolean } = {},
): string {
  if (!days.length) return '';
  const said = [...new Set(days.map(d => `${SOURCES[d.day.source].name}, ${fetchedWords(d.fetchedAt)}`))];
  const lines = [
    `FORECAST (${said.join('; ')} — a forecast, which can change; it covers only the days listed):`,
  ];
  for (const { label, day } of days) {
    const parts = (Object.keys(PARTS) as PartName[])
      .map(n => (day.parts[n] ? partLine(n, day.parts[n] as ForecastPart) : null)).filter(Boolean);
    if (day.verdictHours) parts.unshift(partLine(`daytime ${day.verdictHours[0]}:00-${day.verdictHours[1]}:00 overall`, day));
    lines.push(`- ${label}: high ${day.highC}°C / ${day.highF}°F, low ${day.lowC}°C / ${day.lowF}°F${parts.length ? `; ${parts.join('; ')}` : ''}.`);
  }
  if (opts.night) {
    // The answer's "morning", "afternoon" and "evening" are the stops of one
    // evening, not the clock's — read against the forecast's evening.
    lines.push(`This is one evening out: its stops ("morning", "afternoon" and "evening" in your answer) are all after 6pm, so judge every one of them by the forecast evening above, never its morning or afternoon. The "daytime" ideas are earlier that day: judge them by that day's "daytime ${DAYTIME[0]}:00-${DAYTIME[1]}:00 overall".`);
  }
  const spoiled = days.some(d => (Object.values(d.day.parts) as Array<ForecastPart | null>).some(p => p?.worries.length) || d.day.worries.length);
  if (spoiled) {
    lines.push(
      'Where a part of a day above is marked RAIN LIKELY, THUNDERSTORMS POSSIBLE, SNOW LIKELY, VERY HOT or STRONG WIND, put nothing out of doors in it — no hike, trail, walk, beach, park, garden, viewpoint, zoo or boat. Move the outdoor thing to a part of the trip the forecast leaves clear, or use somewhere indoors from the menu.',
      indoor.length
        ? `Indoor places on the menu (the only ones you may use for this): ${indoor.slice(0, 15).map(p => `[${p.ref}] ${p.name} (${p.kind})`).join('; ')}.`
        : 'The menu holds no indoor place to go: for a spoiled part, plan something that needs no venue and is under a roof, or leave it free — never invent a place.',
    );
  }
  // A tip is saved with the plan and read days later, with no source, no
  // time and no credit beside it: the forecast changes and the tip would
  // not. The screen shows the forecast itself, from the row, credited.
  lines.push(
    'Use the forecast to decide what goes where. Never mention the weather forecast in a tip or anywhere else in your answer: the plan screen shows the live forecast with its source, and a sentence saved with the plan would go out of date.',
  );
  return lines.join('\n');
}

/**
 * A tip that states what the weather is forecast to do. Every such tip is
 * taken out, backed or not: a tip is saved as the line's subtitle and read
 * days later with no source, no fetch time and no credit beside it, so
 * "rain is forecast this afternoon" written on the 5th is still saying it on
 * the 8th when the forecast is dry. A day we hold no forecast for makes it
 * an invented fact outright. The rest of the slot stays; the screen shows
 * the forecast itself, from /api/plans/{id}/weather, credited and dated.
 */
const FORECAST_CLAIM = /\b(forecast(ed|s)?|expected to (rain|pour|storm|snow)|(will|going to) (rain|pour|storm|snow|be (wet|rainy|stormy|hot|windy|sunny|dry))|(rain|showers|storms?|thunderstorms?|snow|wind) (is |are )?(likely|expected|due|on the way))\b/i;
export function forecastTip(tip: unknown): boolean {
  return FORECAST_CLAIM.test(String(tip ?? ''));
}

// ── Climate normals for a day past the forecast ──────────────────────────

/** What a day past the forecast gets: the month's usual, said as usual. */
export function usualFor(n: ClimateNormals, date: string, fFirst = false) {
  const m = monthSummary(n, Number(date.slice(5, 7)));
  return {
    month: m.month, monthName: m.monthName,
    highC: m.highC, lowC: m.lowC, highF: m.highF, lowF: m.lowF,
    rainMm: m.rainMm, rainClass: m.rainClass, label: m.label,
    line: `Usually in ${m.monthName}: highs around ${deg(m.highC, m.highF, fFirst)}, ${m.label}`,
  };
}
