// ─── Beaches, neighbourhoods and rivers are real too ─────────────────────
// The name checker reads a plan against the venues we hold, and anything it
// cannot match gets softened. Run over ninety-three saved itinerary items
// that worked out as:
//
//   "Sunset from Playa Los Muertos"        → "Sunset from a local spot"
//   "in the Rio Cuale market"              → "in another nearby market"
//   "brunch ... in the Romantic Zone"      → "in another nearby"
//
// A beach, a river and a neighbourhood. All real, all well known, none of
// them a business — so none of them will ever be in a table built from
// OpenStreetMap's business tags, however complete that table gets.
//
// "We hold no record of it" is not "it is not real". For geography we can
// close that gap properly, because the same map that lists the restaurants
// also lists the beach, and asking it is a real check rather than a guess.
// A name that resolves to a genuine feature near where somebody is going is
// kept. One that resolves to nothing is still softened.
import { haversineMiles } from './distance.ts';

const API = 'https://nominatim.openstreetmap.org/search';
const AGENT = 'Reach/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

/**
 * The kinds of thing that count as somewhere rather than someone's business.
 *
 * A restaurant is in OSM too, and a restaurant is exactly what this must not
 * wave through — the venue table is the only thing allowed to vouch for one,
 * because that is what the sweep verified. So this is an allowlist of
 * geography: land, water, districts, parks and named public places.
 */
const GEOGRAPHY = new Set([
  'place', 'natural', 'waterway', 'boundary', 'landuse',
  'leisure', 'historic', 'tourism', 'highway', 'aeroway', 'railway',
]);

/**
 * Types within those classes that are still really a business.
 *
 * `tourism` covers both a viewpoint and a hotel; `leisure` covers both a
 * park and a fitness centre. The business ones are excluded by name.
 */
const STILL_A_BUSINESS = new Set([
  'hotel', 'motel', 'hostel', 'guest_house', 'apartment', 'chalet',
  'fitness_centre', 'sports_centre', 'nightclub', 'restaurant', 'bar',
  'cafe', 'pub', 'attraction', 'gallery', 'museum', 'theme_park',
]);

/** How far from the destination a feature may be and still be that place. */
const NEAR_MILES = 60;

/** Answers kept for the life of the process. A beach does not move. */
const ASKED = new Map<string, boolean>();

export interface Near { lat: number; lng: number }

/**
 * Is this the name of a real place near where somebody is going?
 *
 * False on anything uncertain — no answer, an answer somewhere else, an
 * answer that is really a business. The cost of a false yes is an invented
 * restaurant kept because the map has a street with a similar name; the cost
 * of a false no is a real beach described as "a local spot". Only one of
 * those misleads anybody.
 */
export async function isRealPlace(
  name: string,
  near: Near,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const q = String(name || '').trim();
  if (q.length < 3) return false;

  const key = `${q.toLowerCase()}@${near.lat.toFixed(1)},${near.lng.toFixed(1)}`;
  const known = ASKED.get(key);
  if (known !== undefined) return known;

  // Bounded to a box around the destination, which is the guard that stops
  // "Test" resolving to a canal in Iran. A name is only that place if it is
  // where somebody is actually going.
  const d = 1.0;
  const url = `${API}?q=${encodeURIComponent(q)}`
    + `&format=json&limit=5&extratags=0&addressdetails=0`
    + `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}&bounded=1`;

  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': AGENT },
      signal: AbortSignal.timeout(6000),
      // The map does not change between two people planning the same trip.
      next: { revalidate: 86400 },
    } as RequestInit);
    if (!res.ok) {
      console.error('[is-place] the map returned', res.status);
      return false;
    }
    const rows = await res.json() as Array<{
      class?: string; type?: string; lat?: string; lon?: string;
    }>;

    const hit = (rows ?? []).some(r => {
      if (!GEOGRAPHY.has(String(r.class ?? ''))) return false;
      if (STILL_A_BUSINESS.has(String(r.type ?? ''))) return false;
      const lat = Number(r.lat), lng = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      return haversineMiles({ lat, lng }, { lat: near.lat, lng: near.lng }) <= NEAR_MILES;
    });

    ASKED.set(key, hit);
    return hit;
  } catch (err) {
    // Unreachable is not "there is no such beach". Softening is the safe
    // fallback and the behaviour we already had.
    console.error('[is-place] could not ask the map', err instanceof Error ? err.message : 'failed');
    return false;
  }
}

/**
 * Which of these names are real places, asked once each.
 *
 * Sequential on purpose. Nominatim asks for one request a second and is run
 * on donated hardware; a handful of names in a batch job is not worth being
 * rude about. Callers with a deadline should wrap this, not remove it.
 */
export async function realPlacesAmong(
  names: string[],
  near: Near,
  fetchImpl: typeof fetch = fetch,
): Promise<Set<string>> {
  const real = new Set<string>();
  for (const name of [...new Set(names)]) {
    if (await isRealPlace(name, near, fetchImpl)) real.add(name);
  }
  return real;
}
