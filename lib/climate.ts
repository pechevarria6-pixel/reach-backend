// ─── What the weather is usually like, from forty years of averages ──────
// The owner asked for Reach to understand climate "in order to make
// recommendations based on best time of year to travel to specific areas".
//
// The source is NASA POWER's climatology service
// (power.larc.nasa.gov/api/temporal/climatology/point): monthly normals for
// any point on earth, from NASA's MERRA-2 reanalysis and satellite records.
// NASA data is not copyrighted and carries no restriction on commercial use
// (earthdata.nasa.gov, "Data Use Guidance"); POWER asks to be credited, and
// nothing may suggest NASA endorses Reach. Every line this file writes for a
// person carries the source and the period with it, for both reasons.
//
// What the numbers are, exactly, because it decides what may be said:
//
//   - They are averages for the ~50 km grid cell around the town, at the
//     cell's average ground height, not the town's. A mountain town in a
//     cell whose average ground is higher reads colder than the town is
//     (Aspen's cell sits about 850 m above Aspen). So these are "usually",
//     never a forecast and never "it will be".
//   - The daily high and low are the monthly mean (T2M) plus and minus half
//     the mean daily range (T2M_RANGE). POWER's climatology has no mean
//     daily maximum as such — its T2M_MAX is the hottest reading of the
//     whole period, which is not what "highs around" means.
//   - Rain is PRECTOTCORR, the mean mm per day, times the days in the month.
//     There is no count of rainy days in the climatology. The "rainy-day
//     proxy" here is a class of the month's total (dry, some rain, wet, very
//     wet) and where the month ranks in the year — never a number of days.
//   - Nothing here knows about storms. A wet season is reported as "the
//     wettest months", because that is what the data shows. Hurricane,
//     cyclone or typhoon risk is not in it and is never claimed.
//
// Pure: no database, no network. The reader is lib/climate-store.ts, the
// loader scripts/ingest/climate.mjs.

export const CLIMATE_SOURCE = 'NASA POWER';
export const CLIMATE_SOURCE_URL = 'https://power.larc.nasa.gov';
/** What POWER asks to be cited as. */
export const CLIMATE_CREDIT =
  "Data from NASA Langley Research Center's POWER project, funded through the NASA Earth Science Division.";

/** The POWER parameters the loader asks for, in the order they are stored. */
export const POWER_PARAMETERS = ['T2M', 'T2M_RANGE', 'PRECTOTCORR', 'RH2M', 'CLOUD_AMT', 'WS2M'] as const;
/** The climatological period asked for. Stored per row from what POWER says it used. */
export const POWER_START = 1981;
export const POWER_END = 2020;

const MONTH_KEYS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
/** Days in each month of a common year; a monthly total is a daily mean times these. */
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Twelve monthly normals for one place, as stored. Index 0 is January. */
export interface ClimateNormals {
  name: string;
  country: string | null;
  lat: number;
  lng: number;
  /** Mean air temperature at 2 m, °C. */
  t2m: number[];
  /** Mean daily range (max − min) at 2 m, °C. */
  t2mRange: number[];
  /** Mean precipitation, mm per day. */
  precipMmDay: number[];
  /** Mean relative humidity at 2 m, %. Null when POWER had no value. */
  rh2m: Array<number | null> | null;
  /** Mean cloud amount, %. */
  cloudPct?: Array<number | null> | null;
  /** Mean wind speed at 2 m, m/s. */
  windMs?: Array<number | null> | null;
  /** "1981–2020", from what POWER reported it used. */
  period: string;
  source: string;
  /** The grid cell's average ground height, m — not the town's. */
  gridElevationM?: number | null;
}

// ─── Reading POWER's answer ──────────────────────────────────────────────

/**
 * POWER's climatology response as normals, or why it is not usable. A
 * response with any required month missing or at the fill value (-999) is
 * refused whole: storing a failure as data is how a place would come to
 * "average" -999 °C in March.
 */
