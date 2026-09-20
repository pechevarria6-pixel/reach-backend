// ─── Checking that a place on somebody's itinerary is real ──────────────
// A generated itinerary names restaurants, bars and shops, and states things
// about them: that they take cards, that Milt's is cash only, that a museum
// is open on a Tuesday. Those read as facts because they are written as
// facts, and nothing checked any of them.
//
// Checked against Moab's actual itinerary before this existed:
//
//   Milt's Stop & Eat   in OpenStreetMap    no payment data recorded
//   Antica Forma        in OpenStreetMap    no payment data recorded
//   El Charro Loco      not in OpenStreetMap at all
//   Peace Tree Juice    not in OpenStreetMap at all
//
// So half the named places could not be confirmed to exist, and not one of
// the payment claims could be sourced from anything. "Cash only" being wrong
// leaves somebody at a till with a card and no way to pay, which is exactly
// the kind of small disaster this app exists to prevent.
//
// The rule here follows from that: state what a source says, say plainly
// when nothing does, and never dress an inference as a fact.

import { boundingBox } from './osm.ts';
import { adviceFor, type Advice } from './wikivoyage.ts';

export interface VenueFacts {
  /** The name as the source spells it, which may differ from the itinerary. */
  name: string;
  /** What kind of place the source says it is. */
  kind: string | null;
  phone: string | null;
  website: string | null;
  /** Opening hours in OSM's own syntax, when recorded. */
  hours: string | null;
  /**
   * Payment, only where a source actually records it. An empty list means
   * nobody has recorded it — never that cards are refused.
   */
  payment: string[];
  /** Where this came from, so a claim can always be traced. */
  source: 'osm';
}

export type Verification =
  | { status: 'confirmed'; facts: VenueFacts }
  /** Searched properly and it is not there. Worth saying out loud. */
  | { status: 'not_found' }
  /** The source was unreachable. Not the same as absent — ask again later. */
  | { status: 'unchecked'; reason: string };

/** Words that stop two different places matching on a shared word. */
const NOISE = new Set([
  // Words that belong to any business of its kind.
  'the', 'and', 'restaurant', 'cafe', 'coffee', 'bar', 'grill', 'kitchen',
  'house', 'co', 'company', 'at', 'of', 'on', 'in', 'a', 'an', 'eat', 'stop',
  // And the words an itinerary wraps a venue in. "Dinner at the bar at
  // Antica Forma for wood-fired pizza" is a sentence about Antica Forma, but
  // 'dinner' is its longest word, and searching a map for 'dinner' near Moab
  // returns everywhere that serves any.
  'dinner', 'lunch', 'brunch', 'breakfast', 'drinks', 'dine', 'dining',
  'visit', 'explore', 'stroll', 'walk', 'hike', 'tour', 'stop', 'head',
  'morning', 'afternoon', 'evening', 'night', 'day', 'early', 'late',
  'grab', 'catch', 'check', 'out', 'over', 'from', 'with', 'for', 'then',
  'your', 'you', 'we', 'us', 'our', 'before', 'after', 'first', 'last',
]);

export function terms(name: string): string[] {
  return String(name || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !NOISE.has(w));
}

/**
 * Lowercased, stripped of punctuation, single-spaced, space-padded.
 *
 * The possessive goes first and separately. Removing apostrophes wholesale
 * turns "Desert Bistro's counter" into "desert bistros", which no longer
 * contains "desert bistro", so a restaurant the map knows about — with a
 * phone number — came back unconfirmed on the strength of one letter.
 * An itinerary writes venue names possessively all the time.
 */
