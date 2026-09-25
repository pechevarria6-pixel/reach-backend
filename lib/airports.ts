// ─── Which airport you fly from ─────────────────────────────────────────
// A departure airport is not a separate fact from where somebody lives, and
// asking for both as independent fields let them disagree. A real profile in
// this database reads:
//
//   home_city:    "Pittsburgh, Pennsylvania"
//   home_airport: "RDU"                        (Raleigh-Durham, 350 miles)
//
// Both saved cleanly, because each was validated on its own — a city of at
// most eighty characters, three letters that look like an IATA code — and
// nothing ever compared them. The trip screen then read "Departing from
// Pittsburgh (RDU)", faithfully showing two values that cannot both be true.
//
// So the airport follows the city by default and is overridable, rather than
// being asked for twice. Somebody can genuinely live in Oakland and fly from
// SFO, which is why the override exists and why a disagreement is surfaced
// rather than refused.

/** Major US airports, by the city people say they live in. */
const AIRPORTS: Record<string, string> = {
  'new york': 'JFK', 'los angeles': 'LAX', 'chicago': 'ORD', 'houston': 'IAH',
  'phoenix': 'PHX', 'philadelphia': 'PHL', 'san antonio': 'SAT', 'san diego': 'SAN',
  'dallas': 'DFW', 'san jose': 'SJC', 'austin': 'AUS', 'jacksonville': 'JAX',
  'fort worth': 'DFW', 'columbus': 'CMH', 'charlotte': 'CLT', 'indianapolis': 'IND',
  'san francisco': 'SFO', 'seattle': 'SEA', 'denver': 'DEN', 'nashville': 'BNA',
  'boston': 'BOS', 'las vegas': 'LAS', 'portland': 'PDX', 'miami': 'MIA',
  'atlanta': 'ATL', 'minneapolis': 'MSP', 'new orleans': 'MSY', 'detroit': 'DTW',
  'memphis': 'MEM', 'baltimore': 'BWI', 'louisville': 'SDF', 'milwaukee': 'MKE',
  'albuquerque': 'ABQ', 'tucson': 'TUS', 'fresno': 'FAT', 'sacramento': 'SMF',
  'kansas city': 'MCI', 'mesa': 'PHX', 'omaha': 'OMA', 'raleigh': 'RDU',
  'durham': 'RDU', 'chapel hill': 'RDU', 'cary': 'RDU',
  'colorado springs': 'COS', 'long beach': 'LGB', 'virginia beach': 'ORF',
  'oakland': 'OAK', 'tulsa': 'TUL', 'tampa': 'TPA',
  'arlington': 'DFW', 'wichita': 'ICT', 'cleveland': 'CLE',
  'bakersfield': 'BFL', 'aurora': 'DEN', 'anaheim': 'SNA',
  'orlando': 'MCO', 'pittsburgh': 'PIT', 'salt lake city': 'SLC', 'birmingham': 'BHM',
};

/**
 * The town out of whatever was typed into a city field.
 *
 * Profiles store "Pittsburgh, Pennsylvania" and the table was keyed on
 * "Pittsburgh", so every lookup returned null and the derivation never fired
 * for anybody who had filled the field in the way the field asks for.
 */
export function townOf(city: string | null | undefined): string {
  return String(city || '').split(',')[0].trim().toLowerCase();
}

/** The airport for a city, or null when we do not know one. */
export function airportForCity(city: string | null | undefined): string | null {
  const town = townOf(city);
  return town ? (AIRPORTS[town] ?? null) : null;
}

/**
 * Where a trip departs from.
 *
 * The saved airport wins, because somebody who set it is correcting us and a
 * correction that gets recomputed away on the next load is not a correction.
 * Everything else follows the city.
 */
export function departureFrom(
  homeCity: string | null | undefined,
  homeAirport: string | null | undefined,
  detected?: { city?: string | null; formatted?: string | null; airport?: string | null } | null,
): { city: string | null; airport: string | null; derived: boolean } {
  const city = homeCity || detected?.formatted || detected?.city || null;
  const saved = homeAirport ? String(homeAirport).toUpperCase() : null;
  const fromCity = airportForCity(city) ?? detected?.airport ?? null;
  return {
    city,
    airport: saved || fromCity,
    // Whether the airport on screen was worked out rather than chosen, so
    // the profile can say which it is showing.
    derived: !saved && !!fromCity,
  };
}

/**
 * The airport a city implies, when the saved one says otherwise.
 *
 * Null when they agree, when either is missing, or when the city is not one
 * we know — a disagreement we cannot substantiate is not a disagreement.
 * Never used to overwrite anything: living in one place and flying from
 * another is ordinary, and the point is that it should be deliberate.
 */
export function airportMismatch(
  homeCity: string | null | undefined,
  homeAirport: string | null | undefined,
): { city: string; saved: string; expected: string } | null {
  const saved = homeAirport ? String(homeAirport).toUpperCase() : null;
  const expected = airportForCity(homeCity);
  if (!saved || !expected || saved === expected) return null;
  return { city: String(homeCity).split(',')[0].trim(), saved, expected };
}

// ─── One flight booking per departure airport ────────────────────────────
// A group is not one place. /bookable priced every flight from whoever opened
// checkout — the organiser's home airport, for everybody — so a friend in
// Raleigh was quoted a seat out of Pittsburgh. The owner's rule (2026-09-25):
// one flight booking per departure airport, split when members fly from
// different cities, never one row per traveller.
//
// Each traveller's origin comes from what they told us, in this order, and
// says which it is, so a screen never shows a worked-out airport as a choice:
//
//   saved    — the home airport on their profile. They chose it.
//   city     — the major airport for their home city (the table above).
//   nearest  — the nearest airport to their home city, from a place lookup.
//
// `city` and `nearest` are both derived. Nobody's origin is ever the
// organiser's by default.

