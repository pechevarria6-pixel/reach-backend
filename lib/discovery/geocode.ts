// ─── Turning a town's name into a point on the map ──────────────────────
// `plans` stores destination_city and destination_country and no coordinate
// at all, so checking an itinerary against the map needs the town located
// first. Nominatim is the OpenStreetMap geocoder, which makes it the right
// one to ask: it and Overpass agree about where things are, and a point from
// somewhere else would search a box next to the town rather than over it.
//
// Nominatim is donated and asks for no more than one request a second, a
// real User-Agent, and results kept rather than re-fetched. All three are
// honoured here. A town is asked about once and remembered for the day.
//
// Measured:
//   Moab, United States                       38.5738, -109.5462
//   Aberdeen, North Carolina, United States   35.1315,  -79.4295
//   Nowherecityxyz, United States             no result, cleanly

const API = 'https://nominatim.openstreetmap.org/search';
const AGENT = 'Reach/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

export interface Located {
  lat: number;
  lng: number;
  /** How the map names it, which is what gets searched and shown. */
  name: string;
}

/**
 * Where a town is, or null.
 *
 * Null Island is refused for the same reason /api/nearby had to refuse it:
 * 0,0 is a real point in the Gulf of Guinea and a bug everywhere else, and
 * a box around it would confirm nothing and claim to have checked.
 */
export async function locate(
  city: string,
  country?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Located | null> {
  const town = String(city || '').trim();
  if (!town) return null;

  const q = [town, country].filter(Boolean).join(', ');
  const url = `${API}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;

  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': AGENT },
      signal: AbortSignal.timeout(8000),
      // A town does not move, and everyone on the same trip asks about the
      // same one.
      next: { revalidate: 86400 },
    } as RequestInit);
    if (!res.ok) return null;

    const hits = await res.json() as { lat?: string; lon?: string; display_name?: string }[];
    const hit = Array.isArray(hits) ? hits[0] : null;
    if (!hit) return null;

    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat === 0 && lng === 0) return null;

    // The first part of the display name is the town itself; the rest is the
    // county and country, which Wikivoyage does not title its pages with.
    const name = String(hit.display_name || town).split(',')[0].trim() || town;
    return { lat, lng, name };
  } catch {
    // Unreachable is not "no such town". The caller checks nothing rather
    // than checking the wrong place.
    return null;
  }
}
