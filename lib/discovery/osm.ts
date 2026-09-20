// ─── OpenStreetMap: the places themselves ────────────────────────────────
// Every partner API is somebody's catalogue. Ticketmaster has arenas,
// Yelp has whatever has been reviewed, and a pottery studio that has run a
// Tuesday evening class for eleven years may be in neither. It is almost
// certainly in OpenStreetMap, which is a map of the world maintained by
// people who live there.
//
// Overpass is OSM's query API. No key, no signup, no quota to negotiate —
// which also means no rate limit to hide behind, so this identifies itself,
// asks for a bounded area, and caches hard.
//
// What it gives us is venues, not dates: "Stockbridge Ceramics, a pottery,
// here, with this website". Turning that into "Wednesday, 7pm, £45" is the
// harvest step, and it is slow, so it does not happen in a request.
import type { Finding, SourceResult, Seeker } from './types.ts';
import { canTurnUp, notRuledOut } from './rules.ts';
import { kindFor } from './taste.ts';

// Overpass is run by volunteers on donated hardware and the main instance
// answers 504 under load — a dense city and a wide box is enough to do it.
// Three mirrors, tried in order, because "your city is empty" is the worst
// possible way for a free service being busy to present itself.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// Overpass asks every client to identify itself. A tool that does not is
// indistinguishable from a scraper and gets blocked, deservedly.
const UA = 'ReachDiscovery/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

/** Which selectors to run for what somebody told us they are into. */
export function tagsFor(interest: string): string[] {
  return kindFor(interest).osm;
}

/**
 * Whether a mapped element answers a selector such as
 * `amenity=restaurant][cuisine~"thai",i` — every part has to hold.
 */
export function matchesSelector(selector: string, tags: Record<string, string>): boolean {
  return selector.split('][').every(part => {
    const pattern = /^([^=~]+)~"(.*)",i$/.exec(part);
    if (pattern) {
      try { return new RegExp(pattern[2], 'i').test(tags[pattern[1]] ?? ''); } catch { return false; }
    }
    const [k, v] = part.split('=');
    return tags[k] === v;
  });
}

/** A box of roughly `miles` around a point. Overpass wants south,west,north,east. */
export function boundingBox(lat: number, lng: number, miles: number): string {
  const dLat = miles / 69;
  // Longitude degrees shrink towards the poles; at 60° north they are half
  // the width they are at the equator, and a fixed offset would search a box
  // twice as wide as asked for in Edinburgh and correctly in Quito.
  const dLng = miles / (69 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const r = (n: number) => Number(n.toFixed(4));
  return `${r(lat - dLat)},${r(lng - dLng)},${r(lat + dLat)},${r(lng + dLng)}`;
}

export function overpassQuery(interests: string[], box: string, perKind = 15, timeoutSec = 25): string {
  // One output per kind of place, each with its own cap. Under a single cap
  // a city's restaurants fill it before the one pottery studio gets a look.
  // `out center` gives ways and relations a coordinate; without it a studio
  // mapped as a building outline comes back with no position at all.
  const blocks = interests
    .map(tagsFor)
    .filter(selectors => selectors.length)
    .map(selectors => `(\n${selectors.map(sel => `  nwr[${sel}](${box});`).join('\n')}\n);\nout center ${perKind};`)
    .join('\n');
  // The server's own limit, which it enforces by refusing. At fifteen seconds
  // Aberdeen, New Jersey came back 504 after twelve; given room, the same
  // query answered in fourteen with twenty-nine places.
  return `[out:json][timeout:${timeoutSec}];\n${blocks}`;
}

/** A finding's id, built from what the map calls the element. */
export const osmFindingId = (type: string, id: number | string) => `osm_${type}_${id}`;

/** And back again: osm_way_456 is the way 456. Anything else is not ours. */
export function osmRef(findingId: string): { type: string; id: number } | null {
  const m = /^osm_([a-z]+)_(\d+)$/.exec(findingId);
  return m ? { type: m[1], id: Number(m[2]) } : null;
}

const websiteOf = (tags: Record<string, string> = {}) =>
  tags.website || tags['contact:website'] || tags.url || null;

/**
 * The narrowest box a place has actually answered at.
 *
 * Held in memory only, and deliberately: it is an optimisation, not a fact
 * about the world. A cold serverless instance simply starts wide again and
 * finds out, which is correct — a city that was too dense last week may have
 * a healthier mirror today.
 */
const ANSWERED_AT = new Map<string, number>();

/** Rounded, so the same town is the same key however it was located. */
function placeKey(at: { lat: number; lng: number }): string {
  return `${at.lat.toFixed(1)},${at.lng.toFixed(1)}`;
}

function worked(at: { lat: number; lng: number }): number | null {
  return ANSWERED_AT.get(placeKey(at)) ?? null;
}

function remember(at: { lat: number; lng: number }, miles: number): void {
  ANSWERED_AT.set(placeKey(at), miles);
}

function forget(at: { lat: number; lng: number }): void {
  ANSWERED_AT.delete(placeKey(at));
}

/**
 * One question, asked of each mirror in turn.
 *
 * A mirror under load does not refuse, it hangs. Without a deadline of our
 * own, three mirrors in a row take longer than anybody will wait and longer
 * than the function is allowed to run.
 */
async function askOverpass(
  body: string,
  budgetMs: number,
  note: (detail: string) => void,
): Promise<any | null> {
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'User-Agent': UA },
        signal: AbortSignal.timeout(budgetMs),
        body,
        // Asking a donated service the same question for every person who
        // opens Discover in the same city would be rude, and would get us
        // blocked. Six hours is plenty for a map.
        next: { revalidate: 21600 },
      } as RequestInit);
      if (!res.ok) {
        note(`${new URL(mirror).host} ${res.status}`);
        console.error('[discover/osm] Overpass returned', res.status, 'from', new URL(mirror).host);
        continue;
      }
      return await res.json();
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : 'request failed';
      note(detail);
      console.error('[discover/osm] Overpass request failed at', new URL(mirror).host, detail);
    }
  }
  return null;
}

