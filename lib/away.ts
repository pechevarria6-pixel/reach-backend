// ─── Is this plan away from home? ────────────────────────────────────────
// An away plan is one where getting there and somewhere to sleep are part of
// the plan, and the checkout spec (2026-09-25, Task 6a) says those two lines
// are never silently left out of one. So the question has to be answered the
// same way everywhere that asks it, and it is answered here:
//
//   a night out          never away. It is one evening, wherever it is, and
//                        a flight and a hotel on it would be a plan for
//                        something nobody asked to do.
//   one night or more    away — somebody is sleeping somewhere that night.
//   80 km or more        away, even for a day: that is a journey, not a
//                        trip across town.
//
// What it will not do is guess. The distance needs both ends as real points,
// and home is the caller's to resolve (override, then GPS, then the group's
// city). When there is no night and no distance we can measure, the answer
// is null — unknown — rather than "local", because "local" is a claim that
// drops the flight and the hotel.
import { haversineMiles, type Point } from './discovery/distance.ts';

/** 80 km, the owner's threshold (decision 10). */
export const AWAY_KM = 80;
const KM_PER_MILE = 1.609344;

export type AwayReason = 'night_out' | 'overnight' | 'distance' | 'local' | 'unknown';

export interface Away {
  /** True, false, or null when nothing we hold can say. */
  away: boolean | null;
  reason: AwayReason;
  /** Great-circle km from home, when both ends are real points. */
  km: number | null;
  /** Nights the dates span, when both are real dates. */
  nights: number | null;
}

export interface AwayInput {
  /** 'night' for a night out; anything else is a trip. */
  mode?: string | null;
  startDate?: unknown;
  endDate?: unknown;
  /** Where they set off from, already resolved by the caller. */
  home?: Partial<Point> | null;
  destination?: Partial<Point> | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}/;

function dayMs(v: unknown): number | null {
  if (typeof v !== 'string' || !DAY.test(v)) return null;
  const d = v.slice(0, 10);
  const t = Date.parse(`${d}T00:00:00Z`);
  // "2026-02-30" parses to March; a date that does not survive the round trip
  // is not one.
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? t : null;
}

/** Nights between two calendar dates, counted as dates — never through a clock. */
export function nightsBetween(startDate: unknown, endDate: unknown): number | null {
  const a = dayMs(startDate);
  const b = dayMs(endDate);
  if (a === null || b === null || b < a) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * A real point or null. Null Island is not somewhere anybody lives: a
 * missing coordinate read through `Number()` is 0, and 0 is finite — that
 * became a location twice in this codebase already.
 */
export function pointOf(p: Partial<Point> | null | undefined): Point | null {
  if (!p) return null;
  const { lat, lng } = p;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** A journey rather than a trip across town. 80 km itself counts. */
export function farEnough(km: number): boolean {
  return Number.isFinite(km) && km >= AWAY_KM;
}

export function away(input: AwayInput): Away {
  const nights = nightsBetween(input.startDate, input.endDate);
  const home = pointOf(input.home);
  const dest = pointOf(input.destination);
  const km = home && dest ? haversineMiles(home, dest) * KM_PER_MILE : null;

  if (input.mode === 'night') return { away: false, reason: 'night_out', km, nights };
  if (nights !== null && nights >= 1) return { away: true, reason: 'overnight', km, nights };
  if (km !== null && farEnough(km)) return { away: true, reason: 'distance', km, nights };
  // Local needs both halves known: a day plan, and a distance we measured.
  if (km !== null && nights === 0) return { away: false, reason: 'local', km, nights };
  return { away: null, reason: 'unknown', km, nights };
}
