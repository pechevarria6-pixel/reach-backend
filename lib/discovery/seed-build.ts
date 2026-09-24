// ─── Placing the seeds, as decisions rather than plumbing ────────────────
// scripts/ingest/build-seeds.mjs runs every day in GitHub Actions. It reads
// every plan destination, queued destination profile and Discover area, and
// turns each into rows of ingest_seeds: a town, its point, and every
// Geofabrik file its circle reaches. The region list the load works through
// is built from those rows (regionList in regions.ts).
//
// The first version asked Nominatim thirteen questions a town — its centre
// and twelve probe points — every time it ran, and this Mac was refused with
// a 429 after three runs, with 15 of 42 seeds stored. So now:
//
//   - a town is geocoded once, ever. Its answer, found or not, is kept in
//     ingest_places and read back the next day;
//   - which files its circle reaches is answered from Geofabrik's own
//     polygons (geofabrik.ts), which costs Nominatim nothing;
//   - Nominatim is asked at most once a second, at most `cap` times a run,
//     and a 429 stops the asking cleanly: everything already placed is
//     still written, and the rest wait for tomorrow.
import type { Located } from './geocode.ts';
import type { GeofabrikMap } from './geofabrik.ts';
import { regionsForTown } from './geofabrik.ts';
import {
  dedupeSeeds, nameKey, probePoints, sameTown, worldTownFor, regionCountries, usStateCode,
  SEED_RADIUS_MILES, type Seed, type SeedCandidate,
} from './regions.ts';
import { siteBase } from './world-destinations.ts';

/** What the geocoder said about a town, remembered so it is never asked twice. */
export interface PlaceMemo {
  query_key: string;
  name: string;
  /** Null when the geocoder found nothing: remembered too, and asked again after NOT_FOUND_DAYS. */
  lat: number | null;
  lng: number | null;
  country_code: string | null;
  asked_at: string;
}

/** How long "the geocoder could not place it" stands before asking again. */
export const NOT_FOUND_DAYS = 30;

/** Nominatim's policy: at most one request a second. A little slack on top. */
export const NOMINATIM_SPACING_MS = 1100;

/** Requests to Nominatim in one run, at most. A new town costs one. */
export const DEFAULT_GEOCODE_CAP = 100;

/**
 * The key a town is remembered under: its name folded, and whatever state
 * and country were typed with it. "Fayetteville, NC" and "Fayetteville, AR"
 * are two keys, because they are two towns.
 */
export function queryKey(c: { name: string; region?: string | null; country?: string | null }): string {
  return [nameKey(c.name), nameKey(String(c.region || '')), String(c.country || '').trim().toUpperCase()].join('|');
}

/**
 * Located; null for "Nominatim answered and found no such town" (remembered
 * for NOT_FOUND_DAYS); 'failed' for a question that got no answer (asked
 * again next run, never remembered); 'stopped' when this run asks no more.
 */
export type Geocode = (query: string, country: string | null) => Promise<Located | null | 'failed' | 'stopped'>;

/** Failed requests in a row after which Nominatim is taken to be down for this run. */
export const FAILURES_BEFORE_STOP = 3;

/**
 * Nominatim, asked politely: one request a second, at most `cap` in a run,
 * and nothing more once it says 429 (or 403, which is how it answers an
 * agent it has blocked). `stopped` says why it stopped, for the log.
 *
 * Built around geocode.ts's own `locate` by handing it a fetch that keeps
 * count, so the settlement rule and the Null Island rule stay in one place.
 */
