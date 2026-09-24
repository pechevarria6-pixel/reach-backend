// ─── Which places the climate loader fills ───────────────────────────────
// Every town the map load reads around (ingest_seeds) and every world
// destination, once each. A seed exists once per Geofabrik file its circle
// touches — Moab is in the Utah and the Colorado files — so the key is the
// folded name and the point rounded to two places, the same key
// place_climate is unique on.
import { nameKey, worldTownFor } from './discovery/regions.ts';
import { WORLD_DESTINATIONS } from './discovery/world-destinations.ts';

export interface ClimatePlace { name: string; name_key: string; country: string | null; lat: number; lng: number }

/** Rounded as the table stores it. */
export const round2 = (n: number) => Math.round(Number(n) * 100) / 100;
export const climateKey = (p: { name: string; lat: number; lng: number }) =>
  `${nameKey(p.name)}|${round2(p.lat).toFixed(2)}|${round2(p.lng).toFixed(2)}`;

/** US territories Geofabrik files under north-america/us. */
const US_TERRITORY: Record<string, string> = {
  'puerto-rico': 'PR', 'us-virgin-islands': 'VI', 'guam': 'GU', 'american-samoa': 'AS', 'northern-mariana-islands': 'MP',
};

/**
 * The country a seed is in, from what we already hold: a world destination
 * at the same place says so outright; a file under north-america/us is the
 * US or one of its territories. Anything else is left null, never guessed
 * from the file's name.
 */
export function countryOf(seed: { name: string; lat: number; lng: number; region?: string | null }): string | null {
  const world = worldTownFor(seed);
  if (world) return world.country;
  const m = /^north-america\/us\/([a-z-]+)$/.exec(String(seed.region ?? ''));
  if (m) return US_TERRITORY[m[1]] ?? 'US';
  return null;
}

/** Seeds and the world list as one list of places, each once. */
export function climatePlaces(seeds: Array<{ name: string; lat: number; lng: number; region?: string | null }>): ClimatePlace[] {
  const out = new Map<string, ClimatePlace>();
  const add = (name: string, lat: number, lng: number, country: string | null) => {
    if (!name || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
    // Null Island is a missing coordinate, not a place (see lib/discovery/where.ts).
    if (Number(lat) === 0 && Number(lng) === 0) return;
    const key = climateKey({ name, lat, lng });
    const had = out.get(key);
    if (had) { if (!had.country && country) had.country = country; return; }
    out.set(key, { name, name_key: nameKey(name), country, lat: round2(lat), lng: round2(lng) });
  };
  for (const s of seeds) add(s.name, s.lat, s.lng, countryOf(s));
  for (const d of WORLD_DESTINATIONS) add(d.name, d.lat, d.lng, d.country);
  return [...out.values()];
}

/** Held long enough to ask again. Normals move slowly: a year at least. */
export const REFRESH_DAYS = 365;
export function isStale(fetchedAt: string | null | undefined, now = Date.now()): boolean {
  const t = Date.parse(String(fetchedAt ?? ''));
  return !Number.isFinite(t) || now - t > REFRESH_DAYS * 86400000;
}
