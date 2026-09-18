// ─── Nearest first, without burying the thing they came for ─────────────
// Discover is a list of what is on near you, and it was not ordered by near.
//
// A straight distance sort is the obvious fix and the wrong one here, for a
// reason worth writing down: only some sources tell us where a thing is.
// OpenStreetMap and the cache carry coordinates; Ticketmaster and Yelp send
// a distance but no point; the harvest sends neither. Sorting purely on
// haversine would put most of the list at the bottom as "unknown" and call
// it nearest-first.
//
// So distance is taken from whatever a source does give, and the ordering is
// by band rather than by exact yards. Within a band the existing ranking
// survives — a pottery class four miles away still beats a stadium show
// three miles away, which is the whole point of asking what somebody is
// into. Banding is also what the daily shuffle varies inside, so the list
// moves without the best match falling off the screen.
import type { Finding } from './types.ts';

export type Point = { lat: number; lng: number };

const EARTH_MILES = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle miles between two points. */
export function haversineMiles(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "60 mi" → 60. The shape every source writes when it has no point. */
export function parseMiles(dist: string | null | undefined): number | null {
  if (!dist) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(dist);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * How far away this is, in miles, or null when nothing we hold can say.
 * Coordinates are preferred because they are a fact; the string is a
 * provider's own measurement and is trusted only when there is no point.
 */
export function milesOf(finding: Finding, origin: Point | null): number | null {
  if (origin && typeof finding.lat === 'number' && typeof finding.lng === 'number') {
    const miles = haversineMiles(origin, { lat: finding.lat, lng: finding.lng });
    return Number.isFinite(miles) ? miles : null;
  }
  return parseMiles(finding.dist);
}

/** Which ring of the map this falls in. Ten-mile rings. */
export function bandOf(miles: number | null, size = 10): number {
  // No distance at all sorts last, always, without throwing and without
  // pretending to be at the origin — a missing number is not a zero.
  if (miles === null || !Number.isFinite(miles)) return Number.POSITIVE_INFINITY;
  return Math.floor(Math.max(0, miles) / size);
}

/**
 * The findings, nearest band first, keeping the order they arrived in within
 * each band — which is the ranking, so what somebody is into still leads.
 *
 * A stable sort is load-bearing here, not an implementation detail: it is
 * what carries the ranking through. Array.prototype.sort has been stable in
 * every engine since ES2019, and this relies on it deliberately.
 */
export function byDistance(findings: Finding[], origin: Point | null, bandSize = 10): Finding[] {
  const band = new Map<Finding, number>();
  for (const f of findings ?? []) band.set(f, bandOf(milesOf(f, origin), bandSize));
  return [...(findings ?? [])].sort((a, b) => (band.get(a) as number) - (band.get(b) as number));
}
