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

/**
 * Somewhere people live, which is the only kind of answer that is any use.
 *
 * A geocoder answers every question, and some of the questions are not
 * places. Asked for "Test" — the title of a real plan in this database —
 * Nominatim returns a canal in Dehestan-e Dudahak, Iran, with complete
 * confidence. Accepting it would put the search box over rural Iran and then
 * report which of the trip's restaurants had been confirmed against it.
 *
 * So an answer has to be a settlement or an administrative boundary before
 * it is treated as the town somebody is going to. Everything else is read as
 * not knowing, which is a state this app can handle.
 */
const SETTLEMENT: Record<string, Set<string>> = {
  place: new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'municipality', 'borough', 'quarter', 'neighbourhood']),
  boundary: new Set(['administrative']),
};

function isSettlement(cls?: string, type?: string): boolean {
  return Boolean(cls && type && SETTLEMENT[cls]?.has(type));
}

export interface Located {
  lat: number;
  lng: number;
  /** How the map names it, which is what gets searched and shown. */
  name: string;
  /** The exact string that was geocoded, so a wrong box can be traced. */
  from: string;
  /** ISO 3166-1 as the geocoder gave it ("us"), when it did. */
  countryCode?: string | null;
  /** ISO 3166-2 ("US-NC", "GB-SCT"), when it did. Says which download holds it. */
  subdivision?: string | null;
  /**
   * The town, its state and its country, as the map names them ("Portland,
   * Oregon, United States"): what a pin says, so a person can see which
   * Portland we mean. Built from the address parts rather than the display
   * name, which puts a county in the middle.
   */
  label?: string;
}

type NominatimAddress = {
  country_code?: string; 'ISO3166-2-lvl4'?: string;
  city?: string; town?: string; village?: string; hamlet?: string; municipality?: string;
  state?: string; country?: string;
};

/**
 * "Moab, Utah, United States" — the place that matched, then whatever of
 * state and country the map gave.
 *
 * The place's own name comes first, not address.city: a suburb, borough or
 * neighbourhood is a settlement here, and its address.city is the city
 * around it. Brooklyn comes back { suburb: "Brooklyn", city: "New York" },
 * and reading city first labelled a Brooklyn trip "New York, New York" —
 * the same pin as a Manhattan trip, and not the place the plan names.
 */
export function labelOf(name: string, a?: NominatimAddress): string {
  const town = String(name || '').trim() || a?.city || a?.town || a?.village || a?.hamlet || a?.municipality || '';
  const parts: string[] = [];
  for (const p of [town, a?.state, a?.country]) {
    const v = String(p ?? '').trim();
    if (v && !parts.includes(v)) parts.push(v);
  }
  return parts.join(', ') || name;
}

/**
 * Where a town is, or null.
 *
 * Null Island is refused for the same reason /api/nearby had to refuse it:
 * 0,0 is a real point in the Gulf of Guinea and a bug everywhere else, and
 * a box around it would confirm nothing and claim to have checked.
 *
 * Null here means both "no such town" and "could not ask". A caller that
 * remembers the answer must use `locateOrFail`, which tells them apart.
 */
