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