export function politeGeocoder(opts: {
  /** geocode.ts's `locateOrFail`, or `locate` (a failure is still caught at the fetch). */
  locate: (city: string, country: string | null, fetchImpl: typeof fetch) => Promise<Located | null | 'failed'>;
  fetchImpl?: typeof fetch;
  cap?: number;
  spacingMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}): { geocode: Geocode; asked: () => number; stopped: () => string | null } {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cap = opts.cap ?? DEFAULT_GEOCODE_CAP;
  const spacing = opts.spacingMs ?? NOMINATIM_SPACING_MS;
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const clock = opts.clock ?? (() => Date.now());
  let asked = 0;
  let last = -Infinity;
  let stopped: string | null = null;
  let failedInRow = 0;
  // Whether the request behind the current answer failed. `locate` turns a
  // 5xx, a timeout and a dropped connection into null, the same null as "no
  // such town"; this is how the difference survives it.
  let thisFailed = false;

  const counted = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const wait = last + spacing - clock();
    if (wait > 0) await sleep(wait);
    last = clock();
    asked++;
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      thisFailed = true;
      throw e;
    }
    if (res.status === 429 || res.status === 403) {
      stopped = `Nominatim answered ${res.status} after ${asked} request${asked === 1 ? '' : 's'}`;
    } else if (!res.ok) {
      thisFailed = true;
    }
    return res;
  }) as typeof fetch;

  const geocode: Geocode = async (query, country) => {
    if (stopped) return 'stopped';
    if (asked >= cap) { stopped = `reached this run's cap of ${cap} requests`; return 'stopped'; }
    thisFailed = false;
    let found: Located | null | 'failed';
    try {
      found = await opts.locate(query, country, counted);
    } catch {
      found = 'failed';
    }
    // A refused request comes back from locate as null, which is not "no
    // such town" and must not be remembered as one.
    if (stopped) return 'stopped';
    if (found === 'failed' || thisFailed) {
      failedInRow++;
      if (failedInRow >= FAILURES_BEFORE_STOP) {
        stopped = `${failedInRow} Nominatim requests in a row got no answer (5xx, timeout or network)`;
      }
      return 'failed';
    }
    failedInRow = 0;
    return found;
  };
  return { geocode, asked: () => asked, stopped: () => stopped };
}

/**
 * Before sql/ingest-every-region-2026-09-24.sql runs there is no
 * ingest_places table, and the seeds already stored are the only memory of
 * where a town was placed. A candidate reuses a stored seed's point when the
 * name matches exactly one point, and nothing typed disagrees with it: a
 * state code has to be the state the seed is filed in, a country code one
 * of its file's countries. Anything ambiguous is geocoded, as before.
 */
export function memoFromSeeds(
  rows: Array<{ name: string; name_key?: string | null; lat: number; lng: number; region: string }>,
): (c: { name: string; region?: string | null; country?: string | null }) => { lat: number; lng: number } | null {
  const byName = new Map<string, Array<{ lat: number; lng: number; regions: Set<string> }>>();
  for (const r of rows) {
    const key = r.name_key || nameKey(r.name);
    const points = byName.get(key) ?? [];
    // One town filed in several regions is one point written several times.
    const same = points.find(p => Math.abs(p.lat - Number(r.lat)) < 0.001 && Math.abs(p.lng - Number(r.lng)) < 0.001);
    if (same) same.regions.add(r.region);
    else points.push({ lat: Number(r.lat), lng: Number(r.lng), regions: new Set([r.region]) });
    byName.set(key, points);
  }
  return (c) => {
    const points = byName.get(nameKey(c.name)) ?? [];
    if (points.length !== 1) return null;
    const [p] = points;
    const hint = String(c.region || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(hint) && String(c.country || 'US').toUpperCase() === 'US') {
      const state = [...p.regions].some(r => usStateCode(r) === hint);
      if (!state) return null;
    } else if (hint) {
      return null;
    }
    const cc = String(c.country || '').trim().toUpperCase();
    if (cc && ![...p.regions].some(r => regionCountries(r).includes(cc))) return null;
    return { lat: p.lat, lng: p.lng };
  };
}


export interface PlacedSeeds {
  seeds: Array<Seed & { name_key: string }>;
  /** New or refreshed answers to remember in ingest_places. */
  remembered: PlaceMemo[];
  skipped: string[];
  /** Towns left for another day because the geocoder stopped. */
  waiting: number;
  /** How many towns were placed from memory, costing Nominatim nothing. */
  fromMemory: number;
}

/**
 * Every candidate placed, in order, and the seed rows they become.
 *
 * `remember` is called with each new answer as it arrives, so the caller
 * can write them as it goes: a run that is killed half way keeps what it
 * learned.
 */