export type OriginSource = 'saved' | 'city' | 'nearest';

export interface Origin {
  userId: string;
  name: string;
  /** IATA code, or null when nothing we hold says where they fly from. */
  airport: string | null;
  source: OriginSource | null;
  /** True for city and nearest: worked out, not chosen. */
  derived: boolean;
}

/** Three letters that could be an IATA code, upper-cased; anything else is null. */
export function iataOf(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null;
}

/**
 * Where one traveller flies from, before any lookup. `nearest` is the answer
 * of a place lookup the caller made (travellerOrigins in
 * lib/essentials-server.ts), passed in so this stays pure.
 */
export function originOf(
  p: { userId: string; name: string; homeCity?: string | null; homeAirport?: string | null },
  nearest?: string | null,
): Origin {
  const saved = iataOf(p.homeAirport);
  if (saved) return { userId: p.userId, name: p.name, airport: saved, source: 'saved', derived: false };
  const fromCity = airportForCity(p.homeCity);
  if (fromCity) return { userId: p.userId, name: p.name, airport: fromCity, source: 'city', derived: true };
  const near = iataOf(nearest);
  if (near) return { userId: p.userId, name: p.name, airport: near, source: 'nearest', derived: true };
  return { userId: p.userId, name: p.name, airport: null, source: null, derived: false };
}

export interface DepartureGroup {
  airport: string;
  userIds: string[];
  names: string[];
  /** Whose airport here was worked out rather than chosen. */
  derivedFor: string[];
}

/**
 * Travellers grouped by where they fly from — one flight booking each. In a
 * stable order (most people first, then by code) so the same group reads the
 * same way on every open. `unknown` is everybody we cannot place.
 */
export function byDepartureAirport(origins: Origin[]): { groups: DepartureGroup[]; unknown: Origin[] } {
  const at = new Map<string, DepartureGroup>();
  const unknown: Origin[] = [];
  for (const o of origins) {
    if (!o.airport) { unknown.push(o); continue; }
    const g = at.get(o.airport) ?? { airport: o.airport, userIds: [], names: [], derivedFor: [] };
    g.userIds.push(o.userId);
    g.names.push(o.name);
    if (o.derived) g.derivedFor.push(o.userId);
    at.set(o.airport, g);
  }
  const groups = [...at.values()].sort((a, b) =>
    b.userIds.length - a.userIds.length || a.airport.localeCompare(b.airport));
  return { groups, unknown };
}

/**
 * One member's line in /readiness: their ticketing readiness (lib/essentials
 * readinessOf) plus, on a trip with a flight, where they fly from.
 *
 * `status` is the one word the faces read — ready or needs_details. A missing
 * airport only counts once we could read where people fly from: a read that
 * failed is not somebody's missing detail, and asking them to fix what they
 * may already have filled in sends them looking for a mistake that is ours.
 * A night out (no flight) never asks for an airport at all.
 */
export function travelDetails<T extends { ready: boolean; missing: string[] }>(
  t: T,
  o: { flies: boolean; originsRead: boolean; origin: Origin | null },
): T & {
  status: 'ready' | 'needs_details';
  needs?: string[];
  origin?: { airport: string | null; derived: boolean; source: OriginSource | null } | null;
} {
  const needsAirport = o.flies && o.originsRead && !o.origin?.airport;
  return {
    ...t,
    status: t.ready && !needsAirport ? 'ready' : 'needs_details',
    ...(o.flies ? {
      needs: needsAirport ? [...t.missing, 'home airport'] : t.missing,
      origin: o.origin ? { airport: o.origin.airport, derived: o.origin.derived, source: o.origin.source } : null,
    } : {}),
  };
}

/** "Sam", "Sam and Alex", "Sam, Alex and Jo". */
export function namesList(names: string[]): string {
  const n = names.map(x => x.trim() || 'someone');
  if (n.length <= 1) return n[0] ?? 'someone';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/**
 * Why a flight line cannot be priced as one booking, naming who flies from
 * where — or null when everybody leaves from one airport we know.
 *
 * `you` is the reader's id, so their own entry reads "you" rather than their
 * name, and so the one person who can fix a missing airport is told to.
 */
export function departureWhy(
  split: { groups: DepartureGroup[]; unknown: Origin[] },
  you?: string | null,
): string | null {
  const who = (ids: string[], names: string[]) =>
    namesList(ids.map((id, i) => (you && id === you ? 'you' : names[i])));
  if (split.unknown.length) {
    const ids = split.unknown.map(o => o.userId);
    if (ids.length === 1 && you && ids[0] === you) return 'add your home airport in Profile and we can price this flight';
    const verb = ids.length === 1 && !(you && ids[0] === you) ? 'flies' : 'fly';
    // Worded without "home airport" on purpose: checkout turns that phrase
    // into an "Add your home airport →" button (FIX_FOR in reach-app.jsx),
    // which would send the reader to their own Profile to fix somebody else's.
    return `we don't know where ${who(ids, split.unknown.map(o => o.name))} ${verb} from yet — once that's in ${ids.length === 1 ? 'their' : 'each'} Profile, this flight can be priced`;
  }
  if (split.groups.length <= 1) return null;
  const parts = split.groups.map(g => {
    const one = g.userIds.length === 1 && !(you && g.userIds[0] === you);
    return `${who(g.userIds, g.names)} ${one ? 'flies' : 'fly'} from ${g.airport}`;
  });
  return `${namesList(parts)}, so these are separate flight bookings, one per airport. Reach can't price that as one line yet — each airport has its own flight search here instead`;
}
