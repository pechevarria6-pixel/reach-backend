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
// instance, is four gigabytes.
//
// The one exception is the world list (world-destinations.ts): the most
// visited cities and the Seven Wonders' towns, matched to Geofabrik files
// from Geofabrik's own index by scripts/ingest/world-regions.mjs rather
// than typed here. Paris is read from Île-de-France, not from France.

import { WORLD_REGIONS } from './world-regions.generated.ts';
import { WORLD_DESTINATIONS, type WorldDestination } from './world-destinations.ts';

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

/**
 * The paths regionFor can answer with: the hand-checked table above. The
 * world list's generator walks up to one of these where a point is in a
 * country this table already files, so the two never disagree about a town.
 */
export function legacyRegions(): string[] {
  return [...new Set([
    ...Object.values(US_STATES).map(s => `north-america/us/${s}`),
    ...Object.values(COUNTRIES),
    ...Object.values(UK_NATIONS),
  ])].sort();
}

/**
 * Every region path the weekly load may read, for validating input: the
 * table above, and the files the world destinations were matched to from
 * Geofabrik's own index (world-regions.generated.ts).
 *
 * regionFor still answers only from the table. A plan to Lyon is not
 * guessed into a file; the world list is placed from its own coordinates.
 */
export function knownRegions(): string[] {
  return [...new Set([...legacyRegions(), ...Object.values(WORLD_REGIONS).flat()])].sort();
}

/** The download for a region. `-latest` redirects to the dated file. */
export function geofabrikUrl(region: string): string {
  return `https://download.geofabrik.de/${region}-latest.osm.pbf`;
}

// ─── Seeds: the places the job reads around ─────────────────────────────

/**
 * How far around a town the weekly load keeps places.
 *
 * Nothing reads further. The itinerary menu reads nearest first out to a
 * twenty-five mile box (real-places.ts RINGS_MILES), Discover fifteen, and
 * the booking lookup the same twenty-five. It was a hundred, which kept
 * places nothing would ever show, fetched neighbouring states and even
 * England for circles that grazed them, and filled the harvester's queue
 * with thousands of venues nobody would see.
 */
export const SEED_RADIUS_MILES = 30;

export interface Seed {
  name: string;
  lat: number;
  lng: number;
  region: string;
  radius_miles?: number;
  /** Where it came from: plan, area, profile, world, or several joined by commas. */
  source: string;
}

/**
 * A town's name as the database keys it: case, accents and spacing folded,
 * so the plan's "Rincón" and the area's "Rincon" are one seed.
 *
 * Written to ingest_seeds.name_key by the client, not generated by the
 * database. A generated lower(name) kept the accent, so "Rincón" one run and
 * "Rincon" the next — whichever spelling came first — were two rows for one
 * town, while this code believed they were one.
 */