export async function placeSeeds(input: {
  candidates: Array<SeedCandidate & { sources: string[] }>;
  memo: Map<string, PlaceMemo>;
  /** The pre-migration fallback: stored seeds as memory. */
  fromSeeds?: ReturnType<typeof memoFromSeeds>;
  map: GeofabrikMap;
  geocode: Geocode;
  world: Seed[];
  log?: (line: string) => void;
  remember?: (row: PlaceMemo) => void | Promise<void>;
  now?: Date;
  radiusMiles?: number;
}): Promise<PlacedSeeds> {
  const log = input.log ?? (() => {});
  const now = input.now ?? new Date();
  const radius = input.radiusMiles ?? SEED_RADIUS_MILES;
  const seeds: Seed[] = [];
  const skipped: string[] = [];
  const remembered: PlaceMemo[] = [];
  const placed: Array<{ name: string; lat: number; lng: number }> = [];
  // Sources that join a world destination (a plan to Paris the polygons do
  // not place, a plan to Machu Picchu), keyed by the world name.
  const joinsWorld = new Map<string, string[]>();
  let waiting = 0;
  let fromMemory = 0;

  const keep = async (row: PlaceMemo) => {
    remembered.push(row);
    input.memo.set(row.query_key, row);
    await input.remember?.(row);
  };

  for (const c of input.candidates) {
    // A Discover area joins a town already placed nearby of the same name.
    if (c.sources.length === 1 && c.sources[0] === 'area') {
      const town = placed.find(p => sameTown(c, p));
      if (town) {
        for (const s of seeds) if (s.name === town.name && s.lat === town.lat && s.lng === town.lng) {
          s.source = [...new Set([...s.source.split(','), 'area'])].sort().join(',');
        }
        continue;
      }
    }

    // A wonder, not a town: its base towns are on the world list already.
    const bases = siteBase([c.name, c.region].filter(Boolean).join(', '), c.country ?? null);
    if (bases.length) {
      for (const b of bases) joinsWorld.set(b.name, [...(joinsWorld.get(b.name) ?? []), ...c.sources]);
      log(`  a site: joins ${bases.map(b => b.name).join(' and ')}`);
      continue;
    }

    let lat = c.lat ?? null, lng = c.lng ?? null, country: string | null = c.country ?? null;
    if (lat == null || lng == null) {
      const key = queryKey(c);
      const known = input.memo.get(key);
      const reuse = !known ? input.fromSeeds?.(c) ?? null : null;
      if (known && known.lat != null && known.lng != null) {
        ({ lat, lng } = known);
        country = known.country_code ?? country;
        fromMemory++;
      } else if (known && Date.parse(known.asked_at) > now.getTime() - NOT_FOUND_DAYS * 86400_000) {
        skipped.push(`${c.name} — the geocoder could not place it (asked ${known.asked_at.slice(0, 10)})`);
        continue;
      } else if (reuse) {
        ({ lat, lng } = reuse);
        fromMemory++;
        await keep({ query_key: key, name: c.name, lat, lng, country_code: c.country ?? null, asked_at: now.toISOString() });
      } else {
        const hint = [c.region].filter(Boolean).join(', ');
        const found = await input.geocode(hint ? `${c.name}, ${hint}` : c.name, c.country ?? null);
        // Stopped, or asked and not answered: either way nothing was learned,
        // so nothing is remembered and the town is asked about next run.
        if (found === 'stopped' || found === 'failed') { waiting++; continue; }
        if (!found) {
          await keep({ query_key: key, name: c.name, lat: null, lng: null, country_code: null, asked_at: now.toISOString() });
          skipped.push(`${c.name} — the geocoder could not place it`);
          continue;
        }
        lat = found.lat; lng = found.lng;
        country = (found.countryCode ?? country ?? null)?.toUpperCase() ?? null;
        await keep({ query_key: key, name: c.name, lat, lng, country_code: country, asked_at: now.toISOString() });
      }
    }

    const { regions } = regionsForTown(input.map, { lat: Number(lat), lng: Number(lng) }, probePoints(Number(lat), Number(lng), radius), country);
    if (!regions.length) {
      const town = worldTownFor({ name: c.name, lat, lng });
      if (town) {
        joinsWorld.set(town.name, [...(joinsWorld.get(town.name) ?? []), ...c.sources]);
        continue;
      }
      skipped.push(`${c.name} (${lat}, ${lng}) — in no Geofabrik file`);
      continue;
    }
    placed.push({ name: c.name, lat: Number(lat), lng: Number(lng) });
    for (const region of regions) {
      seeds.push({ name: c.name, lat: Number(lat), lng: Number(lng), region, source: [...c.sources].sort().join(',') });
    }
  }
  // The world list last, so where a plan already names the same town in the
  // same file, the plan's spelling and point are kept and sources joined.
  for (const w of input.world) {
    const joined = joinsWorld.get(w.name) ?? [];
    seeds.push({ ...w, source: [...new Set(['world', ...joined])].sort().join(',') });
  }
  return { seeds: dedupeSeeds(seeds), remembered, skipped, waiting, fromMemory };
}