export async function openStreetMap(seeker: Seeker, budgetMs = 8000): Promise<SourceResult> {
  // Only the kinds the map can answer. Nothing left is not an error: they
  // have not told us anything the map knows about.
  const interests = [...new Set(seeker.interests.slice(0, 6).map(i => kindFor(i).key))]
    .filter(i => tagsFor(i).length);
  if (!interests.length) return { source: 'osm', status: 'ok', findings: [] };

  // Widest first, shrinking until the map answers.
  //
  // Fifteen miles was already narrowed from twenty-five because "the wider
  // box is what makes a dense city time out", and it is still too wide for a
  // real city. Raleigh at fifteen miles never came back at all: every kind,
  // every mirror, minutes of somebody else's donated capacity, nothing
  // stored. The cache held thirty-nine venues and not one of them was in the
  // city the owner actually lives in.
  //
  // The cost is in how much is inside the box rather than how far across it
  // is, so there is no single right number. Measured on real places:
  //
  //   Moab (pop. 5,000)               5mi  54 places in 4.7s
  //   Puerto Vallarta (pop. 200,000)  5mi  504 · 3mi 504 · 2mi 260 in 3.3s
  //
  // A near answer beats no answer: somebody in a city has more within two
  // miles than somebody in a town has within fifteen, so shrinking costs
  // them nothing and is the only way they get anything at all.
  const RADII = [15, 8, 4, 2];

  let json: any = null;
  let lastDetail = 'no mirror answered';
  // Start where this place last answered. A sweep asks the same city a dozen
  // times — four kinds per question — and rediscovering that fifteen miles
  // will not work costs seventy-five seconds of somebody else's donated
  // capacity on every one of them. Remembered per place, not globally,
  // because a town and a city do not have the same answer.
  const start = Math.max(0, RADII.indexOf(worked(seeker) ?? RADII[0]));
  let usedMiles = RADII[start];

  for (const miles of RADII.slice(start)) {
    usedMiles = miles;
    const box = boundingBox(seeker.lat, seeker.lng, miles);
    // Let the server take as long as we are prepared to wait, and no longer.
    const body = overpassQuery(interests, box, 15, Math.ceil(budgetMs / 1000));
    json = await askOverpass(body, budgetMs, d => { lastDetail = d; });
    if (json) break;
  }
  if (!json) {
    // Nothing worked even at the tightest box, so forget what we thought we
    // knew: the next attempt should start wide again rather than inherit a
    // radius that has just failed.
    forget(seeker);
    return { source: 'osm', status: 'error', findings: [], detail: lastDetail };
  }
  if (usedMiles !== RADII[0]) {
    remember(seeker, usedMiles);
    console.error('[discover/osm] answered only at', usedMiles, 'miles for', seeker.city || `${seeker.lat},${seeker.lng}`);
  }

  // Which interest found it, so the card can say. An element can match more
  // than one; the first interest that claims it wins, which is the one they
  // picked earliest and so care about most.
  const claim = (tags: Record<string, string>) =>
    interests.find(i => tagsFor(i).some(sel => matchesSelector(sel, tags))) || interests[0];

  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const el of json?.elements ?? []) {
    const tags: Record<string, string> = el.tags || {};
    const name = tags.name;
    const site = websiteOf(tags);
    // No name is a fence or a shed somebody mapped. No website is a place we
    // cannot send anybody to, and a card you cannot act on is not a card.
    if (!name || !site || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    const interest = claim(tags);
    const what = (tags.craft || tags.shop || tags.amenity || tags.leisure || tags.tourism || '')
      .replace(/_/g, ' ');
    const where = tags['addr:street'] || tags['addr:city'] || seeker.city;

    const finding: Finding = {
      id: osmFindingId(el.type, el.id),
      title: name,
      meta: [what, where].filter(Boolean).join(' · '),
      emoji: kindFor(interest).emoji,
      // OSM does not carry prices, and inventing one would be a lie about
      // money. The card says where to look instead.
      price: null,
      dist: null,
      category: interest.charAt(0).toUpperCase() + interest.slice(1),
      url: site.startsWith('http') ? site : `https://${site}`,
      // A studio is open on Tuesdays; it does not happen once.
      date: null,
      venue: tags['addr:street'] || null,
      source: 'osm',
      because: interest,
      // `out center` gives a way or relation a point of its own, so a studio
      // mapped as a building outline still knows where it is.
      lat: el.lat ?? el.center?.lat ?? null,
      lng: el.lon ?? el.center?.lon ?? null,
    };
    // A caterer or a campus can carry a tag we asked for. Neither is a night out.
    if (canTurnUp(name, [what]) && notRuledOut(`${finding.title} ${finding.meta}`, seeker.avoid)) findings.push(finding);
  }

  return { source: 'osm', status: 'ok', findings };
}