export function nameKey(name: string): string {
  return String(name || '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The key two seeds share when they are the same town. Case and accents are
 * folded, so the plan's "Rincón" and the area's "Rincon" are one seed, and
 * the three queued "Cancun" profiles are one.
 */
export function seedKey(name: string, region: string): string {
  return `${nameKey(name)}|${region}`;
}

/**
 * One row per town per region, first spelling kept, sources merged.
 *
 * Postgres refuses an upsert that names the same row twice, so this has to
 * happen before the write, not be left to the unique index.
 */
export function dedupeSeeds(seeds: Seed[]): Array<Seed & { name_key: string }> {
  const kept = new Map<string, Seed & { name_key: string }>();
  for (const s of seeds) {
    if (!s.name || !s.region || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const key = seedKey(s.name, s.region);
    const had = kept.get(key);
    // name_key is what the table's unique rule is on, so it travels with
    // the row and the upsert conflicts on exactly what this deduped on.
    if (!had) { kept.set(key, { ...s, name_key: nameKey(s.name) }); continue; }
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
 * The town as a seed is named, and the rest of what was typed: "Southern
 * Pines, NC" is Southern Pines in NC. The state is kept, not cut off: it is
 * what tells Fayetteville, NC from Fayetteville, AR, and the menu hands the
 * geocoder the whole string — so the seed has to as well, or the load reads
 * one Fayetteville while the menu looks in the other and finds nothing.
 *
 * Null for a name that is not one — blank, or a three-letter code like the
 * "ABE" an airport search left in discovery_areas.
 */
export function seedPlace(raw: string | null | undefined): { name: string; region: string | null } | null {
  const [first, ...rest] = String(raw || '').split(',');
  const name = first.replace(/\s+/g, ' ').trim();
  if (!name || /^[A-Z]{3}$/.test(name)) return null;
  const region = rest.join(',').replace(/\s+/g, ' ').trim();
  return { name, region: region || null };
}

/** The town's name alone. See seedPlace for the state. */
export function seedName(raw: string | null | undefined): string | null {
  return seedPlace(raw)?.name ?? null;
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

/** Two points close enough to be one town: the area's rounding is about seven miles. */
const SAME_TOWN_MILES = 15;

function milesApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * 69;
  const dLng = (b.lng - a.lng) * 69 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Whether a Discover area is the same town as a candidate already placed:
 * the same name, and a point within a few miles of it.
 *
 * The name alone is not enough. Areas carry no state, and "Fayetteville" at
 * a point in Arkansas is not the Fayetteville, NC somebody is planning a
 * trip to. Folded on the name, the Arkansas point was thrown away and the
 * town was read once, wherever the plan's geocoding put it.
 */
export function sameTown(
  area: { name: string; lat?: number | null; lng?: number | null },
  placed: { name: string; lat?: number | null; lng?: number | null },
): boolean {
  if (nameKey(area.name) !== nameKey(placed.name)) return false;
  const a = { lat: Number(area.lat), lng: Number(area.lng) };
  const b = { lat: Number(placed.lat), lng: Number(placed.lng) };
  if (area.lat == null || placed.lat == null || ![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return false;
  return milesApart(a, b) <= SAME_TOWN_MILES;
}

/**
 * Every town the seed job should place, once each.
 *
 * Plans first, then the queued destination profiles, then Discover's areas,
 * so the spelling somebody typed into a plan is the one kept. The profile
 * queue holds Cancún, San Juan and Nassau three times each; they are one
 * candidate apiece, and one request to the geocoder rather than three.
 *
 * A candidate is a name, a state when one was given, and a country, and all
 * three are its key: "Fayetteville, NC" and "Fayetteville, AR" are two
 * towns, and "Raleigh" with no state is placed as the menu would place it
 * rather than assumed to be the "Raleigh, NC" a profile names. Where two
 * candidates land in the same town, dedupeSeeds joins them after placing.
 *
 * An area already has its point. It joins a candidate only where sameTown
 * says so — for one whose point is known here, a profile's; for the rest,
 * build-seeds.mjs asks once they are placed — and otherwise stands alone at
 * its own point, which is at least where somebody actually looked.
 */
export function seedCandidates(input: {
  plans?: Array<{ destination_city?: string | null; destination_country?: string | null }>;
  profiles?: Array<{ city?: string | null; region?: string | null; country?: string | null; lat?: number | null; lng?: number | null }>;
  areas?: Array<{ city?: string | null; lat?: number | null; lng?: number | null }>;
}): Array<SeedCandidate & { sources: string[] }> {
  const kept = new Map<string, SeedCandidate & { sources: string[] }>();
  // An area's point is part of its key: two areas called Aberdeen, one in
  // North Carolina and one in Scotland, are two towns, and sameTown below has
  // already joined any two that are close enough to be one.
  const keyOf = (c: SeedCandidate) => seedKey(c.name,
    `${String(c.region || '').trim().toUpperCase()}|${String(c.country || '').trim().toUpperCase()}`
    + (c.source === 'area' ? `|${Number(c.lat).toFixed(2)},${Number(c.lng).toFixed(2)}` : ''));
  const add = (c: SeedCandidate) => {
    const key = keyOf(c);
    const had = kept.get(key);
    if (had) {
      if (!had.sources.includes(c.source)) had.sources.push(c.source);
      if (had.lat == null && c.lat != null) { had.lat = c.lat; had.lng = c.lng; }
      return;
    }
    kept.set(key, { ...c, sources: [c.source] });
  };
  for (const p of input.plans ?? []) {
    const at = seedPlace(p.destination_city);
    if (at) add({ name: at.name, region: at.region, country: p.destination_country ?? null, source: 'plan' });
  }
  for (const p of input.profiles ?? []) {
    const at = seedPlace(p.city);
    if (at) add({ name: at.name, region: p.region ?? at.region, country: p.country ?? null, lat: p.lat ?? null, lng: p.lng ?? null, source: 'profile' });
  }
  for (const a of input.areas ?? []) {
    const at = seedPlace(a.city);
    const lat = Number(a.lat), lng = Number(a.lng);
    // An area is a point somebody opened Discover at; without a usable
    // point or a name there is nothing to read around.
    if (!at || a.lat == null || a.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const area = { name: at.name, region: at.region, lat, lng, source: 'area' as const };
    const same = [...kept.values()].find(k => sameTown(area, k));
    if (same) {
      if (!same.sources.includes('area')) same.sources.push('area');
      continue;
    }
    add(area);
  }
  return [...kept.values()];
}

// ─── The world list ──────────────────────────────────────────────────────

/**
 * A seed for every file each world destination's circle reaches, placed
 * from the list's own coordinates — no geocoder — and matched to files by
 * scripts/ingest/world-regions.mjs from Geofabrik's index.
 *
 * A destination the generator has not matched yet has no regions and so no
 * seeds; the unit tests fail on that rather than letting it pass quietly.
 */
export function worldSeeds(): Seed[] {
  const seeds: Seed[] = [];
  for (const d of WORLD_DESTINATIONS) {
    for (const region of WORLD_REGIONS[d.name] ?? []) {
      seeds.push({ name: d.name, lat: d.lat, lng: d.lng, region, source: 'world' });
    }
  }
  return seeds;
}

/**
 * The world destination a placed town is, if it is one: the same name and
 * within a few miles (sameTown). A plan to Paris is placed by the geocoder
 * in a country regionFor does not file; it is still read, as the world
 * list's Paris, rather than logged as skipped.
 */
export function worldTownFor(placed: { name: string; lat?: number | null; lng?: number | null }): WorldDestination | null {
  return WORLD_DESTINATIONS.find(d => sameTown(placed, d)) ?? null;
}
