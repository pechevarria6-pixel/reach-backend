// ─── Which download covers a place ───────────────────────────────────────
// The weekly map job reads OpenStreetMap from Geofabrik, which cuts the world
// into files by country and, in the US, by state. A seed — a town people
// plan trips to — has to be matched to the file that holds it before the job
// can read anything.
//
// Deliberately a short table and not a guess. Every path here was checked
// against download.geofabrik.de on 2026-09-24 (the file resolved and was a
// real extract), and one guess was wrong: Scotland lives under
// europe/united-kingdom/, not europe/great-britain/, and the old path
// redirects to Geofabrik's home page with a 200 — so a job that trusted it
// would have "downloaded" an HTML page and found no venues in Aberdeen.
// A place in a country this table does not know is logged and skipped
// rather than sent to the nearest path that looks right. France, for
// instance, is four gigabytes and nobody has planned a trip there yet.

/** Geofabrik's file for each US state, keyed by USPS code. */
const US_STATES: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
  CO: 'colorado', CT: 'connecticut', DE: 'delaware', DC: 'district-of-columbia',
  FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois',
  IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana',
  ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
  MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada',
  NH: 'new-hampshire', NJ: 'new-jersey', NM: 'new-mexico', NY: 'new-york',
  NC: 'north-carolina', ND: 'north-dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon',
  PA: 'pennsylvania', RI: 'rhode-island', SC: 'south-carolina', SD: 'south-dakota',
  TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia',
  WA: 'washington', WV: 'west-virginia', WI: 'wisconsin', WY: 'wyoming',
  // Territories Geofabrik files under the US.
  PR: 'puerto-rico', VI: 'us-virgin-islands',
};

/** Whole countries, where one file is small enough to read in a job. */
const COUNTRIES: Record<string, string> = {
  MX: 'north-america/mexico',
  BS: 'central-america/bahamas',
  // Nominatim answers Puerto Rico as country "us", subdivision "US-PR", but
  // a plan can store PR as its country. Both land on the same file.
  PR: 'north-america/us/puerto-rico',
  VI: 'north-america/us/us-virgin-islands',
};

/** The UK is filed by nation. Scotland is what anybody has opened so far. */
const UK_NATIONS: Record<string, string> = {
  'GB-SCT': 'europe/united-kingdom/scotland',
  'GB-WLS': 'europe/united-kingdom/wales',
  'GB-ENG': 'europe/united-kingdom/england',
};

/** What a geocoder says about where a point is. */
export interface WhereAbouts {
  /** ISO 3166-1 alpha-2, any case: "us", "MX". */
  countryCode?: string | null;
  /** ISO 3166-2 as Nominatim gives it: "US-NC", "GB-SCT". */
  subdivision?: string | null;
}

/**
 * The Geofabrik path for a place, e.g. "north-america/us/north-carolina", or
 * null when this table does not know it — which the caller logs and skips.
 */
export function regionFor(at: WhereAbouts): string | null {
  const country = String(at.countryCode || '').trim().toUpperCase();
  const sub = String(at.subdivision || '').trim().toUpperCase();
  if (country === 'US' || sub.startsWith('US-')) {
    const state = US_STATES[sub.replace(/^US-/, '')];
    return state ? `north-america/us/${state}` : null;
  }
  if (country === 'GB' || sub.startsWith('GB-')) return UK_NATIONS[sub] ?? null;
  return COUNTRIES[country] ?? null;
}

/** Every region path this table can produce, for validating input. */
export function knownRegions(): string[] {
  return [...new Set([
    ...Object.values(US_STATES).map(s => `north-america/us/${s}`),
    ...Object.values(COUNTRIES),
    ...Object.values(UK_NATIONS),
  ])].sort();
}

/** The download for a region. `-latest` redirects to the dated file. */
export function geofabrikUrl(region: string): string {
  return `https://download.geofabrik.de/${region}-latest.osm.pbf`;
}

// ─── Seeds: the places the job reads around ─────────────────────────────

export interface Seed {
  name: string;
  lat: number;
  lng: number;
  region: string;
  radius_miles?: number;
  /** Where it came from: plan, area, profile, or several joined by commas. */
  source: string;
}

/**
 * The key two seeds share when they are the same town. Case and accents are
 * folded, so the plan's "Rincón" and the area's "Rincon" are one seed, and
 * the three queued "Cancun" profiles are one.
 */