export function parsePower(
  body: unknown, place: { name: string; country: string | null; lat: number; lng: number },
): { normals: ClimateNormals } | { error: string } {
  const b = body as any;
  const params = b?.properties?.parameter;
  if (!params || typeof params !== 'object') {
    const said = Array.isArray(b?.messages) ? String(b.messages[0] ?? '') : '';
    return { error: `no parameters in the response${said ? `: ${said.slice(0, 160)}` : ''}` };
  }
  const fill = Number.isFinite(Number(b?.header?.fill_value)) ? Number(b.header.fill_value) : -999;
  const read = (key: string, required: boolean): Array<number | null> | null | 'bad' => {
    const row = params[key];
    if (!row || typeof row !== 'object') return required ? 'bad' : null;
    const out = MONTH_KEYS.map(m => {
      const v = row[m];
      return typeof v === 'number' && Number.isFinite(v) && v !== fill && v > -900 ? v : null;
    });
    if (required && out.some(v => v === null)) return 'bad';
    return out.every(v => v === null) ? null : out;
  };
  const t2m = read('T2M', true);
  const range = read('T2M_RANGE', true);
  const rain = read('PRECTOTCORR', true);
  if (t2m === 'bad' || range === 'bad' || rain === 'bad' || !t2m || !range || !rain) {
    return { error: 'a required month is missing or at the fill value (T2M, T2M_RANGE, PRECTOTCORR)' };
  }
  if ((range as number[]).some(v => v < 0) || (rain as number[]).some(v => v < 0)) {
    return { error: 'a negative range or rainfall — not a real normal' };
  }
  const opt = (k: string) => { const r = read(k, false); return r === 'bad' ? null : r; };
  const elevation = Array.isArray(b?.geometry?.coordinates) ? Number(b.geometry.coordinates[2]) : NaN;
  return {
    normals: {
      name: place.name, country: place.country, lat: place.lat, lng: place.lng,
      t2m: t2m as number[], t2mRange: range as number[], precipMmDay: rain as number[],
      rh2m: opt('RH2M'), cloudPct: opt('CLOUD_AMT'), windMs: opt('WS2M'),
      period: periodFrom(b?.header?.range) ?? `${POWER_START}–${POWER_END}`,
      source: CLIMATE_SOURCE,
      gridElevationM: Number.isFinite(elevation) ? Math.round(elevation) : null,
    },
  };
}

/** "40-year … (January 1981 - December 2020)" → "1981–2020". */
export function periodFrom(range: unknown): string | null {
  const years = String(range ?? '').match(/\b(19|20)\d{2}\b/g);
  if (!years || years.length < 2) return null;
  return `${years[0]}–${years[years.length - 1]}`;
}

// ─── One month ───────────────────────────────────────────────────────────

export type RainClass = 'dry' | 'some rain' | 'wet' | 'very wet';

export interface MonthSummary {
  /** 1–12. */
  month: number;
  monthName: string;
  highC: number; lowC: number; highF: number; lowF: number;
  /** The month's usual total. */
  rainMm: number; rainIn: number;
  /** The rainy-day proxy: a class of the month's total, not a count of days. */
  rainClass: RainClass;
  /** Where this month sits in the year: "one of the drier months", or null when the year's rain barely varies. */
  rainPlace: string | null;
  humidity: number | null;
  /** "warm and dry". */
  label: string;
  /** 0–100, see comfortScore. */
  comfort: number;
}

const cToF = (c: number) => c * 9 / 5 + 32;
const round = (n: number) => Math.round(n);

/** A month's total rain as a class. The thresholds are mm in the month. */
export function rainClass(mm: number): RainClass {
  if (mm < 25) return 'dry';
  if (mm < 75) return 'some rain';
  if (mm < 150) return 'wet';
  return 'very wet';
}

/** A usual daytime high as a word. °C. */
export function warmthWord(highC: number): string {
  if (highC < 0) return 'freezing';
  if (highC < 8) return 'cold';
  if (highC < 15) return 'cool';
  if (highC < 22) return 'mild';
  if (highC < 28) return 'warm';
  if (highC < 34) return 'hot';
  return 'very hot';
}

const RAIN_WORD: Record<RainClass, string> = { dry: 'dry', 'some rain': 'some rain', wet: 'wet', 'very wet': 'very wet' };

/** "warm and dry", "cool with some rain". */
export function climateLabel(highC: number, rainMm: number): string {
  const c = rainClass(rainMm);
  return c === 'some rain' ? `${warmthWord(highC)} with some rain` : `${warmthWord(highC)} and ${RAIN_WORD[c]}`;
}

