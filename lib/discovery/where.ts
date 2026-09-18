// ─── Is this actually a place? ───────────────────────────────────────────
// /api/nearby read its coordinates with Number(searchParams.get('lat')), and
// Number(null) is 0. Zero is a finite number, so a request with no location
// at all sailed through the guard as latitude 0, longitude 0 — a point in the
// Gulf of Guinea — and every provider was asked what is on near it. Yelp
// answered with its own default city, so a user in North Carolina was shown
// pottery studios in Mill Valley and cooking classes in San Francisco.
//
// It also wrote that non-place into discovery_areas, where the nightly sweep
// then spent part of its budget on it.

export type Where = { lat: number; lng: number };

/** One coordinate, or null when the parameter is missing or not a number. */
export function coord(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Where the request says it is, or null.
 *
 * Null Island is refused on purpose. It is a real point on the map and a
 * fake one in practice: nobody opens Reach from the middle of the ocean, and
 * every way of getting 0,0 into this function is a bug somewhere else.
 */
export function whereFrom(params: URLSearchParams): Where | null {
  const lat = coord(params.get('lat'));
  const lng = coord(params.get('lng'));
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // Within a kilometre of 0,0. A hundredth of a degree is about 1.1km.
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return null;
  return { lat, lng };
}