export async function locate(
  city: string,
  country?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Located | null> {
  const found = await locateOrFail(city, country, fetchImpl);
  return found === 'failed' ? null : found;
}

/**
 * Where a town is; null only when Nominatim answered and found no
 * settlement; 'failed' when the question never got an answer (a 5xx, a
 * timeout, the network, a body that is not the JSON it promised).
 *
 * The difference matters to anything that remembers the answer: the seed
 * builder keeps "not found" for 30 days, and one 503 stored as "not found"
 * would leave a planned town with no venues for a month.
 */
export async function locateOrFail(
  city: string,
  country?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Located | null | 'failed'> {
  const town = String(city || '').trim();
  if (!town) return null;

  const q = [town, country].filter(Boolean).join(', ');
  const url = `${API}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;

  let hits: {
    lat?: string; lon?: string; display_name?: string; name?: string; class?: string; type?: string;
    address?: NominatimAddress;
  }[];
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': AGENT },
      signal: AbortSignal.timeout(8000),
      // A town does not move, and everyone on the same trip asks about the
      // same one.
      next: { revalidate: 86400 },
    } as RequestInit);
    if (!res.ok) return 'failed';
    hits = await res.json();
  } catch {
    // Unreachable is not "no such town".
    return 'failed';
  }
  if (!Array.isArray(hits)) return 'failed';
  const hit = hits[0];
  if (!hit) return null;

  // A canal is not a town. See SETTLEMENT above for why this is here.
  if (!isSettlement(hit.class, hit.type)) return null;

  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;

  // The first part of the display name is the town itself; the rest is the
  // county and country, which Wikivoyage does not title its pages with.
  const name = String(hit.display_name || town).split(',')[0].trim() || town;
  return {
    lat, lng, name, from: q,
    countryCode: hit.address?.country_code ?? null,
    subdivision: hit.address?.['ISO3166-2-lvl4'] ?? null,
    label: labelOf(String(hit.name || '').trim() || name, hit.address),
  };
}

/**
 * Where a plan is, from whatever the plan actually holds.
 *
 * destination_city is the right field and it is empty on every real trip in
 * this database — both of them. It is populated on the E2E fixtures and on
 * nothing else, because it was wired up after those trips were made, so a
 * route that insisted on it would refuse to check exactly the itineraries
 * worth checking.
 *
 * The title is the fallback and never the preference: "Moab, Utah, USA" is a
 * perfectly good thing to hand a geocoder, and "Test" is not, which is what
 * the settlement guard is for. Between them, a plan with a real destination
 * resolves and a plan without one honestly does not.
 */
export async function locatePlan(
  plan: { title?: string | null; destination_city?: string | null; destination_country?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<Located | null> {
  const found = await locatePlanOrFail(plan, fetchImpl);
  return found === 'failed' ? null : found;
}

/**
 * locatePlan, telling "no such place" from "could not ask" — for anything
 * that stores the answer. The trip map keeps the point on the plan, and a
 * 503 kept as "nowhere" would leave a real trip off the map for good; a
 * failure stores nothing and is asked again next time.
 *
 * `titleFallback: false` asks about destination_city only. A night out
 * called "Friday drinks" is not a place, and a geocoder will still find one.
 */
export async function locatePlanOrFail(
  plan: { title?: string | null; destination_city?: string | null; destination_country?: string | null },
  fetchImpl: typeof fetch = fetch,
  opts: { titleFallback?: boolean } = {},
): Promise<Located | null | 'failed'> {
  let failed = false;
  const city = String(plan.destination_city || '').trim();
  if (city) {
    const found = await locateOrFail(city, plan.destination_country, fetchImpl);
    if (found === 'failed') failed = true;
    else if (found) return found;
  }

  const title = String(plan.title || '').trim();
  // A title that is also the city would just repeat the query above.
  if (opts.titleFallback !== false && title && title.toLowerCase() !== city.toLowerCase()) {
    const found = await locateOrFail(title, null, fetchImpl);
    if (found === 'failed') failed = true;
    else if (found) return found;
  }
  // One question unanswered means we do not know, even if the other said no.
  return failed ? 'failed' : null;
}

/**
 * Which country and state a point is in, or null over the sea.
 *
 * Asked at state level (zoom 5), because that is the only question the map
 * job has: which download holds this point. Same courtesy as `locate`: an
 * identified agent, and the caller spaces requests a second apart.
 */
export async function whereIs(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ countryCode: string | null; subdivision: string | null } | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  const url = `${API.replace(/search$/, 'reverse')}?lat=${lat}&lon=${lng}&format=jsonv2&zoom=5&addressdetails=1`;
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = await res.json() as { address?: NominatimAddress; error?: string };
    if (!body?.address || body.error) return null;
    return {
      countryCode: body.address.country_code ?? null,
      subdivision: body.address['ISO3166-2-lvl4'] ?? null,
    };
  } catch {
    return null;
  }
}