/**
 * How comfortable a month usually is for being out and about, 0–100. One
 * simple rule, written down so it can be argued with:
 *
 *   start at 100, then take off
 *   - 4 a degree the usual high is below 18 °C
 *   - 5 a degree the usual high is above 27 °C
 *   - 2 a degree the usual low is below 0 °C
 *   - 1 for every 5 mm the month's rain is over 50 mm, at most 40
 *   - 1 a point of humidity over 70 % when the high is over 24 °C (sticky heat)
 *
 * It is a sightseeing score. A ski trip wants the months this marks down,
 * which is why it is only ever a hint about the weather, never a rule about
 * when to go.
 */
export function comfortScore(m: { highC: number; lowC: number; rainMm: number; humidity: number | null }): number {
  let s = 100;
  if (m.highC < 18) s -= (18 - m.highC) * 4;
  if (m.highC > 27) s -= (m.highC - 27) * 5;
  if (m.lowC < 0) s -= -m.lowC * 2;
  if (m.rainMm > 50) s -= Math.min(40, (m.rainMm - 50) / 5);
  if (m.humidity != null && m.highC > 24 && m.humidity > 70) s -= m.humidity - 70;
  return Math.max(0, Math.min(100, round(s)));
}

/** The month's total rain, mm, from the daily mean. */
function monthRain(place: ClimateNormals, i: number) {
  return place.precipMmDay[i] * DAYS[i];
}

/** 1 = the wettest month of the year, 12 = the driest. Ties share the lower rank. */
function rainRank(place: ClimateNormals, i: number): number {
  const mine = monthRain(place, i);
  return 1 + place.precipMmDay.filter((_, j) => monthRain(place, j) > mine).length;
}

/**
 * Whether the year's rain varies enough to call a month drier or wetter than
 * the rest. A place with 60 mm every month has no drier months, and saying
 * "one of the drier months" there would be a true rank and a false sentence.
 */
function rainVaries(place: ClimateNormals): boolean {
  const totals = place.precipMmDay.map((_, i) => monthRain(place, i));
  const hi = Math.max(...totals), lo = Math.min(...totals);
  return hi - lo >= 20 && hi >= lo * 1.5;
}

function rainPlaceOf(place: ClimateNormals, i: number): string | null {
  if (!rainVaries(place)) return null;
  const r = rainRank(place, i);
  // "The wettest month" of a desert is 36 mm. True as a rank, and it would
  // send somebody to Moab in October with an umbrella: a month is only
  // called wet-anything when it is wet on its own terms (75 mm or more).
  const wetOnItsOwn = monthRain(place, i) >= 75;
  if (r === 1 && wetOnItsOwn) return 'the wettest month';
  if (r <= 4 && wetOnItsOwn) return 'one of the wetter months';
  if (r <= 4) return null;
  if (monthRain(place, i) === Math.min(...place.precipMmDay.map((_, j) => monthRain(place, j)))) return 'the driest month';
  if (r >= 9) return 'one of the drier months';
  return null;
}

/** What a month is usually like there. `month` is 1–12. */
export function monthSummary(place: ClimateNormals, month: number): MonthSummary {
  const i = ((Math.round(month) - 1) % 12 + 12) % 12;
  const highC = place.t2m[i] + place.t2mRange[i] / 2;
  const lowC = place.t2m[i] - place.t2mRange[i] / 2;
  const rainMm = monthRain(place, i);
  const humidity = place.rh2m?.[i] ?? null;
  return {
    month: i + 1, monthName: MONTH_NAMES[i],
    highC: round(highC), lowC: round(lowC), highF: round(cToF(highC)), lowF: round(cToF(lowC)),
    rainMm: round(rainMm), rainIn: Math.round(rainMm / 25.4 * 10) / 10,
    rainClass: rainClass(rainMm), rainPlace: rainPlaceOf(place, i),
    humidity: humidity == null ? null : round(humidity),
    label: climateLabel(highC, rainMm),
    comfort: comfortScore({ highC, lowC, rainMm, humidity }),
  };
}