export function normalise(text: string): string {
  const stripped = String(text || '')
    .toLowerCase()
    .replace(/['’]s\b/g, ' ')        // "Desert Bistro's" → "desert bistro"
    .replace(/['’]/g, '')            // "Milt's" → "milts", once the above is done
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${stripped} `;
}

/**
 * Is this the place the itinerary meant?
 *
 * The source's name has to appear in the sentence as a phrase. Counting
 * shared words was tried first and confirmed the wrong venues, on real data,
 * repeatedly:
 *
 *   "Moab Giants dinosaur tracks museum"        matched  Moab Museum
 *   "Sunrise at Dead Horse Point State Park"    matched  Potash Road Petroglyphs
 *   "Dinner at El Charro Loco, patio seating"   matched  Milt's Stop & Eat
 *
 * Every one of those shared enough words to pass and named somewhere else.
 * Moab Giants and the Moab Museum are two different institutions, and an
 * itinerary that sends somebody to one with the other's phone number is
 * worse than an itinerary that says nothing.
 *
 * Phrase containment only ever fails the other way. "a solo shake at Milt's"
 * will not confirm "Milt's Stop & Eat", so a real venue goes unconfirmed and
 * the screen says nothing about it — which is the safe direction, and the
 * only direction this is allowed to be wrong in.
 */
export function isSamePlace(
  itineraryText: string,
  sourceName: string,
  /**
   * Words that prove nothing here — the town's own name, most of all. Moab
   * has a Moab Museum, a Moab Brewery and a great many other Moabs.
   */
  ignore: Set<string> = new Set(),
): boolean {
  const name = normalise(sourceName);
  const distinctive = name.trim().split(' ').filter(w => w && !ignore.has(w));
  // A name that is nothing but the town's own name identifies nothing.
  if (!distinctive.length) return false;
  // Two letters is not a name to search on.
  if (name.trim().length < 3) return false;
  return normalise(itineraryText).includes(name);
}

/** What OSM records, in the shape the app reads. */
export function factsFrom(tags: Record<string, string>): VenueFacts {
  const payment = Object.entries(tags)
    .filter(([k, v]) => k.startsWith('payment:') && v === 'yes')
    .map(([k]) => k.slice('payment:'.length));
  return {
    name: tags.name,
    kind: tags.amenity || tags.shop || tags.tourism || tags.leisure || null,
    phone: tags.phone || tags['contact:phone'] || null,
    website: tags.website || tags['contact:website'] || null,
    hours: tags.opening_hours || null,
    payment,
    source: 'osm',
  };
}

/**
 * What we can honestly say about payment.
 *
 * Nothing recorded means nothing recorded. It does not mean cards are taken
 * and it does not mean cash only — and a generated line saying either would
 * be this app inventing an operational fact about somebody else's business.
 */
export function paymentLine(facts: VenueFacts): string | null {
  if (!facts.payment.length) return null;
  const cards = facts.payment.filter(p => ['cards', 'visa', 'mastercard', 'debit_cards', 'credit_cards', 'amex', 'american_express'].includes(p));
  const cash = facts.payment.includes('cash');
  if (cards.length && cash) return 'Cards and cash';
  if (cards.length) return 'Cards accepted';
  if (cash) return 'Cash';
  return null;
}

// ─── Asking the sources ─────────────────────────────────────────────────

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UA = 'ReachVerify/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';
/** Measured ceiling: above this Overpass returns 504 rather than an answer. */
const SEARCH_MILES = 5;

/**
 * Look a named place up on the map, near where the trip is.
 *
 * Asked by name rather than by pulling every restaurant in town: the name is
 * the question, and a targeted query is one a donated service can answer
 * without resenting us for it.
 */
/** The tags a place somebody eats at, drinks at or visits is mapped under. */
const KINDS: [string, string][] = [
  ['amenity', 'restaurant'], ['amenity', 'cafe'], ['amenity', 'bar'],
  ['amenity', 'pub'], ['amenity', 'fast_food'], ['amenity', 'ice_cream'],
  ['amenity', 'biergarten'], ['amenity', 'nightclub'], ['amenity', 'theatre'],
  ['amenity', 'cinema'], ['amenity', 'marketplace'],
  ['tourism', 'museum'], ['tourism', 'attraction'], ['tourism', 'gallery'],
  ['tourism', 'viewpoint'], ['tourism', 'zoo'], ['tourism', 'aquarium'],
  ['leisure', 'park'], ['shop', 'bakery'], ['shop', 'deli'],
];

/**
 * Every mapped place near the trip, fetched once for the whole itinerary.
 *
 * Three things were measured to arrive at this query, all of them the hard
 * way, all of them returning 504 until they did not:
 *
 *   25 miles, name regex     504 on all three mirrors, both box sizes
 *   25 miles, equality only  504
 *    5 miles, equality only  200 in 4.7s, 54 places
 *    2 miles, equality only  200 in 1.5s, 52 places
 *
 * So: no name regex, because Overpass has to read every name in the box to
 * answer one and will not; equality on indexed tags instead, and the names
 * matched here, where matching is free. And a small box, because the cost is
 * in the area and a town's restaurants are in its town.
 *
 * That last point is a real limit, and the honest consequence of it is that
 * 'not_found' means "not on the map within five miles of the centre", not
 * "does not exist". It is enough to stop Reach repeating a claim. It is not
 * enough to tell somebody their restaurant is not real, and nothing here
 * says that to anybody.
 */
async function nearbyPlaces(
  near: { lat: number; lng: number },
  fetchImpl: typeof fetch,
  budgetMs: number,
): Promise<Record<string, string>[] | null> {
  const box = boundingBox(near.lat, near.lng, SEARCH_MILES);
  const body = `[out:json][timeout:${Math.ceil(budgetMs / 1000)}];
(
${KINDS.map(([k, v]) => `  nwr[${k}=${v}](${box});`).join('\n')}
);
out center 400;`;

  for (const mirror of MIRRORS) {
    try {
      const res = await fetchImpl(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'User-Agent': UA },
        signal: AbortSignal.timeout(budgetMs),
        body,
        // One town, six hours. Everyone on the same trip asks the same
        // question, and it is somebody else's donated server.
        next: { revalidate: 21600 },
      } as RequestInit);
      if (!res.ok) continue;
      const json = await res.json() as { elements?: { tags?: Record<string, string> }[] };
      return (json.elements ?? []).map(e => e.tags ?? {}).filter(t => t.name);
    } catch {
      // Next mirror. Only when all three are silent is anything unchecked.
    }
  }
  return null;
}

export interface Checked {
  /** What the itinerary called it. */
  said: string;
  verification: Verification;
  /** A traveller's write-up of the same place, when there is one. */
  advice: Advice | null;
  /** Payment we can stand behind, or null. Never a guess. */
  payment: string | null;
}

/**
 * Check everything an itinerary names, against the town it names it in.
 *
 * Wikivoyage is fetched once for the whole town rather than once per place,
 * because it is one page and twenty-six listings.
 */
export async function checkAll(
  names: string[],
  place: { name: string; lat: number; lng: number },
  fetchImpl: typeof fetch = fetch,
  budgetMs = 25000,
): Promise<Checked[]> {
  // "Moab" is not evidence of anything in Moab.
  const ignore = new Set(terms(place.name));

  // One page for the whole town, one map query for the whole itinerary.
  const [{ advice }, mapped] = await Promise.all([
    adviceFor(place.name, fetchImpl),
    nearbyPlaces(place, fetchImpl, budgetMs),
  ]);

  return names.map((said): Checked => {
    const written = advice.find(a => isSamePlace(said, a.name, ignore)) ?? null;

    // Null means the map never answered, which is not the same as the place
    // not being there, and must never be shown as though it were.
    const verification: Verification = mapped === null
      ? { status: 'unchecked', reason: 'no mirror answered' }
      : (() => {
          const hit = mapped.find(t => isSamePlace(said, t.name, ignore));
          return hit ? { status: 'confirmed', facts: factsFrom(hit) } : { status: 'not_found' };
        })();

    // Only what a source records. The map's payment tags are entered by
    // somebody who looked. Anything else stays null, and the screen renders
    // null as nothing at all rather than as a reassurance.
    const payment = verification.status === 'confirmed' ? paymentLine(verification.facts) : null;

    return { said, verification, advice: written, payment };
  });
}

/** How many of an itinerary's named places we could actually confirm. */
export function tally(checked: Checked[]) {
  return {
    named: checked.length,
    confirmed: checked.filter(c => c.verification.status === 'confirmed').length,
    notFound: checked.filter(c => c.verification.status === 'not_found').length,
    unchecked: checked.filter(c => c.verification.status === 'unchecked').length,
    withPayment: checked.filter(c => c.payment).length,
    withAdvice: checked.filter(c => c.advice).length,
  };
}
