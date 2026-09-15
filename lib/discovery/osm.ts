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
import { notRuledOut } from './rules.ts';
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

export async function openStreetMap(seeker: Seeker, budgetMs = 8000): Promise<SourceResult> {
  // Only the kinds the map can answer. Nothing left is not an error: they
  // have not told us anything the map knows about.
  const interests = [...new Set(seeker.interests.slice(0, 6).map(i => kindFor(i).key))]
    .filter(i => tagsFor(i).length);
  if (!interests.length) return { source: 'osm', status: 'ok', findings: [] };

  // Fifteen miles, not twenty-five: nobody crosses a city for a class,
  // and the wider box is what makes a dense city time out.
  const box = boundingBox(seeker.lat, seeker.lng, 15);
  // Let the server take as long as we are prepared to wait, and no longer.
  const body = overpassQuery(interests, box, 15, Math.ceil(budgetMs / 1000));

  let json: any = null;
  let lastDetail = 'no mirror answered';
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      // A mirror under load does not refuse, it hangs. Without a deadline of
      // our own, three mirrors in a row take longer than anybody will wait
      // and longer than the function is allowed to run.
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'User-Agent': UA },
        signal: AbortSignal.timeout(budgetMs),
        body,
        // Asking a donated service the same question for every person who
        // opens Discover in the same city would be rude, and would get us
        // blocked. Six hours is plenty for a map.
        next: { revalidate: 21600 },
      });
      if (!res.ok) {
        lastDetail = `${new URL(mirror).host} ${res.status}`;
        console.error('[discover/osm] Overpass returned', res.status, 'from', new URL(mirror).host);
        continue;
      }
      json = await res.json();
      break;
    } catch (e: unknown) {
      lastDetail = e instanceof Error ? e.message : 'request failed';
      console.error('[discover/osm] Overpass request failed at', new URL(mirror).host, lastDetail);
    }
  }
  if (!json) return { source: 'osm', status: 'error', findings: [], detail: lastDetail };

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
    if (notRuledOut(`${finding.title} ${finding.meta}`, seeker.avoid)) findings.push(finding);
  }

  return { source: 'osm', status: 'ok', findings };
}