// ─── The year ────────────────────────────────────────────────────────────

/**
 * The months with the most comfortable weather: every month within 10 points
 * of the best, and at least 50. Empty when no month reaches 50 — a place that
 * is never comfortable by this rule has no "best months", and saying so is
 * better than naming the least bad. `allYear` when eleven or twelve qualify.
 */
export function bestMonths(place: ClimateNormals): { months: number[]; allYear: boolean; scores: number[] } {
  const scores = MONTH_NAMES.map((_, i) => monthSummary(place, i + 1).comfort);
  const top = Math.max(...scores);
  const months = top < 50 ? [] : scores.map((s, i) => (s >= Math.max(50, top - 10) ? i + 1 : 0)).filter(Boolean);
  return { months, allYear: months.length >= 11, scores };
}

/**
 * The wet season, as the data shows it: up to three months whose rain is at
 * least one and a half times the monthly average, wettest first then put in
 * calendar order. Only where some month reaches 60 mm — a desert's "wettest
 * month" of 30 mm is not a wet season. Says nothing about storms.
 */
export function wettestMonths(place: ClimateNormals): number[] {
  const totals = place.precipMmDay.map((_, i) => monthRain(place, i));
  const mean = totals.reduce((a, b) => a + b, 0) / 12;
  if (Math.max(...totals) < 60) return [];
  return totals.map((mm, i) => ({ mm, m: i + 1 }))
    .filter(x => x.mm >= mean * 1.5)
    .sort((a, b) => b.mm - a.mm).slice(0, 3)
    .map(x => x.m).sort((a, b) => a - b);
}

/**
 * Months as ranges, in the order of the year, joined across December:
 * [4,5,9,10] → "April–May, September–October"; [11,12,1,2] → "November–February".
 */
export function monthRanges(months: number[]): string {
  const set = [...new Set(months.filter(m => m >= 1 && m <= 12))].sort((a, b) => a - b);
  if (!set.length) return '';
  if (set.length === 12) return 'all year';
  const runs: number[][] = [];
  for (const m of set) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === m - 1) last.push(m); else runs.push([m]);
  }
  // A run ending in December joins the one starting in January.
  if (runs.length > 1 && runs[0][0] === 1 && runs[runs.length - 1].slice(-1)[0] === 12) {
    const tail = runs.pop()!;
    runs[0] = [...tail, ...runs[0]];
  }
  // Start with the run the year reaches first after the wrap has been
  // folded, so "November–February, June" reads as "June, November–February".
  runs.sort((a, b) => a[0] - b[0]);
  return runs.map(r => r.length === 1 ? MONTH_NAMES[r[0] - 1] : `${MONTH_NAMES[r[0] - 1]}–${MONTH_NAMES[r[r.length - 1] - 1]}`).join(', ');
}

/** "Best weather in Moab: April–May, September–October", or null when there is nothing honest to say. */
export function bestMonthsLine(place: ClimateNormals, name = place.name): string | null {
  const b = bestMonths(place);
  if (!b.months.length) return null;
  if (b.allYear) return `Weather in ${name} is much the same all year`;
  return `Best weather in ${name}: ${monthRanges(b.months)}`;
}

// ─── A trip's dates ──────────────────────────────────────────────────────

export interface TripClimate {
  place: string;
  /** Nights in each month the trip spans, in order, and where each sits in the year's rain. A day trip counts as one. */
  months: Array<{ month: number; nights: number; rainPlace: string | null }>;
  /** "October" or "October–November". */
  when: string;
  /** Weighted by nights. */
  highC: number; lowC: number; highF: number; lowF: number;
  /** Usual rain in the months, mm a day, weighted. */
  rainMmDay: number;
  label: string;
  /** The month with most nights, as monthSummary gives it. */
  lead: MonthSummary;
  /** Months of the wet season the trip falls in. */
  inWettest: number[];
  /** Average high under COLD_HIGH_C / at or over HOT_HIGH_C, as the area's averages say. */
  cold: boolean;
  hot: boolean;
  /**
   * The grid cell averages HIGH_GROUND_M or more. The town usually sits below
   * the cell's average ground, so it is usually warmer than these figures
   * say, and the screen says whose figures they are.
   */
  highGround: boolean;
  gridElevationM: number | null;
  source: string;
  period: string;
}