export function seedKey(name: string, region: string): string {
  const folded = String(name || '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  return `${folded}|${region}`;
}

/**
 * One row per town per region, first spelling kept, sources merged.
 *
 * Postgres refuses an upsert that names the same row twice, so this has to
 * happen before the write, not be left to the unique index.
 */
export function dedupeSeeds(seeds: Seed[]): Seed[] {
  const kept = new Map<string, Seed>();
  for (const s of seeds) {
    if (!s.name || !s.region || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const key = seedKey(s.name, s.region);
    const had = kept.get(key);
    if (!had) { kept.set(key, { ...s }); continue; }
    const sources = new Set([...had.source.split(','), ...s.source.split(',')].map(x => x.trim()).filter(Boolean));
    had.source = [...sources].sort().join(',');
  }
  return [...kept.values()];
}

/**
 * Points to ask "which region is this?" about, so a seed near a border is
 * read from every file its circle reaches. Washington's hundred miles are
 * mostly Maryland and Virginia; reading only the District's file would
 * leave out nearly all of it.
 *
 * The centre, eight points on the rim and four halfway out. Coarse on
 * purpose: each point is one request to a donated geocoder.
 */
export function probePoints(lat: number, lng: number, miles: number): Array<{ lat: number; lng: number }> {
  const points = [{ lat, lng }];
  const ring = (r: number, bearings: number[]) => {
    for (const deg of bearings) {
      const rad = (deg * Math.PI) / 180;
      const dLat = (r * Math.cos(rad)) / 69;
      const dLng = (r * Math.sin(rad)) / (69 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
      points.push({ lat: Number((lat + dLat).toFixed(4)), lng: Number((lng + dLng).toFixed(4)) });
    }
  };
  ring(miles, [0, 45, 90, 135, 180, 225, 270, 315]);
  ring(miles / 2, [0, 90, 180, 270]);
  return points;
}

// ─── Where seeds come from ───────────────────────────────────────────────

/**
 * The town as a seed is named: "Southern Pines, NC" is Southern Pines, and
 * the state goes to the geocoder separately. Null for a name that is not
 * one — blank, or a three-letter code like the "ABE" an airport search left
 * in discovery_areas.
 */
export function seedName(raw: string | null | undefined): string | null {
  const name = String(raw || '').split(',')[0].replace(/\s+/g, ' ').trim();
  if (!name || /^[A-Z]{3}$/.test(name)) return null;
  return name;
}

/** A town somebody asked about, before it has been placed on a map. */
export interface SeedCandidate {
  name: string;
  /** What to hand the geocoder alongside the name: "NC", "MX". */
  region?: string | null;
  country?: string | null;
  /** Known already (an area row), so no search is needed. */
  lat?: number | null;
  lng?: number | null;
  source: 'plan' | 'area' | 'profile';
}

/**
 * Every town the seed job should place, once each.
 *
 * Plans first, then the queued destination profiles, then Discover's areas,
 * so the spelling somebody typed into a plan is the one kept. The profile
 * queue holds Cancún, San Juan and Nassau three times each; they are one
 * candidate apiece, and one request to the geocoder rather than three.
 */
export function seedCandidates(input: {
  plans?: Array<{ destination_city?: string | null; destination_country?: string | null }>;
  profiles?: Array<{ city?: string | null; region?: string | null; country?: string | null; lat?: number | null; lng?: number | null }>;
  areas?: Array<{ city?: string | null; lat?: number | null; lng?: number | null }>;
}): Array<SeedCandidate & { sources: string[] }> {
  const kept = new Map<string, SeedCandidate & { sources: string[] }>();
  const add = (c: SeedCandidate) => {
    const key = seedKey(c.name, String(c.country || '').toUpperCase());
    const had = kept.get(key);
    if (had) {
      if (!had.sources.includes(c.source)) had.sources.push(c.source);
      if (had.lat == null && c.lat != null) { had.lat = c.lat; had.lng = c.lng; }
      return;
    }
    kept.set(key, { ...c, sources: [c.source] });
  };
  for (const p of input.plans ?? []) {
    const name = seedName(p.destination_city);
    if (name) add({ name, country: p.destination_country ?? null, source: 'plan' });
  }
  for (const p of input.profiles ?? []) {
    const name = seedName(p.city);
    if (name) add({ name, region: p.region ?? null, country: p.country ?? null, lat: p.lat ?? null, lng: p.lng ?? null, source: 'profile' });
  }
  for (const a of input.areas ?? []) {
    const name = seedName(a.city);
    const lat = Number(a.lat), lng = Number(a.lng);
    // An area is a point somebody opened Discover at; without a usable
    // point or a name there is nothing to read around.
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    // Areas carry no country, so an area folds into a plan or profile of the
    // same name whatever its country: Discover opened at Washington is the
    // Washington somebody is planning a trip to. Otherwise it stands alone.
    const same = [...kept.values()].find(k => seedKey(k.name, '') === seedKey(name, ''));
    if (same) {
      if (!same.sources.includes('area')) same.sources.push('area');
      continue;
    }
    add({ name, lat, lng, source: 'area' });
  }
  return [...kept.values()];
}