/**
 * The "Cold weather" no-go, checkable: a trip averages cold when the usual
 * daytime high across its nights is under 10 °C (50 °F). Heat, for "Extreme
 * heat": 35 °C (95 °F) and over. Averages across the nights, so a week that
 * is half a warm September and half a cold October is judged on the mix.
 */
export const COLD_HIGH_C = 10;
export const HOT_HIGH_C = 35;

/**
 * Where the averages stop being the town's. POWER's cells are about 50 km
 * across and carry the cell's average ground height; in mountains that is
 * far above the valley towns sit in. Aspen's cell averages 3,268 m and Aspen
 * is at 2,400; Moab's 1,819 against 1,220. At the standard lapse rate
 * (6.5 °C a km) that is 4 to 6 °C colder than the town.
 *
 * We hold no town heights, so nothing is corrected. Instead, over this
 * height, a verdict that the town-is-warmer bias could flip is not given:
 * a cold area is only called cold if it would still be cold HIGH_GROUND_ALLOWANCE_C
 * warmer, and a mild area is never said to have passed the heat no-go
 * unless it would pass that much warmer too.
 */
export const HIGH_GROUND_M = 1500;
export const HIGH_GROUND_ALLOWANCE_C = 6;

const ymd = (s: unknown): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? [y, mo, d] : null;
};

/**
 * Nights per month between two calendar dates, "YYYY-MM-DD" as the plan
 * stores them. A night belongs to the month of the evening it starts on, so
 * 30 Sep → 3 Oct is one September night and two October ones. The same date
 * twice (a day or an evening) is one in that month. Date.UTC is used for the
 * arithmetic only — these are calendar days, never instants.
 */
export function nightsByMonth(startDate: unknown, endDate: unknown): Array<{ month: number; nights: number }> {
  const a = ymd(startDate);
  if (!a) return [];
  const b = ymd(endDate) ?? a;
  const from = Date.UTC(a[0], a[1] - 1, a[2]);
  const to = Date.UTC(b[0], b[1] - 1, b[2]);
  const count = new Map<number, number>();
  const order: number[] = [];
  const add = (t: number) => {
    const m = new Date(t).getUTCMonth() + 1;
    if (!count.has(m)) order.push(m);
    count.set(m, (count.get(m) ?? 0) + 1);
  };
  if (to <= from) add(from);
  else for (let t = from, n = 0; t < to && n < 366; t += 86400000, n++) add(t);
  return order.map(m => ({ month: m, nights: count.get(m)! }));
}

/** What the weather is usually like across a trip's dates, or null with no dates. */
export function howIsIt(place: ClimateNormals, startDate: unknown, endDate?: unknown): TripClimate | null {
  const months = nightsByMonth(startDate, endDate);
  if (!months.length) return null;
  const total = months.reduce((a, m) => a + m.nights, 0);
  let t = 0, r = 0, rain = 0;
  for (const { month, nights } of months) {
    const i = month - 1;
    t += place.t2m[i] * nights; r += place.t2mRange[i] * nights; rain += place.precipMmDay[i] * nights;
  }
  t /= total; r /= total; rain /= total;
  const highC = t + r / 2, lowC = t - r / 2;
  const lead = monthSummary(place, [...months].sort((x, y) => y.nights - x.nights)[0].month);
  const wet = wettestMonths(place);
  return {
    place: place.name,
    months: months.map(m => ({ ...m, rainPlace: rainPlaceOf(place, m.month - 1) })),
    when: months.length === 1 ? MONTH_NAMES[months[0].month - 1] : `${MONTH_NAMES[months[0].month - 1]}–${MONTH_NAMES[months[months.length - 1].month - 1]}`,
    highC: round(highC), lowC: round(lowC), highF: round(cToF(highC)), lowF: round(cToF(lowC)),
    rainMmDay: Math.round(rain * 10) / 10,
    // The label reads a month's worth of rain at this rate.
    label: climateLabel(highC, rain * 30),
    lead, inWettest: months.map(m => m.month).filter(m => wet.includes(m)),
    cold: highC < COLD_HIGH_C, hot: highC >= HOT_HIGH_C,
    highGround: (place.gridElevationM ?? 0) >= HIGH_GROUND_M,
    gridElevationM: place.gridElevationM ?? null,
    source: place.source, period: place.period,
  };
}

// ─── Saying it ───────────────────────────────────────────────────────────

/**
 * Countries that read Fahrenheit first. The US and the territories that use
 * its units, and the few others that still do.
 */
const FAHRENHEIT = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'LR', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH']);

/**
 * Whether to put °F first: from the person's country when we hold it, else
 * the region of their locale ("en-US" → US). A locale with no region says
 * nothing, and Celsius is what most of the world reads.
 */
export function fahrenheitFirst(country?: string | null, locale?: string | null): boolean {
  const cc = String(country ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) return FAHRENHEIT.has(cc);
  const region = /[-_]([A-Za-z]{2})\b/.exec(String(locale ?? ''))?.[1]?.toUpperCase();
  return region ? FAHRENHEIT.has(region) : false;
}

const deg = (c: number, f: number, fFirst: boolean) => fFirst ? `${f}°F / ${c}°C` : `${c}°C / ${f}°F`;

/**
 * The one line an idea card shows: "Usually in October: highs around
 * 24°C / 75°F, one of the drier months". Where the year's rain barely varies
 * the rain part is the month's own class instead ("and dry"), never a rank
 * the data cannot back.
 */
export function climateLine(c: TripClimate, opts: { fahrenheitFirst?: boolean } = {}): string {
  const f = !!opts.fahrenheitFirst;
  const highs = `highs around ${deg(c.highC, c.highF, f)}`;
  // A rank is a fact about one month. Across two it is only said when both
  // share it, and then as "among the drier months".
  const ranks = [...new Set(c.months.map(m => m.rainPlace))];
  const shared = ranks.length === 1 ? ranks[0] : null;
  const rank = c.months.length === 1 || !shared ? shared
    : shared.replace(/^one of the /, 'among the ').replace(/^the (\w+) month$/, 'among the $1 months');
  // No rank to give: the amount, which is what the number actually is.
  const mm = Math.round(c.rainMmDay * 30);
  const inches = Math.round(mm / 25.4 * 10) / 10;
  const amount = mm < 5 ? 'almost no rain' : `about ${f ? `${inches} in / ${mm} mm` : `${mm} mm / ${inches} in`} of rain a month`;
  const where = c.highGround && c.gridElevationM != null
    ? ` on the high ground around ${c.place} (${c.gridElevationM.toLocaleString('en-US')} m; the town is often warmer)`
    : '';
  return `Usually in ${c.when}${where}: ${highs}, ${rank ?? amount}`;
}

/** The source line that goes under it. */
export function climateCredit(period: string): string {
  return `${CLIMATE_SOURCE} ${period} averages for the area, not a forecast`;
}

/**
 * The facts a prompt gets, as data. The model is told what the averages are
 * and what they are not, and what to do about them.
 */
export function climatePromptBlock(c: TripClimate): string {
  const lines = [
    `WEATHER ON THESE DATES (${c.source} ${c.period} averages for the area around ${c.place} — not a forecast):`,
    `- ${c.when}: highs around ${c.highC}°C / ${c.highF}°F, lows around ${c.lowC}°C / ${c.lowF}°F, ${c.lead.rainMm} mm (${c.lead.rainIn} in) of rain in ${c.lead.monthName} — ${c.label}${c.lead.rainPlace ? `, ${c.lead.rainPlace}` : ''}.`,
  ];
  if (c.inWettest.length) lines.push(`- ${monthRanges(c.inWettest)} ${c.inWettest.length === 1 ? 'is one of' : 'are among'} the wettest months there.`);
  if (c.highGround && c.gridElevationM != null) lines.push(`- These are for the surrounding area, which averages ${c.gridElevationM} m; ${c.place} itself is probably lower and several degrees warmer.`);
  lines.push(
    'Plan for this weather. No beach, swimming or open-water day when highs are under 22°C / 72°F.'
      + (c.cold ? ' It is cold: keep outdoor time short and give every day somewhere warm indoors.' : '')
      + (c.hot ? ' It is very hot: put anything outdoors early or late, and the middle of the day indoors.' : '')
      + (c.inWettest.length ? ' It is the wet season there: every day needs an indoor option.' : ''),
    'Do not repeat these figures as a promise, and never mention storms, hurricanes, cyclones or monsoons — the averages say nothing about them.',
  );
  return lines.join('\n');
}

// ─── The no-gos it can check ─────────────────────────────────────────────

const COLD_VETO = /^(coldweather|cold|cold weather|freezing|snow)$/;
const HEAT_VETO = /^(extremeheat|extreme heat|heat|hot weather|very hot)$/;
const vetoKey = (v: unknown) => String(v ?? '').replace(/^custom:/i, '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Whether one veto is a weather no-go — checked against the climate, never against words. */
export function isWeatherVeto(v: unknown): boolean {
  const k = vetoKey(v);
  return COLD_VETO.test(k) || HEAT_VETO.test(k);
}

/** Which weather no-gos are among these vetoes. */
export function climateVetoes(vetoes: unknown[]): { cold: boolean; heat: boolean } {
  const keys = (vetoes || []).map(vetoKey);
  return { cold: keys.some(k => COLD_VETO.test(k)), heat: keys.some(k => HEAT_VETO.test(k)) };
}

/**
 * The verdict on one idea: which weather no-go its dates break, if any, and
 * whether it could be checked at all. No climate held is `checked: false` —
 * kept, and never described as having passed.
 */
export function climateBreach(
  c: TripClimate | null, vetoes: unknown[],
): { veto: 'coldWeather' | 'extremeHeat' | null; checked: boolean; asked: boolean } {
  const want = climateVetoes(vetoes);
  const asked = want.cold || want.heat;
  if (!asked || !c) return { veto: null, checked: false, asked };
  // On high ground the town is usually warmer than the area: a cold verdict
  // has to survive that allowance, and so does a pass on heat.
  const allow = c.highGround ? HIGH_GROUND_ALLOWANCE_C : 0;
  const high = c.highC;
  if (want.cold && high + allow < COLD_HIGH_C) return { veto: 'coldWeather', checked: true, asked };
  if (want.heat && high >= HOT_HIGH_C) return { veto: 'extremeHeat', checked: true, asked };
  const coldUnclear = want.cold && high < COLD_HIGH_C; // cold as the area, maybe not as the town
  const heatUnclear = want.heat && high + allow >= HOT_HIGH_C;
  return { veto: null, checked: !coldUnclear && !heatUnclear, asked };
}

/**
 * What an idea card carries about the weather. Attached by the route, never
 * written by the model; read back through lib/contracts/idea-climate.ts.
 * The screen words it with climateLine in the reader's own unit order.
 */
export interface IdeaClimate {
  place: string;
  /** Whether we hold any climate for the place at all. */
  held: boolean;
  /** Across the trip's dates, when they are known. */
  trip: TripClimate | null;
  /** "Best weather in Moab: …", when the dates are not known. */
  best: string | null;
  /** "NASA POWER 1981–2020 averages for the area, not a forecast". Empty when nothing is held. */
  credit: string;
  /** A weather no-go was among the vetoes. */
  asked: boolean;
  /** …and this idea was actually checked against it (false = kept, not passed). */
  checked: boolean;
}

/**
 * The card's climate and the no-go verdict for one idea, in one go, so the
 * route cannot attach one without having worked out the other.
 */
export function ideaClimate(
  n: ClimateNormals | null, place: string, dates: { start?: unknown; end?: unknown }, vetoes: unknown[],
): { climate: IdeaClimate | null; breach: 'coldWeather' | 'extremeHeat' | null } {
  const trip = n ? howIsIt(n, dates.start, dates.end) : null;
  const verdict = climateBreach(trip, vetoes);
  if (!n) {
    // Nothing held: only worth a line when somebody's no-go could not be checked.
    return { climate: verdict.asked ? { place, held: false, trip: null, best: null, credit: '', asked: true, checked: false } : null, breach: null };
  }
  return {
    climate: {
      place, held: true, trip,
      best: trip ? null : bestMonthsLine(n, place),
      credit: climateCredit(n.period), asked: verdict.asked, checked: verdict.checked,
    },
    breach: verdict.veto,
  };
}
